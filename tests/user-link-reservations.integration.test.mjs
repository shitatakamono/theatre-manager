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
    const reservation = await service.createProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email: " Person@Example.test ",
    });
    strictEqual(reservation.email, "person@example.test");
    strictEqual(reservation.status, "pending");
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, null);
    strictEqual((await projectRef().collection("participants").doc("person-a").get()).exists, false);
    strictEqual((await projectRef().collection("participantLinkedUsers").get()).empty, true);
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
    const first = await service.createProjectUserLinkReservation({
      uid: ownerUid,
      projectId,
      personId: "person-a",
      email: "first@example.test",
    });
    const changed = await service.changeProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
      email: "second@example.test",
    });
    strictEqual(changed.email, "second@example.test");
    strictEqual(changed.status, "pending");
    strictEqual((await projectRef().collection("userLinkReservations").doc(first.id).get()).data().status, "cancelled");
    await service.cancelProjectUserLinkReservation({
      uid: editorUid,
      projectId,
      personId: "person-a",
    });
    strictEqual((await projectRef().collection("userLinkReservations").doc(changed.id).get()).data().status, "cancelled");
    strictEqual((await projectRef().collection("userLinkReservationLocks").doc("person-a").get()).exists, false);
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
    strictEqual((await projectRef().collection("activityLogs").get()).size, 2);
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
