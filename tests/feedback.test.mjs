import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFeedbackPayload,
  getFeedbackPageLabel,
  getFeedbackStatusLabel,
  getFeedbackTypeLabel,
  normalizeFeedbackBody,
  normalizeFeedbackSourcePath,
} from "../lib/feedback.ts";

describe("feedback labels", () => {
  it("converts feedback types and statuses to Japanese labels", () => {
    strictEqual(getFeedbackTypeLabel("bug"), "不具合");
    strictEqual(getFeedbackTypeLabel("confusing"), "分かりにくい");
    strictEqual(getFeedbackStatusLabel("unreviewed"), "未確認");
    strictEqual(getFeedbackStatusLabel("resolved"), "対応済");
  });

  it("converts project routes to readable page labels", () => {
    strictEqual(getFeedbackPageLabel("/projects/project-a"), "公演トップ");
    strictEqual(getFeedbackPageLabel("/projects/project-a/info"), "公演情報");
    strictEqual(getFeedbackPageLabel("/projects/project-a/production/flyer"), "チラシ・ポスター");
    strictEqual(getFeedbackPageLabel("/projects/project-a/production/accounting"), "会計");
  });
});

describe("feedback payload", () => {
  it("rejects a body containing only whitespace", () => {
    strictEqual(normalizeFeedbackBody("  \n  "), "");
    throws(() => buildFeedbackPayload({
      type: "bug", body: "  ", reporterUid: "uid-a", reporterRole: "viewer",
      currentPath: "/projects/project-a", pageLabel: "公演トップ",
    }, "timestamp"));
  });

  it("builds a valid payload without an email address and trims input", () => {
    deepStrictEqual(buildFeedbackPayload({
      type: "improvement",
      body: "  もっと見やすくしてほしい  ",
      reporterUid: "uid-a",
      reporterName: " テストユーザー ",
      reporterRole: "editor",
      currentPath: "/projects/project-a/production/web",
      pageLabel: "Web・SNS",
    }, "timestamp"), {
      type: "improvement",
      body: "もっと見やすくしてほしい",
      status: "unreviewed",
      reporterUid: "uid-a",
      reporterName: "テストユーザー",
      reporterRole: "editor",
      currentPath: "/projects/project-a/production/web",
      pageLabel: "Web・SNS",
      adminNote: "",
      createdAt: "timestamp",
      updatedAt: "timestamp",
    });
  });

  it("uses the safe reporter name fallback", () => {
    strictEqual(buildFeedbackPayload({
      type: "other", body: "気づき", reporterUid: "uid-a", reporterRole: "owner",
      currentPath: "/projects/project-a", pageLabel: "公演トップ",
    }, 1).reporterName, "名前未設定のユーザー");
  });

  it("keeps the page where reporting started and rejects another project path", () => {
    strictEqual(normalizeFeedbackSourcePath("project-a", "/projects/project-a/production/flyer?x=1"), "/projects/project-a/production/flyer");
    strictEqual(normalizeFeedbackSourcePath("project-a", "/projects/project-b/info"), "/projects/project-a/feedback");
  });
});
