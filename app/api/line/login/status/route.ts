import { adminAuth } from "@/lib/server/firebase-admin";
import { getLineLoginConnectionStatus } from "@/lib/server/line-login";
import { createLineLoginStatusHandler } from "@/lib/server/line-login-handler";

export const runtime = "nodejs";

export const GET = createLineLoginStatusHandler({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  getStatus: getLineLoginConnectionStatus,
});
