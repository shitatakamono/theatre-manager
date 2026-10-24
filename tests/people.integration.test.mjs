import { readFile } from "node:fs/promises";
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import {
  getProjectPeopleWithFallback,
  migrateProjectParticipantsToPeople,
} from "../lib/people.ts";
import {
  getProjectParticipants,
  updateProjectParticipant,
} from "../lib/participants.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "people-integration";
const ownerUid = "people-owner";
const editorUid = "people-editor";
let testEnv;

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function actor(uid) { return { uid, displayName: uid }; }

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), { title: "人物移行テスト", memberUids: [ownerUid, editorUid] });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
    for (const [id, displayName] of [["participant-a", "同姓同名"], ["participant-b", "同姓同名"]]) {
      await setDoc(doc(db, "projects", projectId, "participants", id), {
        displayName,
        specialPractice: id === "participant-a" ? "stage_combat" : "none",
        linkedUserUid: id === "participant-a" ? editorUid : null,
        publicNote: "公開備考",
        active: id === "participant-a",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
        createdByUid: ownerUid,
        updatedByUid: ownerUid,
      });
    }
    await setDoc(doc(db, "projects", projectId, "participantLinkedUsers", editorUid), {
      participantId: "participant-a",
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => { await testEnv.cleanup(); });

describe("people fallback and migration", () => {
  it("merges a partially migrated collection by ID with people taking priority", async () => {
    const db = firestoreFor(ownerUid);
    await setDoc(doc(db, "projects", projectId, "people", "participant-a"), {
      displayName: "People優先",
      attendanceTarget: true,
      specialPractice: "japanese_dance",
      linkedUserUid: editorUid,
      publicNote: "People備考",
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: ownerUid,
      updatedByUid: ownerUid,
    });
    const people = await getProjectPeopleWithFallback(projectId, db);
    strictEqual(people.length, 2);
    strictEqual(people.find(({ id }) => id === "participant-a")?.displayName, "People優先");
    strictEqual(people.find(({ id }) => id === "participant-b")?.displayName, "同姓同名");
  });

  it("supports dry-run, preserves participant IDs, skips existing people, and is idempotent", async () => {
    const db = firestoreFor(ownerUid);
    const dryRun = await migrateProjectParticipantsToPeople(projectId, ownerUid, { dryRun: true, firestore: db });
    deepStrictEqual(dryRun.createdPersonIds.sort(), ["participant-a", "participant-b"]);
    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "participant-a"))).exists(), false);

    const migrated = await migrateProjectParticipantsToPeople(projectId, ownerUid, { firestore: db });
    deepStrictEqual(migrated.createdPersonIds.sort(), ["participant-a", "participant-b"]);
    const person = await getDoc(doc(db, "projects", projectId, "people", "participant-a"));
    strictEqual(person.data()?.attendanceTarget, true);
    strictEqual(person.data()?.specialPractice, "stage_combat");
    strictEqual(person.data()?.createdAt.toDate().toISOString(), "2026-01-01T00:00:00.000Z");

    const repeated = await migrateProjectParticipantsToPeople(projectId, ownerUid, { firestore: db });
    deepStrictEqual(repeated.createdPersonIds, []);
    deepStrictEqual(repeated.skippedPersonIds.sort(), ["participant-a", "participant-b"]);
  });

  it("dual-writes a migrated participant name and returns it from the people-priority merge", async () => {
    const db = firestoreFor(ownerUid);
    await migrateProjectParticipantsToPeople(projectId, ownerUid, { firestore: db });
    await updateProjectParticipant(projectId, "participant-a", {
      displayName: "更新後の氏名",
      specialPractice: "stage_combat",
      linkedUserUid: editorUid,
      publicNote: "公開備考",
      active: true,
    }, actor(ownerUid), db);

    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "participant-a"))).data()?.displayName, "更新後の氏名");
    strictEqual((await getProjectPeopleWithFallback(projectId, db)).find(({ id }) => id === "participant-a")?.displayName, "更新後の氏名");
  });

  it("dual-writes special practice for a migrated participant", async () => {
    const db = firestoreFor(ownerUid);
    await migrateProjectParticipantsToPeople(projectId, ownerUid, { firestore: db });
    await updateProjectParticipant(projectId, "participant-a", {
      displayName: "同姓同名",
      specialPractice: "japanese_dance",
      linkedUserUid: editorUid,
      publicNote: "公開備考",
      active: true,
    }, actor(ownerUid), db);

    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "participant-a"))).data()?.specialPractice, "japanese_dance");
  });

  it("dual-writes linkedUserUid while preserving the participant lock transaction", async () => {
    const db = firestoreFor(ownerUid);
    await migrateProjectParticipantsToPeople(projectId, ownerUid, { firestore: db });
    await updateProjectParticipant(projectId, "participant-a", {
      displayName: "同姓同名",
      specialPractice: "stage_combat",
      linkedUserUid: ownerUid,
      publicNote: "公開備考",
      active: true,
    }, actor(ownerUid), db);

    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "participant-a"))).data()?.linkedUserUid, ownerUid);
    strictEqual((await getDoc(doc(db, "projects", projectId, "participantLinkedUsers", editorUid))).exists(), false);
    strictEqual((await getDoc(doc(db, "projects", projectId, "participantLinkedUsers", ownerUid))).data()?.participantId, "participant-a");
  });

  it("sets active and attendanceTarget false together for a migrated participant", async () => {
    const db = firestoreFor(ownerUid);
    await migrateProjectParticipantsToPeople(projectId, ownerUid, { firestore: db });
    await updateProjectParticipant(projectId, "participant-a", {
      displayName: "同姓同名",
      specialPractice: "stage_combat",
      linkedUserUid: editorUid,
      publicNote: "公開備考",
      active: false,
    }, actor(ownerUid), db);

    const person = (await getDoc(doc(db, "projects", projectId, "people", "participant-a"))).data();
    strictEqual(person?.active, false);
    strictEqual(person?.attendanceTarget, false);
  });

  it("keeps an unmigrated participant in participants only and exposes its update through fallback", async () => {
    const db = firestoreFor(ownerUid);
    await updateProjectParticipant(projectId, "participant-b", {
      displayName: "未移行の更新後氏名",
      specialPractice: "none",
      linkedUserUid: null,
      publicNote: "更新後備考",
      active: true,
    }, actor(ownerUid), db);

    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "participant-b"))).exists(), false);
    strictEqual((await getProjectPeopleWithFallback(projectId, db)).find(({ id }) => id === "participant-b")?.displayName, "未移行の更新後氏名");
  });

  it("rolls back the participant update when the people side of a dual-write is rejected", async () => {
    const db = firestoreFor(ownerUid);
    await migrateProjectParticipantsToPeople(projectId, ownerUid, { firestore: db });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "projects", projectId, "people", "participant-a"), {
        unexpectedField: true,
      });
    });

    await rejects(() => updateProjectParticipant(projectId, "participant-a", {
      displayName: "同姓同名",
      specialPractice: "stage_combat",
      linkedUserUid: editorUid,
      publicNote: "この更新はロールバックされる",
      active: true,
    }, actor(ownerUid), db));

    strictEqual((await getProjectParticipants(projectId, db)).find(({ id }) => id === "participant-a")?.publicNote, "公開備考");
  });
});
