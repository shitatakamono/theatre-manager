import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const clientUrl = new URL("../app/line/account-link/LineAccountLinkClient.tsx", import.meta.url);
const authUrl = new URL("../app/AuthProvider.tsx", import.meta.url);

describe("LINE account-link page", () => {
  it("uses the shared Firebase auth flow and keeps redirect fallback state in session storage", async () => {
    const [client, auth] = await Promise.all([
      readFile(clientUrl, "utf8"),
      readFile(authUrl, "utf8"),
    ]);
    assert.match(client, /useAuth/);
    assert.match(client, /sessionStorage\.setItem/);
    assert.match(client, /sessionStorage\.removeItem/);
    assert.match(client, /history\.replaceState/);
    assert.match(client, /\/api\/line\/account-link\/authorize/);
    assert.match(client, /redirect\.origin !== "https:\/\/access\.line\.me"/);
    assert.match(auth, /signInWithPopup/);
    assert.match(auth, /signInWithRedirect/);
    assert.match(auth, /pathname === "\/line\/account-link"/);
  });

  it("contains safe missing-token, login, authorize, and double-click states", async () => {
    const client = await readFile(clientUrl, "utf8");
    assert.match(client, /LINE連携情報を確認できませんでした/);
    assert.match(client, /Googleでログインして連携する/);
    assert.match(client, /LINEと連携する/);
    assert.match(client, /disabled=\{processing\}/);
  });
});
