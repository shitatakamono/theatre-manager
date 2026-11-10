import { createHash, randomBytes } from "node:crypto";
import { isValidProjectInviteLinkToken } from "../project-invite-links.ts";

export function generateProjectInviteLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashProjectInviteLinkToken(value: string): string {
  if (!isValidProjectInviteLinkToken(value)) throw new Error("invalid_invite_token");
  return createHash("sha256").update(value, "utf8").digest("base64url");
}
