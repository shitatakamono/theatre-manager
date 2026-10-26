import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProjectNavigation,
  getAttendanceManagementAccess,
  getLegacyParticipantManagementAccess,
  hasEnteredPerformanceInformation,
  isCurrentProjectNavigationItem,
} from "../lib/project-navigation.ts";
import { canEditProject, canManageMembers } from "../lib/auth.ts";

function labels(groups) {
  return groups.flatMap((group) => group.items.map((item) => item.label));
}

describe("project navigation", () => {
  it("builds the four groups and stable primary URLs", () => {
    const groups = buildProjectNavigation("project-1", "owner");
    deepStrictEqual(groups.map(({ label }) => label), ["公演", "稽古", "制作", "管理"]);
    strictEqual(groups[0].items[0].href, "/projects/project-1");
    strictEqual(groups[0].items[1].href, "/projects/project-1/info");
    strictEqual(groups[1].items[0].href, "/projects/project-1/rehearsals");
    strictEqual(groups[2].items[0].href, "/projects/project-1#production-roadmap");
    strictEqual(groups[2].items[1].href, "/projects/project-1/tasks");
    strictEqual(groups[3].items[0].href, "/projects/project-1/people");
    strictEqual(groups[3].items.find(({ label }) => label === "参加者管理（補助）")?.href, "/projects/project-1/participants");
  });

  it("shows owner, editor, and viewer items using existing role boundaries", () => {
    const owner = labels(buildProjectNavigation("p", "owner"));
    const editor = labels(buildProjectNavigation("p", "editor"));
    const viewer = labels(buildProjectNavigation("p", "viewer"));
    strictEqual(owner.includes("関係者管理"), true);
    strictEqual(owner.includes("システム利用者"), true);
    strictEqual(owner.includes("全体出欠"), true);
    strictEqual(editor.includes("システム利用者"), true);
    strictEqual(editor.includes("関係者管理"), true);
    strictEqual(editor.includes("全体出欠"), true);
    strictEqual(editor.includes("参加者管理（補助）"), true);
    strictEqual(viewer.includes("全体出欠"), true);
    strictEqual(viewer.includes("関係者管理"), true);
    strictEqual(viewer.includes("システム利用者"), true);
    strictEqual(viewer.includes("参加者管理（補助）"), true);
    strictEqual(viewer.includes("更新履歴"), true);
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

  it("keeps the legacy participant page readable but not editable for every member role", () => {
    deepStrictEqual(getLegacyParticipantManagementAccess("owner"), { canView: true, canEdit: false });
    deepStrictEqual(getLegacyParticipantManagementAccess("editor"), { canView: true, canEdit: false });
    deepStrictEqual(getLegacyParticipantManagementAccess("viewer"), { canView: true, canEdit: false });
    deepStrictEqual(getLegacyParticipantManagementAccess(undefined), { canView: false, canEdit: false });
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
