import { match, doesNotMatch } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
const root = new URL("../", import.meta.url); async function source(path) { return readFile(new URL(path, root), "utf8"); }

describe("project invite link UI", () => {
  it("shows one-time general invite controls and management status", async () => {
    const value = await source("app/projects/[projectId]/members/ProjectInviteLinksPanel.tsx");
    for (const text of ["LINE等で送る招待リンク", "閲覧者（Viewer）", "7日間", "URLをコピー", "このURLは再表示できません", "無効化"]) match(value, new RegExp(text));
  });
  it("offers person-specific links only through the owner capability", async () => {
    const value = await source("app/projects/[projectId]/people/PeopleManagementClient.tsx"); match(value, /canManageMembers/); match(value, /createProjectInviteLink\(project\.id, editing\.id\)/); match(value, /関係者情報と自動で連携/);
  });
  it("keeps raw invite tokens in sessionStorage, removes the fragment, and exposes no editor role", async () => {
    const page = await source("app/invite/InviteClient.tsx"); match(page, /sessionStorage/); match(page, /history\.replaceState/); match(page, /Googleでログイン/); match(page, /LINEでログイン/); match(page, /loginWithLine\(token, true\)/); doesNotMatch(page, /localStorage/);
    const provider = await source("app/AuthProvider.tsx"); match(provider, /startMode: requireInvite \? "invite" : "normal"/); match(provider, /inviteToken/);
    const model = await source("lib/project-invite-links.ts"); doesNotMatch(model, /"editor"|"owner"/);
  });
});
