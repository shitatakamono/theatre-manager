import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { describe, it } from "node:test";
import { RehearsalImportProviderError, RehearsalImportTimeoutError } from "../lib/rehearsal-import.ts";
import { createRehearsalImportPostHandler } from "../lib/server/rehearsal-import-handler.ts";
import { analyzeChigasakiReservationImage } from "../lib/server/rehearsal-import-service.ts";

const context = { params: Promise.resolve({ projectId: "project-a" }) };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function providerResponse(overrides = {}) {
  return {
    source: "chigasaki_public_facility_reservation",
    rows: [{
      sourceRow: 1, status: "reserved", statusText: "予約", applicationNumber: null,
      rawDateTime: "2026年10月25日（日）12:00-16:00", date: "2026-10-25", startTime: "12:00", endTime: "16:00",
      venue: "BF2集会室", confidence: "high", warnings: [], rawText: "予約 2026年10月25日（日）12:00-16:00 BF2集会室",
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
    headers: authorization ? { authorization: "Bearer test-token" } : {},
    body: form,
  });
}

async function assertJsonError(response, expectedStatus, expectedCode) {
  equal(response.status, expectedStatus);
  equal(response.headers.get("content-type")?.includes("application/json"), true);
  const body = await response.json();
  equal(typeof body.error, "string");
  equal(body.code, expectedCode);
}

describe("rehearsal screenshot import API", () => {
  it("allows owners and only analyzes the image without persistence dependencies", async () => {
    let calls = 0;
    const handler = createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => { calls += 1; return providerResponse(); } }));
    const response = await handler(requestFor(), context);
    equal(response.status, 200);
    equal(calls, 1);
    deepStrictEqual(Object.keys(await response.json()).sort(), ["rows", "source", "warnings"]);
  });

  for (const [label, role] of [["editor", "editor"], ["viewer", "viewer"], ["nonmember", null]]) {
    it(`rejects ${label} before image analysis`, async () => {
      let called = false;
      const handler = createRehearsalImportPostHandler(dependencies({
        getProjectRole: async () => role,
        analyzeImage: async () => { called = true; return providerResponse(); },
      }));
      await assertJsonError(await handler(requestFor(), context), 403, "owner_required");
      equal(called, false);
    });
  }

  it("returns JSON 401 without authentication", async () => {
    await assertJsonError(await createRehearsalImportPostHandler(dependencies())(requestFor(png, "image/png", false), context), 401, "authentication_required");
  });

  it("returns JSON for invalid MIME, signature and size", async () => {
    const handler = createRehearsalImportPostHandler(dependencies());
    await assertJsonError(await handler(requestFor(png, "image/gif"), context), 400, "unsupported_image_type");
    await assertJsonError(await handler(requestFor(Uint8Array.from([1, 2, 3])), context), 400, "invalid_image_signature");
    const oversized = new Uint8Array((4 * 1024 * 1024) + 1); oversized.set(png);
    await assertJsonError(await handler(requestFor(oversized), context), 413, "image_too_large");
  });

  it("returns JSON for schema, provider, timeout, empty-table and unexpected failures", async () => {
    await assertJsonError(await createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => ({ rows: [] }) }))(requestFor(), context), 502, "invalid_provider_response");
    await assertJsonError(await createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => { throw new RehearsalImportProviderError(); } }))(requestFor(), context), 502, "image_provider_failed");
    await assertJsonError(await createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => { throw new RehearsalImportTimeoutError(); } }))(requestFor(), context), 504, "image_parse_timeout");
    await assertJsonError(await createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => providerResponse({ rows: [] }) }))(requestFor(), context), 422, "reservation_rows_not_found");
    const logs = [];
    const originalError = console.error;
    console.error = (...values) => logs.push(values);
    try {
      await assertJsonError(await createRehearsalImportPostHandler(dependencies({ analyzeImage: async () => { throw new Error("secret image contents"); } }))(requestFor(), context), 502, "image_parse_failed");
    } finally {
      console.error = originalError;
    }
    equal(JSON.stringify(logs).includes("secret image contents"), false);
  });

  it("imports the service module without evaluating external SDK configuration", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const service = await import("../lib/server/rehearsal-import-service.ts");
      equal(typeof service.analyzeChigasakiReservationImage, "function");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});

describe("OpenAI failure diagnostics", () => {
  const image = { bytes: png, mimeType: "image/png" };

  async function withOpenAIEnvironment(operation) {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousModel = process.env.OPENAI_REHEARSAL_IMPORT_MODEL;
    process.env.OPENAI_API_KEY = "test-key-not-a-secret";
    process.env.OPENAI_REHEARSAL_IMPORT_MODEL = "diagnostic-test-model";
    try {
      await operation();
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousModel === undefined) delete process.env.OPENAI_REHEARSAL_IMPORT_MODEL;
      else process.env.OPENAI_REHEARSAL_IMPORT_MODEL = previousModel;
    }
  }

  for (const scenario of [
    { label: "401", status: 401, code: "invalid_api_key", type: "invalid_request_error" },
    { label: "403", status: 403, code: "permission_denied", type: "permission_error" },
    { label: "400", status: 400, code: "invalid_request", type: "invalid_request_error" },
    { label: "429", status: 429, code: "rate_limit_exceeded", type: "rate_limit_error" },
  ]) {
    it(`logs only safe OpenAI fields for ${scenario.label}`, async () => {
      await withOpenAIEnvironment(async () => {
        const logs = [];
        const providerError = Object.assign(new Error("secret provider response"), {
          status: scenario.status,
          code: scenario.code,
          type: scenario.type,
          response: { body: "secret response body" },
        });
        await rejects(
          () => analyzeChigasakiReservationImage(image, {
            requestOpenAI: async () => { throw providerError; },
            logError: (...values) => logs.push(values),
          }),
          RehearsalImportProviderError
        );
        deepStrictEqual(logs, [["rehearsal_import_openai_failed", {
          name: "Error",
          status: scenario.status,
          code: scenario.code,
          type: scenario.type,
          model: "diagnostic-test-model",
        }]]);
        const serialized = JSON.stringify(logs);
        equal(serialized.includes("secret provider response"), false);
        equal(serialized.includes("secret response body"), false);
        equal(serialized.includes("test-key-not-a-secret"), false);
      });
    });
  }

  it("logs null metadata for a generic error without leaking its message", async () => {
    await withOpenAIEnvironment(async () => {
      const logs = [];
      await rejects(
        () => analyzeChigasakiReservationImage(image, {
          requestOpenAI: async () => { throw new Error("generic secret message"); },
          logError: (...values) => logs.push(values),
        }),
        RehearsalImportProviderError
      );
      deepStrictEqual(logs, [["rehearsal_import_openai_failed", {
        name: "Error", status: null, code: null, type: null, model: "diagnostic-test-model",
      }]]);
      equal(JSON.stringify(logs).includes("generic secret message"), false);
    });
  });

  it("does not emit a failure log for a successful response", async () => {
    await withOpenAIEnvironment(async () => {
      const logs = [];
      const result = await analyzeChigasakiReservationImage(image, {
        requestOpenAI: async () => JSON.stringify({ source: "ok" }),
        logError: (...values) => logs.push(values),
      });
      deepStrictEqual(result, { source: "ok" });
      deepStrictEqual(logs, []);
    });
  });
});
