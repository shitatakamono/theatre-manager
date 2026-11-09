import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { getProductionActivityDefinition } from "../lib/activity.ts";
import { normalizeDm } from "../lib/production-management.ts";

describe("DM management", () => {
  it("normalizes missing and saved preparation data", () => {
    deepStrictEqual(normalizeDm(), { preparation: {} });
    const preparation = {
      invitationReady: true, flyerReady: true, otherReady: true,
      otherLabel: "招待券", envelopeReady: true, mailedDate: "2027-02-01",
    };
    deepStrictEqual(normalizeDm({ preparation }), { preparation });
  });

  it("logs field labels only and does not copy the other text", () => {
    const fields = getProductionActivityDefinition("dm", "preparation").fields;
    deepStrictEqual(fields.map(({ label }) => label), [
      "案内状", "チラシ", "その他", "その他内容", "封筒", "投函日",
    ]);
    strictEqual(fields.some(({ label }) => label.includes("招待券")), false);
  });

  it("keeps DM preparation separate from flyer distribution and production progress", async () => {
    const types = await readFile(new URL("../lib/production-management.ts", import.meta.url), "utf8");
    const progress = await readFile(new URL("../lib/production-progress.ts", import.meta.url), "utf8");
    strictEqual(types.includes("dm: DmManagement"), true);
    strictEqual(types.includes("distribution?:"), true);
    strictEqual(progress.includes("getDmProgress"), false);
  });

  it("provides separate DM and insertion links from the roadmap", async () => {
    const page = await readFile(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
    strictEqual(page.includes('href={`/projects/${projectId}/production/dm`}>DM管理</Link>'), true);
    strictEqual(page.includes('href={`/projects/${projectId}/external-performances`}>折込管理</Link>'), true);
  });

  it("uses the shared role-aware editor and supports an optional mailed date", async () => {
    const client = await readFile(new URL("../app/projects/[projectId]/production/[section]/DmManagementClient.tsx", import.meta.url), "utf8");
    strictEqual(client.includes("useProductionEditor("), true);
    strictEqual(client.includes('"dm"'), true);
    strictEqual(client.includes('type="date"'), true);
    strictEqual(client.includes('value={draft.mailedDate ?? ""}'), true);
    strictEqual(client.includes("その他内容"), true);
  });
});
