import { Timestamp } from "firebase-admin/firestore";

import type { ProjectRole } from "../auth.ts";
import {
  PROJECT_INVITE_LINK_TTL_MS,
  buildProjectInviteLinkUrl,
  getProjectInviteLinkDisplayStatus,
  type ProjectInviteLinkSummary,
  type ProjectInviteLinkStatus,
} from "../project-invite-links.ts";
import { generateProjectInviteLinkToken, hashProjectInviteLinkToken } from "./project-invite-link-token.ts";
import { getAppOrigin } from "../app-url.ts";
import { UserLinkReservationError } from "../user-link-reservations.ts";
import { adminDb } from "./firebase-admin.ts";
import { linkProjectPersonToUserInTransaction } from "./user-link-reservations.ts";

const COLLECTION = "projectInviteLinks";
const CREATE_ATTEMPTS = 3;

export class ProjectInviteLinkError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ProjectInviteLinkError";
    this.code = code;
    this.status = status;
  }
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("/") || normalized.length > 1500) {
    throw new ProjectInviteLinkError("invalid_request", 400, `${label}が不正です`);
  }
  return normalized;
}

function activity(action: "create" | "update", changedFields: string[], name: string, now: Timestamp) {
  return {
    actorName: name || "システム利用者",
    action,
    section: "members",
    sectionLabel: "システム利用者",
    changedFields,
    createdAt: now,
  };
}

function roleOf(snapshot: FirebaseFirestore.DocumentSnapshot): ProjectRole | null {
  const role = snapshot.data()?.role;
  return role === "owner" || role === "editor" || role === "viewer" ? role : null;
}

function iso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function storedStatus(value: unknown): ProjectInviteLinkStatus {
  if (value === "pending" || value === "claiming" || value === "claimed" || value === "revoked") return value;
  throw new ProjectInviteLinkError("invalid_invite", 409, "招待情報が不正です");
}

function displayStatus(data: FirebaseFirestore.DocumentData, nowMs = Date.now()) {
  const expiresAt = data.expiresAt;
  if (!(expiresAt instanceof Timestamp)) throw new ProjectInviteLinkError("invalid_invite", 409, "招待情報が不正です");
  return getProjectInviteLinkDisplayStatus({
    status: storedStatus(data.status),
    expiresAtMs: expiresAt.toMillis(),
    nowMs,
  });
}

function memberName(snapshot: FirebaseFirestore.DocumentSnapshot): string {
  const value = snapshot.data()?.displayName;
  return typeof value === "string" && value.trim() ? value.trim() : "システム利用者";
}

async function requireOwner(projectId: string, uid: string) {
  const projectRef = adminDb.collection("projects").doc(projectId);
  const member = await projectRef.collection("members").doc(uid).get();
  if (roleOf(member) !== "owner") {
    throw new ProjectInviteLinkError("forbidden", 403, "招待リンクを管理する権限がありません");
  }
  return { projectRef, member };
}

export async function createProjectInviteLink(input: {
  uid: string;
  projectId: string;
  personId?: string;
  appOrigin?: string;
}): Promise<{ invite: ProjectInviteLinkSummary; url: string }> {
  const projectId = requiredId(input.projectId, "公演ID");
  const personId = input.personId ? requiredId(input.personId, "関係者ID") : null;
  const { projectRef } = await requireOwner(projectId, input.uid);

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const rawToken = generateProjectInviteLinkToken();
    const inviteRef = adminDb.collection(COLLECTION).doc(hashProjectInviteLinkToken(rawToken));
    try {
      const invite = await adminDb.runTransaction(async (transaction) => {
        const memberRef = projectRef.collection("members").doc(input.uid);
        const personRef = personId ? projectRef.collection("people").doc(personId) : null;
        const [project, member, current, person] = await Promise.all([
          transaction.get(projectRef),
          transaction.get(memberRef),
          transaction.get(inviteRef),
          personRef ? transaction.get(personRef) : Promise.resolve(null),
        ]);
        if (!project.exists || roleOf(member) !== "owner") {
          throw new ProjectInviteLinkError("forbidden", 403, "招待リンクを管理する権限がありません");
        }
        if (current.exists) throw new ProjectInviteLinkError("token_collision", 409, "招待リンクを作成できませんでした");
        if (personRef && (!person?.exists || person.data()?.active !== true)) {
          throw new ProjectInviteLinkError("person_not_found", 404, "対象の関係者が見つかりません");
        }
        const now = Timestamp.now();
        const expiresAt = Timestamp.fromMillis(now.toMillis() + PROJECT_INVITE_LINK_TTL_MS);
        transaction.create(inviteRef, {
          projectId,
          role: "viewer",
          ...(personId ? { personId } : {}),
          status: "pending",
          createdAt: now,
          expiresAt,
          createdByUid: input.uid,
          claimedAt: null,
          claimedByUid: null,
          revokedAt: null,
          revokedByUid: null,
        });
        transaction.create(projectRef.collection("activityLogs").doc(), activity(
          "create",
          [personId ? "関係者指定招待リンクを作成" : "招待リンクを作成"],
          memberName(member),
          now
        ));
        return {
          id: inviteRef.id,
          status: "pending" as const,
          role: "viewer" as const,
          personId,
          personName: person ? String(person.data()?.displayName ?? "").trim() || null : null,
          createdAt: now.toDate().toISOString(),
          expiresAt: expiresAt.toDate().toISOString(),
          claimedAt: null,
        };
      });
      return { invite, url: buildProjectInviteLinkUrl(input.appOrigin ?? getAppOrigin(), rawToken) };
    } catch (error) {
      if (error instanceof ProjectInviteLinkError && error.code === "token_collision") continue;
      throw error;
    }
  }
  throw new ProjectInviteLinkError("create_failed", 500, "招待リンクを作成できませんでした");
}

export async function listProjectInviteLinks(input: {
  uid: string;
  projectId: string;
}): Promise<ProjectInviteLinkSummary[]> {
  const projectId = requiredId(input.projectId, "公演ID");
  const { projectRef } = await requireOwner(projectId, input.uid);
  const snapshot = await adminDb.collection(COLLECTION).where("projectId", "==", projectId).get();
  const personIds = [...new Set(snapshot.docs.flatMap((document) => {
    const value = document.data().personId;
    return typeof value === "string" && value ? [value] : [];
  }))];
  const people = await Promise.all(personIds.map((id) => projectRef.collection("people").doc(id).get()));
  const personNames = new Map(people.map((person) => [
    person.id,
    person.exists && typeof person.data()?.displayName === "string" ? person.data()!.displayName.trim() : null,
  ]));
  return snapshot.docs.map((document) => {
    const data = document.data();
    const personId = typeof data.personId === "string" ? data.personId : null;
    const expiresAt = iso(data.expiresAt);
    if (!expiresAt) throw new ProjectInviteLinkError("invalid_invite", 409, "招待情報が不正です");
    return {
      id: document.id,
      status: displayStatus(data),
      role: "viewer" as const,
      personId,
      personName: personId ? personNames.get(personId) ?? null : null,
      createdAt: iso(data.createdAt),
      expiresAt,
      claimedAt: iso(data.claimedAt),
    };
  }).sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

export async function revokeProjectInviteLink(input: {
  uid: string;
  projectId: string;
  inviteId: string;
}): Promise<void> {
  const projectId = requiredId(input.projectId, "公演ID");
  const inviteId = requiredId(input.inviteId, "招待ID");
  const { projectRef } = await requireOwner(projectId, input.uid);
  const inviteRef = adminDb.collection(COLLECTION).doc(inviteId);
  await adminDb.runTransaction(async (transaction) => {
    const memberRef = projectRef.collection("members").doc(input.uid);
    const [project, member, invite] = await Promise.all([
      transaction.get(projectRef), transaction.get(memberRef), transaction.get(inviteRef),
    ]);
    if (!project.exists || roleOf(member) !== "owner") throw new ProjectInviteLinkError("forbidden", 403, "招待リンクを管理する権限がありません");
    if (!invite.exists || invite.data()?.projectId !== projectId) throw new ProjectInviteLinkError("invite_not_found", 404, "招待リンクが見つかりません");
    if (invite.data()?.status !== "pending") throw new ProjectInviteLinkError("invite_not_pending", 409, "未使用の招待リンクだけを無効化できます");
    const now = Timestamp.now();
    transaction.update(inviteRef, { status: "revoked", revokedAt: now, revokedByUid: input.uid });
    transaction.create(projectRef.collection("activityLogs").doc(), activity("update", ["招待リンクを無効化"], memberName(member), now));
  });
}

export async function previewProjectInviteLink(rawToken: string): Promise<{
  projectName: string;
  role: "viewer";
  expiresAt: string;
  status: "pending" | "claimed" | "revoked" | "expired";
} | null> {
  let inviteRef: FirebaseFirestore.DocumentReference;
  try {
    inviteRef = adminDb.collection(COLLECTION).doc(hashProjectInviteLinkToken(rawToken));
  } catch {
    return null;
  }
  const invite = await inviteRef.get();
  if (!invite.exists) return null;
  const data = invite.data() ?? {};
  const projectId = typeof data.projectId === "string" ? data.projectId : "";
  const expiresAt = iso(data.expiresAt);
  if (!projectId || !expiresAt || data.role !== "viewer") return null;
  const project = await adminDb.collection("projects").doc(projectId).get();
  if (!project.exists) return null;
  const title = [project.data()?.performanceName, project.data()?.title]
    .find((value) => typeof value === "string" && value.trim());
  return {
    projectName: typeof title === "string" ? title.trim().slice(0, 200) : "公演",
    role: "viewer",
    expiresAt,
    status: displayStatus(data),
  };
}

export async function claimProjectInviteLink(input: {
  uid: string;
  displayName?: string;
  email?: string;
  rawToken: string;
}): Promise<{ projectId: string; outcome: "claimed" | "already_claimed"; personLinked: boolean }> {
  let inviteRef: FirebaseFirestore.DocumentReference;
  try {
    inviteRef = adminDb.collection(COLLECTION).doc(hashProjectInviteLinkToken(input.rawToken));
  } catch {
    throw new ProjectInviteLinkError("invite_not_found", 404, "招待リンクが見つかりません");
  }
  try {
    return await adminDb.runTransaction(async (transaction) => {
      const invite = await transaction.get(inviteRef);
      if (!invite.exists) throw new ProjectInviteLinkError("invite_not_found", 404, "招待リンクが見つかりません");
      const data = invite.data() ?? {};
      const projectId = requiredId(String(data.projectId ?? ""), "公演ID");
      if (data.role !== "viewer") throw new ProjectInviteLinkError("invalid_invite", 409, "招待情報が不正です");
      if (data.status === "claimed") {
        if (data.claimedByUid === input.uid) {
          return { projectId, outcome: "already_claimed" as const, personLinked: typeof data.personId === "string" };
        }
        throw new ProjectInviteLinkError("invite_used", 409, "この招待リンクは使用済みです");
      }
      if (data.status !== "pending") throw new ProjectInviteLinkError("invite_unavailable", 409, "この招待リンクは利用できません");
      if (!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= Date.now()) {
        throw new ProjectInviteLinkError("invite_expired", 410, "この招待リンクの有効期限が切れています");
      }

      const projectRef = adminDb.collection("projects").doc(projectId);
      const memberRef = projectRef.collection("members").doc(input.uid);
      const personId = typeof data.personId === "string" ? requiredId(data.personId, "関係者ID") : null;
      const personRef = personId ? projectRef.collection("people").doc(personId) : null;
      const [project, member, person] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(memberRef),
        personRef ? transaction.get(personRef) : Promise.resolve(null),
      ]);
      if (!project.exists) throw new ProjectInviteLinkError("project_not_found", 404, "招待された公演が見つかりません");
      const memberUids = Array.isArray(project.data()?.memberUids) ? project.data()!.memberUids as unknown[] : [];
      const inMemberUids = memberUids.includes(input.uid);
      if (member.exists !== inMemberUids) throw new ProjectInviteLinkError("membership_inconsistent", 409, "公演の利用者情報が不整合です");
      if (personRef && (!person?.exists || person.data()?.active !== true)) throw new ProjectInviteLinkError("person_not_found", 409, "招待された関係者が見つかりません");

      const now = Timestamp.now();
      const actorName = input.displayName?.trim() || "システム利用者";
      if (person && personId) {
        await linkProjectPersonToUserInTransaction({
          transaction,
          projectRef,
          person,
          personId,
          linkedUserUid: input.uid,
          actor: { uid: input.uid, name: actorName },
          now,
          activityRef: projectRef.collection("activityLogs").doc(),
          redactActivityActorUid: true,
        });
      }
      if (!member.exists) {
        transaction.update(projectRef, { memberUids: [...memberUids, input.uid] });
        transaction.create(memberRef, {
          uid: input.uid,
          role: "viewer",
          displayName: actorName,
          ...(input.email?.trim() ? { email: input.email.trim().toLowerCase() } : {}),
          joinedAt: now,
          profileUpdatedAt: now,
        });
      }
      transaction.update(inviteRef, {
        status: "claimed",
        claimedAt: now,
        claimedByUid: input.uid,
      });
      transaction.create(projectRef.collection("activityLogs").doc(), activity(
        "update",
        [personId ? "関係者指定招待から参加" : "招待リンクから参加"],
        actorName,
        now
      ));
      return { projectId, outcome: "claimed" as const, personLinked: Boolean(personId) };
    });
  } catch (error) {
    if (error instanceof UserLinkReservationError) {
      throw new ProjectInviteLinkError(
        "person_link_conflict",
        409,
        "この関係者はすでに別のSeisakuBoardユーザーと連携されています。"
      );
    }
    throw error;
  }
}
