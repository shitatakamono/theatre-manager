import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completeAuthenticatedUserBootstrap } from "../lib/auth-bootstrap.ts";

const profile = {
  uid: "user-1",
  email: "person@example.com",
  displayName: "利用者",
};

describe("authenticated user bootstrap", () => {
  it("claims invitations before reservations and completes the normal profile sync", async () => {
    const calls = [];
    const result = await completeAuthenticatedUserBootstrap({
      profile,
      claimInvites: async () => {
        calls.push("invite");
        return ["第61回公演"];
      },
      claimReservations: async () => {
        calls.push("reservation");
        return { claimedCount: 1 };
      },
      syncMemberProfiles: async () => {
        calls.push("profile");
      },
    });

    assert.deepEqual(calls, ["invite", "reservation", "profile"]);
    assert.deepEqual(result, {
      joinedProjects: ["第61回公演"],
      claimedReservationCount: 1,
    });
  });

  it("continues login when there is no pending reservation", async () => {
    let profileSynced = false;
    const result = await completeAuthenticatedUserBootstrap({
      profile,
      claimInvites: async () => [],
      claimReservations: async () => ({ claimedCount: 0 }),
      syncMemberProfiles: async () => { profileSynced = true; },
    });

    assert.equal(profileSynced, true);
    assert.equal(result.claimedReservationCount, 0);
  });

  it("continues login and profile sync when reservation claim fails", async () => {
    const calls = [];
    const result = await completeAuthenticatedUserBootstrap({
      profile,
      claimInvites: async () => {
        calls.push("invite");
        return [];
      },
      claimReservations: async () => {
        calls.push("reservation");
        throw new Error("member_not_found");
      },
      syncMemberProfiles: async () => {
        calls.push("profile");
      },
    });

    assert.deepEqual(calls, ["invite", "reservation", "profile"]);
    assert.equal(result.claimedReservationCount, 0);
  });

  it("does not let invitation or profile refresh errors block login", async () => {
    let reservationClaimed = false;
    const result = await completeAuthenticatedUserBootstrap({
      profile,
      claimInvites: async () => { throw new Error("invite failed"); },
      claimReservations: async () => {
        reservationClaimed = true;
        return { claimedCount: 1 };
      },
      syncMemberProfiles: async () => { throw new Error("profile failed"); },
    });

    assert.equal(reservationClaimed, true);
    assert.equal(result.claimedReservationCount, 1);
  });
});
