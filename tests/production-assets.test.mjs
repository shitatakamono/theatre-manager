import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildProductionAssetValues, getProductionAssetCapabilities,
  getProductionAssetChangedFields, getProductionAssetTypeLabel,
  normalizeProductionAssetUrl,
} from "../lib/production-assets.ts";

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
  });

  it("links the logo-material check and project navigation to the asset list", async () => {
    const flyer = await readFile(new URL("../app/projects/[projectId]/production/[section]/FlyerManagementClient.tsx", import.meta.url), "utf8");
    strictEqual(flyer.includes("登録済みの制作素材を見る"), true);
    strictEqual(flyer.includes("/assets"), true);
  });
});
