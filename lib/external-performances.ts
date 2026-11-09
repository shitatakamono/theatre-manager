import type { ProjectRole } from "./auth.ts";

export const INSERTION_METHOD_OPTIONS = [
  { value: "with_work", label: "持込作業あり", shortLabel: "持込" },
  { value: "without_work", label: "持込作業なし", shortLabel: "持込" },
  { value: "postal", label: "郵送", shortLabel: "郵送" },
] as const;

export const INSERTION_STATUS_OPTIONS = [
  { value: "before_contact", label: "連絡前" },
  { value: "contacted", label: "連絡済" },
  { value: "confirmed", label: "確定" },
  { value: "completed", label: "完了" },
] as const;

export type InsertionMethod = (typeof INSERTION_METHOD_OPTIONS)[number]["value"];
export type InsertionStatus = (typeof INSERTION_STATUS_OPTIONS)[number]["value"];
export type ExternalPerformanceFilter = "all" | "planned" | "incomplete" | "completed";

export type ExternalPerformanceInsertionInput = {
  method: InsertionMethod;
  dateTimeText: string;
  quantity: string;
  postalAddress: string;
  postalRecipient: string;
  postalArrivalText: string;
  note: string;
  status: InsertionStatus;
};

export type ExternalPerformanceInput = {
  organizationName: string;
  performanceName: string;
  startDate: string;
  endDate: string;
  venue: string;
  contact: string;
  contactMethod: string;
  contactPerson: string;
  note: string;
  insertion: ExternalPerformanceInsertionInput | null;
};

export type ExternalPerformanceInsertion = Omit<ExternalPerformanceInsertionInput, "quantity"> & {
  quantity?: number;
};

export type ExternalPerformanceValues = Omit<ExternalPerformanceInput, "insertion"> & {
  insertion: ExternalPerformanceInsertion | null;
};

export type ExternalPerformance = ExternalPerformanceValues & {
  id: string;
  revision: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export const EMPTY_EXTERNAL_PERFORMANCE_INPUT: ExternalPerformanceInput = {
  organizationName: "", performanceName: "", startDate: "", endDate: "", venue: "",
  contact: "", contactMethod: "", contactPerson: "", note: "", insertion: null,
};

export const EMPTY_INSERTION_INPUT: ExternalPerformanceInsertionInput = {
  method: "with_work", dateTimeText: "", quantity: "", postalAddress: "",
  postalRecipient: "", postalArrivalText: "", note: "", status: "before_contact",
};

const METHODS = INSERTION_METHOD_OPTIONS.map(({ value }) => value);
const STATUSES = INSERTION_STATUS_OPTIONS.map(({ value }) => value);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function trimmed(value: string, limit: number, label: string): string {
  const result = value.trim();
  if (result.length > limit) throw new Error(`${label}は${limit}文字以内で入力してください`);
  return result;
}

export function buildExternalPerformanceValues(input: ExternalPerformanceInput): ExternalPerformanceValues {
  const organizationName = trimmed(input.organizationName, 200, "団体名");
  const performanceName = trimmed(input.performanceName, 200, "公演名");
  if (!organizationName || !performanceName) throw new Error("団体名と公演名を入力してください");
  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim();
  if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) throw new Error("公演日を正しく入力してください");
  if (startDate && endDate && endDate < startDate) throw new Error("終了日は開始日以降にしてください");

  let insertion: ExternalPerformanceInsertion | null = null;
  if (input.insertion) {
    if (!METHODS.includes(input.insertion.method)) throw new Error("折込方法が不正です");
    if (!STATUSES.includes(input.insertion.status)) throw new Error("折込状況が不正です");
    const quantityText = input.insertion.quantity.trim();
    const quantity = quantityText ? Number(quantityText) : undefined;
    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1000000)) {
      throw new Error("部数は1以上の整数で入力してください");
    }
    const postal = input.insertion.method === "postal";
    insertion = {
      method: input.insertion.method,
      dateTimeText: trimmed(input.insertion.dateTimeText, 200, "折込・受渡日時"),
      ...(quantity !== undefined ? { quantity } : {}),
      postalAddress: postal ? trimmed(input.insertion.postalAddress, 500, "郵送先住所") : "",
      postalRecipient: postal ? trimmed(input.insertion.postalRecipient, 200, "宛名") : "",
      postalArrivalText: postal ? trimmed(input.insertion.postalArrivalText, 200, "到着指定") : "",
      note: trimmed(input.insertion.note, 2000, "折込メモ"),
      status: input.insertion.status,
    };
  }
  return {
    organizationName, performanceName, startDate, endDate,
    venue: trimmed(input.venue, 300, "会場"),
    contact: trimmed(input.contact, 300, "連絡先"),
    contactMethod: trimmed(input.contactMethod, 200, "連絡方法"),
    contactPerson: trimmed(input.contactPerson, 200, "担当者"),
    note: trimmed(input.note, 3000, "備考"), insertion,
  };
}

export function externalPerformanceToInput(item: ExternalPerformance): ExternalPerformanceInput {
  return {
    organizationName: item.organizationName, performanceName: item.performanceName,
    startDate: item.startDate, endDate: item.endDate, venue: item.venue,
    contact: item.contact, contactMethod: item.contactMethod, contactPerson: item.contactPerson,
    note: item.note,
    insertion: item.insertion ? { ...item.insertion, quantity: item.insertion.quantity === undefined ? "" : String(item.insertion.quantity) } : null,
  };
}

export function sortExternalPerformances(items: ExternalPerformance[]): ExternalPerformance[] {
  return [...items].sort((left, right) => {
    if (left.startDate && !right.startDate) return -1;
    if (!left.startDate && right.startDate) return 1;
    return left.startDate.localeCompare(right.startDate, "ja")
      || left.organizationName.localeCompare(right.organizationName, "ja")
      || left.performanceName.localeCompare(right.performanceName, "ja")
      || left.id.localeCompare(right.id);
  });
}

export function filterExternalPerformances(items: ExternalPerformance[], filter: ExternalPerformanceFilter): ExternalPerformance[] {
  if (filter === "planned") return items.filter(({ insertion }) => insertion !== null);
  if (filter === "incomplete") return items.filter(({ insertion }) => insertion !== null && insertion.status !== "completed");
  if (filter === "completed") return items.filter(({ insertion }) => insertion?.status === "completed");
  return items;
}

export function getInsertionSummary(insertion: ExternalPerformanceInsertion | null): string {
  if (!insertion) return "―";
  const method = INSERTION_METHOD_OPTIONS.find(({ value }) => value === insertion.method)?.shortLabel ?? "";
  const quantity = insertion.quantity === undefined ? "部数未定" : `${insertion.quantity.toLocaleString("ja-JP")}部`;
  return `${quantity}・${method}`;
}

export function getInsertionDateTimeLabel(insertion: ExternalPerformanceInsertion | null): string {
  if (!insertion) return "―";
  const values = [
    insertion.dateTimeText,
    insertion.method === "postal" && insertion.postalArrivalText ? `到着：${insertion.postalArrivalText}` : "",
  ].filter(Boolean);
  return values.join(" / ") || "未定";
}

export function getInsertionStatusLabel(insertion: ExternalPerformanceInsertion | null): string {
  if (!insertion) return "折込予定なし";
  return INSERTION_STATUS_OPTIONS.find(({ value }) => value === insertion.status)?.label ?? "";
}

export function getExternalPerformanceCapabilities(role?: ProjectRole) {
  return { canView: role === "owner" || role === "editor" || role === "viewer", canEdit: role === "owner" || role === "editor" };
}

export function getExternalPerformanceChangedFields(before: ExternalPerformanceValues, after: ExternalPerformanceValues): string[] {
  const fields: Array<[keyof Omit<ExternalPerformanceValues, "insertion">, string]> = [
    ["organizationName", "団体名"], ["performanceName", "公演名"], ["startDate", "公演日"],
    ["endDate", "公演日"], ["venue", "会場"], ["contact", "連絡先"],
    ["contactMethod", "連絡方法"], ["contactPerson", "担当者"], ["note", "備考"],
  ];
  const changed = fields.filter(([key]) => before[key] !== after[key]).map(([, label]) => label);
  if (!before.insertion && after.insertion) changed.push("折込情報追加");
  else if (before.insertion && !after.insertion) changed.push("折込情報削除");
  else if (before.insertion && after.insertion && JSON.stringify(before.insertion) !== JSON.stringify(after.insertion)) {
    changed.push(before.insertion.status !== "completed" && after.insertion.status === "completed" ? "折込完了" : "折込情報");
  }
  return [...new Set(changed)];
}
