import { createUserLinkReservationClaimHandler } from "@/lib/server/user-link-reservation-handler";
import {
  claimPendingUserLinkReservations,
  verifyUserLinkReservationIdToken,
} from "@/lib/server/user-link-reservations";

export const runtime = "nodejs";

export const POST = createUserLinkReservationClaimHandler({
  verifyIdToken: verifyUserLinkReservationIdToken,
  claimReservations: claimPendingUserLinkReservations,
});
