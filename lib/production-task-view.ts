import type { Task, ProjectPerformanceRecord } from "./firestore.ts";
import {
  STANDARD_ACCOUNTING_TASKS,
  normalizeAccounting,
  normalizeFlyer,
  normalizeReception,
  normalizeTickets,
  normalizeWeb,
  type AccountingTask,
} from "./production-management.ts";
import {
  normalizeVenueManagement,
  type ApplicationStatus,
  type SubmissionStatus,
} from "./venue-management.ts";

export type ProductionTaskSource = "standard" | "accountingCustom" | "customTask";
export type ProductionTaskStatus = "not-started" | "in-progress" | "complete" | "on-hold";
export type ProductionSectionSlug = "venue" | "flyer" | "web" | "tickets" | "reception" | "accounting";

export type ProductionTaskView = {
  id: string;
  source: ProductionTaskSource;
  section: ProductionSectionSlug | null;
  sectionLabel: string;
  detailLabel?: string;
  title: string;
  status: ProductionTaskStatus;
  dueDate: string | null;
  assignee: string | null;
  assigneeUid: string | null;
  note: string | null;
  custom: boolean;
  editTarget: string;
  customTaskId: string | null;
  stage?: string;
};

const SECTION_LABELS: Record<ProductionSectionSlug, string> = {
  venue: "会場",
  flyer: "チラシ・ポスター",
  web: "Web・SNS",
  tickets: "チケット",
  reception: "当日受付",
  accounting: "会計",
};

const validDate = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const dateFromDateTime = (value: unknown): string | null =>
  typeof value === "string" ? validDate(value.slice(0, 10)) : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const hasOwn = (value: object | undefined, key: PropertyKey): boolean =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

function standardTask(
  projectId: string,
  section: ProductionSectionSlug,
  key: string,
  title: string,
  values: Partial<Pick<ProductionTaskView, "status" | "dueDate" | "assignee" | "note" | "detailLabel">> = {}
): ProductionTaskView {
  return {
    id: `standard:${section}:${key}`,
    source: "standard",
    section,
    sectionLabel: SECTION_LABELS[section],
    title,
    status: values.status ?? "not-started",
    dueDate: values.dueDate ?? null,
    assignee: values.assignee ?? null,
    assigneeUid: null,
    note: values.note ?? null,
    custom: false,
    editTarget: `/projects/${projectId}/production/${section}`,
    customTaskId: null,
    detailLabel: values.detailLabel,
  };
}

function booleanStatus(value: unknown): ProductionTaskStatus {
  return value === true ? "complete" : "not-started";
}

function applicationStatus(value: ApplicationStatus | undefined): ProductionTaskStatus {
  if (value === "approved" || value === "not-required") return "complete";
  if (value === "applied") return "in-progress";
  return "not-started";
}

function submissionStatus(value: SubmissionStatus | undefined): ProductionTaskStatus {
  return value === "submitted" || value === "not-required" ? "complete" : "not-started";
}

function buildVenueTasks(project: ProjectPerformanceRecord): ProductionTaskView[] {
  const venue = normalizeVenueManagement(project.production?.venue);
  const tasks = [
    standardTask(project.id, "venue", "materials:flyer", "チラシ提出済", { status: booleanStatus(venue.materials?.flyerSubmitted) }),
    standardTask(project.id, "venue", "materials:poster", "ポスター提出済", { status: booleanStatus(venue.materials?.posterSubmitted) }),
    standardTask(project.id, "venue", "materials:publicity", "会場広報掲載依頼済", { status: booleanStatus(venue.materials?.publicityRequested), note: text(venue.materials?.note) }),
    standardTask(project.id, "venue", "meeting:adjustment", "劇場との日程調整", {
      status: venue.meeting?.adjustmentStatus === "confirmed" ? "complete" : venue.meeting?.adjustmentStatus === "adjusting" ? "in-progress" : "not-started",
      dueDate: validDate(venue.meeting?.plannedDate),
    }),
    standardTask(project.id, "venue", "meeting", "打ち合わせ", {
      status: venue.meeting?.completedDate ? "complete" : "not-started",
      dueDate: validDate(venue.meeting?.plannedDate),
      note: text(venue.meeting?.note),
    }),
    standardTask(project.id, "venue", "meeting:load-in", "搬入", { dueDate: dateFromDateTime(venue.meeting?.loadIn?.dateTime), note: text(venue.meeting?.loadIn?.note) }),
    standardTask(project.id, "venue", "meeting:load-out", "搬出", { dueDate: dateFromDateTime(venue.meeting?.loadOut?.dateTime), note: text(venue.meeting?.loadOut?.note) }),
    standardTask(project.id, "venue", "meeting:merchandise", "物販販売許可申請", { status: applicationStatus(venue.meeting?.merchandiseApplication) }),
    standardTask(project.id, "venue", "meeting:parking", "駐車場申請", { status: applicationStatus(venue.meeting?.parkingApplication) }),
  ];
  for (const [key, label] of [["audio", "音響"], ["lighting", "照明"], ["video", "映像"]] as const) {
    tasks.push(
      standardTask(project.id, "venue", `meeting:${key}:equipment`, `${label} 機材申請`, { status: submissionStatus(venue.meeting?.[key]?.equipmentApplication) }),
      standardTask(project.id, "venue", `meeting:${key}:plan`, `${label} 仕込み図`, { status: submissionStatus(venue.meeting?.[key]?.setupPlan) })
    );
  }
  for (const document of venue.documents ?? []) {
    tasks.push(standardTask(project.id, "venue", `documents:${document.id}`, document.name || "提出書類", {
      status: booleanStatus(document.submitted),
      dueDate: validDate(document.deadline),
      note: text(document.note),
      detailLabel: "提出書類",
    }));
  }
  return tasks;
}

function buildFlyerTasks(project: ProjectPerformanceRecord): ProductionTaskView[] {
  const flyer = normalizeFlyer(project.production?.flyer);
  const tasks: ProductionTaskView[] = [];
  for (const [key, label] of [["flyer", "チラシ"], ["poster", "ポスター"]] as const) {
    const item = flyer[key];
    if (item?.enabled) {
      tasks.push(
        standardTask(project.id, "flyer", `${key}:submission`, `${label} 入稿`, {
          status: item.submissionDate ? "complete" : "not-started",
          dueDate: validDate(item.submissionPlannedDate),
          assignee: text(flyer.specifications?.designer),
          detailLabel: label,
        }),
        standardTask(project.id, "flyer", `${key}:delivery`, `${label} 納品`, {
          status: item.deliveryDate ? "complete" : "not-started",
          dueDate: validDate(item.deliveryPlannedDate),
          detailLabel: label,
        })
      );
    }
  }
  for (const [key, label] of [
    ["informationFinalized", "公演情報確定"],
    ["sponsorInfoReady", "協賛・後援等掲載情報確認"],
    ["logoMaterialsReady", "ロゴ素材確認"],
    ["proofread", "校正"],
  ] as const) {
    tasks.push(standardTask(project.id, "flyer", `information:${key}`, label, {
      status: booleanStatus(flyer.information?.[key]),
      detailLabel: "掲載情報確認",
    }));
  }
  tasks.push(standardTask(project.id, "flyer", "distribution", "配布開始日", {
    dueDate: validDate(flyer.distribution?.distributionStartDate),
    note: text(flyer.distribution?.note),
  }));
  return tasks;
}

function buildWebTasks(project: ProjectPerformanceRecord): ProductionTaskView[] {
  const web = normalizeWeb(project.production?.web);
  const tasks: ProductionTaskView[] = [];
  if (web.page?.teaserEnabled) {
    tasks.push(standardTask(project.id, "web", "page:teaser", "ティザー公開", {
      status: web.page.teaserPublishDate ? "complete" : "not-started",
      dueDate: validDate(web.page.teaserPublishPlannedDate),
      detailLabel: "公演ページ",
    }));
  }
  tasks.push(standardTask(project.id, "web", "page", "本公開", {
    status: booleanStatus(web.page?.published),
    dueDate: validDate(web.page?.publishPlannedDate),
  }));
  for (const [key, label] of [["ticketLinkPublished", "チケットリンク掲載"], ["accessPublished", "アクセス掲載"], ["castPublished", "出演者掲載"], ["creditsPublished", "掲載情報掲載"]] as const) {
    tasks.push(standardTask(project.id, "web", `page:${key}`, label, { status: booleanStatus(web.page?.[key]), detailLabel: "公演ページ" }));
  }
  tasks.push(
    standardTask(project.id, "web", "announcements:sales", "販売開始告知", { status: booleanStatus(web.announcements?.ticketSalesAnnouncement), detailLabel: "告知タイミング" }),
    standardTask(project.id, "web", "announcements:reminder", "本番前リマインド", { status: booleanStatus(web.announcements?.preShowReminder), detailLabel: "告知タイミング" })
  );
  tasks.push(
    standardTask(project.id, "web", "consistency", "公演情報との整合確認", { status: web.consistency?.performanceInfoCheckedAt ? "complete" : "not-started", note: text(web.consistency?.note) }),
    standardTask(project.id, "web", "post-show:report", "終演報告", { status: booleanStatus(web.postShow?.postShowReport), detailLabel: "終演後対応" }),
    standardTask(project.id, "web", "post-show:ticket", "チケットリンク終了", { status: booleanStatus(web.postShow?.ticketLinkClosed), detailLabel: "終演後対応" }),
    standardTask(project.id, "web", "post-show:page", "公演ページ更新", { status: booleanStatus(web.postShow?.performancePageUpdated), note: text(web.postShow?.note), detailLabel: "終演後対応" })
  );
  return tasks;
}

function buildTicketTasks(project: ProjectPerformanceRecord): ProductionTaskView[] {
  const tickets = normalizeTickets(project.production?.tickets);
  return [
    standardTask(project.id, "tickets", "handoff", "受付への引継ぎ確認", { status: booleanStatus(tickets.handoff?.receptionHandoffConfirmed), note: text(tickets.handoff?.note) }),
  ];
}

function buildReceptionTasks(project: ProjectPerformanceRecord): ProductionTaskView[] {
  const shows = project.data.performances ?? [];
  const reception = normalizeReception(project.production?.reception, shows.map((show) => show.id));
  const operation = reception.operation;
  const tasks: ProductionTaskView[] = [];
  const preparationLabels = {
    receptionList: "受付名簿",
    guestList: "招待・ゲストリスト",
    program: "パンフレット",
    questionnaire: "アンケート",
    stationery: "筆記具",
    firstAid: "救急用品",
    otherSupplies: "その他受付備品",
  } as const;
  for (const [key, label] of Object.entries(preparationLabels) as [keyof typeof preparationLabels, string][]) {
    tasks.push(standardTask(project.id, "reception", `preparations:${key}`, label, { status: booleanStatus(reception.preparations?.[key]), detailLabel: "受付準備" }));
  }
  if (operation?.pos) tasks.push(standardTask(project.id, "reception", "preparations:register", "レジ・会計手段の準備", { status: booleanStatus(reception.preparations?.register), detailLabel: "受付準備" }));
  if (operation?.cashless) tasks.push(standardTask(project.id, "reception", "preparations:cashless", "決済端末・決済手段の準備", { status: booleanStatus(reception.preparations?.cashlessReady), detailLabel: "受付準備" }));
  for (const item of reception.preparations?.customItems ?? []) {
    tasks.push(standardTask(project.id, "reception", `preparations:custom:${item.id}`, item.label || "名称未設定", { status: booleanStatus(item.checked), detailLabel: "受付準備" }));
  }
  if (reception.merchandise?.enabled) {
    for (const [key, label] of Object.entries({ productRegistration: "販売商品登録・確認", inventoryRegistration: "在庫登録・確認", salesArea: "売場準備", pricePop: "値札・POP準備", delivery: "商品搬入確認" }) as ["productRegistration" | "inventoryRegistration" | "salesArea" | "pricePop" | "delivery", string][]) {
      tasks.push(standardTask(project.id, "reception", `merchandise:${key}`, label, { status: booleanStatus(reception.merchandise[key]), detailLabel: "物販準備" }));
    }
    for (const item of reception.merchandise.customItems ?? []) {
      tasks.push(standardTask(project.id, "reception", `merchandise:custom:${item.id}`, item.label || "名称未設定", { status: booleanStatus(item.checked), detailLabel: "物販準備" }));
    }
  }
  tasks.push(standardTask(project.id, "reception", "opening", "開場前確認", { status: booleanStatus(reception.opening?.openingCheckCompleted), note: text(reception.opening?.note) }));
  const showLabels = new Map(shows.map((show) => [show.id, `${show.date}${show.startTime ? ` ${show.startTime}` : ""}`]));
  for (const closing of reception.closingByPerformance ?? []) {
    const detailLabel = showLabels.get(closing.performanceId) ?? "公演回ごとの終演後確認";
    for (const [key, label] of [["salesChecked", "売上確認"], ["cashChecked", "現金確認"], ["registerClosed", "レジ・決済締め"], ["inventoryChecked", "在庫確認"]] as const) {
      if (hasOwn(closing, key)) tasks.push(standardTask(project.id, "reception", `closing:${closing.performanceId}:${key}`, label, { status: booleanStatus(closing[key]), detailLabel }));
    }
    for (const item of closing.customItems ?? []) {
      tasks.push(standardTask(project.id, "reception", `closing:${closing.performanceId}:custom:${item.id}`, item.label || "名称未設定", { status: booleanStatus(item.checked), detailLabel }));
    }
  }
  return tasks;
}

function accountingTask(projectId: string, task: AccountingTask): ProductionTaskView {
  const isCustom = task.custom === true || !STANDARD_ACCOUNTING_TASKS.some((standard) => standard.id === task.id);
  return {
    ...standardTask(projectId, "accounting", isCustom ? `custom:${task.id}` : `tasks:${task.id}`, task.label || "項目名未設定", {
      status: task.completed ? "complete" : "not-started",
      dueDate: validDate(task.dueDate),
      assignee: text(task.responsible),
      note: text(task.note),
      detailLabel: task.phase === "before" ? "公演前" : task.phase === "day" ? "公演当日" : "公演後",
    }),
    id: isCustom ? `accounting-custom:${task.id}` : `standard:accounting:tasks:${task.id}`,
    source: isCustom ? "accountingCustom" : "standard",
    custom: isCustom,
  };
}

export function getCustomTaskSection(task: Task): ProductionSectionSlug | null {
  const value = `${task.category_parent ?? ""} ${task.category_child ?? ""}`.trim().toLowerCase();
  if (/会場|venue/.test(value)) return "venue";
  if (/チラシ|ポスター|flyer|poster/.test(value)) return "flyer";
  if (/web|sns|ウェブ|サイト/.test(value)) return "web";
  if (/チケット|ticket/.test(value)) return "tickets";
  if (/受付|reception/.test(value)) return "reception";
  if (/会計|予算|account/.test(value)) return "accounting";
  return null;
}

function customTaskStatus(task: Task): ProductionTaskStatus {
  if (task.done) return "complete";
  const value = text(task.status)?.toLowerCase();
  if (["complete", "completed", "done", "完了"].includes(value ?? "")) return "complete";
  if (["in-progress", "in_progress", "progress", "進行中", "着手中"].includes(value ?? "")) return "in-progress";
  if (["on-hold", "on_hold", "hold", "保留"].includes(value ?? "")) return "on-hold";
  return "not-started";
}

export function toCustomProductionTask(projectId: string, task: Task): ProductionTaskView {
  const section = getCustomTaskSection(task);
  return {
    id: `custom:${task.id}`,
    source: "customTask",
    section,
    sectionLabel: section ? SECTION_LABELS[section] : "その他",
    detailLabel: [task.category_parent, task.category_child].filter(Boolean).join(" / ") || undefined,
    title: task.title || "名称未設定のタスク",
    status: customTaskStatus(task),
    dueDate: validDate(task.dueDate) ?? validDate(task.deadline),
    assignee: text(task.assigneeName) ?? text(task.assignee) ?? text(task.responsible),
    assigneeUid: text(task.assigneeUid),
    note: null,
    custom: true,
    editTarget: `/projects/${projectId}/tasks`,
    customTaskId: task.id,
    stage: task.stage,
  };
}

export function buildProductionTaskViews(project: ProjectPerformanceRecord, customTasks: readonly Task[]): ProductionTaskView[] {
  return [
    ...buildVenueTasks(project),
    ...buildFlyerTasks(project),
    ...buildWebTasks(project),
    ...buildTicketTasks(project),
    ...buildReceptionTasks(project),
    ...(normalizeAccounting(project.production?.accounting).tasks ?? []).map((task) => accountingTask(project.id, task)),
    ...customTasks.map((task) => toCustomProductionTask(project.id, task)),
  ];
}

export function canToggleProductionTask(task: ProductionTaskView, canEdit: boolean): boolean {
  return canEdit && task.source === "customTask" && task.customTaskId !== null;
}

