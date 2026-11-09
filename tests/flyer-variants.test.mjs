import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildFlyerVariantCopyInput,
  buildFlyerVariantValues,
  buildLegacyFlyerVariant,
  getFlyerVariantChangedFields,
  getFlyerVariantStatusLabel,
  hasLegacyFlyerData,
} from "../lib/flyer-variants.ts";

const flyer = {
  specifications: { designer: "担当者" },
  flyer: { enabled: true, submissionDate: "2026-11-01", deliveryDate: "2026-11-05" },
  information: { informationFinalized: true, sponsorInfoReady: true, proofread: true },
};

describe("flyer variants", () => {
  it("validates names and notes and exposes the four production statuses", () => {
    deepStrictEqual(buildFlyerVariantValues({ name: " A案 ", status: "review", note: " 確認待ち " }), {
      name: "A案", status: "review", note: "確認待ち",
    });
    strictEqual(getFlyerVariantStatusLabel("in-progress"), "制作中");
    throws(() => buildFlyerVariantValues({ name: "", status: "not-started", note: "" }), /パターン名/);
    throws(() => buildFlyerVariantValues({ name: "A", status: "not-started", note: "x".repeat(2001) }), /2000/);
  });

  it("copies user fields with a new name but no ids, revisions, or timestamps", () => {
    const copy = buildFlyerVariantCopyInput({ name: "A案", status: "in-progress", note: "赤を強める" });
    deepStrictEqual(copy, { name: "A案のコピー", status: "in-progress", note: "赤を強める" });
    strictEqual("id" in copy, false);
    strictEqual("revision" in copy, false);
    strictEqual("createdAt" in copy, false);
  });

  it("provides a legacy basic design without migrating the existing flyer document", () => {
    strictEqual(hasLegacyFlyerData(flyer.flyer), true);
    deepStrictEqual(buildLegacyFlyerVariant(flyer.flyer), {
      id: "legacy-basic", legacy: true, name: "基本案", status: "complete", note: "",
    });
    strictEqual(buildLegacyFlyerVariant(undefined), null);
  });

  it("records field labels only, never memo contents", () => {
    deepStrictEqual(getFlyerVariantChangedFields(
      { name: "A案", status: "not-started", note: "秘密の旧メモ" },
      { name: "B案", status: "review", note: "秘密の新メモ" },
    ), ["パターン名", "状態", "メモ"]);
  });

  it("does not affect existing flyer progress or standard production tasks", () => {
    return Promise.all([
      readFile(new URL("../lib/production-progress.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/production-task-view.ts", import.meta.url), "utf8"),
    ]).then(([progressSource, taskSource]) => {
      strictEqual(progressSource.includes("flyerVariants"), false);
      strictEqual(taskSource.includes("flyerVariants"), false);
      strictEqual(progressSource.includes("flyer.flyer?.submissionDate"), true);
      strictEqual(taskSource.includes("buildFlyerTasks"), true);
    });
  });

  it("keeps viewer controls hidden and confirms deletion in the dense flyer UI", async () => {
    const source = await readFile(new URL("../app/projects/[projectId]/production/[section]/FlyerVariantsPanel.tsx", import.meta.url), "utf8");
    strictEqual(source.includes("canEdit && <button"), true);
    strictEqual(source.includes("window.confirm"), true);
    strictEqual(source.includes("既存のチラシ情報"), true);
    strictEqual(source.includes("custom"), false);
  });
});
