import { Timestamp } from "firebase-admin/firestore";

import {
  LINE_LOGIN_STATE_TTL_MS,
  LineLoginError,
  generateLineLoginCodeVerifier,
  generateLineLoginNonce,
  generateLineLoginState,
  getLineLoginStateId,
} from "../line-login.ts";
import { requireFirebaseUid, requireLineUserId } from "../line-account-link.ts";
import { adminDb } from "./firebase-admin.ts";
import { linkFirebaseUserToLineUserInTransaction } from "./line-account-link.ts";
import { recordRelinkEvents } from "./line-link-events.ts";

const LINE_LOGIN_STATES = "lineLoginStates";
const USER_INTEGRATIONS = "userIntegrations";
const CREATE_ATTEMPTS = 3;

function stateRef(state: string) {
  return adminDb.collection(LINE_LOGIN_STATES).doc(getLineLoginStateId(state));
}

function integrationRef(uid: string) {
  return adminDb.collection(USER_INTEGRATIONS).doc(uid).collection("providers").doc("line");
}

export async function getLineLoginConnectionStatus(uidValue: string): Promise<{
  connected: boolean;
  deliveryStatus: "reachable" | "unreachable" | "unknown" | null;
}> {
  const uid = requireFirebaseUid(uidValue);
  const snapshot = await integrationRef(uid).get();
  const data = snapshot.data();
  const connected = snapshot.exists && data?.provider === "line" && data?.status === "linked";
  const deliveryStatus = data?.deliveryStatus;
  return {
    connected,
    deliveryStatus: connected && (
      deliveryStatus === "reachable"
      || deliveryStatus === "unreachable"
      || deliveryStatus === "unknown"
    ) ? deliveryStatus : null,
  };
}

export async function createLineLoginState(uidValue: string): Promise<{
  state: string;
  nonce: string;
  codeVerifier: string;
}> {
  const uid = requireFirebaseUid(uidValue);
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const state = generateLineLoginState();
    const nonce = generateLineLoginNonce();
    const codeVerifier = generateLineLoginCodeVerifier();
    const now = Timestamp.now();
    try {
      await stateRef(state).create({
        uid,
        nonce,
        codeVerifier,
        status: "pending",
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + LINE_LOGIN_STATE_TTL_MS),
        consumedAt: null,
      });
      return { state, nonce, codeVerifier };
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
      if (code !== "6" && code !== "already-exists") throw error;
    }
  }
  throw new LineLoginError("state_generation_failed");
}

export type PendingLineLoginState = {
  status: "pending" | "consumed" | "failed";
  uid: string;
  nonce: string;
  codeVerifier: string;
};

export async function readLineLoginState(state: string): Promise<PendingLineLoginState> {
  const reference = stateRef(state);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new LineLoginError("state_not_found");
  const data = snapshot.data();
  const status = data?.status;
  if (status !== "pending" && status !== "consumed" && status !== "failed") {
    throw new LineLoginError("invalid_state_status");
  }
  const uid = requireFirebaseUid(typeof data?.uid === "string" ? data.uid : "");
  if (status !== "pending") return { status, uid, nonce: "", codeVerifier: "" };
  const nonce = typeof data?.nonce === "string" ? data.nonce : "";
  const codeVerifier = typeof data?.codeVerifier === "string" ? data.codeVerifier : "";
  const expiresAt = data?.expiresAt;
  if (!nonce || !codeVerifier || !(expiresAt instanceof Timestamp)) {
    await failLineLoginState(state);
    throw new LineLoginError("invalid_state_data");
  }
  if (expiresAt.toMillis() <= Date.now()) {
    await failLineLoginState(state);
    throw new LineLoginError("state_expired");
  }
  return { status, uid, nonce, codeVerifier };
}

export async function failLineLoginState(state: string): Promise<void> {
  const reference = stateRef(state);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data()?.status !== "pending") return;
    transaction.update(reference, { status: "failed", consumedAt: Timestamp.now() });
  });
}

export async function completeLineLoginState(input: {
  state: string;
  lineUserId: string;
  lineDisplayName?: string;
  deliveryStatus: "reachable" | "unreachable" | "unknown";
}): Promise<{ outcome: "linked" | "already_linked" }> {
  const lineUserId = requireLineUserId(input.lineUserId);
  const reference = stateRef(input.state);
  const result = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    if (!snapshot.exists) throw new LineLoginError("state_not_found");
    const uid = requireFirebaseUid(typeof data?.uid === "string" ? data.uid : "");

    if (data?.status === "consumed") {
      const status = await linkFirebaseUserToLineUserInTransaction(transaction, {
        uid,
        lineUserId,
        now: Timestamp.now(),
        deliveryStatus: input.deliveryStatus,
        lineDisplayName: input.lineDisplayName,
      });
      if (status !== "already_linked") throw new LineLoginError("state_already_consumed");
      return { outcome: "already_linked" as const, uid };
    }
    if (data?.status !== "pending") throw new LineLoginError("state_not_pending");
    const expiresAt = data.expiresAt;
    const now = Timestamp.now();
    if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= now.toMillis()) {
      transaction.update(reference, { status: "failed", consumedAt: now });
      throw new LineLoginError("state_expired");
    }

    const outcome = await linkFirebaseUserToLineUserInTransaction(transaction, {
      uid,
      lineUserId,
      now,
      deliveryStatus: input.deliveryStatus,
      lineDisplayName: input.lineDisplayName,
    });
    transaction.update(reference, { status: "consumed", consumedAt: now });
    return { outcome, uid };
  });
  if (result.outcome === "linked") {
    try {
      await recordRelinkEvents({
        uid: result.uid,
        lineDisplayName: input.lineDisplayName?.trim() || "表示名未取得",
        sourceId: reference.id,
      });
    } catch {
      console.error("line_link_event_record_failed", { category: "settings_relink" });
    }
  }
  return { outcome: result.outcome };
}
