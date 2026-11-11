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
  it("keeps the confirmation explicit and warns existing users", async () => {
    const source = await readFile(new URL("../app/line/auth/complete/LineAuthCompleteClient.tsx", import.meta.url), "utf8");
    match(source, /SeisakuBoardを初めて利用しますか/); match(source, /既存アカウントでログイン/);
    match(source, /LINEで新しいアカウントを作成/); match(source, /利用規約/); match(source, /プライバシーポリシー/);
  });
});
