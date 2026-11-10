import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildFlyerDuplicateInput,
  buildFlyerValues,
  buildLegacyFlyer,
  sortFlyers,
} from "../lib/flyers.ts";

function flyer(id, values = {}) {
  return {
    id, name: id, enabled: true, revision: 0,
    createdByUid: "owner", updatedByUid: "owner", ...values,
  };
}

describe("multiple flyers", () => {
  it("normalizes names and optional production fields", () => {
    deepStrictEqual(buildFlyerValues({
      name: " 公募用チラシ ", enabled: true, size: " A4 ", sides: "double",
      quantity: 500, printer: " 印刷会社 ", submissionDate: "2026-11-01", printCost: 0,
    }), {
      name: "公募用チラシ", enabled: true, size: "A4", sides: "double",
      quantity: 500, printer: "印刷会社", submissionDate: "2026-11-01", printCost: 0,
    });
    throws(() => buildFlyerValues({ name: " ", enabled: true }), /チラシ名/);
    throws(() => buildFlyerValues({ name: "本番", enabled: true, quantity: 0 }), /部数/);
    throws(() => buildFlyerValues({ name: "本番", enabled: true, printCost: -1 }), /印刷費/);
    throws(() => buildFlyerValues({ name: "本番", enabled: true, deliveryDate: "2026-02-30" }), /納品実績日/);
  });

  it("adapts the embedded flyer as the fixed legacy item with a safe name fallback", () => {
    deepStrictEqual(buildLegacyFlyer({ enabled: true, size: "A4", quantity: 300 }), {
      id: "legacy-production-flyer", legacy: true, name: "チラシ",
      enabled: true, size: "A4", quantity: 300,
    });
    strictEqual(buildLegacyFlyer({ name: " 仮チラシ ", enabled: false }).name, "仮チラシ");
  });

  it("duplicates reusable print settings but resets dates, cost, ids, and metadata", () => {
    const duplicate = buildFlyerDuplicateInput({
      name: "本番チラシ", enabled: true, size: "A4", sides: "double", quantity: 1000,
      printer: "印刷所", submissionPlannedDate: "2026-10-01", submissionDate: "2026-10-02",
      deliveryPlannedDate: "2026-10-10", deliveryDate: "2026-10-11", printCost: 12000, order: 3,
    });
    deepStrictEqual(duplicate, {
      name: "本番チラシのコピー", enabled: true, size: "A4", sides: "double",
      quantity: 1000, printer: "印刷所",
    });
    for (const key of ["submissionPlannedDate", "submissionDate", "deliveryPlannedDate", "deliveryDate", "printCost", "order", "id", "revision", "createdAt"]) {
      strictEqual(key in duplicate, false);
    }
  });

  it("sorts by explicit order, then creation time and document id", () => {
    const time = (value) => ({ toMillis: () => value });
    deepStrictEqual(sortFlyers([
      flyer("unset-b", { createdAt: time(20) }),
      flyer("ordered-b", { order: 2, createdAt: time(1) }),
      flyer("ordered-a", { order: 1, createdAt: time(30) }),
      flyer("unset-a", { createdAt: time(20) }),
    ]).map(({ id }) => id), ["ordered-a", "ordered-b", "unset-a", "unset-b"]);
  });

  it("uses the new flyer panel without exposing the legacy design-variant panel", async () => {
    const source = await readFile(new URL("../app/projects/[projectId]/production/[section]/FlyerManagementClient.tsx", import.meta.url), "utf8");
    strictEqual(source.includes("<FlyersPanel"), true);
    strictEqual(source.includes("<FlyerVariantsPanel"), false);
    strictEqual(source.includes("renderPrintSection(\"poster\""), true);
  });

  it("keeps production percentage unchanged while allowing task views to consume supplied flyers", async () => {
    const [progress, taskView] = await Promise.all([
      readFile(new URL("../lib/production-progress.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/production-task-view.ts", import.meta.url), "utf8"),
    ]);
    strictEqual(progress.includes("getProjectFlyers"), false);
    strictEqual(taskView.includes("getProjectFlyers"), false);
    strictEqual(taskView.includes("projectFlyers"), true);
    strictEqual(taskView.includes("getFlyerRecordTaskId"), true);
    strictEqual(taskView.includes("buildLegacyFlyer"), true);
    strictEqual(taskView.includes("const flyer = normalizeFlyer"), true);
  });
});
