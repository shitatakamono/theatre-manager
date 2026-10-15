import { auth } from "./firebase";

type InviteEmailApiResult = {
  success?: boolean;
  email?: string;
  emailStatus?: "sent" | "failed";
  error?: string;
  code?: string;
};

export async function requestMemberInviteEmail(projectId: string, inviteEmail: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("招待メールを送信するにはログインが必要です");
  const idToken = await user.getIdToken();
  const response = await fetch("/api/member-invites/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId, inviteEmail }),
  });
  const result = await response.json() as InviteEmailApiResult;
  if (!response.ok) {
    const error = new Error(result.error || "招待メールを送信できませんでした");
    Object.assign(error, { code: result.code, emailStatus: result.emailStatus });
    throw error;
  }
  return result;
}
