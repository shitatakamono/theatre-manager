import type { PrintItemManagement } from "./production-management.ts";

export const FLYER_VARIANT_STATUS_OPTIONS = [
  { value: "not-started", label: "未着手" },
  { value: "in-progress", label: "制作中" },
  { value: "review", label: "確認中" },
  { value: "complete", label: "完了" },
] as const;

export type FlyerVariantStatus = (typeof FLYER_VARIANT_STATUS_OPTIONS)[number]["value"];

export type FlyerVariantInput = {
  name: string;
  status: FlyerVariantStatus;
  note: string;
};

export type FlyerVariant = FlyerVariantInput & {
  id: string;
  revision: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export type LegacyFlyerVariant = FlyerVariantInput & {
  id: "legacy-basic";
  legacy: true;
};

export const EMPTY_FLYER_VARIANT_INPUT: FlyerVariantInput = {
  name: "",
  status: "not-started",
  note: "",
};

const VALID_STATUSES = new Set<string>(FLYER_VARIANT_STATUS_OPTIONS.map(({ value }) => value));

export function buildFlyerVariantValues(input: FlyerVariantInput): FlyerVariantInput {
  const name = input.name.trim();
  const note = input.note.trim();
  if (!name) throw new Error("パターン名を入力してください");
  if (name.length > 100) throw new Error("パターン名は100文字以内で入力してください");
  if (!VALID_STATUSES.has(input.status)) throw new Error("状態が不正です");
  if (note.length > 2000) throw new Error("メモは2000文字以内で入力してください");
  return { name, status: input.status, note };
}

export function flyerVariantToInput(variant: FlyerVariant): FlyerVariantInput {
  return { name: variant.name, status: variant.status, note: variant.note };
}

export function buildFlyerVariantCopyInput(source: FlyerVariantInput): FlyerVariantInput {
  const suffix = "のコピー";
  const sourceName = source.name.trim() || "パターン";
  const name = `${sourceName.slice(0, 100 - suffix.length)}${suffix}`;
  return buildFlyerVariantValues({ name, status: source.status, note: source.note });
}

export function getFlyerVariantChangedFields(before: FlyerVariantInput, after: FlyerVariantInput): string[] {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push("パターン名");
  if (before.status !== after.status) changed.push("状態");
  if (before.note !== after.note) changed.push("メモ");
  return changed;
}

export function hasLegacyFlyerData(flyer?: PrintItemManagement): boolean {
  return Boolean(
    flyer?.enabled
    || flyer?.size?.trim()
    || flyer?.sides
    || flyer?.quantity !== undefined
    || flyer?.printer?.trim()
    || flyer?.submissionPlannedDate
    || flyer?.submissionDate
    || flyer?.deliveryPlannedDate
    || flyer?.deliveryDate
    || flyer?.printCost !== undefined
  );
}

export function buildLegacyFlyerVariant(flyer?: PrintItemManagement): LegacyFlyerVariant | null {
  if (!hasLegacyFlyerData(flyer)) return null;
  const status: FlyerVariantStatus = flyer?.deliveryDate
    ? "complete"
    : flyer?.submissionDate || flyer?.enabled
      ? "in-progress"
      : "not-started";
  return { id: "legacy-basic", legacy: true, name: "基本案", status, note: "" };
}

export function getFlyerVariantStatusLabel(status: FlyerVariantStatus): string {
  return FLYER_VARIANT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "未着手";
}
