import "server-only";

import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";

const COLLECTION = "googleCalendarOAuthStates";
const STATE_TTL_MINUTES = 10;

export async function createGoogleCalendarOAuthState(
  uid: string
): Promise<string> {
  if (!uid) {
    throw new Error("OAuth state作成に必要なUIDがありません");
  }

  const state = randomBytes(32).toString("base64url");

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(
    now.toMillis() + STATE_TTL_MINUTES * 60 * 1000
  );

  await adminDb.collection(COLLECTION).doc(state).set({
    uid,
    createdAt: now,
    expiresAt,
  });

  return state;
}

export async function consumeGoogleCalendarOAuthState(
  state: string
): Promise<string | null> {
  if (!state) return null;

  const ref = adminDb.collection(COLLECTION).doc(state);

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data();
    const uid = typeof data?.uid === "string" ? data.uid : "";
    const expiresAt = data?.expiresAt;

    transaction.delete(ref);

    if (
      !uid ||
      !(expiresAt instanceof Timestamp) ||
      expiresAt.toMillis() <= Date.now()
    ) {
      return null;
    }

    return uid;
  });
}