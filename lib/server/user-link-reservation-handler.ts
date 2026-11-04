import type { DecodedIdToken } from "firebase-admin/auth";
import { UserLinkReservationError } from "../user-link-reservations.ts";

type ManagementDependencies = {
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>;
  getReservations: (input: {
    uid: string;
    projectId: string;
    personId?: string;
  }) => Promise<unknown>;
  createReservation: (input: {
    uid: string;
    projectId: string;
    personId: string;
    email: string;
  }) => Promise<unknown>;
  changeReservation: (input: {
    uid: string;
    projectId: string;
    personId: string;
    email: string;
  }) => Promise<unknown>;
  cancelReservation: (input: {
    uid: string;
    projectId: string;
    personId: string;
  }) => Promise<void>;
};

type ClaimDependencies = {
  verifyIdToken: (idToken: string) => Promise<DecodedIdToken>;
  claimReservations: (token: DecodedIdToken) => Promise<{
    claimedCount: number;
    waitingForMembershipCount: number;
  }>;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

async function authenticate<T extends { uid: string }>(
  request: Request,
  verifyIdToken: (idToken: string) => Promise<T>
): Promise<T | Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "ログインが必要です", code: "unauthorized" }, 401);
  try {
    return await verifyIdToken(match[1]);
  } catch {
    return json({ error: "認証情報を確認できませんでした", code: "unauthorized" }, 401);
  }
}

function requestError(error: unknown): Response {
  if (error instanceof UserLinkReservationError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  console.error("user_link_reservation_request_failed", {
    name: error instanceof Error ? error.name : "unknown",
  });
  return json({
    error: "紐づけ予約を処理できませんでした",
    code: "reservation_request_failed",
  }, 500);
}

function bodyValues(body: Record<string, unknown>): { personId: string; email: string } {
  return {
    personId: typeof body.personId === "string" ? body.personId.trim() : "",
    email: typeof body.email === "string" ? body.email : "",
  };
}

export function createUserLinkReservationManagementHandlers(
  projectId: string,
  dependencies: ManagementDependencies
) {
  async function GET(request: Request): Promise<Response> {
    const token = await authenticate(request, dependencies.verifyIdToken);
    if (token instanceof Response) return token;
    const personId = new URL(request.url).searchParams.get("personId")?.trim();
    try {
      const reservations = await dependencies.getReservations({
        uid: token.uid,
        projectId,
        ...(personId ? { personId } : {}),
      });
      return json({ success: true, reservations }, 200);
    } catch (error) {
      return requestError(error);
    }
  }

  async function mutate(
    request: Request,
    operation: "create" | "change" | "cancel"
  ): Promise<Response> {
    const token = await authenticate(request, dependencies.verifyIdToken);
    if (token instanceof Response) return token;
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json({ error: "送信内容が不正です", code: "invalid_request" }, 400);
    }
    const values = bodyValues(body);
    try {
      if (operation === "cancel") {
        await dependencies.cancelReservation({
          uid: token.uid,
          projectId,
          personId: values.personId,
        });
        return json({ success: true }, 200);
      }
      const reservation = await (operation === "create"
        ? dependencies.createReservation
        : dependencies.changeReservation)({
        uid: token.uid,
        projectId,
        personId: values.personId,
        email: values.email,
      });
      return json({ success: true, reservation }, operation === "create" ? 201 : 200);
    } catch (error) {
      return requestError(error);
    }
  }

  return {
    GET,
    POST: (request: Request) => mutate(request, "create"),
    PATCH: (request: Request) => mutate(request, "change"),
    DELETE: (request: Request) => mutate(request, "cancel"),
  };
}

export function createUserLinkReservationClaimHandler(
  dependencies: ClaimDependencies
) {
  return async function POST(request: Request): Promise<Response> {
    const token = await authenticate(request, dependencies.verifyIdToken);
    if (token instanceof Response) return token;
    try {
      const result = await dependencies.claimReservations(token);
      return json({ success: true, ...result }, 200);
    } catch (error) {
      return requestError(error);
    }
  };
}
