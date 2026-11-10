import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("LINE authentication completion page", () => {
  it("removes the ticket from the URL before one-time exchange and signs in with Firebase", async () => {
    const source = await readFile(
      new URL("../app/line/auth/complete/LineAuthCompleteClient.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /window\.location\.hash/);
    assert.match(source, /history\.replaceState\(null, "", "\/line\/auth\/complete"\)/);
    assert.match(source, /\/api\/line\/auth\/exchange/);
    assert.match(source, /signInWithCustomToken\(auth, body\.customToken\)/);
    assert.match(source, /takeProjectInviteReturnPath/);
    assert.match(source, /location\.replace\(returnPath\.current \?\? "\/projects"\)/);
    assert.match(source, /このLINEアカウントはまだSeisakuBoardに連携されていません/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|console\./);
  });

  it("marks the completion route noindex and no-referrer", async () => {
    const source = await readFile(
      new URL("../app/line/auth/complete/page.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /index: false/);
    assert.match(source, /follow: false/);
    assert.match(source, /referrer: "no-referrer"/);
  });
});
