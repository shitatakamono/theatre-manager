import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GOOGLE_CALENDAR_SYNC_TYPES,
  filterGoogleCalendarSyncRehearsals,
  isUpcomingGoogleCalendarRehearsal,
  parseGoogleCalendarSyncTypes,
  resolveGoogleCalendarSyncTypes,
} from "../lib/google-calendar-sync-preferences.ts";
import {
  handleGoogleCalendarSyncPreferencesGet,
  handleGoogleCalendarSyncPreferencesPatch,
} from "../lib/server/google-calendar-sync-preferences-handler.ts";

const cast = [{ id: "cast-a", personId: "person-a", name: "出演者" }];
const staff = [{ id: "role-a", role: "制作", members: [{ id: "member-a", personId: "staff-a", name: "スタッフ" }] }];

function person(id, rehearsalParticipationTypes = ["acting"], active = true) {
  return { id, rehearsalParticipationTypes, active };
}

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      verifyIdToken: async (token) => {
        if (token !== "valid") throw new Error("invalid");
        return { uid: "uid-a" };
      },
      isProjectMember: async () => overrides.member ?? true,
      getView: async () => overrides.view ?? { configured: false, connected: true, rehearsalTypes: ["acting"] },
      save: async (...args) => { calls.push(["save", ...args]); },
      enqueue: async (...args) => { calls.push(["enqueue", ...args]); },
    },
  };
}

describe("Google Calendar rehearsal sync preferences", () => {
  it("uses all five existing schema types without defining aliases", () => {
    deepStrictEqual(new Set(GOOGLE_CALENDAR_SYNC_TYPES), new Set([
      "acting", "japanese_dance", "stage_combat", "meeting", "other",
    ]));
  });

  it("keeps the legacy audience rule when no preference exists", () => {
    deepStrictEqual(resolveGoogleCalendarSyncTypes({
      person: person("person-a", ["acting", "japanese_dance"]),
      cast,
      staff,
      configuredTypes: null,
    }), ["acting", "japanese_dance"]);
    deepStrictEqual(resolveGoogleCalendarSyncTypes({
      person: person("staff-a", []),
      cast,
      staff,
      configuredTypes: null,
    }), GOOGLE_CALENDAR_SYNC_TYPES);
  });

  it("allows an explicit empty selection independently of participation", () => {
    deepStrictEqual(resolveGoogleCalendarSyncTypes({
      person: person("person-a", ["acting"]),
      cast,
      staff,
      configuredTypes: [],
    }), []);
  });

  it("filters all same-day and duplicate-type slots only by the saved types", () => {
    const rehearsals = [
      { rehearsalId: "acting-a", type: "acting" },
      { rehearsalId: "acting-b", type: "acting" },
      { rehearsalId: "dance-a", type: "japanese_dance" },
      { rehearsalId: "meeting-a", type: "meeting" },
    ];
    deepStrictEqual(
      filterGoogleCalendarSyncRehearsals(rehearsals, ["acting", "japanese_dance"]).map(({ rehearsalId }) => rehearsalId),
      ["acting-a", "acting-b", "dance-a"]
    );
  });

  it("validates configured values strictly", () => {
    deepStrictEqual(parseGoogleCalendarSyncTypes([]), []);
    deepStrictEqual(parseGoogleCalendarSyncTypes(["meeting", "acting"]), ["acting", "meeting"]);
    for (const invalid of [null, "acting", ["acting", "acting"], ["unknown"]]) {
      let failed = false;
      try { parseGoogleCalendarSyncTypes(invalid); } catch { failed = true; }
      strictEqual(failed, true);
    }
  });

  it("uses absolute instants for the Asia/Tokyo schedule boundary", () => {
    const now = new Date("2026-11-16T00:00:00+09:00");
    strictEqual(isUpcomingGoogleCalendarRehearsal({ startAt: "2026-11-16T00:00:00+09:00" }, now), true);
    strictEqual(isUpcomingGoogleCalendarRehearsal({ startAt: "2026-11-15T23:59:59+09:00" }, now), false);
  });

  it("preserves an already-started rehearsal, including one still in progress", () => {
    const duringRehearsal = new Date("2026-11-16T14:00:00+09:00");
    strictEqual(isUpcomingGoogleCalendarRehearsal(
      { startAt: "2026-11-16T13:00:00+09:00" },
      duringRehearsal
    ), false);
  });
});

describe("Google Calendar sync preference API", () => {
  it("requires authentication and project membership", async () => {
    const first = dependencies();
    strictEqual((await handleGoogleCalendarSyncPreferencesGet(
      new Request("https://example.test/api?projectId=project-a"), first.value
    )).status, 401);
    const second = dependencies({ member: false });
    strictEqual((await handleGoogleCalendarSyncPreferencesGet(
      new Request("https://example.test/api?projectId=project-a", { headers: { authorization: "Bearer valid" } }),
      second.value
    )).status, 403);
  });

  it("lets any project member save only their own five-type selection and queues reconcile", async () => {
    const harness = dependencies();
    const response = await handleGoogleCalendarSyncPreferencesPatch(
      new Request("https://example.test/api", {
        method: "PATCH",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-a", uid: "other-uid", rehearsalTypes: ["meeting", "acting"] }),
      }),
      harness.value
    );
    strictEqual(response.status, 200);
    const responseBody = await response.json();
    strictEqual(responseBody.configured, true);
    strictEqual(Object.hasOwn(responseBody, "synced"), false);
    deepStrictEqual(harness.calls, [
      ["save", "uid-a", "project-a", ["acting", "meeting"]],
      ["enqueue", { uid: "uid-a", projectId: "project-a", reason: "sync_preferences_changed" }],
    ]);
  });

  it("rejects malformed selections before writing", async () => {
    const harness = dependencies();
    const response = await handleGoogleCalendarSyncPreferencesPatch(
      new Request("https://example.test/api", {
        method: "PATCH",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-a", rehearsalTypes: ["acting", "unknown"] }),
      }),
      harness.value
    );
    strictEqual(response.status, 400);
    deepStrictEqual(harness.calls, []);
  });
});
