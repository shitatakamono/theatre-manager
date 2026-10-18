import { readFile } from "node:fs/promises";
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  createProjectRehearsal,
  createProjectRehearsalBatch,
  createProjectRehearsals,
  deleteProjectRehearsal,
  rehearsalToInput,
  updateProjectRehearsal,
} from "../lib/rehearsals.ts";
import { isConflictError } from "../lib/project-revisions.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "rehearsal-conflict";
const rehearsalId = "rehearsal-a";
const ownerUid = "rehearsal-owner";
const editorUid = "rehearsal-editor";
const viewerUid = "rehearsal-viewer";
let testEnv;

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function rehearsalRef(db) { return doc(db, "projects", projectId, "rehearsals", rehearsalId); }

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), { title: "稽古競合テスト", memberUids: [ownerUid, editorUid, viewerUid] });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
    await setDoc(doc(db, "projects", projectId, "members", viewerUid), { uid: viewerUid, role: "viewer" });
    await setDoc(rehearsalRef(db), {
      startAt: new Date("2026-11-15T04:00:00Z"), endAt: new Date("2026-11-15T07:00:00Z"),
      type: "acting", customType: "", venue: "会議室A", content: "立ち稽古", note: "",
      revision: 0, createdAt: new Date(), updatedAt: new Date(), createdByUid: ownerUid, updatedByUid: ownerUid,
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => { await testEnv.cleanup(); });

describe("rehearsal document transactions", () => {
  it("imports one reservation for an owner with revision zero and one activity log", async () => {
    const db = firestoreFor(ownerUid);
    const ids = await createProjectRehearsalBatch(projectId, [{
      date: "2026-11-20", startTime: "13:00", endTime: "16:00", type: "acting", customType: "",
      venue: "会議室A", content: "立ち稽古", note: "画像から確認",
    }], context(ownerUid, 0).actor, "スクリーンショットから稽古予定を1件追加", db);
    strictEqual(ids.length, 1);
    strictEqual((await getDoc(doc(db, "projects", projectId, "rehearsals", ids[0]))).data()?.revision, 0);
    const logDocs = await logs(db);
    strictEqual(logDocs.size, 1);
    deepStrictEqual(logDocs.docs[0].data().changedFields, ["スクリーンショットから稽古予定を1件追加"]);
  });

  it("imports multiple reservations for an editor in one batch with one activity log", async () => {
    const db = firestoreFor(editorUid);
    const inputs = ["2026-11-20", "2026-11-21"].map((date) => ({
      date, startTime: "13:00", endTime: "16:00", type: "acting", customType: "",
      venue: "会議室A", content: "", note: "",
    }));
    const ids = await createProjectRehearsalBatch(projectId, inputs, context(editorUid, 0).actor, "スクリーンショットから稽古予定を2件追加", db);
    strictEqual(ids.length, 2);
    strictEqual((await logs(db)).size, 1);
  });

  it("does not write a partially invalid import batch and denies viewer writes", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const valid = {
      date: "2026-11-20", startTime: "13:00", endTime: "16:00", type: "acting", customType: "",
      venue: "会議室A", content: "", note: "",
    };
    await rejects(() => createProjectRehearsalBatch(projectId, [valid, { ...valid, startTime: "25:00" }], context(ownerUid, 0).actor, "2件追加", ownerDb));
    strictEqual((await getDocs(collection(ownerDb, "projects", projectId, "rehearsals"))).size, 1);
    strictEqual((await logs(ownerDb)).size, 0);
    await rejects(() => createProjectRehearsalBatch(projectId, [valid], context(viewerUid, 0).actor, "1件追加", firestoreFor(viewerUid)));
  });

  it("creates one log per single add and one log for an entire deduplicated bulk add", async () => {
    const db = firestoreFor(ownerUid);
    const input = {
      date: "2026-11-20", startTime: "13:00", endTime: "16:00", type: "acting", customType: "",
      venue: "会議室A", content: "立ち稽古", note: "",
    };
    await createProjectRehearsal(projectId, input, context(ownerUid, 0).actor, db);
    const shared = {
      startTime: input.startTime, endTime: input.endTime, type: input.type, customType: input.customType,
      venue: input.venue, content: input.content, note: input.note,
    };
    const count = await createProjectRehearsals(projectId, ["2026-11-21", "2026-11-22", "2026-11-21"], shared, context(ownerUid, 0).actor, db);
    strictEqual(count, 2);
    strictEqual((await getDocs(collection(db, "projects", projectId, "rehearsals"))).size, 4);
    strictEqual((await logs(db)).size, 2);
  });

  it("rejects a stale update and preserves the first editor's data and single log", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const editorDb = firestoreFor(editorUid);
    const original = await getProjectRehearsalFor(ownerDb);
    await updateProjectRehearsal(ownerDb, projectId, rehearsalId, { ...rehearsalToInput(original), venue: "会議室B" }, context(ownerUid, 0));
    await rejectsConflict(() => updateProjectRehearsal(editorDb, projectId, rehearsalId, { ...rehearsalToInput(original), venue: "和室" }, context(editorUid, 0)));
    const saved = await getDoc(rehearsalRef(ownerDb));
    strictEqual(saved.data()?.venue, "会議室B");
    strictEqual(saved.data()?.revision, 1);
    strictEqual((await logs(ownerDb)).size, 1);
  });

  it("reloads the latest document revision and then saves successfully", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const editorDb = firestoreFor(editorUid);
    const original = await getProjectRehearsalFor(ownerDb);
    await updateProjectRehearsal(ownerDb, projectId, rehearsalId, { ...rehearsalToInput(original), venue: "会議室B" }, context(ownerUid, 0));
    await rejectsConflict(() => updateProjectRehearsal(editorDb, projectId, rehearsalId, { ...rehearsalToInput(original), venue: "和室" }, context(editorUid, 0)));
    const reload = await getProjectRehearsalFor(editorDb);
    const result = await updateProjectRehearsal(editorDb, projectId, rehearsalId, { ...rehearsalToInput(reload), venue: "和室" }, context(editorUid, reload.revision));
    strictEqual(result.revision, 2);
    strictEqual((await logs(ownerDb)).size, 2);
  });

  it("does not write or increment for unchanged values", async () => {
    const db = firestoreFor(ownerUid);
    const original = await getProjectRehearsalFor(db);
    const result = await updateProjectRehearsal(db, projectId, rehearsalId, rehearsalToInput(original), context(ownerUid, 0));
    strictEqual(result.changed, false);
    strictEqual(result.revision, 0);
    strictEqual((await logs(db)).size, 0);
  });

  it("rejects stale deletes and deletes atomically with one activity log at the current revision", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const editorDb = firestoreFor(editorUid);
    const original = await getProjectRehearsalFor(ownerDb);
    await updateProjectRehearsal(ownerDb, projectId, rehearsalId, { ...rehearsalToInput(original), note: "更新" }, context(ownerUid, 0));
    await rejectsConflict(() => deleteProjectRehearsal(editorDb, projectId, rehearsalId, context(editorUid, 0)));
    strictEqual((await getDoc(rehearsalRef(ownerDb))).exists(), true);
    await deleteProjectRehearsal(editorDb, projectId, rehearsalId, context(editorUid, 1));
    strictEqual((await getDoc(rehearsalRef(ownerDb))).exists(), false);
    strictEqual((await logs(ownerDb)).size, 2);
  });
});

function context(uid, expectedRevision) { return { actor: { uid, displayName: uid }, expectedRevision }; }
function logs(db) { return getDocs(collection(db, "projects", projectId, "activityLogs")); }
async function getProjectRehearsalFor(db) {
  const snapshot = await getDoc(rehearsalRef(db));
  const data = snapshot.data();
  return { id: snapshot.id, ...data, revision: data.revision ?? 0 };
}
async function rejectsConflict(operation) {
  try { await operation(); } catch (error) { strictEqual(isConflictError(error), true); return; }
  throw new Error("ConflictError was not thrown");
}
