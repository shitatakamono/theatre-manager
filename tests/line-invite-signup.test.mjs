import { match, notStrictEqual, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { LINE_INVITE_SIGNUP_TTL_MS, generateLineInviteSignupToken, generateLineOnlyFirebaseUid, getLineInviteSignupId } from "../lib/line-invite-signup.ts";

describe("LINE invite signup primitives", () => {
  it("uses opaque one-use values and a ten-minute lifetime", () => {
    const first = generateLineInviteSignupToken(); const second = generateLineInviteSignupToken();
    strictEqual(first.length, 43); notStrictEqual(first, second); notStrictEqual(getLineInviteSignupId(first), first);
    strictEqual(LINE_INVITE_SIGNUP_TTL_MS, 10 * 60 * 1000);
    match(generateLineOnlyFirebaseUid(), /^line_[A-Za-z0-9_-]{43}$/);
  });
  it("uses a single participation action for a designated person and keeps general-invite protection", async () => {
    const source = await readFile(new URL("../app/line/auth/complete/LineAuthCompleteClient.tsx", import.meta.url), "utf8");
    match(source, /公演への参加を確認/); match(source, /この公演に参加する/);
    match(source, /以前のGoogleアカウントで本人確認する/); match(source, /signupPreview\.personName/);
    match(source, /SeisakuBoardを初めて利用しますか/); match(source, /以前Googleで利用していた方/); match(source, /LINEでこの公演に参加/);
    match(source, /利用規約/); match(source, /プライバシーポリシー/);
  });
});
