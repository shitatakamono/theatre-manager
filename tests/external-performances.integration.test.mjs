import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import {
  createProjectExternalPerformance, deleteProjectExternalPerformance,
  getProjectExternalPerformances, updateProjectExternalPerformance,
} from "../lib/external-performance-store.ts";
import { externalPerformanceToInput } from "../lib/external-performances.ts";
import { isConflictError } from "../lib/project-revisions.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "external-performance-conflict";
const ownerUid = "external-owner";
const editorUid = "external-editor";
let testEnv;

const base = {
  organizationName: "ティータイム", performanceName: "○○公演",
  startDate: "2026-11-21", endDate: "2026-11-23", venue: "赤いくつ劇場",
  contact: "", contactMethod: "", contactPerson: "", note: "", insertion: null,
};

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function context(uid, expectedRevision) { return { actor: { uid, displayName: uid }, expectedRevision }; }
function recordRef(db, id) { return doc(db, "projects", projectId, "externalPerformances", id); }
function logs(db) { return getDocs(collection(db, "projects", projectId, "activityLogs")); }

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), { title: "折込管理テスト", memberUids: [ownerUid, editorUid] });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
  });
});
after(async () => { await testEnv.cleanup(); });

describe("external performance transactions", () => {
  it("creates a candidate, adds and removes insertion details, and deletes atomically with safe logs", async () => {
    const db = firestoreFor(ownerUid);
    const id = await createProjectExternalPerformance(projectId, base, context(ownerUid, 0).actor, db);
    let current = (await getProjectExternalPerformances(projectId, db))[0];
    strictEqual(current.id, id);
    strictEqual(current.insertion, null);

    await updateProjectExternalPerformance(db, projectId, id, {
      ...externalPerformanceToInput(current),
      insertion: {
        method: "with_work", dateTimeText: "11/20 18時頃", quantity: "",
        postalAddress: "", postalRecipient: "", postalArrivalText: "", note: "", status: "contacted",
      },
    }, context(ownerUid, current.revision));
    current = (await getProjectExternalPerformances(projectId, db))[0];
    strictEqual(Object.hasOwn(current.insertion ?? {}, "quantity"), false);
    strictEqual(externalPerformanceToInput(current).insertion?.quantity, "");

    await updateProjectExternalPerformance(db, projectId, id, {
      ...externalPerformanceToInput(current), insertion: { ...externalPerformanceToInput(current).insertion, quantity: "300" },
    }, context(ownerUid, current.revision));
    current = (await getProjectExternalPerformances(projectId, db))[0];
    strictEqual(current.insertion?.quantity, 300);
    await updateProjectExternalPerformance(db, projectId, id, {
      ...externalPerformanceToInput(current), insertion: { ...externalPerformanceToInput(current).insertion, quantity: "" },
    }, context(ownerUid, current.revision));
    current = (await getProjectExternalPerformances(projectId, db))[0];
    strictEqual(Object.hasOwn(current.insertion ?? {}, "quantity"), false);

    await updateProjectExternalPerformance(db, projectId, id, { ...externalPerformanceToInput(current), insertion: null }, context(ownerUid, current.revision));
    current = (await getProjectExternalPerformances(projectId, db))[0];
    strictEqual(current.insertion, null);
    await deleteProjectExternalPerformance(db, projectId, id, context(ownerUid, current.revision));
    strictEqual((await getDoc(recordRef(db, id))).exists(), false);

    const entries = (await logs(db)).docs.map((entry) => entry.data());
    deepStrictEqual(entries.map(({ action }) => action).sort(), ["create", "delete", "update", "update", "update", "update"]);
    strictEqual(entries.some((entry) => JSON.stringify(entry).includes("11/20 18時頃")), false);
    strictEqual(entries.some((entry) => entry.changedFields.includes("折込情報追加")), true);
    strictEqual(entries.some((entry) => entry.changedFields.includes("折込情報削除")), true);
  });

  it("rejects stale updates without overwriting the winning editor or creating an extra log", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const editorDb = firestoreFor(editorUid);
    const id = await createProjectExternalPerformance(projectId, base, context(ownerUid, 0).actor, ownerDb);
    const original = (await getProjectExternalPerformances(projectId, ownerDb))[0];
    await updateProjectExternalPerformance(ownerDb, projectId, id, { ...externalPerformanceToInput(original), venue: "会場A" }, context(ownerUid, 0));
    try {
      await updateProjectExternalPerformance(editorDb, projectId, id, { ...externalPerformanceToInput(original), venue: "会場B" }, context(editorUid, 0));
      throw new Error("ConflictError was not thrown");
    } catch (error) { strictEqual(isConflictError(error), true); }
    strictEqual((await getDoc(recordRef(ownerDb, id))).data()?.venue, "会場A");
    strictEqual((await logs(ownerDb)).size, 2);
  });

  it("deletes the nested insertion with its parent document", async () => {
    const db = firestoreFor(editorUid);
    const id = await createProjectExternalPerformance(projectId, { ...base, insertion: {
      method: "postal", dateTimeText: "11/19必着", quantity: "500", postalAddress: "送付先",
      postalRecipient: "担当者様", postalArrivalText: "午前", note: "", status: "contacted",
    } }, context(editorUid, 0).actor, db);
    await deleteProjectExternalPerformance(db, projectId, id, context(editorUid, 0));
    strictEqual((await getDoc(recordRef(db, id))).exists(), false);
  });
});
