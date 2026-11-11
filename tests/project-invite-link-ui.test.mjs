import { match, doesNotMatch } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
const root = new URL("../", import.meta.url); async function source(path) { return readFile(new URL(path, root), "utf8"); }

describe("project invite link UI", () => {
  it("uses people management as the primary invitation entry", async () => {
    const value = await source("app/projects/[projectId]/people/PeopleManagementClient.tsx");
    for (const text of ["新しい人を招待", "SeisakuBoard利用中", "招待済み", "未招待", "招待する", "新しい招待リンクを発行", "招待を取り消す", "リンクをコピー", "7日間有効"]) match(value, new RegExp(text));
    match(value, /canManageMembers/);
    match(value, /createProjectPerson/);
    match(value, /createProjectInviteLink\(project\.id, personId\)/);
    match(value, /createProjectInviteLink\(project\.id, person\.id\)/);
    match(value, /revokeProjectInviteLink/);
  });
  it("keeps system users focused on accounts and roles rather than invitation creation", async () => {
    const value = await source("app/projects/[projectId]/members/page.tsx");
    match(value, /アカウントと権限を確認/);
    match(value, /関係者管理から対象者を選んでください/);
    doesNotMatch(value, /ProjectInviteLinksPanel|createProjectMemberInvite|システム利用者を招待|招待リンクを作成/);
  });
  it("keeps raw invite tokens in sessionStorage, removes the fragment, and exposes no editor role", async () => {
    const page = await source("app/invite/InviteClient.tsx"); match(page, /sessionStorage/); match(page, /history\.replaceState/); match(page, /Googleでログイン（既存利用者）/); match(page, /LINEで公演に参加/); match(page, /loginWithLine\(token, true\)/); doesNotMatch(page, /localStorage/);
    const provider = await source("app/AuthProvider.tsx"); match(provider, /startMode: requireInvite \? "invite" : "normal"/); match(provider, /inviteToken/);
    const model = await source("lib/project-invite-links.ts"); doesNotMatch(model, /"editor"|"owner"/);
  });
});
