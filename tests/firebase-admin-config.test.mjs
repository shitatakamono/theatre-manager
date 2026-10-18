import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLazyInitializer,
  FirebaseAdminConfigurationError,
  resolveFirebaseAdminPrivateKey,
} from "../lib/server/firebase-admin-config.ts";

const privateKey = [
  "-----BEGIN PRIVATE KEY-----",
  "test-key-body",
  "-----END PRIVATE KEY-----",
].join("\n");

describe("Firebase Admin private key configuration", () => {
  it("decodes a UTF-8 Base64 private key", () => {
    equal(resolveFirebaseAdminPrivateKey({
      privateKeyBase64: Buffer.from(privateKey, "utf8").toString("base64"),
    }), privateKey);
  });

  it("prefers Base64 over the legacy PEM value", () => {
    equal(resolveFirebaseAdminPrivateKey({
      privateKeyBase64: Buffer.from(privateKey, "utf8").toString("base64"),
      privateKey: "invalid legacy value",
    }), privateKey);
  });

  it("falls back to the legacy PEM value and restores escaped newlines", () => {
    equal(resolveFirebaseAdminPrivateKey({
      privateKey: privateKey.replace(/\n/g, "\\n"),
    }), privateKey);
  });

  it("rejects malformed Base64 and decoded values that are not PEM", () => {
    for (const privateKeyBase64 of ["%%%invalid%%%", Buffer.from("not a PEM", "utf8").toString("base64")]) {
      throws(
        () => resolveFirebaseAdminPrivateKey({ privateKeyBase64 }),
        FirebaseAdminConfigurationError
      );
    }
  });

  it("does not initialize until the lazy getter is called and initializes only once", () => {
    let calls = 0;
    const getValue = createLazyInitializer(() => {
      calls += 1;
      return { initialized: true };
    });

    equal(calls, 0);
    const first = getValue();
    const second = getValue();
    equal(calls, 1);
    deepStrictEqual(first, { initialized: true });
    equal(first, second);
  });
});
