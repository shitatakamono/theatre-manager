import { readFile } from "node:fs/promises";
import { strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { getProductionActivityDefinition } from "../lib/activity.ts";
import { runProjectRevisionTransaction } from "../lib/project-revisions.ts";
import {
  buildProductionTaskTransitionEvents,
  createCustomTaskWithEvent,
  toggleCustomTaskWithEvent,
  withProductionBlock,
} from "../lib/task-events.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "task-events-project";
const ownerUid = "task-events-owner";
const editorUid = "task-events-editor";
let testEnv;

function firestoreFor(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedProject() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), {
      title: "Task event test",
      memberUids: [ownerUid, editorUid],
      performances: [{ id: "show-a", date: "2026-11-15", startTime: "13:00" }],
      production: { flyer: { information: { proofread: false }, specifications: { designer: "A" } } },
    });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
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

describe("task event writes", () => {
  it("atomically records custom creation, completion, and reopening", async () => {
    const db = firestoreFor(ownerUid);
    const taskId = await createCustomTaskWithEvent(db, projectId, {
      title: "追加作業",
      category_parent: "会場",
    }, ownerUid);
    await toggleCustomTaskWithEvent(db, projectId, taskId, true, ownerUid);
    await toggleCustomTaskWithEvent(db, projectId, taskId, false, ownerUid);

    const events = (await getDocs(collection(db, "projects", projectId, "taskEvents"))).docs.map((entry) => entry.data());
    strictEqual(events.length, 3);
    strictEqual(events.filter((event) => event.eventType === "taskCreated").length, 1);
    strictEqual(events.filter((event) => event.eventType === "taskCompleted").length, 1);
    strictEqual(events.filter((event) => event.eventType === "taskReopened").length, 1);
    strictEqual(events.every((event) => event.taskId === `custom:${taskId}` && event.userUid === ownerUid), true);
    strictEqual(events.every((event) => event.occurredAt != null), true);
  });

  it("records only standard task status changes in the revision transaction", async () => {
    const db = firestoreFor(editorUid);
    async function save(block, value, expectedRevision) {
      return runProjectRevisionTransaction({
        firestore: db,
        projectId,
        revisionKey: "flyer",
        expectedRevision,
        updates: { [`production.flyer.${block}`]: value },
        nextValue: value,
        readCurrentValue: (project) => project.production?.flyer?.[block],
        actor: { uid: editorUid, displayName: "Editor" },
        activity: getProductionActivityDefinition("flyer", block),
        buildTaskEvents: (project) => buildProductionTaskTransitionEvents({
          projectId,
          beforeProject: project,
          afterProject: withProductionBlock(project, "flyer", block, value),
          section: "flyer",
          userUid: editorUid,
        }),
      });
    }

    const settings = await save("specifications", { designer: "B" }, 0);
    strictEqual(settings.revision, 1);
    strictEqual((await getDocs(collection(db, "projects", projectId, "taskEvents"))).size, 0);

    const completion = await save("information", { proofread: true }, 1);
    strictEqual(completion.revision, 2);
    const events = await getDocs(collection(db, "projects", projectId, "taskEvents"));
    strictEqual(events.size, 1);
    strictEqual(events.docs[0].data().taskId, "standard:flyer:information:proofread");
    strictEqual(events.docs[0].data().eventType, "taskCompleted");
  });
});
