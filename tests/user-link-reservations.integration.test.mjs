import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "user-link-reservations-integration";
const ownerUid = "reservation-owner";
const editorUid = "reservation-editor";
let service;
let db;

function projectRef() {
  return db.collection("projects").doc(projectId);
}

function personData(name) {
  const now = Timestamp.now();
  return {
    displayName: name,
    attendanceTarget: true,
    specialPractice: "none",
    rehearsalParticipationTypes: ["acting"],
    linkedUserUid: null,
    publicNote: "",
    active: true,
    createdAt: now,
    updatedAt: now,
    createdByUid: ownerUid,
    updatedByUid: ownerUid,
  };
}

async function seed() {
  const project = projectRef();
  await project.set({ title: "Reservation integration", memberUids: [ownerUid, editorUid] });
  await Promise.all([
    project.collection("members").doc(ownerUid).set({
      uid: ownerUid,
      role: "owner",
      displayName: "Owner",
    }),
    project.collection("members").doc(editorUid).set({
      uid: editorUid,
      role: "editor",
      displayName: "Editor",
    }),
    project.collection("people").doc("person-a").set(personData("Person A")),
    project.collection("people").doc("person-b").set(personData("Person B")),
  ]);
}

async function seedFormalLink({ uid, email, personId }) {
  const project = projectRef();
  const participant = personData((await project.collection("people").doc(personId).get()).data().displayName);
  await Promise.all([
    project.collection("members").doc(uid).set({
      uid,
      role: "viewer",
      displayName: "Linked User",
      email,
    }),
    project.collection("people").doc(personId).update({ linkedUserUid: uid }),
    project.collection("participants").doc(personId).set({
      ...participant,
      linkedUserUid: uid,
    }),
    project.collection("participantLinkedUsers").doc(uid).set({ participantId: personId }),
  ]);
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  service = await import("../lib/server/user-link-reservations.ts");
  db = getFirestore();
});

beforeEach(async () => {
  await db.recursiveDelete(projectRef());
  await seed();
});

after(async () => {
  await db.recursiveDelete(projectRef());
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("user link reservation server transactions", () => {
  it("allows owner/editor creation without changing formal link documents", async () => {
    const result = await service.createProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email: " Person@Example.test ",
    });
    strictEqual(result.outcome, "pending");
    strictEqual(result.inviteOutcome, "created");
    strictEqual(result.reservation.email, "person@example.test");
    strictEqual(result.reservation.status, "pending");
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, null);
    strictEqual((await projectRef().collection("participants").doc("person-a").get()).exists, false);
    strictEqual((await projectRef().collection("participantLinkedUsers").get()).empty, true);
    const invite = (await projectRef().collection("memberInvites").doc("person@example.test").get()).data();
    strictEqual(invite.status, "pending");
    strictEqual(invite.role, "viewer");
    strictEqual(invite.source, "user_link_reservation");
    strictEqual(invite.emailStatus, "not_sent");
  });

  it("keeps pending and accepted invites, but recreates a revoked invite as viewer", async () => {
    const scenarios = [
      { email: "pending@example.test", status: "pending", expected: "existing" },
      { email: "accepted@example.test", status: "accepted", expected: "existing" },
      { email: "revoked@example.test", status: "revoked", expected: "created" },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const personId = index === 0 ? "person-a" : index === 1 ? "person-b" : `person-${index}`;
      if (index > 1) await projectRef().collection("people").doc(personId).set(personData(`Person ${index}`));
      await projectRef().collection("memberInvites").doc(scenario.email).set({
        email: scenario.email,
        status: scenario.status,
        role: "editor",
        marker: scenario.status,
      });
      const result = await service.createProjectUserLinkReservation({
        uid: editorUid,
        projectId,
        personId,
        email: scenario.email,
      });
      strictEqual(result.inviteOutcome, scenario.expected);
      const invite = (await projectRef().collection("memberInvites").doc(scenario.email).get()).data();
      if (scenario.status === "revoked") {
        strictEqual(invite.status, "pending");
        strictEqual(invite.role, "viewer");
      } else {
        strictEqual(invite.marker, scenario.status);
        strictEqual(invite.role, "editor");
      }
    }
  });

  it("is idempotent for the same pending reservation and never duplicates its invite", async () => {
    const input = {
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email: "idempotent@example.test",
    };
    const first = await service.createProjectUserLinkReservation(input);
    const second = await service.createProjectUserLinkReservation(input);
    strictEqual(first.inviteOutcome, "created");
    strictEqual(second.outcome, "pending");
    strictEqual(second.inviteOutcome, "existing");
    strictEqual((await projectRef().collection("memberInvites").get()).size, 1);
    strictEqual((await projectRef().collection("userLinkReservations").get()).size, 1);
    strictEqual((await projectRef().collection("activityLogs").get()).size, 2);
  });

  it("never revokes an independently created manual invite when cancelling a reservation", async () => {
    const email = "manual-invite@example.test";
    await projectRef().collection("memberInvites").doc(email).set({
      email,
      status: "pending",
      role: "editor",
      source: "manual",
    });
    await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email,
    });
    await service.cancelProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
    });
    const invite = (await projectRef().collection("memberInvites").doc(email).get()).data();
    strictEqual(invite.status, "pending");
    strictEqual(invite.role, "editor");
  });

  it("immediately links an existing unlinked member instead of creating a pending reservation", async () => {
    const email = "existing@example.test";
    await projectRef().collection("members").doc("existing-user").set({
      uid: "existing-user",
      role: "viewer",
      displayName: "Existing User",
      email,
    });
    const result = await service.createProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email,
    });

    strictEqual(result.outcome, "linked");
    strictEqual(result.inviteOutcome, "not_needed");
    strictEqual(result.reservation, null);
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, "existing-user");
    strictEqual((await projectRef().collection("participants").doc("person-a").get()).data().linkedUserUid, "existing-user");
    strictEqual((await projectRef().collection("participantLinkedUsers").doc("existing-user").get()).data().participantId, "person-a");
    strictEqual((await projectRef().collection("userLinkReservations").get()).empty, true);
    strictEqual((await projectRef().collection("memberInvites").get()).empty, true);
    strictEqual((await projectRef().collection("activityLogs").get()).size, 1);
  });

  it("never overwrites an existing owner role when linking by email", async () => {
    const email = "owner@example.test";
    await projectRef().collection("members").doc(ownerUid).update({ email });
    const result = await service.createProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email,
    });
    strictEqual(result.outcome, "linked");
    strictEqual(result.inviteOutcome, "not_needed");
    strictEqual((await projectRef().collection("members").doc(ownerUid).get()).data().role, "owner");
    strictEqual((await projectRef().collection("memberInvites").get()).empty, true);
  });

  it("treats an already complete link to the requested person as idempotent success", async () => {
    const email = "same-person@example.test";
    await seedFormalLink({ uid: "same-user", email, personId: "person-a" });
    const result = await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email,
    });

    strictEqual(result.outcome, "already_linked");
    strictEqual(result.inviteOutcome, "not_needed");
    strictEqual(result.reservation, null);
    strictEqual((await projectRef().collection("userLinkReservations").get()).empty, true);
    strictEqual((await projectRef().collection("memberInvites").get()).empty, true);
    strictEqual((await projectRef().collection("activityLogs").get()).empty, true);
  });

  it("rejects a member already linked to another person without changing either link", async () => {
    const email = "other-person@example.test";
    await seedFormalLink({ uid: "linked-user", email, personId: "person-b" });

    await rejects(() => service.createProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email,
    }), {
      code: "member_already_linked",
      message: /Person B/,
    });
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, null);
    strictEqual((await projectRef().collection("people").doc("person-b").get()).data().linkedUserUid, "linked-user");
    strictEqual((await projectRef().collection("participantLinkedUsers").doc("linked-user").get()).data().participantId, "person-b");
    strictEqual((await projectRef().collection("userLinkReservations").get()).empty, true);
    strictEqual((await projectRef().collection("memberInvites").get()).empty, true);
  });

  it("serializes duplicate email and duplicate-person concurrent reservations", async () => {
    const sameEmail = await Promise.allSettled([
      service.createProjectUserLinkReservation({
        uid: ownerUid,
        projectId,
        personId: "person-a",
        email: "same@example.test",
      }),
      service.createProjectUserLinkReservation({
        uid: editorUid,
        projectId,
        personId: "person-b",
        email: "same@example.test",
      }),
    ]);
    strictEqual(sameEmail.filter(({ status }) => status === "fulfilled").length, 1);
    strictEqual(sameEmail.filter(({ status }) => status === "rejected").length, 1);

    await db.recursiveDelete(projectRef());
    await seed();
    const samePerson = await Promise.allSettled([
      service.createProjectUserLinkReservation({
        uid: ownerUid,
        projectId,
        personId: "person-a",
        email: "first@example.test",
      }),
      service.createProjectUserLinkReservation({
        uid: editorUid,
        projectId,
        personId: "person-a",
        email: "second@example.test",
      }),
    ]);
    strictEqual(samePerson.filter(({ status }) => status === "fulfilled").length, 1);
    strictEqual(samePerson.filter(({ status }) => status === "rejected").length, 1);
  });

  it("changes and cancels a pending reservation while preserving its history", async () => {
    const firstResult = await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email: "first@example.test",
    });
    const changedResult = await service.changeProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email: "second@example.test",
    });
    const first = firstResult.reservation;
    const changed = changedResult.reservation;
    strictEqual(changedResult.outcome, "pending");
    strictEqual(changed.email, "second@example.test");
    strictEqual(changed.status, "pending");
    strictEqual((await projectRef().collection("userLinkReservations").doc(first.id).get()).data().status, "cancelled");
    strictEqual((await projectRef().collection("memberInvites").doc("first@example.test").get()).data().status, "revoked");
    strictEqual((await projectRef().collection("memberInvites").doc("second@example.test").get()).data().status, "pending");
    await service.cancelProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
    });
    strictEqual((await projectRef().collection("userLinkReservations").doc(changed.id).get()).data().status, "cancelled");
    strictEqual((await projectRef().collection("memberInvites").doc("second@example.test").get()).data().status, "revoked");
    strictEqual((await projectRef().collection("userLinkReservationLocks").doc("person-a").get()).exists, false);
  });

  it("converts a pending reservation change into an immediate formal link for an existing member", async () => {
    const first = await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email: "waiting@example.test",
    });
    await projectRef().collection("members").doc("new-member").set({
      uid: "new-member",
      role: "viewer",
      email: "registered@example.test",
    });

    const result = await service.changeProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email: "registered@example.test",
    });

    strictEqual(result.outcome, "linked");
    strictEqual(result.reservation, null);
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, "new-member");
    strictEqual((await projectRef().collection("participantLinkedUsers").doc("new-member").get()).data().participantId, "person-a");
    strictEqual((await projectRef().collection("userLinkReservations").doc(first.reservation.id).get()).data().status, "cancelled");
    strictEqual((await projectRef().collection("userLinkReservationLocks").doc("person-a").get()).exists, false);
  });

  it("shows a preserved pending reservation as conflicted after another formal link appears", async () => {
    const email = "later-conflict@example.test";
    const created = await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email,
    });
    await seedFormalLink({ uid: "later-user", email, personId: "person-b" });

    const reservations = await service.getProjectUserLinkReservations({
      uid: editorUid,
      projectId,
    });
    const reservation = reservations.find((item) => item.id === created.reservation.id);
    strictEqual(reservation.status, "pending");
    strictEqual(reservation.conflictPersonName, "Person B");
    strictEqual((await projectRef().collection("userLinkReservations").doc(created.reservation.id).get()).data().status, "pending");
  });

  it("serializes concurrent immediate links for one registered member", async () => {
    const email = "concurrent-member@example.test";
    await projectRef().collection("members").doc("concurrent-user").set({
      uid: "concurrent-user",
      role: "viewer",
      email,
    });
    const results = await Promise.allSettled([
      service.createProjectUserLinkReservation({
        uid: ownerUid,
        projectId,
        personId: "person-a",
        email,
      }),
      service.createProjectUserLinkReservation({
        uid: editorUid,
        projectId,
        personId: "person-b",
        email,
      }),
    ]);
    strictEqual(results.filter(({ status }) => status === "fulfilled").length, 1);
    strictEqual(results.filter(({ status }) => status === "rejected").length, 1);
    const linkedPeople = await projectRef().collection("people")
      .where("linkedUserUid", "==", "concurrent-user").get();
    strictEqual(linkedPeople.size, 1);
    strictEqual((await projectRef().collection("participantLinkedUsers").doc("concurrent-user").get()).exists, true);
    strictEqual((await projectRef().collection("userLinkReservations").get()).empty, true);
  });

  it("waits for membership, then atomically creates the formal bidirectional link", async () => {
    const email = "claim@example.test";
    await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email,
    });
    const token = {
      uid: "claim-user",
      email,
      email_verified: true,
      name: "Claim User",
      firebase: { sign_in_provider: "google.com" },
    };
    const waiting = await service.claimPendingUserLinkReservations(token);
    strictEqual(waiting.claimedCount, 0);
    strictEqual(waiting.waitingForMembershipCount, 1);

    await projectRef().collection("members").doc(token.uid).set({
      uid: token.uid,
      role: "viewer",
      displayName: "Claim User",
      email,
    });
    const claimed = await service.claimPendingUserLinkReservations(token);
    strictEqual(claimed.claimedCount, 1);
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, token.uid);
    strictEqual((await projectRef().collection("participants").doc("person-a").get()).data().linkedUserUid, token.uid);
    strictEqual((await projectRef().collection("participantLinkedUsers").doc(token.uid).get()).data().participantId, "person-a");
    const reservations = await projectRef().collection("userLinkReservations").where("email", "==", email).get();
    strictEqual(reservations.docs[0].data().status, "claimed");
    strictEqual((await projectRef().collection("userLinkReservationLocks").doc("person-a").get()).exists, false);
    strictEqual((await projectRef().collection("activityLogs").get()).size, 3);
  });

  it("rejects unverified/non-Google identities and existing link conflicts", async () => {
    const email = "conflict@example.test";
    await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email,
    });
    await projectRef().collection("members").doc("claim-user").set({
      uid: "claim-user",
      role: "viewer",
    });
    await rejects(() => service.claimPendingUserLinkReservations({
      uid: "claim-user",
      email,
      email_verified: false,
      firebase: { sign_in_provider: "google.com" },
    }), { code: "email_not_verified" });
    await rejects(() => service.claimPendingUserLinkReservations({
      uid: "claim-user",
      email,
      email_verified: true,
      firebase: { sign_in_provider: "password" },
    }), { code: "google_account_required" });

    await projectRef().collection("people").doc("person-a").update({ linkedUserUid: "other-user" });
    await rejects(() => service.claimPendingUserLinkReservations({
      uid: "claim-user",
      email,
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
    }), { code: "reservation_conflict" });
    strictEqual((await projectRef().collection("participantLinkedUsers").doc("claim-user").get()).exists, false);
  });

  it("does not link a UID that is already present on another person", async () => {
    const email = "duplicate-user@example.test";
    await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email,
    });
    await Promise.all([
      projectRef().collection("members").doc("claim-user").set({
        uid: "claim-user",
        role: "viewer",
      }),
      projectRef().collection("people").doc("person-b").update({
        linkedUserUid: "claim-user",
      }),
    ]);
    await rejects(() => service.claimPendingUserLinkReservations({
      uid: "claim-user",
      email,
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
    }), { code: "reservation_conflict" });
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, null);
  });
});
