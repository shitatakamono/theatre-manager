import { readFile } from "node:fs/promises";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const testProjectId = "seisakuboard-rules-test";
const projectId = "performance-a";
const ownerUid = "owner-a";
const editorUid = "editor-a";
const viewerUid = "viewer-a";
const outsiderUid = "outsider-a";
const invitedUid = "invitee-a";
const invitedEmail = "invitee-a@example.test";

let testEnv;

function firestoreFor(uid) {
  return uid
    ? testEnv.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore()
    : testEnv.unauthenticatedContext().firestore();
}

function firestoreForEmail(uid, email) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

function projectRef(db, id = projectId) {
  return doc(db, "projects", id);
}

function memberRef(db, uid, id = projectId) {
  return doc(db, "projects", id, "members", uid);
}

function taskRef(db, id = "task-a", targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "tasks", id);
}

function rehearsalRef(db, id = "rehearsal-a", targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "rehearsals", id);
}

function rehearsalData(uid, overrides = {}) {
  return {
    startAt: new Date("2026-11-15T04:00:00Z"),
    endAt: new Date("2026-11-15T07:00:00Z"),
    type: "acting",
    customType: "",
    venue: "会議室A",
    content: "立ち稽古",
    note: "",
    revision: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: uid,
    updatedByUid: uid,
    ...overrides,
  };
}

function participantRef(db, id = "participant-a", targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "participants", id);
}

function participantLinkedUserRef(db, uid = editorUid, targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "participantLinkedUsers", uid);
}

function participantData(uid, overrides = {}) {
  return {
    displayName: "参加者A",
    specialPractice: "none",
    linkedUserUid: null,
    publicNote: "公開備考",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: uid,
    updatedByUid: uid,
    ...overrides,
  };
}

function attendanceRef(db, date = "2026-11-03", participantId = "participant-a", targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "attendanceRecords", `${date}_${participantId}`);
}

function attendanceData(uid, overrides = {}) {
  return {
    participantId: "participant-a",
    date: "2026-11-03",
    status: "attending",
    availableFrom: "13:00",
    availableUntil: "16:30",
    publicNote: "途中参加",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: uid,
    updatedByUid: uid,
    ...overrides,
  };
}

async function createAttendanceParticipant(db, id = "participant-a") {
  return setDoc(participantRef(db, id), participantData(ownerUid));
}

async function createLinkedParticipant(db, actorUid, participantId, linkedUserUid) {
  const batch = writeBatch(db);
  batch.set(participantRef(db, participantId), participantData(actorUid, { linkedUserUid }));
  batch.set(participantLinkedUserRef(db, linkedUserUid), { participantId });
  return batch.commit();
}

function activityRef(db, id = "activity-a", targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "activityLogs", id);
}

function activityData(actorUid, action = "update") {
  return {
    actorUid,
    actorName: "テストユーザー",
    action,
    section: "production.flyer",
    sectionLabel: "チラシ・ポスター",
    changedFields: ["部数"],
    createdAt: serverTimestamp(),
  };
}

function inviteRef(db, email = invitedEmail, targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "memberInvites", email);
}

function inviteData(email = invitedEmail, role = "editor") {
  return {
    projectId,
    projectName: "Test performance",
    email,
    role,
    invitedByUid: ownerUid,
    invitedByName: "Owner",
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    acceptedAt: null,
    emailStatus: "not_sent",
    emailSentAt: null,
    emailLastError: null,
    emailSendCount: 0,
    emailLastAttemptAt: null,
  };
}

async function claimInvite(db, uid = invitedUid, email = invitedEmail, role = "editor", mutateProject = undefined, requirePending = true) {
  const invitation = inviteRef(db, email);
  const project = projectRef(db);
  const member = memberRef(db, uid);
  return runTransaction(db, async (transaction) => {
    const inviteSnapshot = await transaction.get(invitation);
    if (!inviteSnapshot.exists() || (requirePending && inviteSnapshot.data().status !== "pending")) throw new Error("invite not pending");
    transaction.update(project, mutateProject ?? { memberUids: arrayUnion(uid) });
    transaction.set(member, {
      uid,
      role,
      displayName: "Invited User",
      email,
      joinedAt: serverTimestamp(),
      profileUpdatedAt: serverTimestamp(),
    });
    transaction.update(invitation, {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

function feedbackRef(db, id = "feedback-a", targetProjectId = projectId) {
  return doc(db, "projects", targetProjectId, "feedback", id);
}

function feedbackData(reporterUid, reporterRole) {
  return {
    type: "bug",
    body: "保存時にエラーが出ました",
    status: "unreviewed",
    reporterUid,
    reporterName: "テストユーザー",
    reporterRole,
    currentPath: `/projects/${projectId}/production/flyer`,
    pageLabel: "チラシ・ポスター",
    adminNote: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedProject() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(projectRef(db), {
      title: "Test performance",
      memberUids: [ownerUid, editorUid, viewerUid],
      production: { venue: { note: "seed" } },
    });
    for (const [uid, role] of [
      [ownerUid, "owner"],
      [editorUid, "editor"],
      [viewerUid, "viewer"],
    ]) {
      await setDoc(memberRef(db, uid), { uid, role, email: `${uid}@example.test` });
    }
    await setDoc(taskRef(db), { title: "Seed task", done: false });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: testProjectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedProject();
});

after(async () => {
  await testEnv.cleanup();
});

describe("unauthenticated access", () => {
  it("denies project document and list reads", async () => {
    const db = firestoreFor();
    await assertFails(getDoc(projectRef(db)));
    await assertFails(getDocs(collection(db, "projects")));
    await assertFails(getDoc(memberRef(db, ownerUid)));
  });

  it("denies project, task, and member writes", async () => {
    const db = firestoreFor();
    await assertFails(setDoc(projectRef(db, "unauth-project"), { title: "No", memberUids: [] }));
    await assertFails(setDoc(taskRef(db, "unauth-task"), { title: "No" }));
    await assertFails(setDoc(memberRef(db, "unauth-user"), { uid: "unauth-user", role: "owner" }));
  });
});

describe("non-member access", () => {
  it("denies project, task, and member reads", async () => {
    const db = firestoreFor(outsiderUid);
    await assertFails(getDoc(projectRef(db)));
    await assertFails(getDoc(taskRef(db)));
    await assertFails(getDocs(collection(db, "projects", projectId, "members")));
  });

  it("denies edits and member management", async () => {
    const db = firestoreFor(outsiderUid);
    await assertFails(updateDoc(projectRef(db), { title: "No" }));
    await assertFails(updateDoc(projectRef(db), { "production.venue.note": "No", "revisions.venue": 1 }));
    await assertFails(updateDoc(taskRef(db), { done: true }));
    await assertFails(setDoc(memberRef(db, outsiderUid), { uid: outsiderUid, role: "viewer" }));
  });
});

describe("viewer role", () => {
  it("reads the project, production data, and tasks", async () => {
    const db = firestoreFor(viewerUid);
    const project = await assertSucceeds(getDoc(projectRef(db)));
    await assertSucceeds(getDoc(taskRef(db)));
    await assertSucceeds(getDocs(collection(db, "projects", projectId, "tasks")));
    if (project.data()?.production?.venue?.note !== "seed") {
      throw new Error("production data was not readable");
    }
  });

  it("cannot edit project, production data, tasks, members, or delete the project", async () => {
    const db = firestoreFor(viewerUid);
    await assertFails(updateDoc(projectRef(db), { title: "No" }));
    await assertFails(updateDoc(projectRef(db), { "production.venue.note": "No", "revisions.venue": 1 }));
    await assertFails(updateDoc(taskRef(db), { done: true }));
    await assertFails(setDoc(memberRef(db, outsiderUid), { uid: outsiderUid, role: "viewer" }));
    await assertFails(deleteDoc(projectRef(db)));
  });
});

describe("editor role", () => {
  it("reads and edits normal fields, production data, and tasks", async () => {
    const db = firestoreFor(editorUid);
    await assertSucceeds(getDoc(projectRef(db)));
    await assertSucceeds(updateDoc(projectRef(db), { title: "Edited" }));
    await assertSucceeds(updateDoc(projectRef(db), { "production.venue.note": "Edited", "revisions.venue": 1 }));
    await assertSucceeds(updateDoc(taskRef(db), { done: true }));
  });

  it("cannot change membership, delete the project, or self-escalate", async () => {
    const db = firestoreFor(editorUid);
    await assertFails(updateDoc(projectRef(db), { memberUids: arrayUnion(outsiderUid) }));
    await assertFails(setDoc(memberRef(db, outsiderUid), { uid: outsiderUid, role: "viewer" }));
    await assertFails(updateDoc(memberRef(db, editorUid), { role: "owner" }));
    await assertFails(deleteDoc(memberRef(db, viewerUid)));
    await assertFails(deleteDoc(projectRef(db)));
  });
});

describe("owner role", () => {
  it("lists only the projects available to each owner, editor, and viewer", async () => {
    const listProjectId = "owner-list-project";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(projectRef(db, listProjectId), {
        title: "Owner list performance",
        memberUids: [ownerUid],
      });
      await setDoc(memberRef(db, ownerUid, listProjectId), {
        uid: ownerUid,
        role: "owner",
        email: `${ownerUid}@example.test`,
      });
    });

    for (const [uid, expectedIds] of [
      [ownerUid, [listProjectId, projectId]],
      [editorUid, [projectId]],
      [viewerUid, [projectId]],
    ]) {
      const db = firestoreFor(uid);
      const snapshot = await assertSucceeds(getDocs(query(
        collection(db, "projects"),
        where("memberUids", "array-contains", uid),
      )));
      deepStrictEqual(snapshot.docs.map((project) => project.id).sort(), expectedIds.sort());
    }
  });

  it("returns no projects for a non-member using the same memberUids query", async () => {
    const db = firestoreFor(outsiderUid);
    const snapshot = await assertSucceeds(getDocs(query(
      collection(db, "projects"),
      where("memberUids", "array-contains", outsiderUid),
    )));
    strictEqual(snapshot.empty, true);
  });

  it("reads and edits project, production data, and tasks", async () => {
    const db = firestoreFor(ownerUid);
    await assertSucceeds(getDoc(projectRef(db)));
    await assertSucceeds(updateDoc(projectRef(db), { title: "Owner edit" }));
    await assertSucceeds(updateDoc(projectRef(db), { "production.venue.note": "Owner edit", "revisions.venue": 1 }));
    await assertSucceeds(updateDoc(taskRef(db), { done: true }));
  });

  it("adds a member, updates its role, and removes it with consistent batches", async () => {
    const db = firestoreFor(ownerUid);
    const addBatch = writeBatch(db);
    addBatch.set(memberRef(db, outsiderUid), { uid: outsiderUid, role: "viewer" });
    addBatch.update(projectRef(db), { memberUids: arrayUnion(outsiderUid) });
    await assertSucceeds(addBatch.commit());
    await assertSucceeds(updateDoc(memberRef(db, outsiderUid), { role: "editor", updatedAt: serverTimestamp() }));
    const removeBatch = writeBatch(db);
    removeBatch.delete(memberRef(db, outsiderUid));
    removeBatch.update(projectRef(db), { memberUids: arrayRemove(outsiderUid) });
    await assertSucceeds(removeBatch.commit());
  });

  it("rejects inconsistent member document and memberUids changes", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(setDoc(memberRef(db, outsiderUid), { uid: outsiderUid, role: "viewer" }));
    await assertFails(updateDoc(projectRef(db), { memberUids: arrayUnion(outsiderUid) }));
    await assertFails(deleteDoc(memberRef(db, viewerUid)));
    await assertFails(updateDoc(projectRef(db), { memberUids: arrayRemove(viewerUid) }));
  });

  it("cannot demote or remove itself, so an owner cannot reduce owners to zero", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(updateDoc(memberRef(db, ownerUid), { role: "editor" }));
    await assertFails(deleteDoc(memberRef(db, ownerUid)));
  });

  it("deletes tasks and then the project", async () => {
    const db = firestoreFor(ownerUid);
    await assertSucceeds(deleteDoc(taskRef(db)));
    await assertSucceeds(deleteDoc(projectRef(db)));
  });
});

describe("new project bootstrap", () => {
  it("allows one batch containing the creator as the sole owner", async () => {
    const db = firestoreFor(ownerUid);
    const id = "valid-bootstrap";
    const batch = writeBatch(db);
    batch.set(projectRef(db, id), { title: "New", memberUids: [ownerUid] });
    batch.set(memberRef(db, ownerUid, id), { uid: ownerUid, role: "owner" });
    await assertSucceeds(batch.commit());
  });

  it("denies project creation without the owner member document", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(setDoc(projectRef(db, "missing-member"), { title: "No", memberUids: [ownerUid] }));
  });

  it("denies an empty or different memberUids bootstrap", async () => {
    for (const [id, memberUids] of [["empty-members", []], ["different-member", [outsiderUid]]]) {
      const db = firestoreFor(ownerUid);
      const batch = writeBatch(db);
      batch.set(projectRef(db, id), { title: "No", memberUids });
      batch.set(memberRef(db, ownerUid, id), { uid: ownerUid, role: "owner" });
      await assertFails(batch.commit());
    }
  });

  it("denies making a different user the bootstrap owner", async () => {
    const db = firestoreFor(ownerUid);
    const id = "different-owner";
    const batch = writeBatch(db);
    batch.set(projectRef(db, id), { title: "No", memberUids: [outsiderUid] });
    batch.set(memberRef(db, outsiderUid, id), { uid: outsiderUid, role: "owner" });
    await assertFails(batch.commit());
  });

  it("denies bootstrap with a non-owner creator member", async () => {
    const db = firestoreFor(ownerUid);
    const id = "editor-bootstrap";
    const batch = writeBatch(db);
    batch.set(projectRef(db, id), { title: "No", memberUids: [ownerUid] });
    batch.set(memberRef(db, ownerUid, id), { uid: ownerUid, role: "editor" });
    await assertFails(batch.commit());
  });
});

describe("section revisions", () => {
  it("treats a missing revision as zero and permits exactly one matching increment", async () => {
    const db = firestoreFor(editorUid);
    await assertSucceeds(updateDoc(projectRef(db), {
      "production.flyer.flyer.quantity": 100,
      "revisions.flyer": 1,
    }));
    const project = await getDoc(projectRef(db));
    strictEqual(project.data()?.revisions?.flyer, 1);
  });

  it("accepts the matching independent revision for all seven protected sections", async () => {
    const db = firestoreFor(ownerUid);
    for (const update of [
      { performanceInfo: { title: "Title" }, "revisions.performanceInfo": 1 },
      { "production.venue.note": "Venue", "revisions.venue": 1 },
      { "production.flyer.flyer.quantity": 100, "revisions.flyer": 1 },
      { "production.web.channels.website": true, "revisions.web": 1 },
      { "production.tickets.methods.online": true, "revisions.ticket": 1 },
      { "production.reception.basic.gatheringTime": "17:00", "revisions.reception": 1 },
      { "production.accounting.tasks": [], "revisions.accounting": 1 },
    ]) {
      await assertSucceeds(updateDoc(projectRef(db), update));
    }
  });

  it("rejects missing, skipped, unrelated, and multi-section revision changes", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(updateDoc(projectRef(db), { "production.flyer.flyer.quantity": 100 }));
    await assertFails(updateDoc(projectRef(db), { "production.flyer.flyer.quantity": 100, "revisions.flyer": 2 }));
    await assertFails(updateDoc(projectRef(db), { "production.flyer.flyer.quantity": 100, "revisions.accounting": 1 }));
    await assertFails(updateDoc(projectRef(db), {
      "production.flyer.flyer.quantity": 100,
      "production.accounting.tasks": [],
      "revisions.flyer": 1,
      "revisions.accounting": 1,
    }));
    await assertFails(updateDoc(projectRef(db), { "revisions.flyer": 1 }));
  });
});

describe("rehearsals", () => {
  it("allows owners and editors to read, create, update, and delete", async () => {
    for (const [uid, id] of [[ownerUid, "owner-rehearsal"], [editorUid, "editor-rehearsal"]]) {
      const db = firestoreFor(uid);
      const ref = rehearsalRef(db, id);
      await assertSucceeds(setDoc(ref, rehearsalData(uid)));
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(updateDoc(ref, { venue: "和室", revision: 1, updatedAt: serverTimestamp(), updatedByUid: uid }));
      await assertSucceeds(deleteDoc(ref));
    }
  });

  it("allows viewers to read but denies all writes", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(rehearsalRef(context.firestore()), { ...rehearsalData(ownerUid), createdAt: new Date(), updatedAt: new Date() });
    });
    const db = firestoreFor(viewerUid);
    await assertSucceeds(getDoc(rehearsalRef(db)));
    await assertSucceeds(getDocs(collection(db, "projects", projectId, "rehearsals")));
    await assertFails(setDoc(rehearsalRef(db, "viewer-create"), rehearsalData(viewerUid)));
    await assertFails(updateDoc(rehearsalRef(db), { venue: "改ざん", revision: 1, updatedAt: serverTimestamp(), updatedByUid: viewerUid }));
    await assertFails(deleteDoc(rehearsalRef(db)));
  });

  it("denies every operation to non-members", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(rehearsalRef(context.firestore()), { ...rehearsalData(ownerUid), createdAt: new Date(), updatedAt: new Date() });
    });
    const db = firestoreFor(outsiderUid);
    await assertFails(getDoc(rehearsalRef(db)));
    await assertFails(getDocs(collection(db, "projects", projectId, "rehearsals")));
    await assertFails(setDoc(rehearsalRef(db, "outsider-create"), rehearsalData(outsiderUid)));
    await assertFails(updateDoc(rehearsalRef(db), { venue: "改ざん", revision: 1, updatedAt: serverTimestamp(), updatedByUid: outsiderUid }));
    await assertFails(deleteDoc(rehearsalRef(db)));
  });

  it("rejects invalid types and custom type combinations", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(setDoc(rehearsalRef(db, "invalid-type"), rehearsalData(ownerUid, { type: "dance" })));
    await assertFails(setDoc(rehearsalRef(db, "removed-reading"), rehearsalData(ownerUid, { type: "reading" })));
    await assertFails(setDoc(rehearsalRef(db, "removed-run-through"), rehearsalData(ownerUid, { type: "run_through" })));
    await assertFails(setDoc(rehearsalRef(db, "other-empty"), rehearsalData(ownerUid, { type: "other", customType: "" })));
    await assertFails(setDoc(rehearsalRef(db, "acting-custom"), rehearsalData(ownerUid, { type: "acting", customType: "自主稽古" })));
    await assertSucceeds(setDoc(rehearsalRef(db, "meeting-valid"), rehearsalData(ownerUid, { type: "meeting" })));
    await assertSucceeds(setDoc(rehearsalRef(db, "other-valid"), rehearsalData(ownerUid, { type: "other", customType: "自主稽古" })));
  });

  it("rejects endAt at or before startAt and oversized text", async () => {
    const db = firestoreFor(editorUid);
    await assertFails(setDoc(rehearsalRef(db, "equal-time"), rehearsalData(editorUid, { endAt: new Date("2026-11-15T04:00:00Z") })));
    await assertFails(setDoc(rehearsalRef(db, "before-time"), rehearsalData(editorUid, { endAt: new Date("2026-11-15T03:59:00Z") })));
    await assertFails(setDoc(rehearsalRef(db, "long-venue"), rehearsalData(editorUid, { venue: "a".repeat(201) })));
  });

  it("rejects revision skipping, UID impersonation, and non-server timestamps", async () => {
    const db = firestoreFor(editorUid);
    await assertFails(setDoc(rehearsalRef(db, "bad-revision"), rehearsalData(editorUid, { revision: 1 })));
    await assertFails(setDoc(rehearsalRef(db, "uid-spoof"), rehearsalData(ownerUid)));
    await assertFails(setDoc(rehearsalRef(db, "bad-created-time"), rehearsalData(editorUid, { createdAt: new Date(0) })));
    await assertFails(setDoc(rehearsalRef(db, "bad-updated-time"), rehearsalData(editorUid, { updatedAt: new Date(0) })));
  });

  it("rejects revision jumps, creator metadata changes, and extra fields on update", async () => {
    const db = firestoreFor(ownerUid);
    const ref = rehearsalRef(db, "protected-update");
    await assertSucceeds(setDoc(ref, rehearsalData(ownerUid)));
    await assertFails(updateDoc(ref, { revision: 2, updatedAt: serverTimestamp(), updatedByUid: ownerUid }));
    await assertFails(updateDoc(ref, { revision: 1, createdByUid: editorUid, updatedAt: serverTimestamp(), updatedByUid: ownerUid }));
    await assertFails(updateDoc(ref, { revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByUid: ownerUid }));
    await assertFails(updateDoc(ref, { revision: 1, unexpected: true, updatedAt: serverTimestamp(), updatedByUid: ownerUid }));
  });

  it("rejects fields outside the rehearsal schema on create", async () => {
    await assertFails(setDoc(rehearsalRef(firestoreFor(ownerUid), "extra-field"), rehearsalData(ownerUid, { date: "2026-11-15" })));
  });

  it("keeps legacy removed types readable and allows an editor to convert them to acting", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(rehearsalRef(context.firestore(), "legacy-reading"), {
        ...rehearsalData(ownerUid, { type: "reading" }),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const db = firestoreFor(editorUid);
    await assertSucceeds(getDoc(rehearsalRef(db, "legacy-reading")));
    await assertSucceeds(updateDoc(rehearsalRef(db, "legacy-reading"), {
      type: "acting",
      revision: 1,
      updatedAt: serverTimestamp(),
      updatedByUid: editorUid,
    }));
  });
});

describe("participants", () => {
  it("allows owners and editors to create and update participants", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const editorDb = firestoreFor(editorUid);
    await assertSucceeds(setDoc(participantRef(ownerDb, "owner-created"), participantData(ownerUid)));
    await assertSucceeds(setDoc(participantRef(editorDb, "editor-created"), participantData(editorUid, { specialPractice: "stage_combat" })));
    await assertSucceeds(updateDoc(participantRef(editorDb, "owner-created"), {
      displayName: "更新参加者",
      active: false,
      updatedAt: serverTimestamp(),
      updatedByUid: editorUid,
    }));
    const updated = await getDoc(participantRef(ownerDb, "owner-created"));
    strictEqual(updated.data()?.active, false);
  });

  it("allows viewers to read participants but denies their writes", async () => {
    await assertSucceeds(setDoc(participantRef(firestoreFor(ownerUid)), participantData(ownerUid)));
    const viewerDb = firestoreFor(viewerUid);
    await assertSucceeds(getDocs(collection(viewerDb, "projects", projectId, "participants")));
    await assertFails(setDoc(participantRef(viewerDb, "viewer-created"), participantData(viewerUid)));
    await assertFails(updateDoc(participantRef(viewerDb), {
      active: false,
      updatedAt: serverTimestamp(),
      updatedByUid: viewerUid,
    }));
    await assertFails(deleteDoc(participantRef(viewerDb)));
  });

  it("denies non-member reads and writes", async () => {
    const db = firestoreFor(outsiderUid);
    await assertFails(getDocs(collection(db, "projects", projectId, "participants")));
    await assertFails(setDoc(participantRef(db), participantData(outsiderUid)));
  });

  it("validates display name, special practice, linked UID, active, and schema", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(setDoc(participantRef(db, "empty-name"), participantData(ownerUid, { displayName: "" })));
    await assertFails(setDoc(participantRef(db, "bad-special"), participantData(ownerUid, { specialPractice: "acting" })));
    await assertFails(setDoc(participantRef(db, "bad-active"), participantData(ownerUid, { active: "yes" })));
    await assertFails(setDoc(participantRef(db, "bad-linked"), participantData(ownerUid, { linkedUserUid: 42 })));
    await assertFails(setDoc(participantRef(db, "extra-field"), participantData(ownerUid, { privateNote: "不可" })));
    await assertSucceeds(setDoc(participantRef(db, "null-linked"), participantData(ownerUid, { linkedUserUid: null, active: false })));
    await assertSucceeds(setDoc(participantRef(db, "dance"), participantData(ownerUid, { specialPractice: "japanese_dance" })));
  });

  it("requires a matching internal link and prevents duplicate linked users", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(setDoc(participantRef(db, "missing-link"), participantData(ownerUid, { linkedUserUid: editorUid })));
    await assertSucceeds(createLinkedParticipant(db, ownerUid, "linked-first", editorUid));

    const duplicate = writeBatch(db);
    duplicate.set(participantRef(db, "linked-second"), participantData(ownerUid, { linkedUserUid: editorUid }));
    duplicate.set(participantLinkedUserRef(db, editorUid), { participantId: "linked-second" });
    await assertFails(duplicate.commit());
  });

  it("accepts null or a current project member UID and rejects a non-member UID", async () => {
    const db = firestoreFor(ownerUid);
    await assertSucceeds(setDoc(participantRef(db, "unlinked"), participantData(ownerUid, { linkedUserUid: null })));
    await assertSucceeds(createLinkedParticipant(db, ownerUid, "linked-member", editorUid));

    const nonMember = writeBatch(db);
    nonMember.set(participantRef(db, "linked-outsider"), participantData(ownerUid, { linkedUserUid: outsiderUid }));
    nonMember.set(participantLinkedUserRef(db, outsiderUid), { participantId: "linked-outsider" });
    await assertFails(nonMember.commit());
  });

  it("allows an editor to change or clear a linked user atomically", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await assertSucceeds(createLinkedParticipant(ownerDb, ownerUid, "linked", editorUid));
    const editorDb = firestoreFor(editorUid);
    const change = writeBatch(editorDb);
    change.update(participantRef(editorDb, "linked"), {
      linkedUserUid: viewerUid,
      updatedAt: serverTimestamp(),
      updatedByUid: editorUid,
    });
    change.delete(participantLinkedUserRef(editorDb, editorUid));
    change.set(participantLinkedUserRef(editorDb, viewerUid), { participantId: "linked" });
    await assertSucceeds(change.commit());

    const nonMemberChange = writeBatch(editorDb);
    nonMemberChange.update(participantRef(editorDb, "linked"), {
      linkedUserUid: outsiderUid,
      updatedAt: serverTimestamp(),
      updatedByUid: editorUid,
    });
    nonMemberChange.delete(participantLinkedUserRef(editorDb, viewerUid));
    nonMemberChange.set(participantLinkedUserRef(editorDb, outsiderUid), { participantId: "linked" });
    await assertFails(nonMemberChange.commit());

    const clear = writeBatch(editorDb);
    clear.update(participantRef(editorDb, "linked"), {
      linkedUserUid: null,
      updatedAt: serverTimestamp(),
      updatedByUid: editorUid,
    });
    clear.delete(participantLinkedUserRef(editorDb, viewerUid));
    await assertSucceeds(clear.commit());
  });

  it("protects creator metadata and disallows document deletion", async () => {
    const db = firestoreFor(ownerUid);
    await assertSucceeds(setDoc(participantRef(db), participantData(ownerUid)));
    await assertFails(updateDoc(participantRef(db), {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: ownerUid,
    }));
    await assertFails(updateDoc(participantRef(db), {
      createdByUid: editorUid,
      updatedAt: serverTimestamp(),
      updatedByUid: ownerUid,
    }));
    await assertFails(deleteDoc(participantRef(db)));
  });
});

describe("attendance records", () => {
  it("allows owners and editors to create and update records for an existing participant", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await createAttendanceParticipant(ownerDb);
    await assertSucceeds(setDoc(attendanceRef(ownerDb), attendanceData(ownerUid)));

    const editorDb = firestoreFor(editorUid);
    await assertSucceeds(updateDoc(attendanceRef(editorDb), {
      status: "tentative",
      availableFrom: null,
      availableUntil: null,
      publicNote: "確認中",
      updatedAt: serverTimestamp(),
      updatedByUid: editorUid,
    }));
  });

  it("allows viewer reads but denies viewer creates and updates", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await createAttendanceParticipant(ownerDb);
    await assertSucceeds(setDoc(attendanceRef(ownerDb), attendanceData(ownerUid)));
    const viewerDb = firestoreFor(viewerUid);
    await assertSucceeds(getDocs(collection(viewerDb, "projects", projectId, "attendanceRecords")));
    await assertFails(setDoc(attendanceRef(viewerDb, "2026-11-04"), attendanceData(viewerUid, { date: "2026-11-04" })));
    await assertFails(updateDoc(attendanceRef(viewerDb), {
      publicNote: "改ざん",
      updatedAt: serverTimestamp(),
      updatedByUid: viewerUid,
    }));
  });

  it("denies non-member reads and writes", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await createAttendanceParticipant(ownerDb);
    await assertSucceeds(setDoc(attendanceRef(ownerDb), attendanceData(ownerUid)));
    const outsiderDb = firestoreFor(outsiderUid);
    await assertFails(getDocs(collection(outsiderDb, "projects", projectId, "attendanceRecords")));
    await assertFails(setDoc(attendanceRef(outsiderDb, "2026-11-04"), attendanceData(outsiderUid, { date: "2026-11-04" })));
  });

  it("requires an existing participant and a deterministic document ID", async () => {
    const db = firestoreFor(ownerUid);
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid)));
    await createAttendanceParticipant(db);
    await assertFails(setDoc(doc(db, "projects", projectId, "attendanceRecords", "random-id"), attendanceData(ownerUid)));
    await assertSucceeds(setDoc(attendanceRef(db), attendanceData(ownerUid)));
  });

  it("validates status, dates, times, notes, and the exact schema", async () => {
    const db = firestoreFor(ownerUid);
    await createAttendanceParticipant(db);
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid, { status: "unanswered" })));
    await assertFails(setDoc(attendanceRef(db, "2026-13-03"), attendanceData(ownerUid, { date: "2026-13-03" })));
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid, { availableFrom: "9:00" })));
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid, { availableFrom: "16:30", availableUntil: "16:30" })));
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid, { status: "absent" })));
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid, { status: "tentative", availableFrom: null })));
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid, { publicNote: "a".repeat(2001) })));
    await assertFails(setDoc(attendanceRef(db), attendanceData(ownerUid, { privateNote: "不可" })));
    await assertSucceeds(setDoc(attendanceRef(db), attendanceData(ownerUid)));
  });

  it("accepts null times for absent and tentative", async () => {
    const db = firestoreFor(ownerUid);
    await createAttendanceParticipant(db);
    await assertSucceeds(setDoc(attendanceRef(db), attendanceData(ownerUid, {
      status: "absent", availableFrom: null, availableUntil: null,
    })));
    await assertSucceeds(setDoc(attendanceRef(db, "2026-11-04"), attendanceData(ownerUid, {
      date: "2026-11-04", status: "tentative", availableFrom: null, availableUntil: null,
    })));
  });

  it("protects creator metadata and immutable participant and date fields", async () => {
    const db = firestoreFor(ownerUid);
    await createAttendanceParticipant(db);
    await setDoc(participantRef(db, "participant-b"), participantData(ownerUid));
    await assertSucceeds(setDoc(attendanceRef(db), attendanceData(ownerUid)));
    await assertFails(updateDoc(attendanceRef(db), {
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedByUid: ownerUid,
    }));
    await assertFails(updateDoc(attendanceRef(db), {
      createdByUid: editorUid, updatedAt: serverTimestamp(), updatedByUid: ownerUid,
    }));
    await assertFails(updateDoc(attendanceRef(db), {
      participantId: "participant-b", updatedAt: serverTimestamp(), updatedByUid: ownerUid,
    }));
    await assertFails(updateDoc(attendanceRef(db), {
      date: "2026-11-04", updatedAt: serverTimestamp(), updatedByUid: ownerUid,
    }));
  });

  it("denies deletion for every member role", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await createAttendanceParticipant(ownerDb);
    await assertSucceeds(setDoc(attendanceRef(ownerDb), attendanceData(ownerUid)));
    await assertFails(deleteDoc(attendanceRef(ownerDb)));
    await assertFails(deleteDoc(attendanceRef(firestoreFor(editorUid))));
    await assertFails(deleteDoc(attendanceRef(firestoreFor(viewerUid))));
  });

  it("allows a viewer to create and update only their linked active participant attendance", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await assertSucceeds(createLinkedParticipant(ownerDb, ownerUid, "viewer-participant", viewerUid));
    const viewerDb = firestoreFor(viewerUid);
    const selfRef = attendanceRef(viewerDb, "2026-11-03", "viewer-participant");
    await assertSucceeds(setDoc(selfRef, attendanceData(viewerUid, { participantId: "viewer-participant" })));
    await assertSucceeds(updateDoc(selfRef, {
      status: "tentative",
      availableFrom: null,
      availableUntil: null,
      publicNote: "確認中",
      updatedAt: serverTimestamp(),
      updatedByUid: viewerUid,
    }));
  });

  it("denies a viewer from creating or updating another participant attendance", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await assertSucceeds(createLinkedParticipant(ownerDb, ownerUid, "viewer-participant", viewerUid));
    await assertSucceeds(setDoc(participantRef(ownerDb, "other-participant"), participantData(ownerUid)));
    await assertSucceeds(setDoc(attendanceRef(ownerDb, "2026-11-03", "other-participant"), attendanceData(ownerUid, { participantId: "other-participant" })));
    const viewerDb = firestoreFor(viewerUid);
    await assertFails(setDoc(attendanceRef(viewerDb, "2026-11-04", "other-participant"), attendanceData(viewerUid, {
      participantId: "other-participant", date: "2026-11-04",
    })));
    await assertFails(updateDoc(attendanceRef(viewerDb, "2026-11-03", "other-participant"), {
      publicNote: "改ざん",
      updatedAt: serverTimestamp(),
      updatedByUid: viewerUid,
    }));
  });

  it("denies self writes when the viewer is unlinked or the participant is inactive", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await assertSucceeds(setDoc(participantRef(ownerDb, "unlinked"), participantData(ownerUid)));
    const viewerDb = firestoreFor(viewerUid);
    await assertFails(setDoc(attendanceRef(viewerDb, "2026-11-03", "unlinked"), attendanceData(viewerUid, { participantId: "unlinked" })));

    const inactive = writeBatch(ownerDb);
    inactive.set(participantRef(ownerDb, "inactive"), participantData(ownerUid, { linkedUserUid: viewerUid, active: false }));
    inactive.set(participantLinkedUserRef(ownerDb, viewerUid), { participantId: "inactive" });
    await assertSucceeds(inactive.commit());
    await assertFails(setDoc(attendanceRef(viewerDb, "2026-11-03", "inactive"), attendanceData(viewerUid, { participantId: "inactive" })));
  });

  it("denies viewer participant and audit UID impersonation", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await assertSucceeds(createLinkedParticipant(ownerDb, ownerUid, "viewer-participant", viewerUid));
    await assertSucceeds(setDoc(participantRef(ownerDb, "other-participant"), participantData(ownerUid)));
    const viewerDb = firestoreFor(viewerUid);
    await assertFails(setDoc(attendanceRef(viewerDb, "2026-11-03", "viewer-participant"), attendanceData(viewerUid, {
      participantId: "other-participant",
    })));
    await assertFails(setDoc(attendanceRef(viewerDb, "2026-11-03", "viewer-participant"), attendanceData(ownerUid, {
      participantId: "viewer-participant",
      updatedByUid: viewerUid,
    })));
    await assertFails(setDoc(attendanceRef(viewerDb, "2026-11-03", "viewer-participant"), attendanceData(viewerUid, {
      participantId: "viewer-participant",
      updatedByUid: ownerUid,
    })));
  });

  it("revokes viewer self-write access after the participant link changes", async () => {
    const ownerDb = firestoreFor(ownerUid);
    await assertSucceeds(createLinkedParticipant(ownerDb, ownerUid, "viewer-participant", viewerUid));
    const viewerDb = firestoreFor(viewerUid);
    const selfRef = attendanceRef(viewerDb, "2026-11-03", "viewer-participant");
    await assertSucceeds(setDoc(selfRef, attendanceData(viewerUid, { participantId: "viewer-participant" })));

    const relink = writeBatch(ownerDb);
    relink.update(participantRef(ownerDb, "viewer-participant"), {
      linkedUserUid: editorUid,
      updatedAt: serverTimestamp(),
      updatedByUid: ownerUid,
    });
    relink.delete(participantLinkedUserRef(ownerDb, viewerUid));
    relink.set(participantLinkedUserRef(ownerDb, editorUid), { participantId: "viewer-participant" });
    await assertSucceeds(relink.commit());
    await assertFails(updateDoc(selfRef, {
      publicNote: "旧ユーザー更新",
      updatedAt: serverTimestamp(),
      updatedByUid: viewerUid,
    }));
  });
});

describe("activity logs", () => {
  it("allows owners and editors to create a log for themselves", async () => {
    await assertSucceeds(setDoc(activityRef(firestoreFor(ownerUid), "owner-log"), activityData(ownerUid)));
    await assertSucceeds(setDoc(activityRef(firestoreFor(editorUid), "editor-log"), activityData(editorUid)));
    await assertSucceeds(setDoc(activityRef(firestoreFor(ownerUid), "create-log"), activityData(ownerUid, "create")));
    await assertSucceeds(setDoc(activityRef(firestoreFor(editorUid), "delete-log"), activityData(editorUid, "delete")));
  });

  it("denies viewers from creating a log", async () => {
    await assertFails(setDoc(activityRef(firestoreFor(viewerUid)), activityData(viewerUid)));
  });

  it("allows members to read logs", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(activityRef(context.firestore()), {
        ...activityData(ownerUid),
        createdAt: new Date(),
      });
    });
    await assertSucceeds(getDoc(activityRef(firestoreFor(ownerUid))));
    await assertSucceeds(getDocs(collection(firestoreFor(viewerUid), "projects", projectId, "activityLogs")));
  });

  it("denies non-members from reading logs", async () => {
    await assertFails(getDocs(collection(firestoreFor(outsiderUid), "projects", projectId, "activityLogs")));
  });

  it("denies updates and deletes even by owners", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(activityRef(context.firestore()), {
        ...activityData(ownerUid),
        createdAt: new Date(),
      });
    });
    const ref = activityRef(firestoreFor(ownerUid));
    await assertFails(updateDoc(ref, { sectionLabel: "改ざん" }));
    await assertFails(deleteDoc(ref));
  });

  it("denies actorUid impersonation", async () => {
    await assertFails(setDoc(activityRef(firestoreFor(editorUid)), activityData(ownerUid)));
  });
});

describe("feedback", () => {
  it("allows owners, editors, and viewers to create their own feedback", async () => {
    await assertSucceeds(setDoc(feedbackRef(firestoreFor(ownerUid), "owner-feedback"), feedbackData(ownerUid, "owner")));
    await assertSucceeds(setDoc(feedbackRef(firestoreFor(editorUid), "editor-feedback"), feedbackData(editorUid, "editor")));
    await assertSucceeds(setDoc(feedbackRef(firestoreFor(viewerUid), "viewer-feedback"), feedbackData(viewerUid, "viewer")));
  });

  it("denies feedback creation by a non-member", async () => {
    await assertFails(setDoc(feedbackRef(firestoreFor(outsiderUid)), feedbackData(outsiderUid, "viewer")));
  });

  it("allows members to read feedback and denies non-members", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(feedbackRef(context.firestore()), { ...feedbackData(ownerUid, "owner"), createdAt: new Date(), updatedAt: new Date() });
    });
    await assertSucceeds(getDoc(feedbackRef(firestoreFor(ownerUid))));
    await assertSucceeds(getDocs(collection(firestoreFor(editorUid), "projects", projectId, "feedback")));
    await assertSucceeds(getDocs(collection(firestoreFor(viewerUid), "projects", projectId, "feedback")));
    await assertFails(getDoc(feedbackRef(firestoreFor(outsiderUid))));
  });

  it("denies reporter UID and role impersonation", async () => {
    await assertFails(setDoc(feedbackRef(firestoreFor(editorUid), "uid-spoof"), feedbackData(ownerUid, "editor")));
    await assertFails(setDoc(feedbackRef(firestoreFor(editorUid), "role-spoof"), feedbackData(editorUid, "owner")));
  });

  it("requires the initial status, empty admin note, and server timestamps", async () => {
    await assertFails(setDoc(feedbackRef(firestoreFor(viewerUid), "status-spoof"), { ...feedbackData(viewerUid, "viewer"), status: "resolved" }));
    await assertFails(setDoc(feedbackRef(firestoreFor(viewerUid), "note-spoof"), { ...feedbackData(viewerUid, "viewer"), adminNote: "事前メモ" }));
    await assertFails(setDoc(feedbackRef(firestoreFor(viewerUid), "time-spoof"), { ...feedbackData(viewerUid, "viewer"), createdAt: new Date(0) }));
  });

  it("allows an owner to update only status, admin note, and updatedAt", async () => {
    const ref = feedbackRef(firestoreFor(ownerUid));
    await assertSucceeds(setDoc(ref, feedbackData(ownerUid, "owner")));
    await assertSucceeds(updateDoc(ref, { status: "planned", adminNote: "次回対応", updatedAt: serverTimestamp() }));
    const feedback = await getDoc(ref);
    strictEqual(feedback.data()?.status, "planned");
    strictEqual(feedback.data()?.adminNote, "次回対応");
  });

  it("denies feedback updates by editors and viewers", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(feedbackRef(context.firestore()), { ...feedbackData(viewerUid, "viewer"), createdAt: new Date(), updatedAt: new Date() });
    });
    const update = { status: "resolved", adminNote: "対応済み", updatedAt: serverTimestamp() };
    await assertFails(updateDoc(feedbackRef(firestoreFor(editorUid)), update));
    await assertFails(updateDoc(feedbackRef(firestoreFor(viewerUid)), update));
  });

  it("denies body and reporter metadata changes even by an owner", async () => {
    const ref = feedbackRef(firestoreFor(ownerUid));
    await assertSucceeds(setDoc(ref, feedbackData(ownerUid, "owner")));
    await assertFails(updateDoc(ref, { body: "改ざん", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { reporterName: "別人", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { reporterUid: editorUid, updatedAt: serverTimestamp() }));
  });

  it("denies feedback deletion for every role", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(feedbackRef(context.firestore()), { ...feedbackData(ownerUid, "owner"), createdAt: new Date(), updatedAt: new Date() });
    });
    await assertFails(deleteDoc(feedbackRef(firestoreFor(ownerUid))));
    await assertFails(deleteDoc(feedbackRef(firestoreFor(editorUid))));
    await assertFails(deleteDoc(feedbackRef(firestoreFor(viewerUid))));
  });
});

describe("member profile sync", () => {
  it("allows a member to synchronize only their own display name and email", async () => {
    const db = firestoreFor(editorUid);
    await assertSucceeds(updateDoc(memberRef(db, editorUid), {
      displayName: "Editor Name",
      email: `${editorUid}@example.test`,
      profileUpdatedAt: serverTimestamp(),
    }));
    const member = await getDoc(memberRef(db, editorUid));
    strictEqual(member.data()?.displayName, "Editor Name");
    strictEqual(member.data()?.role, "editor");
  });

  it("denies self role changes and changes to another member profile", async () => {
    const editorDb = firestoreFor(editorUid);
    await assertFails(updateDoc(memberRef(editorDb, editorUid), { role: "owner", profileUpdatedAt: serverTimestamp() }));
    await assertFails(updateDoc(memberRef(editorDb, viewerUid), {
      displayName: "Changed",
      email: `${editorUid}@example.test`,
      profileUpdatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(memberRef(firestoreFor(ownerUid), viewerUid), {
      displayName: "Owner changed this",
      email: `${viewerUid}@example.test`,
      profileUpdatedAt: serverTimestamp(),
    }));
  });
});

describe("member invites", () => {
  it("allows only an owner to create editor or viewer invites", async () => {
    await assertSucceeds(setDoc(inviteRef(firestoreFor(ownerUid)), inviteData()));
    await assertFails(setDoc(inviteRef(firestoreFor(editorUid), "editor-target@example.test"), inviteData("editor-target@example.test")));
    await assertFails(setDoc(inviteRef(firestoreFor(viewerUid), "viewer-target@example.test"), inviteData("viewer-target@example.test")));
    await assertFails(setDoc(inviteRef(firestoreFor(outsiderUid), "outsider-target@example.test"), inviteData("outsider-target@example.test")));
    await assertFails(setDoc(inviteRef(firestoreFor(ownerUid), "owner-target@example.test"), inviteData("owner-target@example.test", "owner")));
  });

  it("prevents duplicate pending invites at the deterministic email path", async () => {
    const ref = inviteRef(firestoreFor(ownerUid));
    await assertSucceeds(setDoc(ref, inviteData()));
    await assertFails(setDoc(ref, inviteData()));
  });

  it("allows only an owner to restart a revoked invite with a new role and reset delivery state", async () => {
    const ownerDb = firestoreFor(ownerUid);
    const ref = inviteRef(ownerDb);
    await assertSucceeds(setDoc(ref, inviteData()));
    await assertSucceeds(updateDoc(ref, { status: "revoked", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(inviteRef(firestoreFor(editorUid)), inviteData(invitedEmail, "viewer")));
    await assertFails(setDoc(inviteRef(firestoreFor(viewerUid)), inviteData(invitedEmail, "viewer")));
    await assertSucceeds(setDoc(ref, inviteData(invitedEmail, "viewer")));
    const restarted = (await getDoc(ref)).data();
    strictEqual(restarted?.status, "pending");
    strictEqual(restarted?.role, "viewer");
    strictEqual(restarted?.acceptedAt, null);
    strictEqual(restarted?.emailStatus, "not_sent");
    strictEqual(restarted?.emailSentAt, null);
    strictEqual(restarted?.emailLastError, null);
    strictEqual(restarted?.emailSendCount, 0);
    strictEqual(restarted?.emailLastAttemptAt, null);
  });

  it("allows an owner to restart accepted history after the member is no longer present", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(inviteRef(context.firestore()), {
        ...inviteData(),
        status: "accepted",
        acceptedAt: new Date("2026-10-01T00:00:00Z"),
        emailStatus: "sent",
        emailSentAt: new Date("2026-09-30T00:00:00Z"),
        emailSendCount: 2,
        emailLastAttemptAt: new Date("2026-09-30T00:00:00Z"),
      });
    });
    const ownerDb = firestoreFor(ownerUid);
    await assertSucceeds(setDoc(inviteRef(ownerDb), inviteData(invitedEmail, "editor")));
    const restarted = (await getDoc(inviteRef(ownerDb))).data();
    strictEqual(restarted?.status, "pending");
    strictEqual(restarted?.acceptedAt, null);
    strictEqual(restarted?.emailStatus, "not_sent");
    strictEqual(restarted?.emailSendCount, 0);
  });

  it("prevents a client from forging the initial email delivery state", async () => {
    await assertFails(setDoc(inviteRef(firestoreFor(ownerUid)), {
      ...inviteData(),
      emailStatus: "sent",
      emailSentAt: serverTimestamp(),
      emailSendCount: 1,
      emailLastAttemptAt: serverTimestamp(),
    }));
  });

  it("allows an invitee to query only their own invites and an owner to list project invites", async () => {
    await assertSucceeds(setDoc(inviteRef(firestoreFor(ownerUid)), inviteData()));
    const invitedDb = firestoreForEmail(invitedUid, invitedEmail);
    await assertSucceeds(getDocs(query(collectionGroup(invitedDb, "memberInvites"), where("email", "==", invitedEmail))));
    await assertSucceeds(getDocs(collection(firestoreFor(ownerUid), "projects", projectId, "memberInvites")));
    await assertFails(getDoc(inviteRef(firestoreForEmail("other-invitee", "other@example.test"))));
  });

  it("allows an owner to revoke a pending invite without rewriting its content", async () => {
    const ref = inviteRef(firestoreFor(ownerUid));
    await assertSucceeds(setDoc(ref, inviteData()));
    await assertSucceeds(updateDoc(ref, { status: "revoked", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { status: "pending", role: "viewer", updatedAt: serverTimestamp() }));
  });

  it("atomically claims a pending invite with the invited role and profile", async () => {
    await assertSucceeds(setDoc(inviteRef(firestoreFor(ownerUid)), inviteData()));
    const invitedDb = firestoreForEmail(invitedUid, invitedEmail);
    await assertSucceeds(claimInvite(invitedDb));
    const project = await getDoc(projectRef(invitedDb));
    const member = await getDoc(memberRef(invitedDb, invitedUid));
    const invite = await getDoc(inviteRef(invitedDb));
    strictEqual(project.data()?.memberUids.includes(invitedUid), true);
    strictEqual(member.data()?.role, "editor");
    strictEqual(member.data()?.displayName, "Invited User");
    strictEqual(member.data()?.email, invitedEmail);
    strictEqual(invite.data()?.status, "accepted");
  });

  it("denies another email and a revoked invite from being claimed", async () => {
    await assertSucceeds(setDoc(inviteRef(firestoreFor(ownerUid)), inviteData()));
    await assertFails(claimInvite(firestoreForEmail("wrong-user", "wrong@example.test"), "wrong-user", invitedEmail));
    await assertSucceeds(updateDoc(inviteRef(firestoreFor(ownerUid)), { status: "revoked", updatedAt: serverTimestamp() }));
    await assertFails(claimInvite(firestoreForEmail(invitedUid, invitedEmail), invitedUid, invitedEmail, "editor", undefined, false));
  });

  it("denies role escalation and other memberUids changes during claim", async () => {
    await assertSucceeds(setDoc(inviteRef(firestoreFor(ownerUid)), inviteData()));
    const invitedDb = firestoreForEmail(invitedUid, invitedEmail);
    await assertFails(claimInvite(invitedDb, invitedUid, invitedEmail, "owner"));
    await assertFails(claimInvite(invitedDb, invitedUid, invitedEmail, "viewer"));
    await assertFails(claimInvite(invitedDb, invitedUid, invitedEmail, "editor", { memberUids: [invitedUid] }));
  });

  it("denies claiming the same invitation twice", async () => {
    await assertSucceeds(setDoc(inviteRef(firestoreFor(ownerUid)), inviteData()));
    const invitedDb = firestoreForEmail(invitedUid, invitedEmail);
    await assertSucceeds(claimInvite(invitedDb));
    await assertFails(claimInvite(invitedDb, invitedUid, invitedEmail, "editor", undefined, false));
  });
});
