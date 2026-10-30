import { notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGoogleCalendarEventMappingId,
  buildGoogleCalendarRehearsalSourceHash,
  decideGoogleCalendarEventLease,
  decideGoogleCalendarEventUpdateLease,
  GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS,
  ownsGoogleCalendarEventLease,
  ownsGoogleCalendarEventUpdateLease,
} from "../lib/google-calendar-event-mapping.ts";

const source = {
  startAt: "2026-11-15T03:00:00.000Z",
  endAt: "2026-11-15T06:00:00.000Z",
  categoryId: "acting",
  customType: "",
  venue: "稽古場",
  content: "立ち稽古",
  note: "台本を持参",
};

describe("Google Calendar event mapping helpers", () => {
  it("builds the same safe mapping ID from the same project and rehearsal", () => {
    const first = buildGoogleCalendarEventMappingId("project-a", "rehearsal-a");
    const second = buildGoogleCalendarEventMappingId("project-a", "rehearsal-a");
    strictEqual(first, second);
    strictEqual(first.includes("/"), false);
  });

  it("builds a different mapping ID for another rehearsal", () => {
    notStrictEqual(
      buildGoogleCalendarEventMappingId("project-a", "rehearsal-a"),
      buildGoogleCalendarEventMappingId("project-a", "rehearsal-b")
    );
  });

  it("builds the same source hash from the same canonical values", () => {
    strictEqual(
      buildGoogleCalendarRehearsalSourceHash(source),
      buildGoogleCalendarRehearsalSourceHash({
        ...source,
        startAt: new Date(source.startAt),
      })
    );
  });

  for (const [label, change] of [
    ["start time", { startAt: "2026-11-15T04:00:00.000Z" }],
    ["venue", { venue: "別の稽古場" }],
    ["content", { content: "通し稽古" }],
    ["category ID", { categoryId: "stage_combat" }],
  ]) {
    it(`changes the source hash when ${label} changes`, () => {
      notStrictEqual(
        buildGoogleCalendarRehearsalSourceHash(source),
        buildGoogleCalendarRehearsalSourceHash({ ...source, ...change })
      );
    });
  }

  it("supports a future category ID without a fixed category switch", () => {
    const dance = buildGoogleCalendarRehearsalSourceHash({
      ...source,
      categoryId: "dance",
    });
    strictEqual(dance, buildGoogleCalendarRehearsalSourceHash({
      ...source,
      categoryId: "dance",
    }));
  });

  it("acquires creation rights when no mapping exists", () => {
    strictEqual(decideGoogleCalendarEventLease(null, 1_000), "acquire");
  });

  it("skips a completed mapping", () => {
    strictEqual(
      decideGoogleCalendarEventLease({ status: "synced" }, 1_000),
      "synced"
    );
  });

  it("does not create while another active lease is running", () => {
    strictEqual(decideGoogleCalendarEventLease({
      status: "creating",
      operationId: "operation-a",
      startedAtMillis: 1_000,
    }, 1_000 + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS - 1), "in_progress");
  });

  it("allows a stale creating lease to be acquired again", () => {
    strictEqual(decideGoogleCalendarEventLease({
      status: "creating",
      operationId: "operation-a",
      startedAtMillis: 1_000,
    }, 1_000 + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS), "acquire");
  });

  it("permits completion and release only for the matching operation", () => {
    const state = {
      status: "creating",
      operationId: "operation-a",
      startedAtMillis: 1_000,
    };
    strictEqual(ownsGoogleCalendarEventLease(state, "operation-a"), true);
    strictEqual(ownsGoogleCalendarEventLease(state, "operation-b"), false);
  });

  it("models two simultaneous claims with only the first allowed to create", () => {
    const now = 1_000;
    strictEqual(decideGoogleCalendarEventLease(null, now), "acquire");
    const stateAfterFirstClaim = {
      status: "creating",
      operationId: "operation-a",
      startedAtMillis: now,
    };
    strictEqual(
      decideGoogleCalendarEventLease(stateAfterFirstClaim, now),
      "in_progress"
    );
  });

  it("acquires an update lease only when the source hash changed", () => {
    strictEqual(decideGoogleCalendarEventUpdateLease(
      { status: "synced", sourceHash: "old" },
      "new",
      1_000
    ), "acquire");
    strictEqual(decideGoogleCalendarEventUpdateLease(
      { status: "synced", sourceHash: "same" },
      "same",
      1_000
    ), "unchanged");
  });

  it("blocks active updates and permits stale update lease takeover", () => {
    const state = {
      status: "updating",
      operationId: "operation-a",
      startedAtMillis: 1_000,
      sourceHash: "old",
      targetSourceHash: "new",
    };
    strictEqual(decideGoogleCalendarEventUpdateLease(
      state,
      "newer",
      1_000 + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS - 1
    ), "in_progress");
    strictEqual(decideGoogleCalendarEventUpdateLease(
      state,
      "newer",
      1_000 + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS
    ), "acquire");
  });

  it("allows only the current update operation and target hash to complete", () => {
    const state = {
      status: "updating",
      operationId: "operation-new",
      startedAtMillis: 1_000,
      sourceHash: "old",
      targetSourceHash: "newest",
    };
    strictEqual(ownsGoogleCalendarEventUpdateLease(
      state,
      "operation-new",
      "newest"
    ), true);
    strictEqual(ownsGoogleCalendarEventUpdateLease(
      state,
      "operation-stale",
      "newest"
    ), false);
    strictEqual(ownsGoogleCalendarEventUpdateLease(
      state,
      "operation-new",
      "older-target"
    ), false);
  });
});
