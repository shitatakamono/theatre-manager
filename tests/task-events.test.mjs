import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomTaskTransitionEvent,
  buildProductionTaskTransitionEvents,
  buildTaskCreatedEvent,
  getPerformanceDateSnapshot,
  withProductionBlock,
} from "../lib/task-events.ts";

const projectId = "project-a";
const userUid = "editor-a";

function project(production = {}) {
  return {
    title: "公演A",
    performances: [{ id: "show-a", date: "2026-11-15", startTime: "13:00" }],
    production,
  };
}

describe("custom task events", () => {
  it("records creation with a stable custom task ID and no before status", () => {
    const event = buildTaskCreatedEvent({
      projectId,
      task: { id: "task-a", title: "追加作業", stage: "", category_parent: "会場", category_child: "", done: false },
      userUid,
      performanceDateSnapshot: "2026-11-15",
    });
    strictEqual(event.taskId, "custom:task-a");
    strictEqual(event.taskSource, "customTask");
    strictEqual(event.eventType, "taskCreated");
    strictEqual(event.beforeStatus, null);
    strictEqual(event.afterStatus, "not_started");
    strictEqual(event.userUid, userUid);
  });

  it("records complete and reopen once without a duplicate status event", () => {
    const base = { id: "task-a", title: "追加作業", stage: "", category_parent: "会場", category_child: "", done: false };
    const completed = buildCustomTaskTransitionEvent({ projectId, before: base, after: { ...base, done: true }, userUid, performanceDateSnapshot: null });
    const reopened = buildCustomTaskTransitionEvent({ projectId, before: { ...base, done: true }, after: base, userUid, performanceDateSnapshot: null });
    strictEqual(completed?.eventType, "taskCompleted");
    strictEqual(completed?.beforeStatus, "not_started");
    strictEqual(completed?.afterStatus, "completed");
    strictEqual(reopened?.eventType, "taskReopened");
    strictEqual(reopened?.beforeStatus, "completed");
    strictEqual(reopened?.afterStatus, "not_started");
    strictEqual(buildCustomTaskTransitionEvent({ projectId, before: base, after: base, userUid, performanceDateSnapshot: null }), null);
  });
});

describe("standard production task events", () => {
  it("records an actionable completion but ignores settings-only changes", () => {
    const before = project({ flyer: { information: { proofread: false }, specifications: { designer: "A" } } });
    const completed = withProductionBlock(before, "flyer", "information", { proofread: true });
    const events = buildProductionTaskTransitionEvents({ projectId, beforeProject: before, afterProject: completed, section: "flyer", userUid });
    deepStrictEqual(events.map((event) => [event.taskId, event.eventType]), [["standard:flyer:information:proofread", "taskCompleted"]]);

    const settingsOnly = withProductionBlock(before, "flyer", "specifications", { designer: "B" });
    deepStrictEqual(buildProductionTaskTransitionEvents({ projectId, beforeProject: before, afterProject: settingsOnly, section: "flyer", userUid }), []);
  });

  it("records an explicit in-progress status without inventing it for boolean tasks", () => {
    const before = project({ venue: { meeting: { adjustmentStatus: "not-started" } } });
    const after = withProductionBlock(before, "venue", "meeting", { adjustmentStatus: "adjusting" });
    const [event] = buildProductionTaskTransitionEvents({ projectId, beforeProject: before, afterProject: after, section: "venue", userUid });
    strictEqual(event.taskId, "standard:venue:meeting:adjustment");
    strictEqual(event.eventType, "statusChanged");
    strictEqual(event.beforeStatus, "not_started");
    strictEqual(event.afterStatus, "in_progress");
  });

  it("keeps standard and custom accounting IDs and sources stable", () => {
    const before = project({ accounting: { tasks: [
      { id: "standard-cash-float", label: "釣銭準備", phase: "before", completed: false },
      { id: "custom-a", label: "独自精算", phase: "after", custom: true, completed: false },
    ] } });
    const after = withProductionBlock(before, "accounting", "tasks", [
      { id: "standard-cash-float", label: "釣銭準備", phase: "before", completed: true },
      { id: "custom-a", label: "独自精算", phase: "after", custom: true, completed: true },
    ]);
    const events = buildProductionTaskTransitionEvents({ projectId, beforeProject: before, afterProject: after, section: "accounting", userUid });
    deepStrictEqual(events.map(({ taskId, taskSource, eventType }) => ({ taskId, taskSource, eventType })), [
      { taskId: "standard:accounting:tasks:standard-cash-float", taskSource: "standard", eventType: "taskCompleted" },
      { taskId: "accounting-custom:custom-a", taskSource: "accountingCustom", eventType: "taskCompleted" },
    ]);
  });

  it("does not infer an event when a conditional standard task only appears", () => {
    const before = project({ flyer: { flyer: { enabled: false } } });
    const after = withProductionBlock(before, "flyer", "flyer", { enabled: true, submissionDate: "2026-10-20" });
    deepStrictEqual(buildProductionTaskTransitionEvents({ projectId, beforeProject: before, afterProject: after, section: "flyer", userUid }), []);
  });
});

describe("performance date snapshot", () => {
  it("uses the earliest performance date and falls back to the legacy start date", () => {
    strictEqual(getPerformanceDateSnapshot({ performances: [{ date: "2026-11-20" }, { date: "2026-11-15" }] }), "2026-11-15");
    strictEqual(getPerformanceDateSnapshot({ performances: [{ date: "2026-02-31" }, { date: "2026-11-15" }] }), "2026-11-15");
    strictEqual(getPerformanceDateSnapshot({ show_start_date: "2026-12-01" }), "2026-12-01");
    strictEqual(getPerformanceDateSnapshot({}), null);
  });
});
