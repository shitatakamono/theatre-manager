import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findUserLinkReservationMemberByEmail,
  getUserLinkReservationInviteOutcome,
  getUserLinkReservationId,
  isValidUserLinkReservationEmail,
  normalizeUserLinkReservationEmail,
  UserLinkReservationError,
} from "../lib/user-link-reservations.ts";
import {
  createUserLinkReservationClaimHandler,
  createUserLinkReservationManagementHandlers,
} from "../lib/server/user-link-reservation-handler.ts";

function management(overrides = {}) {
  return createUserLinkReservationManagementHandlers("project-a", {
    verifyIdToken: async () => ({ uid: "editor-a" }),
    getReservations: async () => [],
    createReservation: async (input) => ({
      outcome: "pending",
      reservation: { id: "reservation-a", ...input },
      inviteOutcome: "created",
    }),
    changeReservation: async (input) => ({
      outcome: "pending",
      reservation: { id: "reservation-b", ...input },
      inviteOutcome: "existing",
    }),
    cancelReservation: async () => undefined,
    ...overrides,
  });
}

function request(method, body, token = "token-a") {
  return new Request("https://example.test/api?personId=person-a", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("user link reservation identity", () => {
  it("normalizes only surrounding whitespace and letter case", () => {
    strictEqual(
      normalizeUserLinkReservationEmail("  User.Name+stage@GMAIL.com  "),
      "user.name+stage@gmail.com"
    );
    strictEqual(isValidUserLinkReservationEmail("person@example.test"), true);
    strictEqual(isValidUserLinkReservationEmail("person/example.test"), false);
  });

  it("generates deterministic base64url SHA-256 IDs from normalized email", () => {
    const first = getUserLinkReservationId(" User@Example.test ");
    const second = getUserLinkReservationId("user@example.test");
    strictEqual(first, second);
    strictEqual(first.length, 43);
    strictEqual(/^[A-Za-z0-9_-]+$/.test(first), true);
    notStrictEqual(first, getUserLinkReservationId("other@example.test"));
  });

  it("finds one member by normalized email and rejects ambiguous member data", () => {
    deepStrictEqual(findUserLinkReservationMemberByEmail([
      { uid: "user-a", email: " Person@Example.test " },
    ], "person@example.test"), { kind: "match", uid: "user-a" });
    deepStrictEqual(findUserLinkReservationMemberByEmail([], "person@example.test"), {
      kind: "none",
    });
    deepStrictEqual(findUserLinkReservationMemberByEmail([
      { uid: "user-a", email: "person@example.test" },
      { uid: "user-b", email: "PERSON@example.test" },
    ], "person@example.test"), { kind: "ambiguous" });
  });

  it("creates an invite only when membership and an active/accepted invite are absent", () => {
    strictEqual(getUserLinkReservationInviteOutcome({ memberExists: true }), "not_needed");
    strictEqual(getUserLinkReservationInviteOutcome({ memberExists: false }), "created");
    strictEqual(getUserLinkReservationInviteOutcome({ memberExists: false, inviteStatus: "revoked" }), "created");
    strictEqual(getUserLinkReservationInviteOutcome({ memberExists: false, inviteStatus: "pending" }), "existing");
    strictEqual(getUserLinkReservationInviteOutcome({ memberExists: false, inviteStatus: "accepted" }), "existing");
  });
});

describe("user link reservation management handlers", () => {
  it("requires a Firebase bearer token", async () => {
    const response = await management().GET(new Request("https://example.test/api"));
    strictEqual(response.status, 401);
  });

  it("passes authenticated create, change, cancel, and list inputs to the server service", async () => {
    const calls = [];
    const handlers = management({
      getReservations: async (input) => { calls.push(["get", input]); return []; },
      createReservation: async (input) => {
        calls.push(["create", input]);
        return { outcome: "pending", reservation: input, inviteOutcome: "created" };
      },
      changeReservation: async (input) => {
        calls.push(["change", input]);
        return { outcome: "pending", reservation: input, inviteOutcome: "existing" };
      },
      cancelReservation: async (input) => { calls.push(["cancel", input]); },
    });
    strictEqual((await handlers.GET(request("GET"))).status, 200);
    strictEqual((await handlers.POST(request("POST", {
      personId: "person-a",
      email: "Person@Example.test",
    }))).status, 201);
    strictEqual((await handlers.PATCH(request("PATCH", {
      personId: "person-a",
      email: "Other@Example.test",
    }))).status, 200);
    strictEqual((await handlers.DELETE(request("DELETE", {
      personId: "person-a",
    }))).status, 200);
    deepStrictEqual(calls, [
      ["get", { uid: "editor-a", projectId: "project-a", personId: "person-a" }],
      ["create", { uid: "editor-a", projectId: "project-a", personId: "person-a", email: "Person@Example.test" }],
      ["change", { uid: "editor-a", projectId: "project-a", personId: "person-a", email: "Other@Example.test" }],
      ["cancel", { uid: "editor-a", projectId: "project-a", personId: "person-a" }],
    ]);
  });

  it("returns immediate and idempotent formal-link outcomes without a reservation", async () => {
    const linked = management({
      createReservation: async () => ({ outcome: "linked", reservation: null, inviteOutcome: "not_needed" }),
    });
    const alreadyLinked = management({
      createReservation: async () => ({ outcome: "already_linked", reservation: null, inviteOutcome: "not_needed" }),
    });
    const linkedResponse = await linked.POST(request("POST", {
      personId: "person-a",
      email: "person@example.test",
    }));
    const alreadyResponse = await alreadyLinked.POST(request("POST", {
      personId: "person-a",
      email: "person@example.test",
    }));
    strictEqual(linkedResponse.status, 200);
    strictEqual(alreadyResponse.status, 200);
    deepStrictEqual(await linkedResponse.json(), {
      success: true,
      outcome: "linked",
      reservation: null,
      inviteOutcome: "not_needed",
    });
    deepStrictEqual(await alreadyResponse.json(), {
      success: true,
      outcome: "already_linked",
      reservation: null,
      inviteOutcome: "not_needed",
    });
  });

  it("returns safe conflict codes without exposing internal errors", async () => {
    const handlers = management({
      createReservation: async () => {
        throw new UserLinkReservationError(
          "email_already_reserved",
          409,
          "このメールアドレスは別の関係者に予約されています"
        );
      },
    });
    const response = await handlers.POST(request("POST", {
      personId: "person-a",
      email: "person@example.test",
    }));
    strictEqual(response.status, 409);
    const result = await response.json();
    strictEqual(result.code, "email_already_reserved");
  });
});

describe("user link reservation claim handler", () => {
  it("uses the verified token and returns only safe counts", async () => {
    const decoded = {
      uid: "user-a",
      email: "person@example.test",
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
    };
    let received;
    const handler = createUserLinkReservationClaimHandler({
      verifyIdToken: async () => decoded,
      claimReservations: async (token) => {
        received = token;
        return { claimedCount: 1, waitingForMembershipCount: 2 };
      },
    });
    const response = await handler(request("POST"));
    strictEqual(response.status, 200);
    strictEqual(received, decoded);
    deepStrictEqual(await response.json(), {
      success: true,
      claimedCount: 1,
      waitingForMembershipCount: 2,
    });
  });
});
