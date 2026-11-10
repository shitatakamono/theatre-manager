import { adminAuth } from "@/lib/server/firebase-admin";
import { unlinkLineAccount } from "@/lib/server/line-account-link";
import { getLineLoginConnectionStatus } from "@/lib/server/line-login";
import { createLineLoginDisconnectHandler } from "@/lib/server/line-login-handler";

export const runtime = "nodejs";

export const POST = createLineLoginDisconnectHandler({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  getStatus: getLineLoginConnectionStatus,
  hasAlternativeLogin: async (uid) => {
    const user = await adminAuth.getUser(uid);
    return user.providerData.some((provider) => provider.providerId === "google.com");
  },
  unlink: unlinkLineAccount,
});
