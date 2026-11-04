import { createHash } from "node:crypto";

export type UserLinkReservationStatus = "pending" | "claimed" | "cancelled";

export type UserLinkReservation = {
  id: string;
  personId: string;
  email: string;
  status: UserLinkReservationStatus;
  createdAt?: unknown;
  createdByUid: string;
  updatedAt?: unknown;
  updatedByUid: string;
  claimedAt: unknown | null;
  claimedByUid: string | null;
  cancelledAt: unknown | null;
};

export type UserLinkReservationErrorCode =
  | "invalid_request"
  | "forbidden"
  | "person_not_found"
  | "person_already_linked"
  | "person_already_reserved"
  | "email_already_reserved"
  | "reservation_not_found"
  | "reservation_conflict"
  | "email_not_verified"
  | "google_account_required"
  | "ambiguous_reservation";

export class UserLinkReservationError extends Error {
  readonly code: UserLinkReservationErrorCode;
  readonly status: number;

  constructor(code: UserLinkReservationErrorCode, status: number, message: string) {
    super(message);
    this.name = "UserLinkReservationError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeUserLinkReservationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidUserLinkReservationEmail(email: string): boolean {
  const normalized = normalizeUserLinkReservationEmail(email);
  return normalized.length <= 254
    && !normalized.includes("/")
    && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized);
}

export function getUserLinkReservationId(email: string): string {
  const normalized = normalizeUserLinkReservationEmail(email);
  if (!isValidUserLinkReservationEmail(normalized)) {
    throw new Error("有効なメールアドレスを入力してください");
  }
  return createHash("sha256").update(normalized, "utf8").digest("base64url");
}
