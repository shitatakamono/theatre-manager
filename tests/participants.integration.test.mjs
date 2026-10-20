import { readFile } from "node:fs/promises";
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  createProjectParticipant,
  getProjectParticipants,
  updateProjectParticipant,
} from "../lib/participants.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "participant-integration";
const ownerUid = "participant-owner";
const editorUid = "participant-editor";
const viewerUid = "participant-viewer";
let testEnv;

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function actor(uid) { return { uid, displayName: uid }; }

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), { title: "参加者テスト", memberUids: [ownerUid, editorUid, viewerUid] });
    for (const [uid, role] of [[ownerUid, "owner"], [editorUid, "editor"], [viewerUid, "viewer"]]) {
      await setDoc(doc(db, "projects", projectId, "members", uid), { uid, role, displayName: uid });
    }
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => { await testEnv.cleanup(); });

describe("participant transactions", () => {
  it("creates a linked participant and one activity log atomically", async () => {
    const db = firestoreFor(ownerUid);
    const id = await createProjectParticipant(projectId, {
      displayName: "田中 太郎",
      specialPractice: "stage_combat",
      linkedUserUid: editorUid,
      publicNote: "公開備考",
      active: true,
    }, actor(ownerUid), db);

    const participant = await getDoc(doc(db, "projects", projectId, "participants", id));
    const linkedUser = await getDoc(doc(db, "projects", projectId, "participantLinkedUsers", editorUid));
    const logs = await getDocs(collection(db, "projects", projectId, "activityLogs"));
    strictEqual(participant.data()?.linkedUserUid, editorUid);
    strictEqual(linkedUser.data()?.participantId, id);
    strictEqual(logs.size, 1);
    deepStrictEqual(logs.docs[0].data().changedFields, ["参加者を追加（田中 太郎）"]);
  });

  it("lets an editor finish a participant and prevents duplicate links", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const firstId = await createProjectParticipant(projectId, {
      displayName: "参加者A", specialPractice: "none", linkedUserUid: viewerUid, publicNote: "", active: true,
    }, actor(ownerUid), ownerDb);
    const editorDb = firestoreFor(editorUid);
    await rejects(() => createProjectParticipant(projectId, {
      displayName: "参加者B", specialPractice: "japanese_dance", linkedUserUid: viewerUid, publicNote: "", active: true,
    }, actor(editorUid), editorDb), /別の参加者/);
    strictEqual(await updateProjectParticipant(projectId, firstId, {
      displayName: "参加者A", specialPractice: "none", linkedUserUid: viewerUid, publicNote: "", active: false,
    }, actor(editorUid), editorDb), true);
    const participants = await getProjectParticipants(projectId, editorDb);
    strictEqual(participants[0].active, false);
    strictEqual((await getDocs(collection(editorDb, "projects", projectId, "activityLogs"))).size, 2);
  });

  it("keeps viewers read-only through the shared data functions", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await createProjectParticipant(projectId, {
      displayName: "閲覧対象", specialPractice: "none", linkedUserUid: null, publicNote: "", active: true,
    }, actor(ownerUid), ownerDb);
    const viewerDb = firestoreFor(viewerUid);
    strictEqual((await getProjectParticipants(projectId, viewerDb)).length, 1);
    await rejects(() => createProjectParticipant(projectId, {
      displayName: "Viewer作成", specialPractice: "none", linkedUserUid: null, publicNote: "", active: true,
    }, actor(viewerUid), viewerDb));
  });
});
