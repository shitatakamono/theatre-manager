import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConflictError,
  getProjectRevision,
  isConflictError,
  normalizeRevision,
} from "../lib/project-revisions.ts";

describe("project revisions", () => {
  it("treats missing and invalid revisions as zero", () => {
    strictEqual(getProjectRevision(undefined, "flyer"), 0);
    strictEqual(normalizeRevision(undefined), 0);
    strictEqual(normalizeRevision(-1), 0);
    strictEqual(normalizeRevision(1.5), 0);
  });

  it("keeps valid integer revisions", () => {
    strictEqual(getProjectRevision({ flyer: 3 }, "flyer"), 3);
  });

  it("identifies the dedicated conflict error", () => {
    const error = new ConflictError(2, 3);
    strictEqual(isConflictError(error), true);
    strictEqual(error.expectedRevision, 2);
    strictEqual(error.actualRevision, 3);
    strictEqual(isConflictError(new Error("network")), false);
  });
});
