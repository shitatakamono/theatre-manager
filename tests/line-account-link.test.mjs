import { deepStrictEqual, notStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LineAccountLinkError,
  decideLineAccountLink,
  generateLineAccountLinkNonce,
  getLineAccountLinkNonceId,
  getLineDeliveryUpdate,
  getLineUserLinkId,
  isValidLineAccountLinkNonce,
} from "../lib/line-account-link.ts";

const lineUserId = `U${"a".repeat(32)}`;

describe("LINE account link identifiers", () => {
  it("generates stable opaque document IDs", () => {
    strictEqual(getLineUserLinkId(lineUserId), getLineUserLinkId(lineUserId));
    strictEqual(getLineUserLinkId(lineUserId).length, 43);
    strictEqual(getLineAccountLinkNonceId("valid_nonce_123456"), getLineAccountLinkNonceId("valid_nonce_123456"));
    notStrictEqual(getLineAccountLinkNonceId("valid_nonce_123456"), "valid_nonce_123456");
  });

  it("generates distinct 32-byte base64url nonces within the LINE length bounds", () => {
    const first = generateLineAccountLinkNonce();
    const second = generateLineAccountLinkNonce();
    strictEqual(first.length, 43);
    strictEqual(isValidLineAccountLinkNonce(first), true);
    strictEqual(isValidLineAccountLinkNonce(second), true);
    notStrictEqual(first, second);
  });
});

describe("LINE account link decisions", () => {
  it("creates an unlinked pair and treats a complete matching pair as idempotent", () => {
    strictEqual(decideLineAccountLink({ uid: "uid-a", lineUserId, integration: null, reverseLink: null }), "create");
    strictEqual(decideLineAccountLink({
      uid: "uid-a",
      lineUserId,
      integration: { lineUserId },
      reverseLink: { uid: "uid-a", lineUserId },
    }), "already_linked");
  });

  it("rejects UID, LINE user, and partial-pair conflicts", () => {
    throws(() => decideLineAccountLink({
      uid: "uid-a",
      lineUserId,
      integration: { lineUserId: `U${"b".repeat(32)}` },
      reverseLink: null,
    }), (error) => error instanceof LineAccountLinkError && error.code === "uid_already_linked");
    throws(() => decideLineAccountLink({
      uid: "uid-a",
      lineUserId,
      integration: null,
      reverseLink: { uid: "uid-b", lineUserId },
    }), (error) => error instanceof LineAccountLinkError && error.code === "line_user_already_linked");
    throws(() => decideLineAccountLink({
      uid: "uid-a",
      lineUserId,
      integration: { lineUserId },
      reverseLink: null,
    }), (error) => error instanceof LineAccountLinkError && error.code === "line_link_inconsistent");
  });

  it("maps follow and unfollow without changing identity", () => {
    deepStrictEqual(getLineDeliveryUpdate("follow"), {
      deliveryStatus: "reachable",
      timestampField: "lastFollowAt",
    });
    deepStrictEqual(getLineDeliveryUpdate("unfollow"), {
      deliveryStatus: "unreachable",
      timestampField: "lastUnfollowAt",
    });
  });
});
