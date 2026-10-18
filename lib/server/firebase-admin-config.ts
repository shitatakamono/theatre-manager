export class FirebaseAdminConfigurationError extends Error {
  constructor() {
    super("Firebase Adminの秘密鍵設定が不正です");
    this.name = "FirebaseAdminConfigurationError";
  }
}

function normalizeAndValidatePrivateKey(value: string): string {
  const privateKey = value.trim();
  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
    || !privateKey.includes("-----END PRIVATE KEY-----")) {
    throw new FirebaseAdminConfigurationError();
  }
  return privateKey;
}

function decodeBase64PrivateKey(value: string): string {
  const encoded = value.trim();
  const isCanonicalBase64 = encoded.length > 0
    && encoded.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded);
  if (!isCanonicalBase64) throw new FirebaseAdminConfigurationError();

  try {
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw new FirebaseAdminConfigurationError();
  }
}

export function resolveFirebaseAdminPrivateKey(input: {
  privateKeyBase64?: string;
  privateKey?: string;
}): string | undefined {
  if (input.privateKeyBase64?.trim()) {
    return normalizeAndValidatePrivateKey(decodeBase64PrivateKey(input.privateKeyBase64));
  }
  if (input.privateKey?.trim()) {
    return normalizeAndValidatePrivateKey(input.privateKey.replace(/\\n/g, "\n"));
  }
  return undefined;
}

export function createLazyInitializer<T>(initialize: () => T): () => T {
  let value: T | undefined;
  return () => {
    if (value === undefined) value = initialize();
    return value;
  };
}
