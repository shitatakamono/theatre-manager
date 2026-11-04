import { createUserLinkReservationManagementHandlers } from "@/lib/server/user-link-reservation-handler";
import {
  cancelProjectUserLinkReservation,
  changeProjectUserLinkReservation,
  createProjectUserLinkReservation,
  getProjectUserLinkReservations,
  verifyUserLinkReservationIdToken,
} from "@/lib/server/user-link-reservations";

export const runtime = "nodejs";

function handlers(projectId: string) {
  return createUserLinkReservationManagementHandlers(projectId, {
    verifyIdToken: verifyUserLinkReservationIdToken,
    getReservations: getProjectUserLinkReservations,
    createReservation: createProjectUserLinkReservation,
    changeReservation: changeProjectUserLinkReservation,
    cancelReservation: cancelProjectUserLinkReservation,
  });
}

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  return handlers((await context.params).projectId).GET(request);
}

export async function POST(request: Request, context: Context) {
  return handlers((await context.params).projectId).POST(request);
}

export async function PATCH(request: Request, context: Context) {
  return handlers((await context.params).projectId).PATCH(request);
}

export async function DELETE(request: Request, context: Context) {
  return handlers((await context.params).projectId).DELETE(request);
}
