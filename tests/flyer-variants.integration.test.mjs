import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  copyProjectFlyerVariant,
  createProjectFlyerVariant,
  deleteProjectFlyerVariant,
  getProjectFlyerVariants,
  updateProjectFlyerVariant,
} from "../lib/flyer-variant-store.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "flyer-variants";
const ownerUid = "flyer-owner";
const editorUid = "flyer-editor";
const viewerUid = "flyer-viewer";
let testEnv;

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function actor(uid) { return { uid, displayName: uid }; }
function variantRef(db, id) { return doc(db, "projects", projectId, "flyerVariants", id); }

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), { title: "チラシテスト", memberUids: [ownerUid, editorUid, viewerUid] });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
    await setDoc(doc(db, "projects", projectId, "members", viewerUid), { uid: viewerUid, role: "viewer" });
  });
});
after(async () => { await testEnv.cleanup(); });

describe("flyer variant transactions and rules", () => {
  it("lets owners create, copy, edit, and delete while preserving source metadata and safe activity logs", async () => {
    const db = firestoreFor(ownerUid);
    const sourceId = await createProjectFlyerVariant(projectId, { name: "A案", status: "in-progress", note: "本文はログ禁止" }, actor(ownerUid), db);
    const sourceBefore = (await getDoc(variantRef(db, sourceId))).data();
    const copyId = await copyProjectFlyerVariant(db, projectId, sourceId, actor(ownerUid));
    let items = await getProjectFlyerVariants(projectId, db);
    strictEqual(items.length, 2);
    const sourceAfter = (await getDoc(variantRef(db, sourceId))).data();
    strictEqual(sourceAfter?.revision, sourceBefore?.revision);
    strictEqual(sourceAfter?.name, "A案");
    const copy = items.find(({ id }) => id === copyId);
    strictEqual(copy?.name, "A案のコピー");
    strictEqual(copy?.revision, 0);
    strictEqual(copy?.createdByUid, ownerUid);

    await updateProjectFlyerVariant(db, projectId, copyId, { name: "B案", status: "review", note: "別の本文" }, { actor: actor(ownerUid), expectedRevision: 0 });
    items = await getProjectFlyerVariants(projectId, db);
    strictEqual(items.find(({ id }) => id === copyId)?.revision, 1);
    await deleteProjectFlyerVariant(db, projectId, copyId, { actor: actor(ownerUid), expectedRevision: 1 });
    strictEqual((await getDoc(variantRef(db, copyId))).exists(), false);
    strictEqual((await getDoc(variantRef(db, sourceId))).exists(), true);

    const logs = (await getDocs(collection(db, "projects", projectId, "activityLogs"))).docs.map((entry) => entry.data());
    deepStrictEqual(logs.map(({ action }) => action).sort(), ["create", "create", "delete", "update"]);
    strictEqual(logs.some((entry) => JSON.stringify(entry).includes("本文はログ禁止") || JSON.stringify(entry).includes("別の本文")), false);
  });

  it("allows editors to create and viewers to read but not create, update, or delete", async () => {
    const editorDb = firestoreFor(editorUid);
    const viewerDb = firestoreFor(viewerUid);
    const id = await createProjectFlyerVariant(projectId, { name: "編集者案", status: "not-started", note: "" }, actor(editorUid), editorDb);
    await assertSucceeds(getDoc(variantRef(viewerDb, id)));
    await assertFails(createProjectFlyerVariant(projectId, { name: "閲覧者案", status: "not-started", note: "" }, actor(viewerUid), viewerDb));
    await assertFails(updateProjectFlyerVariant(viewerDb, projectId, id, { name: "変更", status: "complete", note: "" }, { actor: actor(viewerUid), expectedRevision: 0 }));
    await assertFails(deleteProjectFlyerVariant(viewerDb, projectId, id, { actor: actor(viewerUid), expectedRevision: 0 }));
    strictEqual((await getDoc(variantRef(editorDb, id))).exists(), true);
  });
});
