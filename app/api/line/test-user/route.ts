import { createLineTestUserGetHandler } from "@/lib/server/line-test-user-handler";
import { getLatestLineFollowUser } from "@/lib/server/line-test-user";
import { adminAuth, adminDb } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

// Temporary owner-only endpoint for the one-time LINE push-message test.
export const GET = createLineTestUserGetHandler({
  verifyIdToken: (idToken) => adminAuth.verifyIdToken(idToken),
  getProjectRole: async (projectId, uid) => {
    const member = await adminDb.collection("projects").doc(projectId)
      .collection("members").doc(uid).get();
    return member.exists && typeof member.data()?.role === "string"
      ? member.data()!.role
      : null;
  },
  getLatestFollow: getLatestLineFollowUser,
});
