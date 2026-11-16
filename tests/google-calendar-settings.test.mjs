import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const settingsUrl = new URL("../app/settings/page.tsx", import.meta.url);

describe("Google Calendar settings UI", () => {
  it("offers reauthorization only for an existing connection and keeps disconnect", async () => {
    const source = await readFile(settingsUrl, "utf8");

    assert.match(source, /connected \? \(/);
    assert.match(source, /Googleカレンダーを再認証/);
    assert.match(source, /同期されない場合は再認証をお試しください/);
    assert.match(source, /以前と同じGoogleアカウントを選択してください/);
    assert.match(source, /onClick=\{\(\) => void connect\(\)\}/);
    assert.match(source, /onClick=\{\(\) => void disconnect\(\)\}/);
    assert.match(source, /Googleカレンダーと連携/);
    assert.match(source, /連携を解除/);
    assert.match(source, /disabled=\{processing\}/);
  });
});
