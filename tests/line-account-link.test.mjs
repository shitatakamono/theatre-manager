import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LineAccountLinkError,
  decideLineAccountLink,
  getLineDeliveryUpdate,
  getLineUserLinkId,
} from "../lib/line-account-link.ts";

const lineUserId = `U${"a".repeat(32)}`;

describe("LINE account link identifiers", () => {
  it("generates a stable opaque reverse-link document ID", () => {
    strictEqual(getLineUserLinkId(lineUserId), getLineUserLinkId(lineUserId));
    strictEqual(getLineUserLinkId(lineUserId).length, 43);
    strictEqual(getLineUserLinkId(lineUserId).includes(lineUserId), false);
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
