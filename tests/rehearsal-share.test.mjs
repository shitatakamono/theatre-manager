import { doesNotMatch, match, notStrictEqual, strictEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildRehearsalSharePath,
  generateRehearsalShareToken,
  hashRehearsalShareToken,
  isValidRehearsalShareToken,
} from "../lib/rehearsal-share.ts";
import {
  createRehearsalShareDeleteHandler,
  createRehearsalShareGetHandler,
  createRehearsalSharePatchHandler,
  createRehearsalSharePostHandler,
} from "../lib/server/rehearsal-share-handler.ts";

function context(projectId = "project-a") {
  return { params: Promise.resolve({ projectId }) };
}

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      verifyIdToken: async () => ({ uid: "owner-a" }),
      getProjectRole: async () => "owner",
      getStatus: async (projectId) => { calls.push(["get", projectId]); return { enabled: false, path: null }; },
      issue: async (projectId, uid) => { calls.push(["issue", projectId, uid]); return { enabled: true, path: "/s/rehearsals/test" }; },
      regenerate: async (projectId, uid) => { calls.push(["regenerate", projectId, uid]); return { enabled: true, path: "/s/rehearsals/new" }; },
      disable: async (projectId, uid) => { calls.push(["disable", projectId, uid]); return { enabled: false, path: null }; },
      ...overrides,
    },
  };
}

function request(method = "GET", authenticated = true) {
  return new Request("https://example.test/api/share", {
    method,
    headers: authenticated ? { Authorization: "Bearer firebase-token" } : {},
  });
}

describe("rehearsal share tokens", () => {
  it("generates long random URL-safe tokens and stable opaque hashes", () => {
    const first = generateRehearsalShareToken();
    const second = generateRehearsalShareToken();
    strictEqual(first.length, 43);
    strictEqual(isValidRehearsalShareToken(first), true);
    notStrictEqual(first, second);
    strictEqual(hashRehearsalShareToken(first), hashRehearsalShareToken(first));
    notStrictEqual(hashRehearsalShareToken(first), hashRehearsalShareToken(second));
    strictEqual(buildRehearsalSharePath(first), `/s/rehearsals/${first}`);
  });
});

describe("rehearsal share management handlers", () => {
  it("requires Firebase authentication and owner/editor permission", async () => {
    const base = dependencies();
    strictEqual((await createRehearsalShareGetHandler(base.value)(request("GET", false), context())).status, 401);
    const viewer = dependencies({ getProjectRole: async () => "viewer" });
    strictEqual((await createRehearsalSharePostHandler(viewer.value)(request("POST"), context())).status, 403);
    const editor = dependencies({ getProjectRole: async () => "editor" });
    strictEqual((await createRehearsalSharePostHandler(editor.value)(request("POST"), context())).status, 200);
  });

  it("routes issue, regeneration and disable without accepting identifiers from a body", async () => {
    const setup = dependencies();
    const body = JSON.stringify({ uid: "forged", projectId: "other", token: "forged" });
    const authenticated = (method) => new Request("https://example.test/api/share", {
      method,
      headers: { Authorization: "Bearer firebase-token", "Content-Type": "application/json" },
      body,
    });
    await createRehearsalSharePostHandler(setup.value)(authenticated("POST"), context());
    await createRehearsalSharePatchHandler(setup.value)(authenticated("PATCH"), context());
    await createRehearsalShareDeleteHandler(setup.value)(authenticated("DELETE"), context());
    strictEqual(JSON.stringify(setup.calls), JSON.stringify([
      ["issue", "project-a", "owner-a"],
      ["regenerate", "project-a", "owner-a"],
      ["disable", "project-a", "owner-a"],
    ]));
  });
});

describe("rehearsal share UI boundaries", () => {
  it("keeps the public page read-only and excludes private rehearsal fields", async () => {
    const page = await readFile(new URL("../app/s/rehearsals/[token]/page.tsx", import.meta.url), "utf8");
    const panel = await readFile(new URL("../app/projects/[projectId]/rehearsals/RehearsalSharePanel.tsx", import.meta.url), "utf8");
    const service = await readFile(new URL("../lib/server/rehearsal-share.ts", import.meta.url), "utf8");
    match(page, /閲覧専用/);
    doesNotMatch(page, /編集|削除|出欠|メールアドレス|LINE/);
    match(panel, /URLを再発行/);
    match(panel, /共有を停止/);
    match(panel, /Authorization: `Bearer \$\{idToken\}`/);
    doesNotMatch(service, /content:/);
    doesNotMatch(service, /note:/);
  });

  it("keeps copying primary while retaining regeneration and stop as secondary actions", async () => {
    const panel = await readFile(new URL("../app/projects/[projectId]/rehearsals/RehearsalSharePanel.tsx", import.meta.url), "utf8");
    const schedule = await readFile(new URL("../app/projects/[projectId]/rehearsals/RehearsalClient.tsx", import.meta.url), "utf8");
    match(panel, /共有リンクを発行/);
    match(panel, /sharePrimaryAction[^>]+[\s\S]*共有URLをコピー/);
    match(panel, /<summary>その他の操作<\/summary>/);
    match(panel, /再発行すると、現在の共有URLは使えなくなります/);
    match(panel, /新しいURLを改めて案内する必要があります/);
    match(panel, /共有を停止すると、このURLから稽古予定を閲覧できなくなります/);
    match(schedule, /\{canEdit && <RehearsalSharePanel/);
  });
});
