import { strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "external-performance-import";
const ownerUid = "csv-owner";
const editorUid = "csv-editor";
const viewerUid = "csv-viewer";
let db;
let service;

function input(overrides = {}) {
  return {
    organizationName: "劇団A", performanceName: "春公演", venue: "会場A",
    startDate: "2027-03-01", endDate: "2027-03-03", contact: "", contactMethod: "",
    contactPerson: "", note: "", insertion: null, ...overrides,
  };
}
function row(sourceRow, overrides = {}, confirmPossibleDuplicate = false) {
  return { sourceRow, input: input(overrides), confirmPossibleDuplicate };
}
function project() { return db.collection("projects").doc(projectId); }

async function seed() {
  await project().set({ name: "CSV取込公演" });
  await Promise.all([
    project().collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", displayName: "Owner" }),
    project().collection("members").doc(editorUid).set({ uid: editorUid, role: "editor", displayName: "Editor" }),
    project().collection("members").doc(viewerUid).set({ uid: viewerUid, role: "viewer", displayName: "Viewer" }),
  ]);
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  service = await import("../lib/server/external-performance-import.ts");
  db = getFirestore();
});
beforeEach(async () => { await db.recursiveDelete(db.collection("projects")); await seed(); });
after(async () => { await db.recursiveDelete(db.collection("projects")); await Promise.all(getApps().map((app) => deleteApp(app))); });

describe("external performance CSV import", () => {
  it("lets owners and editors create candidates with null insertion and activity logs", async () => {
    const first = await service.importExternalPerformanceRows({ uid: ownerUid, projectId, rows: [row(2)], db });
    const second = await service.importExternalPerformanceRows({ uid: editorUid, projectId, rows: [row(3, { venue: "会場B" })], db });
    strictEqual(first.imported, 1); strictEqual(second.imported, 1);
    const records = await project().collection("externalPerformances").get();
    strictEqual(records.size, 2);
    strictEqual(records.docs.every((item) => item.data().insertion === null), true);
    strictEqual((await project().collection("activityLogs").get()).size, 2);
  });

  it("rejects viewers", async () => {
    await service.importExternalPerformanceRows({ uid: viewerUid, projectId, rows: [row(2)], db }).then(
      () => { throw new Error("expected rejection"); },
      (error) => strictEqual(error.code, "forbidden"),
    );
  });

  it("skips exact duplicates and requires confirmation for uncertain dates", async () => {
    await service.importExternalPerformanceRows({ uid: ownerUid, projectId, rows: [row(2)], db });
    const duplicate = await service.importExternalPerformanceRows({ uid: ownerUid, projectId, rows: [row(3)], db });
    strictEqual(duplicate.skipped, 1);
    const uncertain = row(4, { startDate: "", endDate: "" });
    strictEqual((await service.importExternalPerformanceRows({ uid: ownerUid, projectId, rows: [uncertain], db })).skipped, 1);
    strictEqual((await service.importExternalPerformanceRows({ uid: ownerUid, projectId, rows: [{ ...uncertain, confirmPossibleDuplicate: true }], db })).imported, 1);
  });

  it("reports per-row validation failures without rolling back successful rows", async () => {
    const result = await service.importExternalPerformanceRows({ uid: ownerUid, projectId, rows: [row(2), row(3, { organizationName: "" })], db });
    strictEqual(result.imported, 1); strictEqual(result.failed, 1);
    strictEqual((await project().collection("externalPerformances").get()).size, 1);
  });

  it("serializes simultaneous imports so only one identical candidate is created", async () => {
    const [left, right] = await Promise.all([
      service.importExternalPerformanceRows({ uid: ownerUid, projectId, rows: [row(2)], db }),
      service.importExternalPerformanceRows({ uid: editorUid, projectId, rows: [row(2)], db }),
    ]);
    strictEqual(left.imported + right.imported, 1);
    strictEqual(left.skipped + right.skipped, 1);
    strictEqual((await project().collection("externalPerformances").get()).size, 1);
  });
});
