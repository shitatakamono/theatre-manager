import { adminAuth } from "@/lib/server/firebase-admin";
import { createLineLinkEventHandlers } from "@/lib/server/line-link-event-handler";
import { listLineLinkEvents, repairProjectPersonLineLink } from "@/lib/server/line-link-events";

export const runtime = "nodejs";

const handlers = createLineLinkEventHandlers({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  list: listLineLinkEvents,
  repair: repairProjectPersonLineLink,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
