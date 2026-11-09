import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  createProjectProductionAsset, deleteProjectProductionAsset,
  getProjectProductionAssets, updateProjectProductionAsset,
} from "../lib/production-asset-store.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "production-assets";
const ownerUid = "asset-owner";
const editorUid = "asset-editor";
const viewerUid = "asset-viewer";
let testEnv;
function dbFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function actor(uid) { return { uid, displayName: uid }; }
function assetRef(db, id) { return doc(db, "projects", projectId, "assets", id); }

before(async () => { testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } }); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), { title: "素材テスト", memberUids: [ownerUid, editorUid, viewerUid] });
    for (const [uid, role] of [[ownerUid, "owner"], [editorUid, "editor"], [viewerUid, "viewer"]]) await setDoc(doc(db, "projects", projectId, "members", uid), { uid, role });
  });
});
after(async () => { await testEnv.cleanup(); });

describe("production asset transactions and rules", () => {
  it("creates without a URL, edits every field, and deletes only the information with safe logs", async () => {
    const db = dbFor(ownerUid);
    const id = await createProjectProductionAsset(projectId, { name: "公演ロゴ", type: "performance_logo", url: "", note: "" }, actor(ownerUid), db);
    let item = (await getProjectProductionAssets(projectId, db))[0];
    strictEqual(item.url, "");
    await updateProjectProductionAsset(db, projectId, id, { name: "第61回公演 チラシ元データ", type: "flyer", url: "https://dropbox.example/flyer", note: "印刷用データ" }, { actor: actor(ownerUid), expectedRevision: item.revision });
    item = (await getProjectProductionAssets(projectId, db))[0];
    strictEqual(item.revision, 1);
    strictEqual(item.url, "https://dropbox.example/flyer");
    await deleteProjectProductionAsset(db, projectId, id, { actor: actor(ownerUid), expectedRevision: 1 });
    strictEqual((await getDoc(assetRef(db, id))).exists(), false);
    const logs = (await getDocs(collection(db, "projects", projectId, "activityLogs"))).docs.map((entry) => entry.data());
    deepStrictEqual(logs.map(({ action }) => action).sort(), ["create", "delete", "update"]);
    strictEqual(logs.some((entry) => JSON.stringify(entry).includes("dropbox.example") || JSON.stringify(entry).includes("印刷用データ")), false);
  });

  it("allows editor writes and viewer reads while rejecting viewer and unauthenticated writes", async () => {
    const editorDb = dbFor(editorUid);
    const viewerDb = dbFor(viewerUid);
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const id = await createProjectProductionAsset(projectId, { name: "宣材写真", type: "photo", url: "http://example.test/photos", note: "" }, actor(editorUid), editorDb);
    await assertSucceeds(getDoc(assetRef(viewerDb, id)));
    await assertFails(getDoc(assetRef(publicDb, id)));
    await assertFails(createProjectProductionAsset(projectId, { name: "不可", type: "other", url: "", note: "" }, actor(viewerUid), viewerDb));
    await assertFails(deleteProjectProductionAsset(viewerDb, projectId, id, { actor: actor(viewerUid), expectedRevision: 0 }));
    strictEqual((await getDoc(assetRef(editorDb, id))).exists(), true);
  });
});
