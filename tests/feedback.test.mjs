import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    strictEqual(getFeedbackPageLabel("/projects/project-a/people"), "関係者管理");
    strictEqual(getFeedbackPageLabel("/projects/project-a/external-performances"), "他団体公演・折込");
    strictEqual(getFeedbackPageLabel("/projects/project-a/rehearsals"), "稽古");
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
      pageLabel: "WEB／SNS",
    }, "timestamp"), {
      type: "improvement",
      body: "もっと見やすくしてほしい",
      status: "unreviewed",
      reporterUid: "uid-a",
      reporterName: "テストユーザー",
      reporterRole: "editor",
      currentPath: "/projects/project-a/production/web",
      pageLabel: "WEB／SNS",
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

describe("feedback shortcut", () => {
  it("keeps the desktop label while using a safe compact mobile control below overlays", async () => {
    const [component, css] = await Promise.all([
      readFile(new URL("../app/projects/[projectId]/FeedbackLink.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/projects/[projectId]/feedback-link.module.css", import.meta.url), "utf8"),
    ]);

    strictEqual(component.includes('pathname === `/projects/${projectId}/feedback`'), true);
    strictEqual(component.includes('pathname: `/projects/${projectId}/feedback`'), true);
    strictEqual(component.includes('aria-label="フィードバックを送る"'), true);
    strictEqual(component.includes(">フィードバック</span>"), true);
    strictEqual(component.includes(">問題を報告</span>"), true);
    strictEqual(css.includes("z-index: 40"), true);
    strictEqual(css.includes("@media screen and (max-width: 700px)"), true);
    strictEqual(css.includes("z-index: 4"), true);
    strictEqual(css.includes("min-width: 44px"), true);
    strictEqual(css.includes("min-height: 44px"), true);
    strictEqual(css.includes("env(safe-area-inset-right, 0px)"), true);
    strictEqual(css.includes("env(safe-area-inset-bottom, 0px)"), true);
    strictEqual(css.includes("@media print"), true);
  });

  it("keeps the mobile shortcut below sticky actions and editing overlays", async () => {
    const [feedbackCss, attendanceCss, attendanceManageCss, rehearsalCss] = await Promise.all([
      readFile(new URL("../app/projects/[projectId]/feedback-link.module.css", import.meta.url), "utf8"),
      readFile(new URL("../app/projects/[projectId]/attendance/attendance.module.css", import.meta.url), "utf8"),
      readFile(new URL("../app/projects/[projectId]/attendance/manage/attendance-manage.module.css", import.meta.url), "utf8"),
      readFile(new URL("../app/projects/[projectId]/rehearsals/rehearsals.module.css", import.meta.url), "utf8"),
    ]);

    strictEqual(feedbackCss.includes("z-index: 4"), true);
    strictEqual(attendanceCss.includes("z-index: 5"), true);
    strictEqual(attendanceManageCss.includes("z-index: 30"), true);
    strictEqual(rehearsalCss.includes("z-index: 50"), true);
  });
});
