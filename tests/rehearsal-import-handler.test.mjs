import { equal } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RehearsalImportProviderError,
  RehearsalImportTimeoutError,
} from "../lib/rehearsal-import.ts";
import { createRehearsalImportPostHandler } from "../lib/server/rehearsal-import-handler.ts";

const projectId = "project-a";
const context = { params: Promise.resolve({ projectId }) };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function providerResponse(overrides = {}) {
  return {
    source: "chigasaki_public_facility_reservation",
    rows: [{
      sourceRow: 1,
      status: "reserved",
      statusText: "予約",
      applicationNumber: null,
      rawDateTime: "2026年10月25日（日）12:00-16:00",
      date: "2026-10-25",
      startTime: "12:00",
      endTime: "16:00",
      venue: "BF2集会室",
      confidence: "high",
      warnings: [],
      rawText: "予約 2026年10月25日（日）12:00-16:00 BF2集会室",
    }],
    warnings: [],
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    verifyIdToken: async () => ({ uid: "member-a" }),
    getProjectRole: async () => "owner",
    analyzeImage: async () => providerResponse(),
    ...overrides,
  };
}

function requestFor(bytes = png, type = "image/png", authorization = true) {
  const form = new FormData();
  form.set("image", new Blob([bytes], { type }), "reservation.png");
  return new Request("https://example.test/api/projects/project-a/rehearsals/import", {
    method: "POST",
    headers: authorization ? { authorization: "Bearer valid-token" } : {},
    body: form,
  });
}

describe("rehearsal screenshot import authorization", () => {
  for (const role of ["owner", "editor"]) {
    it(`allows ${role}`, async () => {
      const handler = createRehearsalImportPostHandler(dependencies({ getProjectRole: async () => role }));
      const result = await handler(requestFor(), context);
      equal(result.status, 200);
    });
  }

  for (const [label, role] of [["viewer", "viewer"], ["nonmember", null]]) {
    it(`rejects ${label}`, async () => {
      let called = false;
      const handler = createRehearsalImportPostHandler(dependencies({
        getProjectRole: async () => role,
        analyzeImage: async () => { called = true; return providerResponse(); },
      }));
      const result = await handler(requestFor(), context);
      equal(result.status, 403);
      equal(called, false);
    });
  }

  it("rejects unauthenticated requests", async () => {
    const handler = createRehearsalImportPostHandler(dependencies());
    equal((await handler(requestFor(png, "image/png", false), context)).status, 401);
  });
});

describe("rehearsal screenshot import input and provider failures", () => {
  it("rejects a disallowed MIME type", async () => {
    const handler = createRehearsalImportPostHandler(dependencies());
    equal((await handler(requestFor(png, "image/gif"), context)).status, 400);
  });

  it("rejects MIME and magic-byte disagreement", async () => {
    const handler = createRehearsalImportPostHandler(dependencies());
    equal((await handler(requestFor(Uint8Array.from([1, 2, 3]), "image/png"), context)).status, 400);
  });

  it("rejects files over four MiB", async () => {
    const oversized = new Uint8Array((4 * 1024 * 1024) + 1);
    oversized.set(png);
    const handler = createRehearsalImportPostHandler(dependencies());
    equal((await handler(requestFor(oversized), context)).status, 413);
  });

  it("maps invalid provider schema to 502", async () => {
    const handler = createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => ({ rows: [] }) }));
    equal((await handler(requestFor(), context)).status, 502);
  });

  it("maps provider errors to 502", async () => {
    const handler = createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => { throw new RehearsalImportProviderError(); } }));
    equal((await handler(requestFor(), context)).status, 502);
  });

  it("maps provider timeouts to 504", async () => {
    const handler = createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => { throw new RehearsalImportTimeoutError(); } }));
    equal((await handler(requestFor(), context)).status, 504);
  });

  it("returns 422 when the target table has no recognizable rows", async () => {
    const handler = createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => providerResponse({ rows: [] }) }));
    equal((await handler(requestFor(), context)).status, 422);
  });
});
