import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getProductionActivityDefinition } from "../lib/activity.ts";
import { removeUndefinedValues } from "../lib/firestore-values.ts";
import { runProjectRevisionTransaction } from "../lib/project-revisions.ts";

const projectId = "dm-management";
const ownerUid = "dm-owner";
const editorUid = "dm-editor";
const viewerUid = "dm-viewer";
let testEnv;

const firestoreFor = (uid) => testEnv.authenticatedContext(uid).firestore();

async function seedProject() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), {
      title: "DM管理テスト", memberUids: [ownerUid, editorUid, viewerUid],
    });
    for (const [uid, role] of [[ownerUid, "owner"], [editorUid, "editor"], [viewerUid, "viewer"]]) {
      await setDoc(doc(db, "projects", projectId, "members", uid), { uid, role });
    }
  });
}

function saveDm(db, uid, expectedRevision, preparation) {
  const value = removeUndefinedValues(preparation);
  return runProjectRevisionTransaction({
    firestore: db, projectId, revisionKey: "dm", expectedRevision,
    updates: { "production.dm.preparation": value }, nextValue: value,
    readCurrentValue: (project) => project.production?.dm?.preparation,
    actor: { uid, displayName: uid },
    activity: getProductionActivityDefinition("dm", "preparation"),
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "seisakuboard-conflict-test",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seedProject(); });
after(async () => testEnv.cleanup());

describe("DM management transaction", () => {
  it("persists every field and logs labels without copying free text", async () => {
    const db = firestoreFor(ownerUid);
    const preparation = {
      invitationReady: true, flyerReady: true, otherReady: true,
      otherLabel: "招待券", envelopeReady: true, mailedDate: "2027-02-01",
    };
    const result = await saveDm(db, ownerUid, 0, preparation);
    strictEqual(result.revision, 1);
    const saved = (await getDoc(doc(db, "projects", projectId))).data();
    deepStrictEqual(saved.production.dm.preparation, preparation);
    const logs = await getDocs(collection(db, "projects", projectId, "activityLogs"));
    deepStrictEqual(logs.docs[0].data().changedFields, ["案内状", "チラシ", "その他", "その他内容", "封筒", "投函日"]);
    strictEqual(JSON.stringify(logs.docs[0].data()).includes("招待券"), false);
  });

  it("allows an editor to save with the mailed date unset", async () => {
    const db = firestoreFor(editorUid);
    await saveDm(db, editorUid, 0, {
      invitationReady: true, flyerReady: false, otherReady: false,
      otherLabel: "", envelopeReady: false, mailedDate: "",
    });
    const saved = (await getDoc(doc(db, "projects", projectId))).data();
    strictEqual(saved.production.dm.preparation.mailedDate, "");
  });

  it("denies viewer edits", async () => {
    try {
      await saveDm(firestoreFor(viewerUid), viewerUid, 0, { invitationReady: true });
    } catch (error) {
      strictEqual(error.code, "permission-denied");
      return;
    }
    throw new Error("viewer DM update was not denied");
  });
});
