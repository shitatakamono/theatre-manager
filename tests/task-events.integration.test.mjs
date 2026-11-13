import { readFile } from "node:fs/promises";
import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getProductionActivityDefinition, getVenueActivityDefinition } from "../lib/activity.ts";
import { runProjectRevisionTransaction } from "../lib/project-revisions.ts";
import {
  buildProductionTaskTransitionEvents,
  createCustomTaskWithEvent,
  deleteCustomTaskWithEvent,
  toggleCustomTaskWithEvent,
  updateCustomTaskWithEvent,
  withProductionBlock,
} from "../lib/task-events.ts";
import { toCustomProductionTask } from "../lib/production-task-view.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "task-events-project";
const ownerUid = "task-events-owner";
const editorUid = "task-events-editor";
const viewerUid = "task-events-viewer";
let testEnv;

function firestoreFor(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedProject() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), {
      title: "Task event test",
      memberUids: [ownerUid, editorUid, viewerUid],
      performances: [{ id: "show-a", date: "2026-11-15", startTime: "13:00" }],
      production: { flyer: { information: { proofread: false }, specifications: { designer: "A" } } },
    });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
    await setDoc(doc(db, "projects", projectId, "members", viewerUid), { uid: viewerUid, role: "viewer" });
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

  it("stores, edits, and deletes a detailed additional task with matching events", async () => {
    const db = firestoreFor(editorUid);
    const taskId = await createCustomTaskWithEvent(db, projectId, {
      title: "他劇団の公演情報を集めてまとめる", category_parent: "制作", category_child: "DM・折込", dueDate: "2026-11-20",
      status: "not-started", priority: "normal", assigneeUid: "", assigneeName: "", note: "候補をまとめる",
    }, editorUid);
    await updateCustomTaskWithEvent(db, projectId, taskId, {
      title: "他劇団の公演情報を集める", category_parent: "制作", category_child: "DM・折込", dueDate: "2026-11-21",
      status: "in-progress", priority: "high", assigneeUid: editorUid, assigneeName: "Editor", note: "更新後",
    }, editorUid);
    await updateCustomTaskWithEvent(db, projectId, taskId, {
      title: "他劇団の公演情報を集める", category_parent: "制作", category_child: "DM・折込", dueDate: "2026-11-21",
      status: "in-progress", priority: "high", assigneeUid: editorUid, assigneeName: "Editor", note: "メモだけ更新",
    }, editorUid);
    await updateCustomTaskWithEvent(db, projectId, taskId, {
      title: "他劇団の公演情報を集める", category_parent: "制作", category_child: "DM・折込", dueDate: "2026-11-21",
      status: "in-progress", priority: "high", assigneeUid: editorUid, assigneeName: "Editor", note: "メモだけ更新",
    }, editorUid);
    const taskSnapshot = await getDocs(collection(db, "projects", projectId, "tasks"));
    strictEqual(taskSnapshot.docs[0].data().source, "custom");
    strictEqual(taskSnapshot.docs[0].data().priority, "high");
    strictEqual(taskSnapshot.docs[0].data().assigneeUid, editorUid);
    strictEqual(toCustomProductionTask(projectId, { id: taskId, ...taskSnapshot.docs[0].data() }).section, "dm");
    await deleteCustomTaskWithEvent(db, projectId, taskId, editorUid);
    strictEqual((await getDocs(collection(db, "projects", projectId, "tasks"))).empty, true);
    const events = (await getDocs(collection(db, "projects", projectId, "taskEvents"))).docs.map((entry) => entry.data());
    const statusEvent = events.find((event) => event.eventType === "statusChanged");
    strictEqual(statusEvent?.changes?.title?.before, "他劇団の公演情報を集めてまとめる");
    strictEqual(statusEvent?.changes?.title?.after, "他劇団の公演情報を集める");
    strictEqual(statusEvent?.changes?.dueDate?.after, "2026-11-21");
    strictEqual(statusEvent?.changes?.priority?.after, "high");
    strictEqual(statusEvent?.changes?.assigneeUid?.after, editorUid);
    strictEqual(JSON.stringify(statusEvent).includes("候補をまとめる"), false);
    const noteOnlyEvent = events.find((event) => event.eventType === "taskUpdated");
    strictEqual(noteOnlyEvent?.changes, undefined);
    strictEqual(events.filter((event) => event.eventType === "taskUpdated").length, 1);
    strictEqual(events.some((event) => event.eventType === "taskDeleted"), true);
  });

  it("creates, changes, preserves, and explicitly clears a related view", async () => {
    const db = firestoreFor(ownerUid);
    const taskId = await createCustomTaskWithEvent(db, projectId, {
      title: "折込先を確認", relatedView: "external-performances",
    }, ownerUid);
    const ref = doc(db, "projects", projectId, "tasks", taskId);
    strictEqual((await getDoc(ref)).data()?.relatedView, "external-performances");

    await updateCustomTaskWithEvent(db, projectId, taskId, {
      title: "折込先を再確認", note: "関連画面は維持する",
    }, ownerUid);
    strictEqual((await getDoc(ref)).data()?.relatedView, "external-performances");

    await updateCustomTaskWithEvent(db, projectId, taskId, {
      title: "DMを確認", relatedView: "production-dm",
    }, ownerUid);
    strictEqual((await getDoc(ref)).data()?.relatedView, "production-dm");

    await updateCustomTaskWithEvent(db, projectId, taskId, {
      title: "リンクなし", relatedView: "",
    }, ownerUid);
    strictEqual((await getDoc(ref)).data()?.relatedView, undefined);
    const events = await getDocs(collection(db, "projects", projectId, "taskEvents"));
    strictEqual(events.docs.filter((entry) => entry.data().eventType === "taskUpdated").length, 3);
  });

  it("serializes concurrent custom edits and records both actual transitions", async () => {
    const db = firestoreFor(ownerUid);
    const taskId = await createCustomTaskWithEvent(db, projectId, { title: "同時編集前" }, ownerUid);
    await Promise.all([
      updateCustomTaskWithEvent(db, projectId, taskId, { title: "同時編集A" }, ownerUid),
      updateCustomTaskWithEvent(db, projectId, taskId, { title: "同時編集B" }, ownerUid),
    ]);

    const events = (await getDocs(collection(db, "projects", projectId, "taskEvents"))).docs
      .map((entry) => entry.data())
      .filter((event) => event.eventType === "taskUpdated");
    strictEqual(events.length, 2);
    const transitions = events.map((event) => `${event.changes?.title?.before}->${event.changes?.title?.after}`);
    strictEqual(transitions.some((value) => value === "同時編集前->同時編集A" || value === "同時編集前->同時編集B"), true);
    strictEqual(transitions.some((value) => value === "同時編集A->同時編集B" || value === "同時編集B->同時編集A"), true);
  });

  it("updates a legacy task without removing its untouched legacy fields", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "projects", projectId, "tasks", "legacy-task"), {
        title: "旧タスク", stage: "前期", category_parent: "制作", category_child: "広報",
        done: false, deadline: "2026-11-01", responsible: "旧担当", legacyMarker: "keep",
      });
    });
    const db = firestoreFor(editorUid);
    await updateCustomTaskWithEvent(db, projectId, "legacy-task", {
      title: "旧タスク更新", category_parent: "制作", relatedView: "production-assets",
    }, editorUid);
    const data = (await getDoc(doc(db, "projects", projectId, "tasks", "legacy-task"))).data();
    strictEqual(data?.legacyMarker, "keep");
    strictEqual(data?.deadline, "2026-11-01");
    strictEqual(data?.relatedView, "production-assets");
  });

  it("rejects viewer writes and refuses to delete a non-custom task document", async () => {
    await rejects(() => createCustomTaskWithEvent(firestoreFor(ownerUid), projectId, { title: "  " }, ownerUid));
    await rejects(() => createCustomTaskWithEvent(firestoreFor(viewerUid), projectId, { title: "作成不可" }, viewerUid));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "projects", projectId, "tasks", "standard-copy"), {
        title: "定型タスク", source: "standard", done: false,
      });
    });
    await rejects(() => deleteCustomTaskWithEvent(firestoreFor(ownerUid), projectId, "standard-copy", ownerUid));
    strictEqual((await getDocs(collection(firestoreFor(ownerUid), "projects", projectId, "tasks"))).size, 1);
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

  it("atomically records explicit dynamic task creation and deletion", async () => {
    const db = firestoreFor(editorUid);
    async function save(documents, expectedRevision) {
      return runProjectRevisionTransaction({
        firestore: db,
        projectId,
        revisionKey: "venue",
        expectedRevision,
        updates: { "production.venue.documents": documents },
        nextValue: documents,
        readCurrentValue: (project) => project.production?.venue?.documents,
        actor: { uid: editorUid, displayName: "Editor" },
        activity: getVenueActivityDefinition("documents"),
        buildTaskEvents: (project) => buildProductionTaskTransitionEvents({
          projectId,
          beforeProject: project,
          afterProject: withProductionBlock(project, "venue", "documents", documents),
          section: "venue",
          userUid: editorUid,
        }),
      });
    }

    const documentTask = [{ id: "document-a", name: "消防署提出", submitted: false }];
    await save(documentTask, 0);
    await save([], 1);
    const events = (await getDocs(collection(db, "projects", projectId, "taskEvents"))).docs.map((entry) => entry.data());
    strictEqual(events.length, 2);
    strictEqual(events.some((event) => event.eventType === "taskCreated"), true);
    strictEqual(events.some((event) => event.eventType === "taskDeleted"), true);
    strictEqual(events.every((event) => event.taskId === "standard:venue:documents:document-a"), true);
  });
});
