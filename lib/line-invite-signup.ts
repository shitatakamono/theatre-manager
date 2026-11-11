import { createHash, randomBytes } from "node:crypto";

export const LINE_INVITE_SIGNUP_TTL_MS = 10 * 60 * 1000;

export type LineInviteSignupStatus = "pending" | "creating" | "completed" | "failed";

export class LineInviteSignupError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 409) {
    super("LINEでの新規登録を完了できませんでした");
    this.name = "LineInviteSignupError";
    this.code = code;
    this.status = status;
  }
}

export function generateLineInviteSignupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function getLineInviteSignupId(value: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new LineInviteSignupError("invalid_signup_token", 400);
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function generateLineOnlyFirebaseUid(): string {
  return `line_${randomBytes(32).toString("base64url")}`;
}
