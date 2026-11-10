import type { ProjectRole } from "./auth.ts";

export const PRODUCTION_ASSET_TYPE_OPTIONS = [
  { value: "troupe_logo", label: "劇団ロゴ" },
  { value: "performance_logo", label: "公演ロゴ" },
  { value: "flyer", label: "チラシ素材" },
  { value: "photo", label: "写真" },
  { value: "venue", label: "会場・舞台資料" },
  { value: "other", label: "その他" },
] as const;

export type ProductionAssetType = (typeof PRODUCTION_ASSET_TYPE_OPTIONS)[number]["value"];
export const MAX_PRODUCTION_ASSET_FLYERS = 50;

export type ProductionAssetInput = {
  name: string;
  type: ProductionAssetType;
  url: string;
  note: string;
  flyerIds?: string[];
};
export type ProductionAsset = ProductionAssetInput & {
  id: string;
  revision: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export const EMPTY_PRODUCTION_ASSET_INPUT: ProductionAssetInput = {
  name: "", type: "other", url: "", note: "",
};

const TYPES = new Set<string>(PRODUCTION_ASSET_TYPE_OPTIONS.map(({ value }) => value));

export function normalizeProductionAssetUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { throw new Error("保存場所URLを正しく入力してください"); }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("保存場所URLはhttp://またはhttps://で入力してください");
  }
  return parsed.toString();
}

export function readProductionAssetFlyerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))].sort();
}

export function normalizeProductionAssetFlyerIds(
  value: readonly string[] | undefined,
  allowedFlyerIds?: ReadonlySet<string>,
): string[] {
  const flyerIds = readProductionAssetFlyerIds(value);
  if (flyerIds.length > MAX_PRODUCTION_ASSET_FLYERS) {
    throw new Error(`関連チラシは${MAX_PRODUCTION_ASSET_FLYERS}件以内で選択してください`);
  }
  if (allowedFlyerIds) {
    const invalid = flyerIds.find((flyerId) => !allowedFlyerIds.has(flyerId));
    if (invalid) throw new Error("選択された関連チラシを確認できませんでした");
  }
  return flyerIds;
}

export function buildProductionAssetValues(
  input: ProductionAssetInput,
  allowedFlyerIds?: ReadonlySet<string>,
): ProductionAssetInput {
  const name = input.name.trim();
  const note = input.note.trim();
  if (!name) throw new Error("素材名を入力してください");
  if (name.length > 200) throw new Error("素材名は200文字以内で入力してください");
  if (!TYPES.has(input.type)) throw new Error("種別が不正です");
  if (note.length > 2000) throw new Error("メモは2000文字以内で入力してください");
  const flyerIds = normalizeProductionAssetFlyerIds(input.flyerIds, allowedFlyerIds);
  return {
    name,
    type: input.type,
    url: normalizeProductionAssetUrl(input.url),
    note,
    ...(flyerIds.length > 0 ? { flyerIds } : {}),
  };
}

export function productionAssetToInput(asset: ProductionAsset): ProductionAssetInput {
  return {
    name: asset.name,
    type: asset.type,
    url: asset.url,
    note: asset.note,
    ...(asset.flyerIds?.length ? { flyerIds: [...asset.flyerIds] } : {}),
  };
}

export function getProductionAssetTypeLabel(type: ProductionAssetType): string {
  return PRODUCTION_ASSET_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "その他";
}

export function getProductionAssetChangedFields(before: ProductionAssetInput, after: ProductionAssetInput): string[] {
  const fields: Array<["name" | "type" | "url" | "note", string]> = [
    ["name", "素材名"], ["type", "種別"], ["url", "保存場所URL"], ["note", "メモ"],
  ];
  const changed = fields.filter(([key]) => before[key] !== after[key]).map(([, label]) => label);
  if (normalizeProductionAssetFlyerIds(before.flyerIds).join("\n") !== normalizeProductionAssetFlyerIds(after.flyerIds).join("\n")) {
    changed.push("関連チラシ");
  }
  return changed;
}

export function resolveProductionAssetFlyerNames(
  flyerIds: readonly string[] | undefined,
  flyers: readonly { id: string; name: string }[],
): string[] {
  const selected = new Set(readProductionAssetFlyerIds(flyerIds));
  return flyers.filter((flyer) => selected.has(flyer.id)).map((flyer) => flyer.name);
}

export function formatProductionAssetFlyerNames(names: readonly string[], limit = 2): string {
  const visible = names.slice(0, limit).join(" / ");
  const remaining = names.length - limit;
  return remaining > 0 ? `${visible} 他${remaining}件` : visible;
}

export function getProductionAssetCapabilities(role?: ProjectRole) {
  return { canView: role === "owner" || role === "editor" || role === "viewer", canEdit: role === "owner" || role === "editor" };
}
