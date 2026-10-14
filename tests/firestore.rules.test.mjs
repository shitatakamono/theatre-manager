import { readFile } from "node:fs/promises";
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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const testProjectId = "seisakuboard-rules-test";
const projectId = "performance-a";
const ownerUid = "owner-a";
const editorUid = "editor-a";
const viewerUid = "viewer-a";
const outsiderUid = "outsider-a";

let testEnv;

function firestoreFor(uid) {
  return uid
    ? testEnv.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore()
    : testEnv.unauthenticatedContext().firestore();
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
    await assertFails(updateDoc(projectRef(db), { "production.venue.note": "No" }));
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
    await assertFails(updateDoc(projectRef(db), { "production.venue.note": "No" }));
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
    await assertSucceeds(updateDoc(projectRef(db), { "production.venue.note": "Edited" }));
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
  it("reads and edits project, production data, and tasks", async () => {
    const db = firestoreFor(ownerUid);
    await assertSucceeds(getDoc(projectRef(db)));
    await assertSucceeds(updateDoc(projectRef(db), { title: "Owner edit" }));
    await assertSucceeds(updateDoc(projectRef(db), { "production.venue.note": "Owner edit" }));
    await assertSucceeds(updateDoc(taskRef(db), { done: true }));
  });

  it("adds a member, updates its role, and removes it with consistent batches", async () => {
    const db = firestoreFor(ownerUid);
    const addBatch = writeBatch(db);
    addBatch.set(memberRef(db, outsiderUid), { uid: outsiderUid, role: "viewer" });
    addBatch.update(projectRef(db), { memberUids: arrayUnion(outsiderUid) });
    await assertSucceeds(addBatch.commit());
    await assertSucceeds(updateDoc(memberRef(db, outsiderUid), { role: "editor" }));
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
