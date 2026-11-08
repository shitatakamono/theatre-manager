import { auth } from "./firebase";
import { requestMemberInviteEmail } from "./member-invite-email-client";
import type {
  UserLinkReservationInviteOutcome,
  UserLinkReservation,
  UserLinkReservationMutationOutcome,
  UserLinkReservationMutationResult,
} from "./user-link-reservations";

type ReservationResponse = {
  success?: boolean;
  reservation?: UserLinkReservation | null;
  reservations?: UserLinkReservation[];
  claimedCount?: number;
  waitingForMembershipCount?: number;
  outcome?: UserLinkReservationMutationOutcome;
  inviteOutcome?: UserLinkReservationInviteOutcome;
  error?: string;
};

async function authenticatedRequest(
  path: string,
  init: RequestInit = {},
  getIdToken?: () => Promise<string>
): Promise<ReservationResponse> {
  const tokenProvider = getIdToken ?? (() => {
    const user = auth.currentUser;
    if (!user) throw new Error("ログイン状態を確認できませんでした");
    return user.getIdToken();
  });
  let idToken: string;
  try {
    idToken = await tokenProvider();
  } catch {
    throw new Error("ログイン状態を確認できませんでした");
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error("通信に失敗しました。時間をおいて再度お試しください");
  }
  let result: ReservationResponse;
  try {
    result = await response.json() as ReservationResponse;
  } catch {
    throw new Error("紐づけ予約の応答を確認できませんでした");
  }
  if (!response.ok) {
    throw new Error(result.error || "紐づけ予約を処理できませんでした");
  }
  return result;
}

function managementPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/user-link-reservations`;
}

export async function getProjectUserLinkReservationsClient(
  projectId: string
): Promise<UserLinkReservation[]> {
  const result = await authenticatedRequest(managementPath(projectId));
  return result.reservations ?? [];
}

export async function createProjectUserLinkReservationClient(input: {
  projectId: string;
  personId: string;
  email: string;
}): Promise<UserLinkReservationMutationResult> {
  const result = await authenticatedRequest(managementPath(input.projectId), {
    method: "POST",
    body: JSON.stringify({ personId: input.personId, email: input.email }),
  });
  return completeMutationResult(result, input.projectId, input.email);
}

export async function changeProjectUserLinkReservationClient(input: {
  projectId: string;
  personId: string;
  email: string;
}): Promise<UserLinkReservationMutationResult> {
  const result = await authenticatedRequest(managementPath(input.projectId), {
    method: "PATCH",
    body: JSON.stringify({ personId: input.personId, email: input.email }),
  });
  return completeMutationResult(result, input.projectId, input.email);
}

function mutationResult(result: ReservationResponse): UserLinkReservationMutationResult {
  if (result.outcome === "pending" && result.reservation) {
    if (result.inviteOutcome !== "created" && result.inviteOutcome !== "existing") {
      throw new Error("紐づけ予約の招待結果を確認できませんでした");
    }
    return {
      outcome: "pending",
      reservation: result.reservation,
      inviteOutcome: result.inviteOutcome,
    };
  }
  if (result.outcome === "linked" || result.outcome === "already_linked") {
    return { outcome: result.outcome, reservation: null, inviteOutcome: "not_needed" };
  }
  throw new Error("紐づけ予約の処理結果を確認できませんでした");
}

async function completeMutationResult(
  response: ReservationResponse,
  projectId: string,
  email: string
): Promise<UserLinkReservationMutationResult> {
  const result = mutationResult(response);
  if (result.inviteOutcome !== "created") return result;
  try {
    await requestMemberInviteEmail(projectId, email);
    return { ...result, inviteEmailStatus: "sent" };
  } catch {
    return { ...result, inviteEmailStatus: "failed" };
  }
}

export async function cancelProjectUserLinkReservationClient(input: {
  projectId: string;
  personId: string;
}): Promise<void> {
  await authenticatedRequest(managementPath(input.projectId), {
    method: "DELETE",
    body: JSON.stringify({ personId: input.personId }),
  });
}

export async function claimPendingUserLinkReservationsClient(
  getIdToken: () => Promise<string>
): Promise<{ claimedCount: number; waitingForMembershipCount: number }> {
  const result = await authenticatedRequest(
    "/api/user-link-reservations/claim",
    { method: "POST" },
    getIdToken
  );
  return {
    claimedCount: result.claimedCount ?? 0,
    waitingForMembershipCount: result.waitingForMembershipCount ?? 0,
  };
}
