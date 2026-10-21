import { readFile } from "node:fs/promises";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  getParticipantAttendanceRecords,
  getProjectAttendanceRecords,
  upsertProjectAttendanceRecord,
  upsertProjectAttendanceRecords,
} from "../lib/attendance.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "attendance-integration";
const ownerUid = "attendance-owner";
const editorUid = "attendance-editor";
const viewerUid = "attendance-viewer";
const participantA = "participant-a";
const participantB = "participant-b";
let testEnv;

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), { title: "出欠テスト", memberUids: [ownerUid, editorUid, viewerUid] });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
    await setDoc(doc(db, "projects", projectId, "members", viewerUid), { uid: viewerUid, role: "viewer" });
    await setDoc(doc(db, "projects", projectId, "participants", participantA), { displayName: "参加者A", active: true, linkedUserUid: viewerUid });
    await setDoc(doc(db, "projects", projectId, "participants", participantB), { displayName: "参加者B", active: false });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: emulatorProjectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => { await testEnv.cleanup(); });

describe("attendance transactions", () => {
  it("uses the deterministic ID to update one participant-day record", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const input = {
      participantId: participantA,
      date: "2026-11-03",
      status: "attending",
      availableFrom: "13:00",
      availableUntil: "16:00",
      publicNote: "",
    };
    const created = await upsertProjectAttendanceRecord(projectId, input, ownerUid, ownerDb);
    strictEqual(created.id, "2026-11-03_participant-a");
    strictEqual(created.created, true);

    const updated = await upsertProjectAttendanceRecord(projectId, {
      ...input,
      status: "absent",
      availableFrom: null,
      availableUntil: null,
      publicNote: "欠席",
    }, editorUid, firestoreFor(editorUid));
    strictEqual(updated.created, false);

    const records = await getParticipantAttendanceRecords(projectId, participantA, ownerDb);
    strictEqual(records.length, 1);
    strictEqual(records[0].status, "absent");
    strictEqual(records[0].createdByUid, ownerUid);
    strictEqual(records[0].updatedByUid, editorUid);
  });

  it("saves multiple records atomically through the reusable transaction boundary", async () => {
    const db = firestoreFor(ownerUid);
    const results = await upsertProjectAttendanceRecords(projectId, [
      { participantId: participantA, date: "2026-11-04", status: "tentative", availableFrom: null, availableUntil: null, publicNote: "確認中" },
      { participantId: participantB, date: "2026-11-03", status: "attending", availableFrom: "18:00", availableUntil: "20:00", publicNote: "" },
    ], ownerUid, db);
    deepStrictEqual(results.map(({ id }) => id), ["2026-11-04_participant-a", "2026-11-03_participant-b"]);
    strictEqual((await getDocs(collection(db, "projects", projectId, "attendanceRecords"))).size, 2);
    deepStrictEqual((await getProjectAttendanceRecords(projectId, db)).map(({ id }) => id), [
      "2026-11-03_participant-b",
      "2026-11-04_participant-a",
    ]);
    strictEqual((await getDoc(doc(db, "projects", projectId, "attendanceRecords", results[0].id))).exists(), true);
  });

  it("reuses the Phase 3C upsert boundary for viewer self-entry", async () => {
    const db = firestoreFor(viewerUid);
    const result = await upsertProjectAttendanceRecord(projectId, {
      participantId: participantA,
      date: "2026-11-05",
      status: "attending",
      availableFrom: "13:00",
      availableUntil: "17:00",
      publicNote: "本人入力",
    }, viewerUid, db);
    strictEqual(result.created, true);
    const record = await getDoc(doc(db, "projects", projectId, "attendanceRecords", result.id));
    strictEqual(record.data()?.updatedByUid, viewerUid);
  });
});
