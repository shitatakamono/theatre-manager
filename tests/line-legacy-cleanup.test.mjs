import { access, readFile } from "node:fs/promises";
import { rejects } from "node:assert/strict";
import { describe, it } from "node:test";

const removedPaths = [
  "../app/line/account-link/page.tsx",
  "../app/api/line/account-link/authorize/route.ts",
  "../app/api/line/test-user/route.ts",
  "../app/api/line/test-message/route.ts",
];

describe("legacy LINE account-link and temporary test cleanup", () => {
  it("keeps the removed pages and APIs absent", async () => {
    for (const path of removedPaths) {
      await rejects(access(new URL(path, import.meta.url)), { code: "ENOENT" });
    }
  });

  it("does not recreate old nonce or temporary follow data", async () => {
    const sources = await Promise.all([
      "../app/api/line/webhook/route.ts",
      "../lib/line-webhook.ts",
      "../lib/server/line-account-link.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
    const combined = sources.join("\n");
    if (/lineAccountLinkNonces|system\/lineTest|captureLatestLineFollow/.test(combined)) {
      throw new Error("legacy LINE persistence is still referenced");
    }
  });

  it("retains every environment variable required by LINE Login and Messaging API", async () => {
    const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
    for (const name of [
      "LINE_CHANNEL_SECRET",
      "LINE_CHANNEL_ACCESS_TOKEN",
      "LINE_LOGIN_CHANNEL_ID",
      "LINE_LOGIN_CHANNEL_SECRET",
      "NEXT_PUBLIC_APP_URL",
    ]) {
      if (!example.includes(`${name}=`)) throw new Error(`${name} is missing`);
    }
  });
});
