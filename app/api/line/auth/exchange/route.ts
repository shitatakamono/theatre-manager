import { adminAuth } from "@/lib/server/firebase-admin";
import { consumeLineAuthTicket } from "@/lib/server/line-auth";
import { createLineAuthExchangeHandler } from "@/lib/server/line-auth-handler";

export const runtime = "nodejs";

export const POST = createLineAuthExchangeHandler({
  consumeTicket: consumeLineAuthTicket,
  getUser: (uid) => adminAuth.getUser(uid),
  createCustomToken: (uid) => adminAuth.createCustomToken(uid),
});
