import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TASK_RELATED_VIEW_DEFINITIONS,
  getTaskRelatedViewHref,
  getTaskRelatedViewLabel,
  isTaskRelatedView,
} from "../lib/task-related-views.ts";

describe("task related views", () => {
  it("defines every supported internal destination exactly once", () => {
    deepStrictEqual(TASK_RELATED_VIEW_DEFINITIONS.map(({ id }) => id), [
      "project-info", "rehearsals", "people", "attendance", "members",
      "production-venue", "production-flyer", "production-dm", "production-web",
      "production-tickets", "production-reception", "production-accounting",
      "external-performances", "production-assets",
    ]);
    strictEqual(new Set(TASK_RELATED_VIEW_DEFINITIONS.map(({ id }) => id)).size, TASK_RELATED_VIEW_DEFINITIONS.length);
  });

  it("returns labels and project-local routes only for allowed ids", () => {
    strictEqual(getTaskRelatedViewLabel("external-performances"), "折込管理");
    strictEqual(getTaskRelatedViewHref("project-a", "external-performances"), "/projects/project-a/external-performances");
    strictEqual(getTaskRelatedViewHref("project/a", "production-flyer"), "/projects/project%2Fa/production/flyer");
    strictEqual(getTaskRelatedViewHref("project-a", undefined), null);
    strictEqual(getTaskRelatedViewHref("project-a", "https://example.com"), null);
    strictEqual(getTaskRelatedViewHref("project-a", "javascript:alert(1)"), null);
    strictEqual(getTaskRelatedViewLabel("invalid"), null);
    strictEqual(isTaskRelatedView("rehearsals"), true);
    strictEqual(isTaskRelatedView("/projects/other/rehearsals"), false);
  });
});
