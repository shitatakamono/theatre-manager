import { Timestamp } from "firebase-admin/firestore";

import {
  LINE_AUTH_STATE_TTL_MS,
  LINE_AUTH_TICKET_TTL_MS,
  LineAuthError,
  generateLineAuthState,
  generateLineAuthTicket,
  getLineAuthStateId,
  getLineAuthTicketId,
} from "../line-auth.ts";
import {
  generateLineLoginCodeVerifier,
  generateLineLoginNonce,
} from "../line-login.ts";
import { getLineUserLinkId, requireFirebaseUid, requireLineUserId } from "../line-account-link.ts";
import { adminDb } from "./firebase-admin.ts";
import {
  LINE_INVITE_SIGNUP_TTL_MS,
  generateLineInviteSignupToken,
  getLineInviteSignupId,
} from "../line-invite-signup.ts";
import { requirePendingProjectInviteToken } from "./project-invite-links.ts";

const LINE_AUTH_STATES = "lineAuthStates";
const LINE_AUTH_TICKETS = "lineAuthTickets";
const LINE_USER_LINKS = "lineUserLinks";
const LINE_SIGNUP_ATTEMPTS = "lineSignupAttempts";
const CREATE_ATTEMPTS = 3;

function stateRef(state: string) {
  return adminDb.collection(LINE_AUTH_STATES).doc(getLineAuthStateId(state));
}

function ticketRef(ticket: string) {
  return adminDb.collection(LINE_AUTH_TICKETS).doc(getLineAuthTicketId(ticket));
}

function reverseRef(lineUserId: string) {
  return adminDb.collection(LINE_USER_LINKS).doc(getLineUserLinkId(lineUserId));
}

export async function createLineAuthState(rawInviteToken?: string): Promise<{
  state: string;
  nonce: string;
  codeVerifier: string;
}> {
  const inviteId = rawInviteToken
    ? (await requirePendingProjectInviteToken(rawInviteToken)).inviteId
    : null;
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const state = generateLineAuthState();
    const nonce = generateLineLoginNonce();
    const codeVerifier = generateLineLoginCodeVerifier();
    const now = Timestamp.now();
    try {
      await stateRef(state).create({
        nonce,
        codeVerifier,
        status: "pending",
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + LINE_AUTH_STATE_TTL_MS),
        consumedAt: null,
        failedAt: null,
        ...(inviteId ? { inviteId } : {}),
      });
      return { state, nonce, codeVerifier };
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
      if (code !== "6" && code !== "already-exists") throw error;
    }
  }
  throw new LineAuthError("state_generation_failed");
}

export async function readLineAuthState(state: string): Promise<{
  status: "pending" | "consumed" | "failed";
  nonce: string;
  codeVerifier: string;
  inviteId: string | null;
}> {
  const reference = stateRef(state);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new LineAuthError("state_not_found");
  const data = snapshot.data();
  const status = data?.status;
  if (status !== "pending" && status !== "consumed" && status !== "failed") {
    throw new LineAuthError("invalid_state_status");
  }
  const inviteId = typeof data?.inviteId === "string" ? data.inviteId : null;
  if (status !== "pending") return { status, nonce: "", codeVerifier: "", inviteId };
  const nonce = typeof data?.nonce === "string" ? data.nonce : "";
  const codeVerifier = typeof data?.codeVerifier === "string" ? data.codeVerifier : "";
  const expiresAt = data?.expiresAt;
  if (!nonce || !codeVerifier || !(expiresAt instanceof Timestamp)) {
    await failLineAuthState(state);
    throw new LineAuthError("invalid_state_data");
  }
  if (expiresAt.toMillis() <= Date.now()) {
    await failLineAuthState(state);
    throw new LineAuthError("state_expired");
  }
  return { status, nonce, codeVerifier, inviteId };
}

export async function failLineAuthState(state: string): Promise<void> {
  const reference = stateRef(state);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data()?.status !== "pending") return;
    const now = Timestamp.now();
    transaction.update(reference, { status: "failed", failedAt: now });
  });
}

export async function completeLineAuthState(input: {
  state: string;
  lineUserId: string;
  displayName?: string;
  photoURL?: string;
}): Promise<
  | { outcome: "ticket_created"; ticket: string }
  | { outcome: "signup_required"; signupToken: string }
  | { outcome: "not_linked" }
> {
  const lineUserId = requireLineUserId(input.lineUserId);
  const stateReference = stateRef(input.state);

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const ticket = generateLineAuthTicket();
    const ticketReference = ticketRef(ticket);
    const signupToken = generateLineInviteSignupToken();
    const signupReference = adminDb.collection(LINE_SIGNUP_ATTEMPTS).doc(getLineInviteSignupId(signupToken));
    try {
      return await adminDb.runTransaction(async (transaction) => {
        const stateSnapshot = await transaction.get(stateReference);
        if (!stateSnapshot.exists) throw new LineAuthError("state_not_found");
        const stateData = stateSnapshot.data();
        if (stateData?.status !== "pending") throw new LineAuthError("state_not_pending");
        const expiresAt = stateData.expiresAt;
        const now = Timestamp.now();
        if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= now.toMillis()) {
          transaction.update(stateReference, { status: "failed", failedAt: now });
          return { outcome: "not_linked" as const };
        }

        const reverseSnapshot = await transaction.get(reverseRef(lineUserId));
        const reverseData = reverseSnapshot.data();
        if (!reverseSnapshot.exists || reverseData?.lineUserId !== lineUserId) {
          const inviteId = typeof stateData.inviteId === "string" ? stateData.inviteId : "";
          if (!inviteId) {
            transaction.update(stateReference, { status: "failed", failedAt: now });
            return { outcome: "not_linked" as const };
          }
          const inviteReference = adminDb.collection("projectInviteLinks").doc(inviteId);
          const [inviteSnapshot, signupSnapshot] = await Promise.all([
            transaction.get(inviteReference),
            transaction.get(signupReference),
          ]);
          const inviteData = inviteSnapshot.data();
          if (!inviteSnapshot.exists || inviteData?.role !== "viewer" || inviteData?.status !== "pending"
            || !(inviteData.expiresAt instanceof Timestamp) || inviteData.expiresAt.toMillis() <= now.toMillis()) {
            transaction.update(stateReference, { status: "failed", failedAt: now });
            return { outcome: "not_linked" as const };
          }
          if (signupSnapshot.exists) throw new LineAuthError("signup_token_collision");
          transaction.create(signupReference, {
            inviteId,
            lineUserId,
            status: "pending",
            displayName: input.displayName?.trim().slice(0, 128) || null,
            photoURL: input.photoURL ?? null,
            createdAt: now,
            expiresAt: Timestamp.fromMillis(now.toMillis() + LINE_INVITE_SIGNUP_TTL_MS),
            reservedAt: null,
            completedAt: null,
            failedAt: null,
            plannedUid: null,
          });
          transaction.update(stateReference, { status: "consumed", consumedAt: now });
          return { outcome: "signup_required" as const, signupToken };
        }
        const uid = requireFirebaseUid(typeof reverseData.uid === "string" ? reverseData.uid : "");
        transaction.create(ticketReference, {
          uid,
          status: "pending",
          createdAt: now,
          expiresAt: Timestamp.fromMillis(now.toMillis() + LINE_AUTH_TICKET_TTL_MS),
          consumedAt: null,
        });
        transaction.update(stateReference, { status: "consumed", consumedAt: now });
        return { outcome: "ticket_created" as const, ticket };
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
      if (code !== "6" && code !== "already-exists") throw error;
    }
  }
  throw new LineAuthError("ticket_generation_failed");
}

export async function consumeLineAuthTicket(ticket: string): Promise<string> {
  const reference = ticketRef(ticket);
  const result = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new LineAuthError("ticket_not_found");
    const data = snapshot.data();
    if (data?.status !== "pending") throw new LineAuthError("ticket_not_pending");
    const expiresAt = data.expiresAt;
    const now = Timestamp.now();
    if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= now.toMillis()) {
      transaction.update(reference, { status: "failed", consumedAt: now });
      return { outcome: "expired" as const };
    }
    const uid = requireFirebaseUid(typeof data.uid === "string" ? data.uid : "");
    transaction.update(reference, { status: "consumed", consumedAt: now });
    return { outcome: "consumed" as const, uid };
  });
  if (result.outcome === "expired") throw new LineAuthError("ticket_expired");
  return result.uid;
}
