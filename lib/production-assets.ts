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
export type ProductionAssetInput = { name: string; type: ProductionAssetType; url: string; note: string };
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

export function buildProductionAssetValues(input: ProductionAssetInput): ProductionAssetInput {
  const name = input.name.trim();
  const note = input.note.trim();
  if (!name) throw new Error("素材名を入力してください");
  if (name.length > 200) throw new Error("素材名は200文字以内で入力してください");
  if (!TYPES.has(input.type)) throw new Error("種別が不正です");
  if (note.length > 2000) throw new Error("メモは2000文字以内で入力してください");
  return { name, type: input.type, url: normalizeProductionAssetUrl(input.url), note };
}

export function productionAssetToInput(asset: ProductionAsset): ProductionAssetInput {
  return { name: asset.name, type: asset.type, url: asset.url, note: asset.note };
}

export function getProductionAssetTypeLabel(type: ProductionAssetType): string {
  return PRODUCTION_ASSET_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "その他";
}

export function getProductionAssetChangedFields(before: ProductionAssetInput, after: ProductionAssetInput): string[] {
  const fields: Array<[keyof ProductionAssetInput, string]> = [
    ["name", "素材名"], ["type", "種別"], ["url", "保存場所URL"], ["note", "メモ"],
  ];
  return fields.filter(([key]) => before[key] !== after[key]).map(([, label]) => label);
}

export function getProductionAssetCapabilities(role?: ProjectRole) {
  return { canView: role === "owner" || role === "editor" || role === "viewer", canEdit: role === "owner" || role === "editor" };
}
