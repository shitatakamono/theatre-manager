import { notStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_AUTH_STATE_TTL_MS,
  LINE_AUTH_TICKET_TTL_MS,
  LineAuthError,
  generateLineAuthState,
  generateLineAuthTicket,
  getLineAuthStateId,
  getLineAuthTicketId,
} from "../lib/line-auth.ts";

describe("LINE authentication primitives", () => {
  it("creates distinct cryptographically opaque state and ticket values", () => {
    const state = generateLineAuthState();
    const ticket = generateLineAuthTicket();
    strictEqual(state.length, 43);
    strictEqual(ticket.length, 43);
    notStrictEqual(state, ticket);
    notStrictEqual(getLineAuthStateId(state), state);
    notStrictEqual(getLineAuthTicketId(ticket), ticket);
    strictEqual(getLineAuthStateId(state), getLineAuthStateId(state));
  });

  it("uses short-lived state and tickets and rejects malformed bearer values", () => {
    strictEqual(LINE_AUTH_STATE_TTL_MS, 10 * 60 * 1000);
    strictEqual(LINE_AUTH_TICKET_TTL_MS, 2 * 60 * 1000);
    throws(() => getLineAuthStateId("short"), (error) => error instanceof LineAuthError && error.code === "invalid_state");
    throws(() => getLineAuthTicketId("short"), (error) => error instanceof LineAuthError && error.code === "invalid_ticket");
  });
});
