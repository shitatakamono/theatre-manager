import { createLineTestMessageHandler } from "@/lib/server/line-test-message-handler";
import { sendLinePushTextMessage } from "@/lib/server/line-messaging";
import { adminAuth, adminDb } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

export const POST = createLineTestMessageHandler({
  verifyIdToken: (idToken) => adminAuth.verifyIdToken(idToken),
  getProjectRole: async (projectId, uid) => {
    const member = await adminDb.collection("projects").doc(projectId)
      .collection("members").doc(uid).get();
    return member.exists && typeof member.data()?.role === "string"
      ? member.data()!.role
      : null;
  },
  sendMessage: ({ lineUserId, text }) => sendLinePushTextMessage({
    lineUserId,
    text,
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  }),
});
