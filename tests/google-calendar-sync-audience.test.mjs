import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGoogleCalendarProjectSyncAudience,
  selectGoogleCalendarMappingOwnerUids,
} from "../lib/google-calendar-sync-audience.ts";
import {
  enqueueGoogleCalendarSyncForUids,
  planGoogleCalendarRehearsalTrigger,
} from "../lib/google-calendar-sync-triggers.ts";

function buildAudience(overrides = {}) {
  return buildGoogleCalendarProjectSyncAudience({
    linkedUsers: [{ uid: "user-a", participantId: "person-a" }],
    memberUids: ["user-a"],
    personIds: ["person-a"],
    connections: [{
      uid: "user-a",
      connected: true,
      credentialAvailable: true,
    }],
    mappingOwnerUids: [],
    ...overrides,
  });
}

describe("Google Calendar project sync audience", () => {
  it("includes an explicitly linked member with a person and valid connection", () => {
    const audience = buildAudience();
    deepStrictEqual(audience.normalSyncUids, ["user-a"]);
    deepStrictEqual(audience.skippedUsers, []);
  });

  it("excludes a linked user who is no longer a project member", () => {
    const audience = buildAudience({ memberUids: [] });
    deepStrictEqual(audience.normalSyncUids, []);
    deepStrictEqual(audience.skippedUsers, [{
      uid: "user-a",
      reason: "not_project_member",
    }]);
  });

  it("excludes a link whose people document is missing", () => {
    const audience = buildAudience({ personIds: [] });
    deepStrictEqual(audience.normalSyncUids, []);
    deepStrictEqual(audience.skippedUsers, [{
      uid: "user-a",
      reason: "person_not_found",
    }]);
  });

  for (const connection of [
    { uid: "user-a", connected: false, credentialAvailable: true },
    null,
  ]) {
    it("keeps a disconnected or missing connection in normal sync", () => {
      const audience = buildAudience({
        connections: connection ? [connection] : [],
      });
      deepStrictEqual(audience.normalSyncUids, ["user-a"]);
      deepStrictEqual(audience.disconnectedUids, ["user-a"]);
      deepStrictEqual(audience.skippedUsers, []);
    });
  }

  it("keeps a linked identity in the trigger audience without a refresh token", () => {
    const audience = buildAudience({
      connections: [{
        uid: "user-a",
        connected: true,
        credentialAvailable: false,
      }],
    });
    deepStrictEqual(audience.normalSyncUids, ["user-a"]);
    deepStrictEqual(audience.disconnectedUids, ["user-a"]);
    deepStrictEqual(audience.skippedUsers, []);
  });

  it("enqueues rehearsal_updated while the linked user is disconnected", async () => {
    const audience = buildAudience({
      connections: [{
        uid: "user-a",
        connected: false,
        credentialAvailable: false,
      }],
    });
    const plan = planGoogleCalendarRehearsalTrigger(
      "update",
      { venue: "before" },
      { venue: "after" }
    );
    const calls = [];
    const result = await enqueueGoogleCalendarSyncForUids({
      projectId: "project-a",
      uids: audience.normalSyncUids,
      reason: plan.reason,
      enqueue: async (request) => calls.push(request),
    });
    deepStrictEqual(calls, [{
      uid: "user-a",
      projectId: "project-a",
      reason: "rehearsal_updated",
    }]);
    strictEqual(result.enqueuedCount, 1);
  });

  it("does not filter an inactive person because active is intentionally not an input", () => {
    const audience = buildAudience({
      linkedUsers: [{ uid: "user-a", participantId: "person-a", active: false }],
    });
    deepStrictEqual(audience.normalSyncUids, ["user-a"]);
  });

  it("deduplicates linked and mapping owner UIDs with deterministic ordering", () => {
    const audience = buildAudience({
      linkedUsers: [
        { uid: "user-b", participantId: "person-b" },
        { uid: "user-a", participantId: "person-a" },
        { uid: "user-a", participantId: "person-a" },
      ],
      memberUids: ["user-b", "user-a"],
      personIds: ["person-b", "person-a"],
      connections: [
        { uid: "user-b", connected: true, credentialAvailable: true },
        { uid: "user-a", connected: true, credentialAvailable: true },
      ],
      mappingOwnerUids: ["user-c", "user-a", "user-c"],
    });
    deepStrictEqual(audience.normalSyncUids, ["user-a", "user-b"]);
    deepStrictEqual(audience.mappingOwnerUids, ["user-a", "user-c"]);
    deepStrictEqual(audience.deleteCandidateUids, ["user-a", "user-c"]);
    deepStrictEqual(audience.allKnownSyncUids, ["user-a", "user-b", "user-c"]);
  });

  it("retains an unlinked or removed-member mapping owner only as a candidate", () => {
    const audience = buildAudience({
      linkedUsers: [],
      memberUids: [],
      personIds: [],
      connections: [],
      mappingOwnerUids: ["former-user"],
    });
    deepStrictEqual(audience.normalSyncUids, []);
    deepStrictEqual(audience.mappingOwnerUids, ["former-user"]);
    deepStrictEqual(audience.deleteCandidateUids, ["former-user"]);
    deepStrictEqual(audience.allKnownSyncUids, ["former-user"]);
  });

  it("excludes mapping owners belonging to another project", () => {
    deepStrictEqual(selectGoogleCalendarMappingOwnerUids("project-a", [
      { uid: "user-a", projectId: "project-a" },
      { uid: "user-b", projectId: "project-b" },
      { uid: "user-a", projectId: "project-a" },
    ]), ["user-a"]);
  });

  it("never guesses identity from names or email-like extra fields", () => {
    const audience = buildAudience({
      linkedUsers: [],
      memberUids: ["user-a"],
      personIds: ["person-a"],
      connections: [{
        uid: "user-a",
        connected: true,
        credentialAvailable: true,
        email: "person@example.com",
        displayName: "同名の人",
      }],
    });
    deepStrictEqual(audience.normalSyncUids, []);
  });

  it("does not expose credential or Google resource fields", () => {
    const serialized = JSON.stringify(buildAudience());
    for (const forbidden of [
      "refreshToken",
      "accessToken",
      "calendarId",
      "googleEventId",
      "clientSecret",
    ]) {
      strictEqual(serialized.includes(forbidden), false);
    }
  });

  it("returns stable empty collections for an empty project", () => {
    const audience = buildAudience({
      linkedUsers: [],
      memberUids: [],
      personIds: [],
      connections: [],
      mappingOwnerUids: [],
    });
    deepStrictEqual(audience, {
      normalSyncUids: [],
      disconnectedUids: [],
      mappingOwnerUids: [],
      deleteCandidateUids: [],
      allKnownSyncUids: [],
      skippedUsers: [],
    });
  });
});
