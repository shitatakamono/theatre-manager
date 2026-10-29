import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export type EncryptedGoogleCalendarToken = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY;

  if (!encodedKey) {
    throw new Error(
      "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY が設定されていません"
    );
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error(
      "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY は32バイトのBase64値である必要があります"
    );
  }

  return key;
}

export function encryptGoogleCalendarToken(
  plaintext: string
): EncryptedGoogleCalendarToken {
  if (!plaintext) {
    throw new Error("暗号化するGoogle Calendarトークンが空です");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptGoogleCalendarToken(
  encryptedToken: EncryptedGoogleCalendarToken
): string {
  const key = getEncryptionKey();

  const iv = Buffer.from(encryptedToken.iv, "base64");
  const authTag = Buffer.from(encryptedToken.authTag, "base64");
  const ciphertext = Buffer.from(encryptedToken.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}