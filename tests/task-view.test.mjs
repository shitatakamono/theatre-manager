import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateTaskWarning,
  buildTaskCreateInput,
  filterTasks,
  formatTaskDueDate,
  getTaskDeadlineWarning,
  getTaskProgressStatus,
  getTaskSection,
  sortTasksByDeadline,
} from "../lib/task-view.ts";
import {
  buildProductionTaskViews,
  canToggleProductionTask,
  toCustomProductionTask,
} from "../lib/production-task-view.ts";
import { STANDARD_ACCOUNTING_TASKS } from "../lib/production-management.ts";

const viewTask = (id, values = {}) => ({
  id,
  source: "standard",
  section: "web",
  sectionLabel: "Web・SNS",
  title: id,
  status: "not-started",
  dueDate: null,
  assignee: null,
  assigneeUid: null,
  note: null,
  custom: false,
  editTarget: "/projects/p1/production/web",
  customTaskId: null,
  ...values,
});

const project = (production = {}) => ({
  id: "p1",
  data: { performances: [{ id: "show-1", date: "2026-11-15", startTime: "13:00" }] },
  production,
});

describe("production task adapter", () => {
  it("generates existing standard work from every production section", () => {
    const tasks = buildProductionTaskViews(project(), []);
    deepStrictEqual([...new Set(tasks.filter((task) => task.source === "standard").map((task) => task.section))], [
      "venue", "flyer", "web", "tickets", "reception", "accounting",
    ]);
    strictEqual(tasks.some((task) => task.title === "チラシ提出済"), true);
    strictEqual(tasks.some((task) => task.title === "本公開"), true);
    strictEqual(tasks.some((task) => task.title === "受付への引継ぎ確認"), true);
  });

  it("excludes settings and reference values while retaining actionable work", () => {
    const tasks = buildProductionTaskViews(project({
      flyer: { specifications: { designer: "田中" }, flyer: { enabled: true } },
      web: { channels: { officialWebsite: true, x: true } },
      tickets: { methods: { reservationForm: true }, seating: { mode: "reserved" } },
      reception: { staff: [{ id: "staff-1", name: "佐藤", role: "受付" }] },
    }), []);
    const titles = tasks.map((task) => task.title);
    for (const setting of ["会場登録内容", "使用媒体", "販売方法", "座席方式", "デザイン担当", "受付スタッフ", "受付運用"]) {
      strictEqual(titles.includes(setting), false, `${setting} must not be a task`);
    }
    for (const action of ["チラシ提出済", "打ち合わせ", "チラシ 入稿", "本公開", "販売開始告知", "受付への引継ぎ確認", "受付名簿"]) {
      strictEqual(titles.includes(action), true, `${action} must remain a task`);
    }
  });

  it("uses all standard accounting tasks and includes each accounting custom task once", () => {
    const tasks = buildProductionTaskViews(project({ accounting: { tasks: [
      { id: "standard-cash-float", label: "上書き不可", phase: "before", custom: true, completed: true },
      { id: "custom-accounting", label: "独自精算", phase: "after", custom: true },
    ] } }), []);
    const accounting = tasks.filter((task) => task.section === "accounting");
    strictEqual(accounting.filter((task) => task.source === "standard").length, STANDARD_ACCOUNTING_TASKS.length);
    strictEqual(accounting.filter((task) => task.source === "accountingCustom").length, 1);
    strictEqual(accounting.filter((task) => task.title === "釣銭準備").length, 1);
    strictEqual(accounting.find((task) => task.title === "独自精算")?.id, "accounting-custom:custom-accounting");
  });

  it("merges tasks collection items without ID collisions", () => {
    const tasks = buildProductionTaskViews(project(), [{ id: "contract", title: "追加作業", stage: "", category_parent: "会場", category_child: "", done: false }]);
    const custom = tasks.find((task) => task.source === "customTask");
    strictEqual(custom?.id, "custom:contract");
    strictEqual(custom?.section, "venue");
    strictEqual(new Set(tasks.map((task) => task.id)).size, tasks.length);
  });

  it("uses filtered task totals for each section", () => {
    const tasks = buildProductionTaskViews(project({
      tickets: { methods: { reservationForm: true }, seating: { mode: "reserved" } },
    }), []);
    const counts = tasks.reduce((result, task) => {
      if (task.section) result[task.section] = (result[task.section] ?? 0) + 1;
      return result;
    }, {});
    strictEqual(counts.tickets, 1);
    strictEqual(tasks.filter((task) => task.section === "tickets")[0]?.title, "受付への引継ぎ確認");
  });

  it("uses only explicit dates, assignees, and completion values", () => {
    const tasks = buildProductionTaskViews(project({
      flyer: { specifications: { designer: "田中" }, flyer: { enabled: true, submissionPlannedDate: "2026-10-25" } },
      web: { page: { publishPlannedDate: "2026-10-26", published: true } },
    }), []);
    const submission = tasks.find((task) => task.id === "standard:flyer:flyer:submission");
    strictEqual(submission?.dueDate, "2026-10-25");
    strictEqual(submission?.assignee, "田中");
    strictEqual(submission?.status, "not-started");
    const page = tasks.find((task) => task.id === "standard:web:page");
    strictEqual(page?.status, "complete");
    strictEqual(getTaskDeadlineWarning(page, "2026-10-27"), "none");
  });

  it("keeps standard work read-only here and permits custom completion only to editors", () => {
    const standard = viewTask("standard");
    const custom = toCustomProductionTask("p1", { id: "c1", title: "追加", stage: "", category_parent: "会場", category_child: "", done: false });
    strictEqual(canToggleProductionTask(standard, true), false);
    strictEqual(canToggleProductionTask(custom, true), true);
    strictEqual(canToggleProductionTask(custom, false), false);
  });
});

describe("task view helpers", () => {
  it("normalizes task creation values and rejects an empty title", () => {
    deepStrictEqual(buildTaskCreateInput({ title: "  入稿  ", stage: " 前期 ", category_parent: " 広報 ", category_child: " チラシ " }), {
      title: "入稿", stage: "前期", category_parent: "広報", category_child: "チラシ",
    });
    strictEqual(buildTaskCreateInput({ title: "  ", stage: "", category_parent: "", category_child: "" }), null);
  });

  it("keeps progress status separate from explicit deadline warnings", () => {
    strictEqual(getTaskProgressStatus(viewTask("progress", { status: "in-progress" })), "in-progress");
    strictEqual(getTaskDeadlineWarning(viewTask("14", { dueDate: "2026-11-03" }), "2026-10-20"), "within14Days");
    strictEqual(getTaskDeadlineWarning(viewTask("7", { dueDate: "2026-10-27" }), "2026-10-20"), "within7Days");
    strictEqual(getTaskDeadlineWarning(viewTask("late", { dueDate: "2026-10-19" }), "2026-10-20"), "overdue");
    strictEqual(getTaskDeadlineWarning(viewTask("done", { dueDate: "2026-10-01", status: "complete" }), "2026-10-20"), "none");
    strictEqual(getTaskDeadlineWarning(viewTask("no-date"), "2026-10-20"), "none");
  });

  it("aggregates the strongest warning across standard and custom tasks", () => {
    strictEqual(aggregateTaskWarning([
      viewTask("normal", { dueDate: "2026-12-01" }),
      viewTask("soon", { dueDate: "2026-10-26", source: "customTask", customTaskId: "soon" }),
      viewTask("late", { dueDate: "2026-10-19" }),
    ], "2026-10-20"), "overdue");
  });

  it("sorts dated tasks first and preserves source order for equal or missing deadlines", () => {
    deepStrictEqual(sortTasksByDeadline([
      viewTask("none-a"), viewTask("later", { dueDate: "2026-11-02" }),
      viewTask("first", { dueDate: "2026-10-25" }), viewTask("none-b"),
    ]).map(({ id }) => id), ["first", "later", "none-a", "none-b"]);
  });

  it("filters incomplete, approaching, and only explicitly assigned current-user tasks", () => {
    const tasks = [
      viewTask("mine", { dueDate: "2026-10-25", assigneeUid: "u1" }),
      viewTask("unknown", { dueDate: "2026-12-01" }),
      viewTask("done", { dueDate: "2026-10-01", status: "complete", assignee: "田中" }),
    ];
    deepStrictEqual(filterTasks(tasks, "mine", { uid: "u1", displayName: "田中" }, "2026-10-20").map(({ id }) => id), ["done", "mine"]);
    deepStrictEqual(filterTasks(tasks, "incomplete", null, "2026-10-20").map(({ id }) => id), ["mine", "unknown"]);
    deepStrictEqual(filterTasks(tasks, "due-soon", null, "2026-10-20").map(({ id }) => id), ["mine"]);
  });

  it("returns the section already resolved by the adapter", () => {
    strictEqual(getTaskSection(viewTask("flyer", { section: "flyer" })), "flyer");
    strictEqual(getTaskSection(viewTask("unknown", { section: null })), null);
  });

  it("uses a quiet dash for tasks without deadlines", () => {
    strictEqual(formatTaskDueDate(null), "—");
    strictEqual(formatTaskDueDate("2026-10-25"), "10/25");
  });
});
