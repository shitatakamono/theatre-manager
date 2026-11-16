import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Timestamp } from "firebase-admin/firestore";

import { handleGoogleCalendarSyncPreferencesPatch } from "../lib/server/google-calendar-sync-preferences-handler.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const uid = "calendar-preference-user";
const projectId = "calendar-preference-project";

let adminDb;

before(async () => {
  process.env.FIREBASE_ADMIN_PROJECT_ID = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  ({ adminDb } = await import("../lib/server/firebase-admin.ts"));
});

beforeEach(async () => {
  await Promise.all([
    adminDb.recursiveDelete(adminDb.collection("projects").doc(projectId)),
    adminDb.recursiveDelete(adminDb.collection("googleCalendarConnections").doc(uid)),
    adminDb.collection("googleCalendarSyncJobs").doc(`${uid}__${projectId}`).delete(),
  ]);

  const project = adminDb.collection("projects").doc(projectId);
  await Promise.all([
    project.set({ title: "同期設定テスト" }),
    project.collection("members").doc(uid).set({ uid, role: "viewer" }),
  ]);
});

after(async () => {
  if (!adminDb) return;
  await Promise.all([
    adminDb.recursiveDelete(adminDb.collection("projects").doc(projectId)),
    adminDb.recursiveDelete(adminDb.collection("googleCalendarConnections").doc(uid)),
    adminDb.collection("googleCalendarSyncJobs").doc(`${uid}__${projectId}`).delete(),
  ]);
});

describe("Google Calendar project sync preferences", () => {
  async function saveThroughApi(rehearsalTypes, requestedUid = "ignored-client-uid") {
    const preferenceRef = adminDb.collection("googleCalendarConnections").doc(uid)
      .collection("projectSettings").doc(projectId);
    const jobRef = adminDb.collection("googleCalendarSyncJobs").doc(`${uid}__${projectId}`);
    const response = await handleGoogleCalendarSyncPreferencesPatch(
      new Request("https://example.test/api/google-calendar/project-settings", {
        method: "PATCH",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
        body: JSON.stringify({ projectId, uid: requestedUid, rehearsalTypes }),
      }),
      {
        verifyIdToken: async () => ({ uid }),
        isProjectMember: async (targetUid, targetProjectId) => (
          await adminDb.collection("projects").doc(targetProjectId).collection("members").doc(targetUid).get()
        ).exists,
        getView: async () => ({ configured: false, connected: true, rehearsalTypes: [] }),
        save: async (targetUid, targetProjectId, types) => {
          await adminDb.collection("googleCalendarConnections").doc(targetUid)
            .collection("projectSettings").doc(targetProjectId).set({
              projectId: targetProjectId,
              rehearsalTypes: types,
              updatedAt: Timestamp.now(),
            });
        },
        enqueue: async (input) => { await jobRef.set(input); },
      }
    );
    return { response, preferenceRef, jobRef };
  }

  it("saves the authenticated member's normalized setting and enqueues reconcile", async () => {
    const { response, preferenceRef, jobRef } = await saveThroughApi(["meeting", "acting"]);
    strictEqual(response.status, 200);
    deepStrictEqual((await preferenceRef.get()).data()?.rehearsalTypes, ["acting", "meeting"]);
    strictEqual((await adminDb.collection("googleCalendarConnections").doc("ignored-client-uid")
      .collection("projectSettings").doc(projectId).get()).exists, false);
    strictEqual((await jobRef.get()).data()?.reason, "sync_preferences_changed");
  });

  it("persists an explicit clear-all choice without changing project membership", async () => {
    const { response, preferenceRef } = await saveThroughApi([]);
    strictEqual(response.status, 200);
    deepStrictEqual((await preferenceRef.get()).data()?.rehearsalTypes, []);
    strictEqual((await adminDb.collection("projects").doc(projectId).collection("members").doc(uid).get()).exists, true);
  });
});
