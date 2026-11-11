import { Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  LineAccountLinkError,
  decideLineAccountLink,
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

function integrationRef(uid: string) {
  return adminDb.collection(USER_INTEGRATIONS).doc(uid)
    .collection(PROVIDERS).doc(LINE_PROVIDER);
}

function reverseLinkRef(lineUserId: string) {
  return adminDb.collection(LINE_USER_LINKS).doc(getLineUserLinkId(lineUserId));
}

export async function prepareLineAccountLinkInTransaction(
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

export function writePreparedLineAccountLink(
  transaction: Transaction,
  prepared: Awaited<ReturnType<typeof prepareLineAccountLinkInTransaction>>,
  input: {
    uid: string;
    lineUserId: string;
    now: Timestamp;
    deliveryStatus?: "reachable" | "unreachable" | "unknown";
  }
): "linked" | "already_linked" {
  if (prepared.decision === "already_linked") return "already_linked";
  transaction.create(prepared.linkRef, {
    provider: "line",
    lineUserId: input.lineUserId,
    status: "linked",
    deliveryStatus: input.deliveryStatus ?? "unknown",
    linkedAt: input.now,
    updatedAt: input.now,
    lastFollowAt: null,
    lastUnfollowAt: null,
  });
  transaction.create(prepared.reverseRef, {
    uid: input.uid,
    lineUserId: input.lineUserId,
    linkedAt: input.now,
    updatedAt: input.now,
  });
  return "linked";
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
  const prepared = await prepareLineAccountLinkInTransaction(
    transaction,
    uid,
    lineUserId
  );
  return writePreparedLineAccountLink(transaction, prepared, { ...input, uid, lineUserId });
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
