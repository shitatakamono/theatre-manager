import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const settingsUrl = new URL("../app/settings/page.tsx", import.meta.url);

describe("LINE Login settings UI", () => {
  it("shows safe linked/unlinked states and starts the authenticated flow once", async () => {
    const source = await readFile(settingsUrl, "utf8");
    assert.match(source, /LINE連携/);
    assert.match(source, /LINEと連携/);
    assert.match(source, /連携済み/);
    assert.match(source, /\/api\/line\/login\/status/);
    assert.match(source, /\/api\/line\/login\/start/);
    assert.match(source, /\/api\/line\/login\/disconnect/);
    assert.match(source, /LINE連携を解除/);
    assert.match(source, /window\.confirm/);
    assert.match(source, /if \(!confirmed\) return/);
    assert.match(source, /if \(lineProcessing\) return/);
    assert.match(source, /disabled=\{lineProcessing\}/);
    assert.match(source, /setLineConnected\(false\)/);
    assert.match(source, /LINEとの連携を解除しました/);
    assert.match(source, /時間をおいてもう一度お試しください/);
    assert.match(source, /lineConnected \? \(/);
    assert.match(source, /window\.location\.assign/);
    assert.doesNotMatch(source, /lineUserId/);
  });
});
