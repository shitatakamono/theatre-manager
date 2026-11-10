import type { PrintItemManagement } from "./production-management.ts";

export type FlyerSides = "single" | "double" | "";

export type FlyerInput = {
  name: string;
  enabled: boolean;
  size?: string;
  sides?: FlyerSides;
  quantity?: number;
  printer?: string;
  submissionPlannedDate?: string;
  submissionDate?: string;
  deliveryPlannedDate?: string;
  deliveryDate?: string;
  printCost?: number;
  order?: number;
};

export type Flyer = FlyerInput & {
  id: string;
  revision: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export type LegacyFlyer = FlyerInput & {
  id: "legacy-production-flyer";
  legacy: true;
};

export const EMPTY_FLYER_INPUT: FlyerInput = {
  name: "",
  enabled: true,
  sides: "",
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FLYER_FIELDS: Array<[keyof FlyerInput, string]> = [
  ["name", "チラシ名"],
  ["enabled", "使用有無"],
  ["size", "サイズ"],
  ["sides", "印刷面"],
  ["quantity", "部数"],
  ["printer", "印刷業者"],
  ["submissionPlannedDate", "入稿予定日"],
  ["submissionDate", "入稿実績日"],
  ["deliveryPlannedDate", "納品予定日"],
  ["deliveryDate", "納品実績日"],
  ["printCost", "印刷費"],
  ["order", "表示順"],
];

function optionalText(value: string | undefined, limit: number, label: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > limit) throw new Error(`${label}は${limit}文字以内で入力してください`);
  return normalized;
}

function optionalDate(value: string | undefined, label: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!DATE_PATTERN.test(normalized)) throw new Error(`${label}を正しく入力してください`);
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label}を正しく入力してください`);
  }
  return normalized;
}

export function buildFlyerValues(input: FlyerInput): FlyerInput {
  const name = input.name.trim();
  if (!name) throw new Error("チラシ名を入力してください");
  if (name.length > 100) throw new Error("チラシ名は100文字以内で入力してください");
  if (input.sides !== undefined && !["", "single", "double"].includes(input.sides)) {
    throw new Error("片面・両面の指定が不正です");
  }
  if (input.quantity !== undefined && (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 1000000)) {
    throw new Error("部数は1以上の整数で入力してください");
  }
  if (input.printCost !== undefined && (!Number.isInteger(input.printCost) || input.printCost < 0 || input.printCost > 1000000000)) {
    throw new Error("印刷費は0以上の整数で入力してください");
  }
  if (input.order !== undefined && (!Number.isInteger(input.order) || input.order <= 0 || input.order > 1000000)) {
    throw new Error("表示順は1以上の整数で入力してください");
  }

  const size = optionalText(input.size, 100, "サイズ");
  const printer = optionalText(input.printer, 200, "印刷業者");
  const submissionPlannedDate = optionalDate(input.submissionPlannedDate, "入稿予定日");
  const submissionDate = optionalDate(input.submissionDate, "入稿実績日");
  const deliveryPlannedDate = optionalDate(input.deliveryPlannedDate, "納品予定日");
  const deliveryDate = optionalDate(input.deliveryDate, "納品実績日");

  return {
    name,
    enabled: input.enabled,
    ...(size ? { size } : {}),
    ...(input.sides ? { sides: input.sides } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(printer ? { printer } : {}),
    ...(submissionPlannedDate ? { submissionPlannedDate } : {}),
    ...(submissionDate ? { submissionDate } : {}),
    ...(deliveryPlannedDate ? { deliveryPlannedDate } : {}),
    ...(deliveryDate ? { deliveryDate } : {}),
    ...(input.printCost !== undefined ? { printCost: input.printCost } : {}),
    ...(input.order !== undefined ? { order: input.order } : {}),
  };
}

export function flyerToInput(flyer: Flyer): FlyerInput {
  return Object.fromEntries(FLYER_FIELDS.map(([key]) => [key, flyer[key]]).filter(([, value]) => value !== undefined)) as FlyerInput;
}

export function buildLegacyFlyer(flyer?: PrintItemManagement): LegacyFlyer {
  return {
    id: "legacy-production-flyer",
    legacy: true,
    name: flyer?.name?.trim() || "チラシ",
    enabled: flyer?.enabled ?? false,
    ...(flyer?.size ? { size: flyer.size } : {}),
    ...(flyer?.sides ? { sides: flyer.sides } : {}),
    ...(flyer?.quantity !== undefined ? { quantity: flyer.quantity } : {}),
    ...(flyer?.printer ? { printer: flyer.printer } : {}),
    ...(flyer?.submissionPlannedDate ? { submissionPlannedDate: flyer.submissionPlannedDate } : {}),
    ...(flyer?.submissionDate ? { submissionDate: flyer.submissionDate } : {}),
    ...(flyer?.deliveryPlannedDate ? { deliveryPlannedDate: flyer.deliveryPlannedDate } : {}),
    ...(flyer?.deliveryDate ? { deliveryDate: flyer.deliveryDate } : {}),
    ...(flyer?.printCost !== undefined ? { printCost: flyer.printCost } : {}),
  };
}

export function buildFlyerDuplicateInput(source: FlyerInput): FlyerInput {
  const suffix = "のコピー";
  const sourceName = source.name.trim() || "チラシ";
  return buildFlyerValues({
    name: `${sourceName.slice(0, 100 - suffix.length)}${suffix}`,
    enabled: source.enabled,
    size: source.size,
    sides: source.sides,
    quantity: source.quantity,
    printer: source.printer,
  });
}

function timestampMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.MAX_SAFE_INTEGER;
}

export function sortFlyers(flyers: readonly Flyer[]): Flyer[] {
  return [...flyers].sort((left, right) => {
    const leftOrder = Number.isInteger(left.order) && (left.order ?? 0) > 0 ? left.order! : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isInteger(right.order) && (right.order ?? 0) > 0 ? right.order! : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder
      || timestampMillis(left.createdAt) - timestampMillis(right.createdAt)
      || left.id.localeCompare(right.id);
  });
}

export function getFlyerChangedFields(before: FlyerInput, after: FlyerInput): string[] {
  return FLYER_FIELDS
    .filter(([key]) => before[key] !== after[key])
    .map(([, label]) => label);
}
