import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { createExternalPerformanceImportHandler } from "../lib/server/external-performance-import-handler.ts";
import { ExternalPerformanceImportError } from "../lib/server/external-performance-import.ts";

const context = { params: Promise.resolve({ projectId: "project-a" }) };
const row = {
  sourceRow: 2,
  input: { organizationName: "劇団", performanceName: "公演", venue: "", startDate: "", endDate: "", contact: "", contactMethod: "", contactPerson: "", note: "", insertion: null },
  confirmPossibleDuplicate: false,
};

describe("external performance import handler", () => {
  it("rejects missing and invalid Firebase authentication", async () => {
    const handler = createExternalPerformanceImportHandler({ verifyIdToken: async () => { throw new Error(); }, importRows: async () => ({}) });
    strictEqual((await handler(new Request("https://app.test", { method: "POST" }), context)).status, 401);
    strictEqual((await handler(new Request("https://app.test", { method: "POST", headers: { Authorization: "Bearer bad" } }), context)).status, 401);
  });

  it("passes only the verified uid and validated project route to the service", async () => {
    let received;
    const handler = createExternalPerformanceImportHandler({
      verifyIdToken: async () => ({ uid: "owner-a" }),
      importRows: async (input) => { received = input; return { imported: 1, skipped: 0, failed: 0, rows: [] }; },
    });
    const response = await handler(new Request("https://app.test", { method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify({ rows: [row] }) }), context);
    strictEqual(response.status, 200);
    strictEqual(received.uid, "owner-a");
    strictEqual(received.projectId, "project-a");
  });

  it("returns a safe forbidden response for viewers", async () => {
    const handler = createExternalPerformanceImportHandler({
      verifyIdToken: async () => ({ uid: "viewer-a" }),
      importRows: async () => { throw new ExternalPerformanceImportError("forbidden", 403, "CSVを取り込む権限がありません"); },
    });
    const response = await handler(new Request("https://app.test", { method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify({ rows: [row] }) }), context);
    strictEqual(response.status, 403);
    strictEqual((await response.json()).code, "forbidden");
  });
});
