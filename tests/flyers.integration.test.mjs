import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  copyLegacyProjectFlyer,
  copyProjectFlyer,
  createProjectFlyer,
  deleteProjectFlyer,
  getProjectFlyers,
  updateProjectFlyer,
} from "../lib/flyer-store.ts";
import { isConflictError } from "../lib/project-revisions.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "multiple-flyers";
const ownerUid = "flyer-owner";
const editorUid = "flyer-editor";
const viewerUid = "flyer-viewer";
let testEnv;

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function actor(uid) { return { uid, displayName: uid }; }
function flyerRef(db, id) { return doc(db, "projects", projectId, "flyers", id); }

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), {
      title: "複数チラシ", memberUids: [ownerUid, editorUid, viewerUid],
      performances: [{ id: "show-a", date: "2026-11-15", startTime: "13:00" }],
    });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
    await setDoc(doc(db, "projects", projectId, "members", viewerUid), { uid: viewerUid, role: "viewer" });
  });
});

after(async () => { await testEnv.cleanup(); });

describe("multiple flyer transactions and rules", () => {
  it("allows owners and editors to create while viewers remain read-only", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const editorDb = firestoreFor(editorUid);
    const viewerDb = firestoreFor(viewerUid);
    const ownerId = await createProjectFlyer(projectId, { name: "公募用", enabled: true }, actor(ownerUid), ownerDb);
    const editorId = await createProjectFlyer(projectId, { name: "本番用", enabled: false }, actor(editorUid), editorDb);
    strictEqual((await getDoc(flyerRef(viewerDb, ownerId))).exists(), true);
    strictEqual((await getDoc(flyerRef(viewerDb, editorId))).exists(), true);
    await rejects(() => createProjectFlyer(projectId, { name: "作成不可", enabled: true }, actor(viewerUid), viewerDb));
  });

  it("updates one document with revision conflict protection and clears optional fields", async () => {
    const db = firestoreFor(ownerUid);
    const id = await createProjectFlyer(projectId, {
      name: "仮チラシ", enabled: true, quantity: 300, printer: "秘密の印刷所", printCost: 5000,
    }, actor(ownerUid), db);
    const result = await updateProjectFlyer(db, projectId, id, {
      name: "仮チラシ改訂", enabled: true,
    }, { actor: actor(ownerUid), expectedRevision: 0 });
    strictEqual(result.revision, 1);
    const data = (await getDoc(flyerRef(db, id))).data();
    strictEqual(data?.quantity, undefined);
    strictEqual(data?.printer, undefined);
    strictEqual(data?.printCost, undefined);
    await rejects(
      () => updateProjectFlyer(db, projectId, id, { name: "競合", enabled: true }, { actor: actor(ownerUid), expectedRevision: 0 }),
      (error) => isConflictError(error),
    );
  });

  it("atomically records flyer task completion and reopening", async () => {
    const db = firestoreFor(ownerUid);
    const id = await createProjectFlyer(projectId, { name: "本番チラシ", enabled: true }, actor(ownerUid), db);
    await updateProjectFlyer(db, projectId, id, {
      name: "本番チラシ", enabled: true, submissionDate: "2026-10-01", deliveryDate: "2026-10-05",
    }, { actor: actor(ownerUid), expectedRevision: 0 });
    await updateProjectFlyer(db, projectId, id, {
      name: "本番チラシ", enabled: true, deliveryDate: "2026-10-05",
    }, { actor: actor(ownerUid), expectedRevision: 1 });
    await rejects(
      () => updateProjectFlyer(db, projectId, id, { name: "競合", enabled: true }, { actor: actor(ownerUid), expectedRevision: 0 }),
      (error) => isConflictError(error),
    );

    const events = (await getDocs(collection(db, "projects", projectId, "taskEvents"))).docs.map((entry) => entry.data());
    strictEqual(events.length, 3);
    strictEqual(events.filter((event) => event.eventType === "taskCompleted").length, 2);
    strictEqual(events.filter((event) => event.eventType === "taskReopened").length, 1);
    strictEqual(events.every((event) => event.performanceDateSnapshot === "2026-11-15"), true);
    strictEqual(events.every((event) => event.taskId.startsWith(`standard:flyer:record:${id}:`)), true);
  });

  it("duplicates collection and legacy flyers with reset production dates and safe logs", async () => {
    const db = firestoreFor(ownerUid);
    const sourceId = await createProjectFlyer(projectId, {
      name: "本番チラシ", enabled: true, size: "A4", sides: "double", quantity: 1000,
      printer: "ログへ出さない印刷所", submissionDate: "2026-11-01", deliveryDate: "2026-11-05", printCost: 12000,
    }, actor(ownerUid), db);
    const copyId = await copyProjectFlyer(db, projectId, sourceId, actor(ownerUid));
    const legacyCopyId = await copyLegacyProjectFlyer(projectId, {
      name: "公募用", enabled: false, size: "B5", printer: "別の秘密", deliveryDate: "2026-10-01", printCost: 8000,
    }, actor(ownerUid), db);
    const copy = (await getDoc(flyerRef(db, copyId))).data();
    deepStrictEqual({ name: copy?.name, enabled: copy?.enabled, size: copy?.size, sides: copy?.sides, quantity: copy?.quantity, printer: copy?.printer }, {
      name: "本番チラシのコピー", enabled: true, size: "A4", sides: "double", quantity: 1000, printer: "ログへ出さない印刷所",
    });
    strictEqual(copy?.submissionDate, undefined);
    strictEqual(copy?.deliveryDate, undefined);
    strictEqual(copy?.printCost, undefined);
    strictEqual((await getDoc(flyerRef(db, legacyCopyId))).data()?.name, "公募用のコピー");
    const logs = (await getDocs(collection(db, "projects", projectId, "activityLogs"))).docs.map((entry) => entry.data());
    strictEqual(logs.filter(({ changedFields }) => changedFields?.includes("チラシ複製")).length, 2);
    strictEqual(logs.some((entry) => JSON.stringify(entry).includes("ログへ出さない印刷所") || JSON.stringify(entry).includes("別の秘密")), false);
  });

  it("deletes only the selected collection flyer and records the deletion", async () => {
    const db = firestoreFor(editorUid);
    const first = await createProjectFlyer(projectId, { name: "削除対象", enabled: true }, actor(editorUid), db);
    const second = await createProjectFlyer(projectId, { name: "維持対象", enabled: true }, actor(editorUid), db);
    await deleteProjectFlyer(db, projectId, first, { actor: actor(editorUid), expectedRevision: 0 });
    strictEqual((await getDoc(flyerRef(db, first))).exists(), false);
    strictEqual((await getDoc(flyerRef(db, second))).exists(), true);
    strictEqual((await getProjectFlyers(projectId, db)).length, 1);
  });
});
