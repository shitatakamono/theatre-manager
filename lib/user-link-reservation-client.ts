import { auth } from "./firebase";
import type { UserLinkReservation } from "./user-link-reservations";

type ReservationResponse = {
  success?: boolean;
  reservation?: UserLinkReservation;
  reservations?: UserLinkReservation[];
  claimedCount?: number;
  waitingForMembershipCount?: number;
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
}): Promise<UserLinkReservation> {
  const result = await authenticatedRequest(managementPath(input.projectId), {
    method: "POST",
    body: JSON.stringify({ personId: input.personId, email: input.email }),
  });
  if (!result.reservation) throw new Error("作成した予約情報を確認できませんでした");
  return result.reservation;
}

export async function changeProjectUserLinkReservationClient(input: {
  projectId: string;
  personId: string;
  email: string;
}): Promise<UserLinkReservation> {
  const result = await authenticatedRequest(managementPath(input.projectId), {
    method: "PATCH",
    body: JSON.stringify({ personId: input.personId, email: input.email }),
  });
  if (!result.reservation) throw new Error("変更した予約情報を確認できませんでした");
  return result.reservation;
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
