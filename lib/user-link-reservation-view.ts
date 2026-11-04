import type { UserLinkReservation } from "./user-link-reservations";

export type UserLinkReservationView =
  | { kind: "hidden" }
  | { kind: "create" }
  | { kind: "pending"; email: string; conflictPersonName: string | null };

export function getUserLinkReservationView(input: {
  canEdit: boolean;
  linkedUserUid: string | null;
  reservation?: Pick<UserLinkReservation, "email" | "status" | "conflictPersonName">;
}): UserLinkReservationView {
  if (!input.canEdit || input.linkedUserUid) return { kind: "hidden" };
  if (input.reservation?.status === "pending") {
    return {
      kind: "pending",
      email: input.reservation.email,
      conflictPersonName: input.reservation.conflictPersonName ?? null,
    };
  }
  return { kind: "create" };
}
