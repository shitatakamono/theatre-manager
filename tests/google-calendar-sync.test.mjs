import { strictEqual } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { shouldSyncRehearsalForPerson } from "../lib/google-calendar-sync.ts";
import { getAppOrigin, getGoogleCalendarRedirectUri } from "../lib/app-url.ts";

const ORIGINAL_URL_ENV = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  GOOGLE_CALENDAR_REDIRECT_URI: process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  VERCEL_URL: process.env.VERCEL_URL,
};

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL_URL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const cast = [{
  id: "cast-a",
  personId: "cast-person",
  order: 1,
  name: "キャスト",
}];

const staff = [{
  id: "staff-role",
  role: "演出",
  members: [{ id: "staff-a", personId: "staff-person", name: "スタッフ" }],
}];

function person(id, categories, overrides = {}) {
  return {
    id,
    active: true,
    rehearsalParticipationTypes: categories,
    ...overrides,
  };
}

function rehearsal(type) {
  return { type };
}

describe("Google Calendar rehearsal sync targeting", () => {
  it("syncs a cast rehearsal only when its category is selected", () => {
    const target = person("cast-person", ["acting"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("stage_combat"), cast, staff), false);
  });

  it("supports multiple selected categories for cast", () => {
    const target = person("cast-person", ["acting", "stage_combat"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("stage_combat"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("japanese_dance"), cast, staff), false);
  });

  it("keeps a cast-and-staff person on cast category targeting", () => {
    const bothStaff = [{
      id: "staff-role",
      role: "演出",
      members: [{ id: "staff-a", personId: "cast-person", name: "兼任" }],
    }];
    const target = person("cast-person", ["acting"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, bothStaff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("meeting"), cast, bothStaff), false);
  });

  it("syncs every category for staff-only people", () => {
    const target = person("staff-person", []);
    for (const type of ["acting", "japanese_dance", "meeting", "other"]) {
      strictEqual(shouldSyncRehearsalForPerson(target, rehearsal(type), cast, staff), true);
    }
  });

  it("uses category matching for other people and rejects an empty selection", () => {
    const target = person("other-person", ["japanese_dance"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("japanese_dance"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), false);
    strictEqual(shouldSyncRehearsalForPerson(person("other-person", []), rehearsal("acting"), cast, staff), false);
    strictEqual(shouldSyncRehearsalForPerson(person("other-person", undefined), rehearsal("acting"), cast, staff), false);
  });

  it("does not sync ended people", () => {
    const target = person("staff-person", [], { active: false });
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), false);
  });

  it("does not depend on attendanceTarget or attendance records", () => {
    const enabled = person("cast-person", ["acting"], { attendanceTarget: true });
    const disabled = person("cast-person", ["acting"], { attendanceTarget: false });
    strictEqual(shouldSyncRehearsalForPerson(enabled, rehearsal("acting"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(disabled, rehearsal("acting"), cast, staff), true);
  });

  it("matches a future custom category ID without fixed category branching", () => {
    const target = person("other-person", ["dance"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("dance"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("song"), cast, staff), false);
  });
});

describe("Google Calendar public application URL", () => {
  it("uses the configured custom-domain origin without hardcoding a deployment host", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://board.example.jp/path";
    strictEqual(getAppOrigin(), "https://board.example.jp");
    strictEqual(getGoogleCalendarRedirectUri(), "https://board.example.jp/api/google-calendar/callback");
  });

  it("keeps an explicit OAuth redirect URI when configured", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://board.example.jp";
    process.env.GOOGLE_CALENDAR_REDIRECT_URI = "https://oauth.example.jp/callback";
    strictEqual(getGoogleCalendarRedirectUri(), "https://oauth.example.jp/callback");
  });

  it("falls back to the current request origin outside configured deployments", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    strictEqual(getAppOrigin(new Request("https://preview.example.net/api/google-calendar/connect")), "https://preview.example.net");
  });
});
