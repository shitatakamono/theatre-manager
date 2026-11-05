import { adminAuth } from "@/lib/server/firebase-admin";
import { unlinkLineAccount } from "@/lib/server/line-account-link";
import { createLineLoginDisconnectHandler } from "@/lib/server/line-login-handler";

export const runtime = "nodejs";

export const POST = createLineLoginDisconnectHandler({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  unlink: unlinkLineAccount,
});
