import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  createProjectProductionAsset, deleteProjectProductionAsset,
  getProjectProductionAssets, updateProjectProductionAsset,
} from "../lib/production-asset-store.ts";
import { createProjectFlyer, deleteProjectFlyer, isFlyerReferencedByProductionAssetError } from "../lib/flyer-store.ts";
import { LEGACY_FLYER_ID } from "../lib/flyers.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "production-assets";
const ownerUid = "asset-owner";
const editorUid = "asset-editor";
const viewerUid = "asset-viewer";
let testEnv;
function dbFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function actor(uid) { return { uid, displayName: uid }; }
function assetRef(db, id) { return doc(db, "projects", projectId, "assets", id); }
function flyerRef(db, id) { return doc(db, "projects", projectId, "flyers", id); }

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
    const id = await createProjectProductionAsset(projectId, { name: "宣材写真", type: "photo", url: "http://example.test/photos", note: "", flyerIds: [LEGACY_FLYER_ID] }, actor(editorUid), editorDb);
    await assertSucceeds(getDoc(assetRef(viewerDb, id)));
    await assertFails(getDoc(assetRef(publicDb, id)));
    await assertFails(createProjectProductionAsset(projectId, { name: "不可", type: "other", url: "", note: "" }, actor(viewerUid), viewerDb));
    await assertFails(deleteProjectProductionAsset(viewerDb, projectId, id, { actor: actor(viewerUid), expectedRevision: 0 }));
    strictEqual((await getDoc(assetRef(editorDb, id))).exists(), true);
  });

  it("links multiple and legacy flyers with revision-safe set comparison and safe unlinking", async () => {
    const ownerDb = dbFor(ownerUid);
    const editorDb = dbFor(editorUid);
    const viewerDb = dbFor(viewerUid);
    const flyerId = await createProjectFlyer(projectId, { name: "本番チラシ", enabled: true }, actor(ownerUid), ownerDb);
    const id = await createProjectProductionAsset(projectId, {
      name: "メインビジュアル", type: "flyer", url: "", note: "", flyerIds: [flyerId, LEGACY_FLYER_ID, flyerId],
    }, actor(ownerUid), ownerDb);
    let item = (await getProjectProductionAssets(projectId, ownerDb)).find((entry) => entry.id === id);
    deepStrictEqual(item?.flyerIds, [flyerId, LEGACY_FLYER_ID].sort());

    const unchanged = await updateProjectProductionAsset(ownerDb, projectId, id, {
      name: item.name, type: item.type, url: item.url, note: item.note, flyerIds: [...item.flyerIds].reverse(),
    }, { actor: actor(ownerUid), expectedRevision: 0 });
    deepStrictEqual(unchanged, { changed: false, revision: 0 });

    await assertFails(updateProjectProductionAsset(viewerDb, projectId, id, {
      name: item.name, type: item.type, url: item.url, note: item.note, flyerIds: [],
    }, { actor: actor(viewerUid), expectedRevision: 0 }));
    await updateProjectProductionAsset(editorDb, projectId, id, {
      name: item.name, type: item.type, url: item.url, note: item.note, flyerIds: [flyerId],
    }, { actor: actor(editorUid), expectedRevision: 0 });
    item = (await getProjectProductionAssets(projectId, ownerDb)).find((entry) => entry.id === id);
    strictEqual(item?.revision, 1);

    await rejects(
      () => deleteProjectFlyer(ownerDb, projectId, flyerId, { actor: actor(ownerUid), expectedRevision: 0 }),
      (error) => isFlyerReferencedByProductionAssetError(error),
    );
    await updateProjectProductionAsset(ownerDb, projectId, id, {
      name: item.name, type: item.type, url: item.url, note: item.note, flyerIds: [],
    }, { actor: actor(ownerUid), expectedRevision: 1 });
    strictEqual((await getDoc(assetRef(ownerDb, id))).data()?.flyerIds, undefined);
    await deleteProjectFlyer(ownerDb, projectId, flyerId, { actor: actor(ownerUid), expectedRevision: 0 });
    strictEqual((await getDoc(flyerRef(ownerDb, flyerId))).exists(), false);

    const logs = (await getDocs(collection(ownerDb, "projects", projectId, "activityLogs"))).docs.map((entry) => entry.data());
    strictEqual(logs.some((entry) => entry.changedFields?.includes("関連チラシ")), true);
    strictEqual(logs.some((entry) => JSON.stringify(entry).includes(flyerId)), false);
  });

  it("reads stale relation IDs safely and preserves them during an unrelated edit", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(assetRef(context.firestore(), "stale-asset"), {
        name: "旧素材", type: "flyer", url: "", note: "", flyerIds: ["missing-flyer"], revision: 0,
        createdAt: new Date(), updatedAt: new Date(), createdByUid: ownerUid, updatedByUid: ownerUid,
      });
    });
    const db = dbFor(ownerUid);
    const stale = (await getProjectProductionAssets(projectId, db)).find((entry) => entry.id === "stale-asset");
    deepStrictEqual(stale?.flyerIds, ["missing-flyer"]);
    await updateProjectProductionAsset(db, projectId, "stale-asset", {
      name: "旧素材（更新）", type: stale.type, url: stale.url, note: stale.note, flyerIds: stale.flyerIds,
    }, { actor: actor(ownerUid), expectedRevision: 0 });
    deepStrictEqual((await getDoc(assetRef(db, "stale-asset"))).data()?.flyerIds, ["missing-flyer"]);
  });
});
