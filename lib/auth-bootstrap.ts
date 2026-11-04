import type { UserProfile } from "./auth";

export type AuthBootstrapResult = {
  joinedProjects: string[];
  claimedReservationCount: number;
};

export async function completeAuthenticatedUserBootstrap(input: {
  profile: UserProfile;
  claimInvites: (profile: UserProfile) => Promise<string[]>;
  claimReservations: () => Promise<{ claimedCount: number }>;
  syncMemberProfiles: (profile: UserProfile) => Promise<void>;
}): Promise<AuthBootstrapResult> {
  let joinedProjects: string[] = [];
  let claimedReservationCount = 0;

  try {
    joinedProjects = await input.claimInvites(input.profile);
  } catch {
    // Authentication continues. A pending invitation can be retried next login.
  }
  try {
    const result = await input.claimReservations();
    claimedReservationCount = result.claimedCount;
  } catch {
    // Authentication continues. Reservation conflicts remain pending for review.
  }
  try {
    await input.syncMemberProfiles(input.profile);
  } catch {
    // Existing application data remains usable even if profile refresh fails.
  }

  return { joinedProjects, claimedReservationCount };
}
