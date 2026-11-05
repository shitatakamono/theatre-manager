import { Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  LINE_ACCOUNT_LINK_NONCE_TTL_MS,
  LineAccountLinkError,
  decideLineAccountLink,
  generateLineAccountLinkNonce,
  getLineAccountLinkNonceId,
  getLineDeliveryUpdate,
  getLineUserLinkId,
  requireFirebaseUid,
  requireLineUserId,
  type LineDeliveryEvent,
} from "../line-account-link.ts";
import { adminDb } from "./firebase-admin.ts";

const USER_INTEGRATIONS = "userIntegrations";
const PROVIDERS = "providers";
const LINE_PROVIDER = "line";
const LINE_USER_LINKS = "lineUserLinks";
const LINE_ACCOUNT_LINK_NONCES = "lineAccountLinkNonces";
const NONCE_CREATE_ATTEMPTS = 3;

function integrationRef(uid: string) {
  return adminDb.collection(USER_INTEGRATIONS).doc(uid)
    .collection(PROVIDERS).doc(LINE_PROVIDER);
}

function reverseLinkRef(lineUserId: string) {
  return adminDb.collection(LINE_USER_LINKS).doc(getLineUserLinkId(lineUserId));
}

function nonceRef(nonce: string) {
  return adminDb.collection(LINE_ACCOUNT_LINK_NONCES)
    .doc(getLineAccountLinkNonceId(nonce));
}

async function getLineAccountLinkDecision(
  transaction: Transaction,
  uid: string,
  lineUserId: string
): Promise<{
  decision: "create" | "already_linked";
  linkRef: ReturnType<typeof integrationRef>;
  reverseRef: ReturnType<typeof reverseLinkRef>;
}> {
  const linkRef = integrationRef(uid);
  const reverseRef = reverseLinkRef(lineUserId);
  const [integrationSnapshot, reverseSnapshot] = await Promise.all([
    transaction.get(linkRef),
    transaction.get(reverseRef),
  ]);
  return {
    decision: decideLineAccountLink({
      uid,
      lineUserId,
      integration: integrationSnapshot.exists
        ? { lineUserId: String(integrationSnapshot.data()?.lineUserId ?? "") }
        : null,
      reverseLink: reverseSnapshot.exists
        ? {
          uid: String(reverseSnapshot.data()?.uid ?? ""),
          lineUserId: String(reverseSnapshot.data()?.lineUserId ?? ""),
        }
        : null,
    }),
    linkRef,
    reverseRef,
  };
}

export async function linkFirebaseUserToLineUserInTransaction(
  transaction: Transaction,
  input: {
    uid: string;
    lineUserId: string;
    now: Timestamp;
    deliveryStatus?: "reachable" | "unreachable" | "unknown";
  }
): Promise<"linked" | "already_linked"> {
  const uid = requireFirebaseUid(input.uid);
  const lineUserId = requireLineUserId(input.lineUserId);
  const { decision, linkRef, reverseRef } = await getLineAccountLinkDecision(
    transaction,
    uid,
    lineUserId
  );
  if (decision === "already_linked") return "already_linked";

  transaction.create(linkRef, {
    provider: "line",
    lineUserId,
    status: "linked",
    deliveryStatus: input.deliveryStatus ?? "unknown",
    linkedAt: input.now,
    updatedAt: input.now,
    lastFollowAt: null,
    lastUnfollowAt: null,
  });
  transaction.create(reverseRef, {
    uid,
    lineUserId,
    linkedAt: input.now,
    updatedAt: input.now,
  });
  return "linked";
}

export async function isLineUserLinked(lineUserIdValue: string): Promise<boolean> {
  const lineUserId = requireLineUserId(lineUserIdValue);
  const snapshot = await reverseLinkRef(lineUserId).get();
  return snapshot.exists
    && snapshot.data()?.lineUserId === lineUserId
    && typeof snapshot.data()?.uid === "string";
}

export async function createLineAccountLinkNonce(uidValue: string): Promise<string> {
  const uid = requireFirebaseUid(uidValue);
  for (let attempt = 0; attempt < NONCE_CREATE_ATTEMPTS; attempt += 1) {
    const nonce = generateLineAccountLinkNonce();
    const now = Timestamp.now();
    try {
      await nonceRef(nonce).create({
        uid,
        status: "pending",
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now.toMillis() + LINE_ACCOUNT_LINK_NONCE_TTL_MS),
        consumedAt: null,
      });
      return nonce;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
      if (code !== "6" && code !== "already-exists") throw error;
    }
  }
  throw new LineAccountLinkError("nonce_generation_failed", "LINE連携nonceを生成できませんでした");
}

type LinkTransactionResult =
  | { outcome: "linked" | "already_linked" }
  | { outcome: "rejected"; error: LineAccountLinkError };

async function runLineAccountLinkTransaction(input: {
  expectedUid?: string;
  lineUserId: string;
  nonce: string;
  allowConsumedReplay: boolean;
}): Promise<{ outcome: "linked" | "already_linked" }> {
  const expectedUid = input.expectedUid === undefined
    ? null
    : requireFirebaseUid(input.expectedUid);
  const lineUserId = requireLineUserId(input.lineUserId);
  const pendingNonceRef = nonceRef(input.nonce);

  const result = await adminDb.runTransaction<LinkTransactionResult>(async (transaction) => {
    const nonceSnapshot = await transaction.get(pendingNonceRef);
    const nonceData = nonceSnapshot.data();
    if (!nonceSnapshot.exists) {
      return {
        outcome: "rejected",
        error: new LineAccountLinkError("nonce_not_found", "LINE連携nonceは使用できません"),
      };
    }
    const uidValue = typeof nonceData?.uid === "string" ? nonceData.uid : "";
    let uid: string;
    try {
      uid = requireFirebaseUid(uidValue);
    } catch {
      const now = Timestamp.now();
      if (nonceData?.status === "pending") {
        transaction.update(pendingNonceRef, { status: "failed", consumedAt: now });
      }
      return {
        outcome: "rejected",
        error: new LineAccountLinkError("nonce_mismatch", "LINE連携nonceが一致しません"),
      };
    }
    if (expectedUid && uid !== expectedUid) {
      const now = Timestamp.now();
      if (nonceData?.status === "pending") {
        transaction.update(pendingNonceRef, { status: "failed", consumedAt: now });
      }
      return {
        outcome: "rejected",
        error: new LineAccountLinkError("nonce_mismatch", "LINE連携nonceが一致しません"),
      };
    }

    if (nonceData?.status === "consumed") {
      if (input.allowConsumedReplay) {
        try {
          const existing = await getLineAccountLinkDecision(transaction, uid, lineUserId);
          if (existing.decision === "already_linked") return { outcome: "already_linked" };
        } catch (error) {
          return {
            outcome: "rejected",
            error: error instanceof LineAccountLinkError
              ? error
              : new LineAccountLinkError("line_link_failed", "LINE連携を完了できませんでした"),
          };
        }
      }
      return {
        outcome: "rejected",
        error: new LineAccountLinkError("nonce_not_pending", "LINE連携nonceは使用できません"),
      };
    }
    if (nonceData?.status !== "pending") {
      return {
        outcome: "rejected",
        error: new LineAccountLinkError("nonce_failed", "LINE連携nonceは使用できません"),
      };
    }
    const expiresAt = nonceData.expiresAt;
    if (!(expiresAt instanceof Timestamp)) {
      transaction.update(pendingNonceRef, {
        status: "failed",
        consumedAt: Timestamp.now(),
      });
      return {
        outcome: "rejected",
        error: new LineAccountLinkError("nonce_mismatch", "LINE連携nonceが一致しません"),
      };
    }

    const now = Timestamp.now();
    if (expiresAt.toMillis() <= now.toMillis()) {
      transaction.update(pendingNonceRef, { status: "failed", consumedAt: now });
      return {
        outcome: "rejected",
        error: new LineAccountLinkError("nonce_expired", "LINE連携nonceの有効期限が切れています"),
      };
    }

    let outcome: "linked" | "already_linked";
    try {
      outcome = await linkFirebaseUserToLineUserInTransaction(transaction, {
        uid,
        lineUserId,
        now,
      });
    } catch (error) {
      const linkError = error instanceof LineAccountLinkError
        ? error
        : new LineAccountLinkError("line_link_failed", "LINE連携を完了できませんでした");
      transaction.update(pendingNonceRef, { status: "failed", consumedAt: now });
      return { outcome: "rejected", error: linkError };
    }

    transaction.update(pendingNonceRef, { status: "consumed", consumedAt: now });
    return { outcome };
  });

  if (result.outcome === "rejected") throw result.error;
  return result;
}

export async function linkLineAccount(input: {
  uid: string;
  lineUserId: string;
  nonce: string;
}): Promise<{ outcome: "linked" | "already_linked" }> {
  return runLineAccountLinkTransaction({
    expectedUid: input.uid,
    lineUserId: input.lineUserId,
    nonce: input.nonce,
    allowConsumedReplay: false,
  });
}

export async function linkLineAccountFromWebhook(input: {
  lineUserId: string;
  nonce: string;
}): Promise<{ outcome: "linked" | "already_linked" }> {
  return runLineAccountLinkTransaction({
    lineUserId: input.lineUserId,
    nonce: input.nonce,
    allowConsumedReplay: true,
  });
}

export async function failLineAccountLinkNonce(nonce: string): Promise<{
  outcome: "failed" | "already_failed" | "already_consumed" | "not_found";
}> {
  const pendingNonceRef = nonceRef(nonce);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(pendingNonceRef);
    if (!snapshot.exists) return { outcome: "not_found" as const };
    const status = snapshot.data()?.status;
    if (status === "failed") return { outcome: "already_failed" as const };
    if (status === "consumed") return { outcome: "already_consumed" as const };
    if (status !== "pending") {
      throw new LineAccountLinkError("nonce_invalid_state", "LINE連携nonceの状態が不正です");
    }
    transaction.update(pendingNonceRef, {
      status: "failed",
      consumedAt: Timestamp.now(),
    });
    return { outcome: "failed" as const };
  });
}

export async function unlinkLineAccount(uidValue: string): Promise<{
  outcome: "unlinked" | "already_unlinked";
}> {
  const uid = requireFirebaseUid(uidValue);
  const linkRef = integrationRef(uid);
  return adminDb.runTransaction(async (transaction) => {
    const integration = await transaction.get(linkRef);
    if (!integration.exists) {
      const orphanedReverseLinks = await transaction.get(
        adminDb.collection(LINE_USER_LINKS).where("uid", "==", uid).limit(1)
      );
      if (!orphanedReverseLinks.empty) {
        throw new LineAccountLinkError("line_link_inconsistent", "LINE連携情報が不整合です");
      }
      return { outcome: "already_unlinked" as const };
    }

    const lineUserIdValue = integration.data()?.lineUserId;
    const lineUserId = typeof lineUserIdValue === "string"
      ? requireLineUserId(lineUserIdValue)
      : "";
    if (!lineUserId) {
      throw new LineAccountLinkError("line_link_inconsistent", "LINE連携情報が不整合です");
    }
    const reverseRef = reverseLinkRef(lineUserId);
    const reverse = await transaction.get(reverseRef);
    if (!reverse.exists
      || reverse.data()?.uid !== uid
      || reverse.data()?.lineUserId !== lineUserId) {
      throw new LineAccountLinkError("line_link_inconsistent", "LINE連携情報が不整合です");
    }

    transaction.delete(linkRef);
    transaction.delete(reverseRef);
    return { outcome: "unlinked" as const };
  });
}

export async function updateLineDeliveryStatus(input: {
  lineUserId: string;
  event: LineDeliveryEvent;
}): Promise<{ outcome: "updated" | "not_linked" | "inconsistent" }> {
  const lineUserId = requireLineUserId(input.lineUserId);
  const reverseRef = reverseLinkRef(lineUserId);
  return adminDb.runTransaction(async (transaction) => {
    const reverse = await transaction.get(reverseRef);
    if (!reverse.exists) return { outcome: "not_linked" as const };
    const uidValue = reverse.data()?.uid;
    if (typeof uidValue !== "string") return { outcome: "inconsistent" as const };

    let uid: string;
    try {
      uid = requireFirebaseUid(uidValue);
    } catch {
      return { outcome: "inconsistent" as const };
    }
    const linkRef = integrationRef(uid);
    const integration = await transaction.get(linkRef);
    if (!integration.exists
      || integration.data()?.lineUserId !== lineUserId
      || integration.data()?.status !== "linked") {
      return { outcome: "inconsistent" as const };
    }

    const now = Timestamp.now();
    const update = getLineDeliveryUpdate(input.event);
    transaction.update(linkRef, {
      deliveryStatus: update.deliveryStatus,
      [update.timestampField]: now,
      updatedAt: now,
    });
    return { outcome: "updated" as const };
  });
}
