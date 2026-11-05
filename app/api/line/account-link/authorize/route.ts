import { createLineAccountLinkAuthorizeHandler } from "@/lib/server/line-account-link-authorize-handler";
import { createLineAccountLinkNonce } from "@/lib/server/line-account-link";
import { adminAuth } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

export const POST = createLineAccountLinkAuthorizeHandler({
  verifyIdToken: (idToken) => adminAuth.verifyIdToken(idToken),
  createNonce: createLineAccountLinkNonce,
});
