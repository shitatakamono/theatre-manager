import { randomBytes } from "node:crypto";

import { sha256Base64Url } from "./line-account-link.ts";

export const LINE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const LINE_AUTH_TICKET_TTL_MS = 2 * 60 * 1000;

export type LineAuthRecordStatus = "pending" | "consumed" | "failed";

export class LineAuthError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("LINEログインを完了できませんでした");
    this.name = "LineAuthError";
    this.code = code;
  }
}

function generateOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

function opaqueDocumentId(value: string, errorCode: string): string {
  if (!/^[A-Za-z0-9_-]{43,255}$/.test(value)) {
    throw new LineAuthError(errorCode);
  }
  return sha256Base64Url(value);
}

export function generateLineAuthState(): string {
  return generateOpaqueValue();
}

export function generateLineAuthTicket(): string {
  return generateOpaqueValue();
}

export function getLineAuthStateId(state: string): string {
  return opaqueDocumentId(state, "invalid_state");
}

export function getLineAuthTicketId(ticket: string): string {
  return opaqueDocumentId(ticket, "invalid_ticket");
}
