import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildProductionAssetValues, getProductionAssetCapabilities,
  getProductionAssetChangedFields, getProductionAssetTypeLabel,
  formatProductionAssetFlyerNames, normalizeProductionAssetFlyerIds,
  normalizeProductionAssetUrl,
  readProductionAssetFlyerIds, resolveProductionAssetFlyerNames,
} from "../lib/production-assets.ts";
import { LEGACY_FLYER_ID } from "../lib/flyers.ts";

const base = { name: " 劇団カレーライス ロゴ PNG ", type: "troupe_logo", url: "", note: " 透明背景版 " };

describe("production asset values", () => {
  it("requires only the asset name and keeps a missing location valid", () => {
    deepStrictEqual(buildProductionAssetValues(base), { name: "劇団カレーライス ロゴ PNG", type: "troupe_logo", url: "", note: "透明背景版" });
    throws(() => buildProductionAssetValues({ ...base, name: "  " }), /素材名/);
    strictEqual(getProductionAssetTypeLabel("flyer"), "チラシ素材");
  });

  it("accepts only valid HTTP and HTTPS locations", () => {
    strictEqual(normalizeProductionAssetUrl("https://drive.google.com/example"), "https://drive.google.com/example");
    strictEqual(normalizeProductionAssetUrl("http://example.test/folder"), "http://example.test/folder");
    strictEqual(normalizeProductionAssetUrl("  "), "");
    for (const value of ["javascript:alert(1)", "data:text/plain,x", "ftp://example.test/x", "not-a-url", "https://"]) {
      throws(() => normalizeProductionAssetUrl(value));
    }
  });

  it("reports field labels without copying URLs or memo contents", () => {
    deepStrictEqual(getProductionAssetChangedFields(
      { name: "A", type: "photo", url: "https://old.example/x", note: "旧メモ" },
      { name: "B", type: "flyer", url: "https://new.example/x", note: "新メモ" },
    ), ["素材名", "種別", "保存場所URL", "メモ"]);
  });

  it("normalizes optional flyer relations as an unordered unique set", () => {
    strictEqual("flyerIds" in buildProductionAssetValues(base), false);
    deepStrictEqual(normalizeProductionAssetFlyerIds(
      [" flyer-b ", "", LEGACY_FLYER_ID, "flyer-b", "flyer-a"],
      new Set([LEGACY_FLYER_ID, "flyer-a", "flyer-b"]),
    ), ["flyer-a", "flyer-b", LEGACY_FLYER_ID].sort());
    throws(() => normalizeProductionAssetFlyerIds(["unknown"], new Set([LEGACY_FLYER_ID])), /確認できません/);
    throws(() => normalizeProductionAssetFlyerIds(Array.from({ length: 51 }, (_, index) => `flyer-${index}`)), /50件以内/);
    deepStrictEqual(readProductionAssetFlyerIds(["", 1, "stale", "stale"]), ["stale"]);
  });

  it("resolves relation names in the existing flyer display order and hides stale ids", () => {
    const choices = [
      { id: LEGACY_FLYER_ID, name: "既存のチラシ" },
      { id: "ordered", name: "本番チラシ" },
      { id: "later", name: "公募用チラシ" },
    ];
    const names = resolveProductionAssetFlyerNames(["stale", "later", LEGACY_FLYER_ID, "ordered"], choices);
    deepStrictEqual(names, ["既存のチラシ", "本番チラシ", "公募用チラシ"]);
    strictEqual(formatProductionAssetFlyerNames(names), "既存のチラシ / 本番チラシ 他1件");
  });

  it("tracks flyer relation changes without treating array order as a change", () => {
    const before = { ...base, flyerIds: [LEGACY_FLYER_ID, "flyer-a"] };
    deepStrictEqual(getProductionAssetChangedFields(before, { ...base, flyerIds: ["flyer-a", LEGACY_FLYER_ID] }), []);
    deepStrictEqual(getProductionAssetChangedFields(before, { ...base, flyerIds: ["flyer-b"] }), ["関連チラシ"]);
  });

  it("keeps owner/editor writes and viewer read-only", () => {
    deepStrictEqual(getProductionAssetCapabilities("owner"), { canView: true, canEdit: true });
    deepStrictEqual(getProductionAssetCapabilities("editor"), { canView: true, canEdit: true });
    deepStrictEqual(getProductionAssetCapabilities("viewer"), { canView: true, canEdit: false });
  });

  it("uses safe links, missing-location labels, confirmation, and no file deletion API", async () => {
    const page = await readFile(new URL("../app/projects/[projectId]/assets/page.tsx", import.meta.url), "utf8");
    strictEqual(page.includes('target="_blank"'), true);
    strictEqual(page.includes('rel="noopener noreferrer"'), true);
    strictEqual(page.includes("未登録"), true);
    strictEqual(page.includes("window.confirm"), true);
    strictEqual(page.includes("実ファイルは削除されません"), true);
    strictEqual(page.includes("deleteObject"), false);
    strictEqual(page.includes("Firebase Storage"), false);
    strictEqual(page.includes("関連チラシ"), true);
    strictEqual(page.includes('type="checkbox"'), true);
  });

  it("links the logo-material check and project navigation to the asset list", async () => {
    const flyer = await readFile(new URL("../app/projects/[projectId]/production/[section]/FlyerManagementClient.tsx", import.meta.url), "utf8");
    strictEqual(flyer.includes("登録済みの制作素材を見る"), true);
    strictEqual(flyer.includes("/assets"), true);
  });
});
