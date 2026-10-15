import { readFile } from "node:fs/promises";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getProductionActivityDefinition } from "../lib/activity.ts";
import { removeUndefinedValues } from "../lib/firestore-values.ts";
import {
  isConflictError,
  runProjectRevisionTransaction,
} from "../lib/project-revisions.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "performance-conflict";
const ownerUid = "conflict-owner";
const editorUid = "conflict-editor";
const viewerUid = "conflict-viewer";
let testEnv;

function firestoreFor(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function projectRef(db) {
  return doc(db, "projects", projectId);
}

async function seedProject(data = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(projectRef(db), {
      title: "Conflict test",
      memberUids: [ownerUid, editorUid, viewerUid],
      ...data,
    });
    for (const [uid, role] of [[ownerUid, "owner"], [editorUid, "editor"], [viewerUid, "viewer"]]) {
      await setDoc(doc(db, "projects", projectId, "members", uid), { uid, role });
    }
  });
}

function saveFlyer(db, uid, expectedRevision, value) {
  const cleanValue = removeUndefinedValues(value);
  return runProjectRevisionTransaction({
    firestore: db,
    projectId,
    revisionKey: "flyer",
    expectedRevision,
    updates: { "production.flyer.flyer": cleanValue },
    nextValue: cleanValue,
    readCurrentValue: (project) => project.production?.flyer?.flyer,
    actor: { uid, displayName: uid === ownerUid ? "Owner" : "Editor" },
    activity: getProductionActivityDefinition("flyer", "flyer"),
  });
}

function saveAccounting(db, uid, expectedRevision, tasks) {
  const cleanValue = removeUndefinedValues(tasks);
  return runProjectRevisionTransaction({
    firestore: db,
    projectId,
    revisionKey: "accounting",
    expectedRevision,
    updates: { "production.accounting.tasks": cleanValue },
    nextValue: cleanValue,
    readCurrentValue: (project) => project.production?.accounting?.tasks,
    actor: { uid, displayName: "Editor" },
    activity: getProductionActivityDefinition("accounting", "tasks"),
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: emulatorProjectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedProject();
});

after(async () => {
  await testEnv.cleanup();
});

describe("revision transactions", () => {
  it("rejects the second stale save in the same section without overwriting data or adding a log", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const editorDb = firestoreFor(editorUid);
    const first = await saveFlyer(ownerDb, ownerUid, 0, { enabled: true, quantity: 100 });
    strictEqual(first.revision, 1);

    await rejectsConflict(() => saveFlyer(editorDb, editorUid, 0, { enabled: true, quantity: 200 }));

    const project = await getDoc(projectRef(ownerDb));
    strictEqual(project.data()?.production?.flyer?.flyer?.quantity, 100);
    strictEqual(project.data()?.revisions?.flyer, 1);
    strictEqual((await getDocs(collection(ownerDb, "projects", projectId, "activityLogs"))).size, 1);
  });

  it("allows independent flyer and accounting revisions for owner and editor", async () => {
    const flyer = await saveFlyer(firestoreFor(ownerUid), ownerUid, 0, { enabled: true, quantity: 100 });
    const accounting = await saveAccounting(firestoreFor(editorUid), editorUid, 0, [{ id: "task-a", label: "精算", phase: "after" }]);
    strictEqual(flyer.revision, 1);
    strictEqual(accounting.revision, 1);

    const db = firestoreFor(ownerUid);
    const project = await getDoc(projectRef(db));
    strictEqual(project.data()?.revisions?.flyer, 1);
    strictEqual(project.data()?.revisions?.accounting, 1);
    strictEqual((await getDocs(collection(db, "projects", projectId, "activityLogs"))).size, 2);
  });

  it("treats a missing revision as zero and rejects a stale revision from the same user", async () => {
    const db = firestoreFor(ownerUid);
    await saveFlyer(db, ownerUid, 0, { enabled: true, quantity: 100 });
    await rejectsConflict(() => saveFlyer(db, ownerUid, 0, { enabled: true, quantity: 120 }));
  });

  it("does not increment the revision or create a log for an unchanged save", async () => {
    await testEnv.clearFirestore();
    await seedProject({ production: { flyer: { flyer: { enabled: false, quantity: 0 } } } });
    const db = firestoreFor(ownerUid);
    const result = await saveFlyer(db, ownerUid, 0, { enabled: false, quantity: 0, printer: undefined });
    strictEqual(result.changed, false);
    strictEqual(result.revision, 0);
    const project = await getDoc(projectRef(db));
    strictEqual(project.data()?.revisions, undefined);
    strictEqual((await getDocs(collection(db, "projects", projectId, "activityLogs"))).size, 0);
  });

  it("normalizes undefined, records changed fields, and still denies viewer saves", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await saveFlyer(ownerDb, ownerUid, 0, { enabled: true, quantity: undefined, printer: "印刷A" });
    const logs = await getDocs(collection(ownerDb, "projects", projectId, "activityLogs"));
    deepStrictEqual(logs.docs[0].data().changedFields, ["チラシ使用", "チラシ印刷会社"]);
    await rejectsPermission(() => saveFlyer(firestoreFor(viewerUid), viewerUid, 1, { enabled: false, printer: "印刷A" }));
  });
});

async function rejectsConflict(operation) {
  try {
    await operation();
  } catch (error) {
    strictEqual(isConflictError(error), true);
    return;
  }
  throw new Error("ConflictError was not thrown");
}

async function rejectsPermission(operation) {
  try {
    await operation();
  } catch (error) {
    strictEqual(isConflictError(error), false);
    return;
  }
  throw new Error("permission-denied was not thrown");
}
