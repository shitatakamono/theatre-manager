import { createHash } from "node:crypto";

const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/i;

export type LineDeliveryStatus = "reachable" | "unreachable" | "unknown";
export type LineAccountLinkStatus = "linked";
export type LineDeliveryEvent = "follow" | "unfollow";

export type LineIntegration = {
  provider: "line";
  lineUserId: string;
  status: LineAccountLinkStatus;
  deliveryStatus: LineDeliveryStatus;
  linkedAt: unknown;
  updatedAt: unknown;
  lastFollowAt: unknown | null;
  lastUnfollowAt: unknown | null;
};

export type LineUserLink = {
  uid: string;
  lineUserId: string;
  linkedAt: unknown;
  updatedAt: unknown;
};

export type ExistingLineIntegration = Pick<LineIntegration, "lineUserId"> | null;
export type ExistingLineUserLink = Pick<LineUserLink, "uid" | "lineUserId"> | null;

export class LineAccountLinkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LineAccountLinkError";
    this.code = code;
  }
}

export function requireFirebaseUid(uid: string): string {
  const normalized = uid.trim();
  if (!normalized || normalized.includes("/") || normalized.length > 128) {
    throw new LineAccountLinkError("invalid_uid", "Firebase UIDが不正です");
  }
  return normalized;
}

export function requireLineUserId(lineUserId: string): string {
  const normalized = lineUserId.trim();
  if (!LINE_USER_ID_PATTERN.test(normalized)) {
    throw new LineAccountLinkError("invalid_line_user_id", "LINE userIdが不正です");
  }
  return normalized;
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function getLineUserLinkId(lineUserId: string): string {
  return sha256Base64Url(requireLineUserId(lineUserId));
}

export function decideLineAccountLink(input: {
  uid: string;
  lineUserId: string;
  integration: ExistingLineIntegration;
  reverseLink: ExistingLineUserLink;
}): "create" | "already_linked" {
  const uid = requireFirebaseUid(input.uid);
  const lineUserId = requireLineUserId(input.lineUserId);
  const integrationLineUserId = input.integration?.lineUserId ?? "";
  const reverseUid = input.reverseLink?.uid ?? "";
  const reverseLineUserId = input.reverseLink?.lineUserId ?? "";

  if (input.integration && !integrationLineUserId) {
    throw new LineAccountLinkError(
      "line_link_inconsistent",
      "LINE連携情報が不整合です"
    );
  }
  if (input.reverseLink && (!reverseUid || !reverseLineUserId)) {
    throw new LineAccountLinkError(
      "line_link_inconsistent",
      "LINE連携情報が不整合です"
    );
  }

  if (integrationLineUserId && integrationLineUserId !== lineUserId) {
    throw new LineAccountLinkError(
      "uid_already_linked",
      "このシステム利用者は別のLINEアカウントと連携済みです"
    );
  }
  if (reverseUid && reverseUid !== uid) {
    throw new LineAccountLinkError(
      "line_user_already_linked",
      "このLINEアカウントは別のシステム利用者と連携済みです"
    );
  }

  const integrationMatches = integrationLineUserId === lineUserId;
  const reverseMatches = reverseUid === uid && reverseLineUserId === lineUserId;
  if (integrationMatches || input.reverseLink) {
    if (integrationMatches && reverseMatches) return "already_linked";
    throw new LineAccountLinkError(
      "line_link_inconsistent",
      "LINE連携情報が不整合です"
    );
  }
  return "create";
}

export function getLineDeliveryUpdate(event: LineDeliveryEvent): {
  deliveryStatus: Exclude<LineDeliveryStatus, "unknown">;
  timestampField: "lastFollowAt" | "lastUnfollowAt";
} {
  return event === "follow"
    ? { deliveryStatus: "reachable", timestampField: "lastFollowAt" }
    : { deliveryStatus: "unreachable", timestampField: "lastUnfollowAt" };
}
