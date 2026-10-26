import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProjectNavigation,
  buildRehearsalSectionNavigation,
  getAttendanceManagementAccess,
  getLegacyParticipantRedirectPath,
  hasEnteredPerformanceInformation,
  isCurrentProjectPrimaryNavigationItem,
  isManagementMenuVisible,
  isCurrentProjectNavigationItem,
  reduceManagementMenuState,
} from "../lib/project-navigation.ts";
import { canEditProject, canManageMembers } from "../lib/auth.ts";

describe("project navigation", () => {
  it("uses three direct links and keeps only management as a menu", () => {
    const navigation = buildProjectNavigation("project-1");
    deepStrictEqual(navigation.primary, [
      { label: "公演トップ", href: "/projects/project-1" },
      { label: "稽古", href: "/projects/project-1/rehearsals" },
      { label: "制作タスク", href: "/projects/project-1/tasks" },
    ]);
    deepStrictEqual(navigation.management.map(({ label }) => label), ["関係者管理", "システム利用者", "更新履歴", "使い方"]);
    strictEqual([...navigation.primary, ...navigation.management].some(({ label }) => label === "制作ロードマップ"), false);
    strictEqual([...navigation.primary, ...navigation.management].some(({ label }) => label === "公演情報"), false);
  });

  it("shows owner, editor, and viewer items using existing role boundaries", () => {
    const member = buildProjectNavigation("p").management.map(({ label }) => label);
    strictEqual(member.includes("関係者管理"), true);
    strictEqual(member.includes("システム利用者"), true);
    strictEqual(member.includes("更新履歴"), true);
    strictEqual(canManageMembers("owner"), true);
    strictEqual(canManageMembers("editor"), false);
    strictEqual(canManageMembers("viewer"), false);
    strictEqual(canEditProject("owner"), true);
    strictEqual(canEditProject("editor"), true);
    strictEqual(canEditProject("viewer"), false);
  });

  it("keeps attendance management readable for viewers and editable only for owner and editor", () => {
    deepStrictEqual(getAttendanceManagementAccess("owner"), { canView: true, canEdit: true });
    deepStrictEqual(getAttendanceManagementAccess("editor"), { canView: true, canEdit: true });
    deepStrictEqual(getAttendanceManagementAccess("viewer"), { canView: true, canEdit: false });
  });

  it("redirects the removed participant page to people management", () => {
    strictEqual(getLegacyParticipantRedirectPath("project-1"), "/projects/project-1/people");
  });

  it("links all three rehearsal and attendance screens in both directions", () => {
    deepStrictEqual(buildRehearsalSectionNavigation("project-1"), [
      { label: "稽古スケジュール", href: "/projects/project-1/rehearsals" },
      { label: "自分の出欠", href: "/projects/project-1/attendance" },
      { label: "全体出欠", href: "/projects/project-1/attendance/manage" },
    ]);
    strictEqual(isCurrentProjectPrimaryNavigationItem("/projects/project-1/rehearsals", "/projects/project-1/rehearsals"), true);
    strictEqual(isCurrentProjectPrimaryNavigationItem("/projects/project-1/attendance", "/projects/project-1/rehearsals"), true);
    strictEqual(isCurrentProjectPrimaryNavigationItem("/projects/project-1/attendance/manage", "/projects/project-1/rehearsals"), true);
  });

  it("toggles management and closes it for every navigation dismissal", () => {
    strictEqual(reduceManagementMenuState(false, "toggle"), true);
    strictEqual(reduceManagementMenuState(true, "toggle"), false);
    for (const reason of ["management item", "direct link", "outside click", "Escape", "route change"]) {
      strictEqual(reduceManagementMenuState(true, "close"), false, reason);
    }
    strictEqual(isManagementMenuVisible(true, "/projects/p", "/projects/p"), true);
    strictEqual(isManagementMenuVisible(true, "/projects/p", "/projects/p/tasks"), false);
  });

  it("does not mark the roadmap anchor current at the same time as the project top", () => {
    strictEqual(isCurrentProjectNavigationItem("/projects/p", "/projects/p"), true);
    strictEqual(isCurrentProjectNavigationItem("/projects/p", "/projects/p#production-roadmap"), false);
  });
});

describe("performance information state", () => {
  it("reports missing information until all dashboard header fields are present", () => {
    strictEqual(hasEnteredPerformanceInformation({ hasPerformanceDate: false }), false);
    strictEqual(hasEnteredPerformanceInformation({ organizer: "劇団", performanceName: "第1回公演", title: "作品", venueName: "劇場", hasPerformanceDate: false }), false);
  });

  it("recognizes the same resolved information shown in the dashboard header", () => {
    strictEqual(hasEnteredPerformanceInformation({ organizer: "劇団", performanceName: "第1回公演", title: "作品", venueName: "劇場", hasPerformanceDate: true }), true);
  });

  it("accepts either a performance name or title when the other header fields are present", () => {
    strictEqual(hasEnteredPerformanceInformation({ organizer: "劇団", title: "作品", venueName: "劇場", hasPerformanceDate: true }), true);
    strictEqual(hasEnteredPerformanceInformation({ organizer: "劇団", performanceName: "第1回公演", venueName: "劇場", hasPerformanceDate: true }), true);
  });
});
