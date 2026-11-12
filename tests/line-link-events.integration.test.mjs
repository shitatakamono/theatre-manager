import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "line-link-event-project";
const ownerUid = "line-event-owner";
const viewerUid = "line-event-viewer";
const lineUserId = `U${"a".repeat(32)}`;
let db;
let service;
let accountLink;

function projectRef() { return db.collection("projects").doc(projectId); }

async function seed(role = "viewer") {
  await projectRef().set({ title: "連携通知テスト公演", memberUids: [ownerUid, viewerUid] });
  await Promise.all([
    projectRef().collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner" }),
    projectRef().collection("members").doc(viewerUid).set({ uid: viewerUid, role }),
    projectRef().collection("people").doc("person-a").set({ displayName: "参加者A", active: true, linkedUserUid: viewerUid }),
    projectRef().collection("participants").doc("person-a").set({ displayName: "参加者A", active: true, linkedUserUid: viewerUid }),
    projectRef().collection("participantLinkedUsers").doc(viewerUid).set({ participantId: "person-a" }),
    db.collection("userIntegrations").doc(viewerUid).collection("providers").doc("line").set({
      provider: "line", status: "linked", lineUserId, lineDisplayName: "LINE参加者",
    }),
    db.collection("lineUserLinks").doc(accountLink.getLineUserLinkId(lineUserId)).set({ uid: viewerUid, lineUserId }),
  ]);
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  service = await import("../lib/server/line-link-events.ts");
  accountLink = await import("../lib/line-account-link.ts");
  db = getFirestore();
});
beforeEach(async () => {
  for (const collection of ["projects", "userIntegrations", "lineUserLinks", "lineNotificationDeliveries"]) {
    await db.recursiveDelete(db.collection(collection));
  }
  await seed();
});
after(async () => {
  for (const collection of ["projects", "userIntegrations", "lineUserLinks", "lineNotificationDeliveries"]) {
    await db.recursiveDelete(db.collection(collection));
  }
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("LINE project link repair and delivery", () => {
  it("records the first settings link and later relinks without normal-login events", async () => {
    await service.recordRelinkEvents({ uid: viewerUid, lineDisplayName: "LINE参加者", sourceId: "state-a", db });
    await service.recordRelinkEvents({ uid: viewerUid, lineDisplayName: "LINE参加者", sourceId: "state-b", db });
    const events = await projectRef().collection("lineLinkEvents").get();
    strictEqual(events.size, 2);
    strictEqual((await projectRef().collection("lineLinkEvents")
      .doc(service.lineLinkEventId("state-a", projectId, "person-a")).get()).data().eventType, "linked");
    strictEqual((await projectRef().collection("lineLinkEvents")
      .doc(service.lineLinkEventId("state-b", projectId, "person-a")).get()).data().eventType, "relinked");
  });

  it("removes only the viewer's project link and membership while preserving global LINE linkage", async () => {
    await service.repairProjectPersonLineLink({ ownerUid, projectId, personId: "person-a", db });
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, null);
    strictEqual((await projectRef().collection("participants").doc("person-a").get()).data().linkedUserUid, null);
    strictEqual((await projectRef().collection("participantLinkedUsers").doc(viewerUid).get()).exists, false);
    strictEqual((await projectRef().collection("members").doc(viewerUid).get()).exists, false);
    strictEqual((await projectRef().get()).data().memberUids.includes(viewerUid), false);
    strictEqual((await db.collection("userIntegrations").doc(viewerUid).collection("providers").doc("line").get()).exists, true);
    strictEqual((await db.collection("lineUserLinks").doc(accountLink.getLineUserLinkId(lineUserId)).get()).exists, true);
    strictEqual((await projectRef().collection("lineLinkEvents").get()).size, 1);
  });

  it("rejects privileged and conflicting project links without partial deletion", async () => {
    await projectRef().collection("members").doc(viewerUid).update({ role: "editor" });
    await rejects(() => service.repairProjectPersonLineLink({ ownerUid, projectId, personId: "person-a", db }),
      (error) => error.code === "privileged_member");
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, viewerUid);
    await projectRef().collection("members").doc(viewerUid).update({ role: "viewer" });
    await projectRef().collection("people").doc("person-b").set({ displayName: "参加者B", active: true, linkedUserUid: viewerUid });
    await rejects(() => service.repairProjectPersonLineLink({ ownerUid, projectId, personId: "person-a", db }),
      (error) => error.code === "other_person_linked");
    strictEqual((await projectRef().collection("members").doc(viewerUid).get()).exists, true);
  });

  it("sends each owner once for the same event and stores no LINE user id in history", async () => {
    const ownerLineId = `U${"b".repeat(32)}`;
    await Promise.all([
      db.collection("userIntegrations").doc(ownerUid).collection("providers").doc("line").set({
        provider: "line", status: "linked", deliveryStatus: "reachable", lineUserId: ownerLineId,
      }),
      db.collection("lineUserLinks").doc(accountLink.getLineUserLinkId(ownerLineId)).set({ uid: ownerUid, lineUserId: ownerLineId }),
      projectRef().collection("lineLinkEvents").doc("event-a").set({
        eventType: "linked", personId: "person-a", personName: "参加者A", lineDisplayName: "LINE参加者",
        source: "invite_claim", occurredAt: Timestamp.now(),
      }),
    ]);
    const sent = [];
    const send = async (payload) => { sent.push(payload); };
    await service.dispatchLineLinkEvent({ projectId, eventId: "event-a", db, send });
    await service.dispatchLineLinkEvent({ projectId, eventId: "event-a", db, send });
    strictEqual(sent.length, 1);
    strictEqual(sent[0].text.includes("連携通知テスト公演"), true);
    strictEqual(sent[0].text.includes("参加者A"), true);
    strictEqual(sent[0].text.includes("LINE参加者"), true);
    const event = (await projectRef().collection("lineLinkEvents").doc("event-a").get()).data();
    strictEqual(event.lineUserId, undefined);
    strictEqual((await db.collection("lineNotificationDeliveries").get()).size, 1);
  });

  it("retries a due retryable owner notification without duplicating the event", async () => {
    const ownerLineId = `U${"c".repeat(32)}`;
    await Promise.all([
      db.collection("userIntegrations").doc(ownerUid).collection("providers").doc("line").set({
        provider: "line", status: "linked", deliveryStatus: "reachable", lineUserId: ownerLineId,
      }),
      db.collection("lineUserLinks").doc(accountLink.getLineUserLinkId(ownerLineId)).set({ uid: ownerUid, lineUserId: ownerLineId }),
      projectRef().collection("lineLinkEvents").doc("event-retry").set({
        eventType: "linked", personId: "person-a", personName: "参加者A", lineDisplayName: "LINE参加者",
        source: "invite_claim", occurredAt: Timestamp.now(),
      }),
    ]);
    await service.dispatchLineLinkEvent({
      projectId, eventId: "event-retry", db, send: async () => { throw new Error("temporary"); },
    });
    const delivery = (await db.collection("lineNotificationDeliveries").get()).docs[0];
    strictEqual(delivery.data().status, "failed_retryable");
    const now = Timestamp.now();
    await delivery.ref.update({ nextAttemptAt: Timestamp.fromMillis(now.toMillis() - 1) });
    const sent = [];
    const result = await service.retryDueLineLinkEvents({ now, db, send: async (payload) => { sent.push(payload); } });
    strictEqual(result.sentCount, 1);
    strictEqual(sent.length, 1);
    strictEqual((await delivery.ref.get()).data().status, "sent");
    strictEqual((await projectRef().collection("lineLinkEvents").get()).size, 1);
  });
});
