import { readFile } from "node:fs/promises";
import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { upsertProjectAttendanceRecord } from "../lib/attendance.ts";
import { buildAttendanceManagementMatrix } from "../lib/attendance-management.ts";
import { findSelfParticipant } from "../lib/attendance-view.ts";
import { getProjectAttendanceParticipants } from "../lib/people.ts";
import { createProjectPerson, setProjectPersonEnded, updateProjectPerson } from "../lib/people-management.ts";
import { preparePerformancePeopleForSave } from "../lib/performance-people.ts";
import { updateProjectPerformancePeopleSection } from "../lib/performance-people-writes.ts";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "performance-people-integration";
const ownerUid = "performance-owner";
const editorUid = "performance-editor";
const viewerUid = "performance-viewer";
let testEnv;

function firestoreFor(uid) { return testEnv.authenticatedContext(uid).firestore(); }
function actor(uid) { return { uid, displayName: uid }; }
function personDraft(id, overrides = {}) {
  return {
    id,
    values: {
      displayName: `人物 ${id}`,
      attendanceTarget: true,
      specialPractice: "none",
      linkedUserUid: null,
      publicNote: "",
      active: true,
      ...overrides,
    },
  };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects", projectId), {
      title: "人物関連付けテスト",
      cast: [],
      staff: [],
      memberUids: [ownerUid, editorUid, viewerUid],
    });
    await setDoc(doc(db, "projects", projectId, "members", ownerUid), { uid: ownerUid, role: "owner" });
    await setDoc(doc(db, "projects", projectId, "members", editorUid), { uid: editorUid, role: "editor" });
    await setDoc(doc(db, "projects", projectId, "members", viewerUid), { uid: viewerUid, role: "viewer" });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => { await testEnv.cleanup(); });

describe("performance people atomic writes", () => {
  it("automatically registers a newly added cast member without copying the credit name", async () => {
    const db = firestoreFor(ownerUid);
    const prepared = preparePerformancePeopleForSave(
      "cast",
      [{ id: "cast-new", order: 1, name: "本名", displayName: "芸名" }],
      [],
      [],
      () => "person-auto-cast"
    );
    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      prepared.value,
      prepared.peopleDrafts,
      { actor: actor(ownerUid), expectedRevision: 0 },
      db
    );

    const person = (await getDoc(doc(db, "projects", projectId, "people", "person-auto-cast"))).data();
    const participant = (await getDoc(doc(db, "projects", projectId, "participants", "person-auto-cast"))).data();
    const project = (await getDoc(doc(db, "projects", projectId))).data();
    strictEqual(person?.displayName, "本名");
    strictEqual(person?.attendanceTarget, false);
    strictEqual(person?.specialPractice, "none");
    strictEqual(person?.rehearsalParticipationTypes.join("|"), "acting");
    strictEqual(person?.linkedUserUid, null);
    strictEqual(participant?.active, false);
    strictEqual(participant?.rehearsalParticipationTypes.join("|"), "acting");
    strictEqual(project?.cast[0].displayName, "芸名");
    strictEqual(project?.cast[0].personId, "person-auto-cast");
  });

  it("automatically registers a newly added staff member without copying the credit name", async () => {
    const db = firestoreFor(editorUid);
    const prepared = preparePerformancePeopleForSave(
      "staff",
      [{ id: "role-a", role: "演出", members: [{ id: "staff-new", name: "スタッフ本名", creditName: "外部表記" }] }],
      [],
      [],
      () => "person-auto-staff"
    );
    await updateProjectPerformancePeopleSection(
      projectId,
      "staff",
      prepared.value,
      prepared.peopleDrafts,
      { actor: actor(editorUid), expectedRevision: 0 },
      db
    );

    const person = (await getDoc(doc(db, "projects", projectId, "people", "person-auto-staff"))).data();
    const project = (await getDoc(doc(db, "projects", projectId))).data();
    strictEqual(person?.displayName, "スタッフ本名");
    strictEqual(person?.attendanceTarget, false);
    strictEqual(person?.rehearsalParticipationTypes.length, 0);
    strictEqual(project?.staff[0].members[0].creditName, "外部表記");
    strictEqual(project?.staff[0].members[0].personId, "person-auto-staff");
  });

  it("does not leave an automatically prepared person when the section save fails", async () => {
    const db = firestoreFor(ownerUid);
    const prepared = preparePerformancePeopleForSave(
      "cast",
      [{ id: "cast-new", order: 1, name: "ロールバック対象" }],
      [],
      [],
      () => "person-rollback"
    );
    await rejects(() => updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      prepared.value,
      prepared.peopleDrafts,
      { actor: actor(ownerUid), expectedRevision: 1 },
      db
    ));

    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "person-rollback"))).exists(), false);
    strictEqual((await getDoc(doc(db, "projects", projectId, "participants", "person-rollback"))).exists(), false);
    strictEqual((await getDoc(doc(db, "projects", projectId))).data()?.cast.length, 0);
  });

  it("creates people and same-ID compatibility participants for owner and editor", async () => {
    for (const [uid, attendanceTarget] of [[ownerUid, false], [editorUid, true]]) {
      const db = firestoreFor(uid);
      const personId = await createProjectPerson(projectId, {
        displayName: `人物 ${uid}`,
        attendanceTarget,
        specialPractice: "none",
        linkedUserUid: null,
        publicNote: "",
      }, actor(uid), db);
      const person = (await getDoc(doc(db, "projects", projectId, "people", personId))).data();
      const participant = (await getDoc(doc(db, "projects", projectId, "participants", personId))).data();
      strictEqual(person?.active, true);
      strictEqual(person?.attendanceTarget, attendanceTarget);
      strictEqual(participant?.active, attendanceTarget);
    }
  });

  it("updates attendance compatibility and linked-user lock atomically", async () => {
    const db = firestoreFor(ownerUid);
    const personId = await createProjectPerson(projectId, {
      displayName: "連携対象",
      attendanceTarget: false,
      specialPractice: "none",
      linkedUserUid: null,
      publicNote: "",
    }, actor(ownerUid), db);
    await updateProjectPerson(projectId, personId, {
      displayName: "連携対象 更新",
      attendanceTarget: true,
      specialPractice: "stage_combat",
      linkedUserUid: viewerUid,
      publicNote: "公開",
    }, actor(ownerUid), db);

    let person = (await getDoc(doc(db, "projects", projectId, "people", personId))).data();
    let participant = (await getDoc(doc(db, "projects", projectId, "participants", personId))).data();
    strictEqual(person?.linkedUserUid, viewerUid);
    strictEqual(person?.active, true);
    strictEqual(person?.attendanceTarget, true);
    strictEqual(participant?.linkedUserUid, viewerUid);
    strictEqual(participant?.active, true);
    strictEqual((await getDoc(doc(db, "projects", projectId, "participantLinkedUsers", viewerUid))).data()?.participantId, personId);

    await updateProjectPerson(projectId, personId, {
      displayName: "連携対象 更新",
      attendanceTarget: false,
      specialPractice: "stage_combat",
      linkedUserUid: null,
      publicNote: "公開",
    }, actor(ownerUid), db);
    person = (await getDoc(doc(db, "projects", projectId, "people", personId))).data();
    participant = (await getDoc(doc(db, "projects", projectId, "participants", personId))).data();
    strictEqual(person?.linkedUserUid, null);
    strictEqual(person?.active, true);
    strictEqual(participant?.linkedUserUid, null);
    strictEqual(participant?.active, false);
    strictEqual((await getDoc(doc(db, "projects", projectId, "participantLinkedUsers", viewerUid))).exists(), false);
  });

  it("rejects duplicate and nonmember links without partial writes", async () => {
    const db = firestoreFor(ownerUid);
    const firstId = await createProjectPerson(projectId, {
      displayName: "先の人物",
      attendanceTarget: true,
      specialPractice: "none",
      linkedUserUid: viewerUid,
      publicNote: "",
    }, actor(ownerUid), db);
    await rejects(() => createProjectPerson(projectId, {
      displayName: "重複人物",
      attendanceTarget: true,
      specialPractice: "none",
      linkedUserUid: viewerUid,
      publicNote: "",
    }, actor(ownerUid), db), /別の参加者または関係者/);
    await rejects(() => createProjectPerson(projectId, {
      displayName: "非メンバー連携",
      attendanceTarget: true,
      specialPractice: "none",
      linkedUserUid: "outsider-user",
      publicNote: "",
    }, actor(ownerUid), db), /公演メンバー/);
    strictEqual((await getDocs(collection(db, "projects", projectId, "people"))).size, 1);
    strictEqual((await getDoc(doc(db, "projects", projectId, "people", firstId))).exists(), true);
  });

  it("keeps cast and staff unchanged when editing people", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "projects", projectId), {
        title: "人物関連付けテスト",
        cast: [{ id: "cast-a", order: 1, name: "A", personId: "person-a" }],
        staff: [{ id: "role-a", role: "演出", members: [{ id: "staff-a", name: "A", personId: "person-a" }] }],
        memberUids: [ownerUid, editorUid, viewerUid],
      });
    });
    const db = firestoreFor(ownerUid);
    const personId = await createProjectPerson(projectId, {
      displayName: "独立人物",
      attendanceTarget: false,
      specialPractice: "none",
      linkedUserUid: null,
      publicNote: "",
    }, actor(ownerUid), db);
    await updateProjectPerson(projectId, personId, {
      displayName: "独立人物 更新",
      attendanceTarget: true,
      specialPractice: "japanese_dance",
      linkedUserUid: null,
      publicNote: "",
    }, actor(ownerUid), db);
    const project = (await getDoc(doc(db, "projects", projectId))).data();
    strictEqual(project?.cast[0].personId, "person-a");
    strictEqual(project?.staff[0].members[0].personId, "person-a");
  });

  it("keeps viewers read-only in the people management write boundary", async () => {
    const db = firestoreFor(viewerUid);
    await rejects(() => createProjectPerson(projectId, {
      displayName: "Viewer人物",
      attendanceTarget: false,
      specialPractice: "none",
      linkedUserUid: null,
      publicNote: "",
    }, actor(viewerUid), db));
    strictEqual((await getDocs(collection(db, "projects", projectId, "people"))).size, 0);
  });

  it("creates a new person, compatibility participant, cast link, revision, and activity atomically", async () => {
    const db = firestoreFor(ownerUid);
    const cast = [{ id: "cast-a", order: 1, name: "旧互換名", personId: "person-a" }];
    const result = await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      cast,
      [personDraft("person-a", { specialPractice: "stage_combat" })],
      { actor: actor(ownerUid), expectedRevision: 0 },
      db
    );

    strictEqual(result.revision, 1);
    strictEqual((await getDoc(doc(db, "projects", projectId))).data()?.cast[0].personId, "person-a");
    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "person-a"))).data()?.specialPractice, "stage_combat");
    strictEqual((await getDoc(doc(db, "projects", projectId, "participants", "person-a"))).data()?.active, true);
    strictEqual((await getDocs(collection(db, "projects", projectId, "activityLogs"))).size, 1);
  });

  it("keeps a new person active while disabling only its attendance compatibility participant", async () => {
    const db = firestoreFor(ownerUid);
    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      [{ id: "cast-a", order: 1, name: "A", personId: "person-a" }],
      [personDraft("person-a", { active: true, attendanceTarget: false })],
      { actor: actor(ownerUid), expectedRevision: 0 },
      db
    );

    const person = (await getDoc(doc(db, "projects", projectId, "people", "person-a"))).data();
    const participant = (await getDoc(doc(db, "projects", projectId, "participants", "person-a"))).data();
    strictEqual(person?.active, true);
    strictEqual(person?.attendanceTarget, false);
    strictEqual(participant?.active, false);
  });

  it("synchronizes an existing person's attendanceTarget both ways without deactivating the person", async () => {
    const db = firestoreFor(ownerUid);
    const cast = [{ id: "cast-a", order: 1, name: "A", personId: "person-a" }];
    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      cast,
      [personDraft("person-a", { active: true, attendanceTarget: true })],
      { actor: actor(ownerUid), expectedRevision: 0 },
      db
    );
    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      cast,
      [personDraft("person-a", { active: true, attendanceTarget: false })],
      { actor: actor(ownerUid), expectedRevision: 1 },
      db
    );
    let person = (await getDoc(doc(db, "projects", projectId, "people", "person-a"))).data();
    let participant = (await getDoc(doc(db, "projects", projectId, "participants", "person-a"))).data();
    strictEqual(person?.active, true);
    strictEqual(person?.attendanceTarget, false);
    strictEqual(participant?.active, false);

    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      cast,
      [personDraft("person-a", { active: true, attendanceTarget: true })],
      { actor: actor(ownerUid), expectedRevision: 1 },
      db
    );
    person = (await getDoc(doc(db, "projects", projectId, "people", "person-a"))).data();
    participant = (await getDoc(doc(db, "projects", projectId, "participants", "person-a"))).data();
    strictEqual(person?.active, true);
    strictEqual(person?.attendanceTarget, true);
    strictEqual(participant?.active, true);
  });

  it("lets an editor reuse one person in multiple staff roles without duplicating people", async () => {
    const db = firestoreFor(editorUid);
    const staff = [
      { id: "role-a", role: "演出", members: [{ id: "staff-a", name: "A", personId: "person-a" }] },
      { id: "role-b", role: "制作", members: [{ id: "staff-b", name: "A", personId: "person-a" }] },
    ];
    await updateProjectPerformancePeopleSection(
      projectId,
      "staff",
      staff,
      [personDraft("person-a")],
      { actor: actor(editorUid), expectedRevision: 0 },
      db
    );

    strictEqual((await getDocs(collection(db, "projects", projectId, "people"))).size, 1);
    strictEqual((await getDoc(doc(db, "projects", projectId))).data()?.staff[1].members[0].personId, "person-a");
  });

  it("keeps people when a cast link is removed", async () => {
    const db = firestoreFor(ownerUid);
    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      [{ id: "cast-a", order: 1, name: "A", personId: "person-a" }],
      [personDraft("person-a")],
      { actor: actor(ownerUid), expectedRevision: 0 },
      db
    );
    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      [],
      [],
      { actor: actor(ownerUid), expectedRevision: 1 },
      db
    );

    const person = await getDoc(doc(db, "projects", projectId, "people", "person-a"));
    strictEqual(person.exists(), true);
    strictEqual(person.data()?.active, true);
    strictEqual(person.data()?.attendanceTarget, true);
    strictEqual((await getDoc(doc(db, "projects", projectId))).data()?.cast.length, 0);
  });

  it("keeps people when a staff entry is removed", async () => {
    const db = firestoreFor(ownerUid);
    await updateProjectPerformancePeopleSection(
      projectId,
      "staff",
      [{ id: "role-a", role: "演出", members: [{ id: "staff-a", name: "A", personId: "person-a" }] }],
      [personDraft("person-a")],
      { actor: actor(ownerUid), expectedRevision: 0 },
      db
    );
    await updateProjectPerformancePeopleSection(
      projectId,
      "staff",
      [{ id: "role-a", role: "演出", members: [] }],
      [],
      { actor: actor(ownerUid), expectedRevision: 1 },
      db
    );

    const person = await getDoc(doc(db, "projects", projectId, "people", "person-a"));
    strictEqual(person.exists(), true);
    strictEqual(person.data()?.active, true);
    strictEqual(person.data()?.attendanceTarget, true);
    strictEqual((await getDoc(doc(db, "projects", projectId))).data()?.staff[0].members.length, 0);
  });

  it("keeps attendance matrix, attendance writes, and viewer self resolution compatible", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const common = {
        displayName: "連携人物",
        specialPractice: "none",
        linkedUserUid: viewerUid,
        publicNote: "",
        active: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        createdByUid: ownerUid,
        updatedByUid: ownerUid,
      };
      await setDoc(doc(db, "projects", projectId, "participants", "person-linked"), common);
      await setDoc(doc(db, "projects", projectId, "people", "person-linked"), { ...common, attendanceTarget: true });
      await setDoc(doc(db, "projects", projectId, "participantLinkedUsers", viewerUid), { participantId: "person-linked" });
    });
    const ownerDb = firestoreFor(ownerUid);
    await updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      [{ id: "cast-a", order: 1, name: "旧互換名", personId: "person-linked" }],
      [personDraft("person-linked", { displayName: "連携人物", linkedUserUid: viewerUid })],
      { actor: actor(ownerUid), expectedRevision: 0 },
      ownerDb
    );
    const attendancePeople = await getProjectAttendanceParticipants(projectId, ownerDb);
    strictEqual(buildAttendanceManagementMatrix(attendancePeople, [{ date: "2026-11-15" }], []).length, 1);
    strictEqual(findSelfParticipant(attendancePeople, viewerUid)?.id, "person-linked");

    const viewerDb = firestoreFor(viewerUid);
    await upsertProjectAttendanceRecord(projectId, {
      participantId: "person-linked",
      date: "2026-11-15",
      status: "absent",
      availableFrom: null,
      availableUntil: null,
      publicNote: "",
    }, viewerUid, viewerDb);
    strictEqual((await getDoc(doc(viewerDb, "projects", projectId, "attendanceRecords", "2026-11-15_person-linked"))).exists(), true);
  });

  it("ends and restores a person without deleting related records or links", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const personId = await createProjectPerson(projectId, {
      displayName: "終了確認",
      attendanceTarget: true,
      specialPractice: "stage_combat",
      rehearsalParticipationTypes: ["acting", "stage_combat"],
      linkedUserUid: viewerUid,
      publicNote: "保持する備考",
    }, actor(ownerUid), ownerDb);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "projects", projectId), {
        cast: [{ id: "cast-ended", order: 1, name: "終了確認", personId }],
        staff: [{ id: "role-ended", role: "演出", members: [{ id: "staff-ended", name: "終了確認", personId }] }],
      }, { merge: true });
    });
    await upsertProjectAttendanceRecord(projectId, {
      participantId: personId,
      date: "2026-10-01",
      status: "absent",
      availableFrom: null,
      availableUntil: null,
      publicNote: "過去記録",
    }, ownerUid, ownerDb);

    strictEqual(await setProjectPersonEnded(projectId, personId, true, actor(ownerUid), ownerDb), true);
    let person = (await getDoc(doc(ownerDb, "projects", projectId, "people", personId))).data();
    let participant = (await getDoc(doc(ownerDb, "projects", projectId, "participants", personId))).data();
    strictEqual(person?.active, false);
    strictEqual(person?.linkedUserUid, viewerUid);
    strictEqual(person?.publicNote, "保持する備考");
    strictEqual(person?.rehearsalParticipationTypes.join("|"), "acting|stage_combat");
    strictEqual(participant?.active, false);
    strictEqual(participant?.rehearsalParticipationTypes.join("|"), "acting|stage_combat");
    strictEqual((await getDoc(doc(ownerDb, "projects", projectId, "attendanceRecords", `2026-10-01_${personId}`))).exists(), true);
    strictEqual((await getDoc(doc(ownerDb, "projects", projectId, "participantLinkedUsers", viewerUid))).data()?.participantId, personId);
    const project = (await getDoc(doc(ownerDb, "projects", projectId))).data();
    strictEqual(project?.cast[0].personId, personId);
    strictEqual(project?.staff[0].members[0].personId, personId);
    strictEqual(buildAttendanceManagementMatrix(await getProjectAttendanceParticipants(projectId, ownerDb), [{ date: "2026-11-15" }], []).length, 0);

    await rejects(() => setProjectPersonEnded(projectId, personId, false, actor(viewerUid), firestoreFor(viewerUid)));
    strictEqual(await setProjectPersonEnded(projectId, personId, false, actor(editorUid), firestoreFor(editorUid)), true);
    person = (await getDoc(doc(ownerDb, "projects", projectId, "people", personId))).data();
    participant = (await getDoc(doc(ownerDb, "projects", projectId, "participants", personId))).data();
    strictEqual(person?.active, true);
    strictEqual(person?.rehearsalParticipationTypes.join("|"), "acting|stage_combat");
    strictEqual(participant?.active, true);
    strictEqual(participant?.rehearsalParticipationTypes.join("|"), "acting|stage_combat");
    strictEqual((await getDocs(collection(ownerDb, "projects", projectId, "activityLogs"))).size, 3);
  });

  it("rejects viewers and leaves every target unchanged", async () => {
    const db = firestoreFor(viewerUid);
    await rejects(() => updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      [{ id: "cast-a", order: 1, name: "A", personId: "person-a" }],
      [personDraft("person-a")],
      { actor: actor(viewerUid), expectedRevision: 0 },
      db
    ));

    strictEqual((await getDoc(doc(db, "projects", projectId))).data()?.cast.length, 0);
    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "person-a"))).exists(), false);
    strictEqual((await getDoc(doc(db, "projects", projectId, "participants", "person-a"))).exists(), false);
  });

  it("does not partially write when linked-user compatibility validation fails", async () => {
    const db = firestoreFor(ownerUid);
    await rejects(() => updateProjectPerformancePeopleSection(
      projectId,
      "cast",
      [{ id: "cast-a", order: 1, name: "A", personId: "person-a" }],
      [personDraft("person-a", { linkedUserUid: editorUid })],
      { actor: actor(ownerUid), expectedRevision: 0 },
      db
    ), /関係者管理/);

    strictEqual((await getDoc(doc(db, "projects", projectId))).data()?.cast.length, 0);
    strictEqual((await getDoc(doc(db, "projects", projectId, "people", "person-a"))).exists(), false);
  });
});
