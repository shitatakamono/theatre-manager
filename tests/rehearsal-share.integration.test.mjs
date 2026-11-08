import { notStrictEqual, strictEqual } from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import {
  disableRehearsalShare,
  getPublicRehearsalSchedule,
  issueRehearsalShare,
  regenerateRehearsalShare,
} from "../lib/server/rehearsal-share.ts";
import { adminDb } from "../lib/server/firebase-admin.ts";

const projectId = "rehearsal-share-integration";
const ownerUid = "share-owner";

beforeEach(async () => {
  await Promise.all([
    adminDb.collection("publicRehearsalShares").doc(projectId).delete(),
    adminDb.recursiveDelete(adminDb.collection("projects").doc(projectId)),
  ]);
  await adminDb.collection("projects").doc(projectId).set({ title: "共有テスト公演", memberUids: [ownerUid] });
  await adminDb.collection("projects").doc(projectId).collection("rehearsals").doc("public-one").set({
    startAt: Timestamp.fromDate(new Date("2099-11-15T04:00:00.000Z")),
    endAt: Timestamp.fromDate(new Date("2099-11-15T08:00:00.000Z")),
    type: "acting",
    customType: "",
    venue: "稽古場A",
    content: "公開しない内容",
    note: "公開しない備考",
    updatedAt: Timestamp.now(),
  });
});

describe("rehearsal share lifecycle", () => {
  it("issues, resolves, rotates and disables one project's public schedule", async () => {
    const issued = await issueRehearsalShare(projectId, ownerUid);
    const token = issued.path.split("/").at(-1);
    const publicSchedule = await getPublicRehearsalSchedule(token, Timestamp.fromDate(new Date("2099-01-01T00:00:00.000Z")));
    strictEqual(publicSchedule?.projectTitle, "共有テスト公演");
    strictEqual(publicSchedule?.rehearsals.length, 1);
    strictEqual(publicSchedule?.rehearsals[0].venue, "稽古場A");
    strictEqual("content" in publicSchedule.rehearsals[0], false);
    strictEqual("note" in publicSchedule.rehearsals[0], false);

    const regenerated = await regenerateRehearsalShare(projectId, ownerUid);
    const nextToken = regenerated.path.split("/").at(-1);
    notStrictEqual(nextToken, token);
    strictEqual(await getPublicRehearsalSchedule(token), null);
    strictEqual((await getPublicRehearsalSchedule(nextToken, Timestamp.fromDate(new Date("2099-01-01T00:00:00.000Z"))))?.rehearsals.length, 1);

    await disableRehearsalShare(projectId, ownerUid);
    strictEqual(await getPublicRehearsalSchedule(nextToken), null);
    strictEqual(await getPublicRehearsalSchedule("not-a-token"), null);
  });

  it("returns no schedule after the project itself is removed", async () => {
    const issued = await issueRehearsalShare(projectId, ownerUid);
    const token = issued.path.split("/").at(-1);
    await adminDb.recursiveDelete(adminDb.collection("projects").doc(projectId));
    strictEqual(await getPublicRehearsalSchedule(token), null);
  });

  it("does not mix another project's rehearsals", async () => {
    const otherId = `${projectId}-other`;
    await adminDb.collection("projects").doc(otherId).set({ title: "別公演" });
    await adminDb.collection("projects").doc(otherId).collection("rehearsals").doc("other-one").set({
      startAt: Timestamp.fromDate(new Date("2099-11-16T04:00:00.000Z")), type: "acting", venue: "別会場",
    });
    const issued = await issueRehearsalShare(projectId, ownerUid);
    const schedule = await getPublicRehearsalSchedule(issued.path.split("/").at(-1), Timestamp.fromDate(new Date("2099-01-01T00:00:00.000Z")));
    strictEqual(schedule?.rehearsals.some(({ venue }) => venue === "別会場"), false);
  });
});
