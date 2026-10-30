import "server-only";

import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/server/firebase-admin";
import { getGoogleCalendarAccessToken } from "@/lib/server/google-calendar-access-token";

const CONNECTIONS_COLLECTION = "googleCalendarConnections";
const GOOGLE_CALENDARS_URL =
  "https://www.googleapis.com/calendar/v3/calendars";
const PROVISIONING_STALE_MILLISECONDS = 5 * 60 * 1000;

export type GoogleCalendarEnsureErrorCode =
  | "not_connected"
  | "connection_lookup_failed"
  | "calendar_lookup_failed"
  | "calendar_provisioning_in_progress"
  | "calendar_provisioning_lost"
  | "calendar_creation_failed"
  | "calendar_response_invalid"
  | "connection_save_failed"
  | "calendar_cleanup_failed";

export class GoogleCalendarEnsureError extends Error {
  readonly code: GoogleCalendarEnsureErrorCode;
  readonly providerStatus: number | null;

  constructor(
    code: GoogleCalendarEnsureErrorCode,
    providerStatus: number | null = null
  ) {
    super(code);
    this.name = "GoogleCalendarEnsureError";
    this.code = code;
    this.providerStatus = providerStatus;
  }
}

export type EnsuredGoogleCalendar = {
  calendarId: string;
  created: boolean;
};

type CalendarProvisioning = {
  status: "creating";
  operationId: string;
  startedAt: Timestamp;
};

type ProvisioningClaim =
  | { kind: "existing"; calendarId: string }
  | { kind: "acquired"; operationId: string };

function getStoredCalendarId(
  data: FirebaseFirestore.DocumentData | undefined
): string {
  return typeof data?.calendarId === "string" ? data.calendarId.trim() : "";
}

function getCalendarProvisioning(
  data: FirebaseFirestore.DocumentData | undefined
): CalendarProvisioning | null {
  const value = data?.calendarProvisioning;

  if (!value || typeof value !== "object") return null;

  return value.status === "creating" &&
    typeof value.operationId === "string" &&
    value.operationId &&
    value.startedAt instanceof Timestamp
    ? {
        status: "creating",
        operationId: value.operationId,
        startedAt: value.startedAt,
      }
    : null;
}

function isActiveProvisioning(
  provisioning: CalendarProvisioning,
  now: Timestamp
): boolean {
  return (
    now.toMillis() - provisioning.startedAt.toMillis() <
    PROVISIONING_STALE_MILLISECONDS
  );
}

async function claimCalendarProvisioning(
  uid: string
): Promise<ProvisioningClaim> {
  const connectionRef = adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid);
  const operationId = randomBytes(18).toString("base64url");

  try {
    return await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(connectionRef);

      if (!snapshot.exists || snapshot.data()?.connected !== true) {
        throw new GoogleCalendarEnsureError("not_connected");
      }

      const calendarId = getStoredCalendarId(snapshot.data());
      if (calendarId) {
        return { kind: "existing", calendarId };
      }

      const now = Timestamp.now();
      const provisioning = getCalendarProvisioning(snapshot.data());

      if (provisioning && isActiveProvisioning(provisioning, now)) {
        throw new GoogleCalendarEnsureError(
          "calendar_provisioning_in_progress"
        );
      }

      transaction.update(connectionRef, {
        calendarProvisioning: {
          status: "creating",
          operationId,
          startedAt: now,
        },
        updatedAt: now,
      });

      return { kind: "acquired", operationId };
    });
  } catch (error) {
    if (error instanceof GoogleCalendarEnsureError) throw error;
    throw new GoogleCalendarEnsureError("connection_lookup_failed");
  }
}

async function claimMissingCalendarProvisioning(
  uid: string,
  missingCalendarId: string
): Promise<ProvisioningClaim> {
  const connectionRef = adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid);
  const operationId = randomBytes(18).toString("base64url");

  try {
    return await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(connectionRef);

      if (!snapshot.exists || snapshot.data()?.connected !== true) {
        throw new GoogleCalendarEnsureError("not_connected");
      }

      const currentCalendarId = getStoredCalendarId(snapshot.data());
      if (currentCalendarId && currentCalendarId !== missingCalendarId) {
        return { kind: "existing", calendarId: currentCalendarId };
      }

      const now = Timestamp.now();
      const provisioning = getCalendarProvisioning(snapshot.data());

      if (provisioning && isActiveProvisioning(provisioning, now)) {
        throw new GoogleCalendarEnsureError(
          "calendar_provisioning_in_progress"
        );
      }

      transaction.update(connectionRef, {
        calendarId: FieldValue.delete(),
        calendarProvisioning: {
          status: "creating",
          operationId,
          startedAt: now,
        },
        updatedAt: now,
      });

      return { kind: "acquired", operationId };
    });
  } catch (error) {
    if (error instanceof GoogleCalendarEnsureError) throw error;
    throw new GoogleCalendarEnsureError("connection_lookup_failed");
  }
}

async function releaseCalendarProvisioning(
  uid: string,
  operationId: string
): Promise<void> {
  const connectionRef = adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid);

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(connectionRef);
    if (!snapshot.exists) return;

    const provisioning = getCalendarProvisioning(snapshot.data());
    if (!provisioning || provisioning.operationId !== operationId) return;

    transaction.update(connectionRef, {
      calendarProvisioning: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
  });
}

async function releaseCalendarProvisioningSafely(
  uid: string,
  operationId: string
): Promise<void> {
  try {
    await releaseCalendarProvisioning(uid, operationId);
  } catch {
    // The lease becomes retryable after the stale timeout.
  }
}

async function createGoogleCalendar(accessToken: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_CALENDARS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: "SeisakuBoard",
        timeZone: "Asia/Tokyo",
      }),
    });
  } catch {
    throw new GoogleCalendarEnsureError("calendar_creation_failed");
  }

  if (!response.ok) {
    throw new GoogleCalendarEnsureError(
      "calendar_creation_failed",
      response.status
    );
  }

  let calendarData: unknown;
  try {
    calendarData = await response.json();
  } catch {
    throw new GoogleCalendarEnsureError(
      "calendar_response_invalid",
      response.status
    );
  }

  const calendarId =
    calendarData &&
    typeof calendarData === "object" &&
    "id" in calendarData &&
    typeof calendarData.id === "string"
      ? calendarData.id.trim()
      : "";

  if (!calendarId) {
    throw new GoogleCalendarEnsureError(
      "calendar_response_invalid",
      response.status
    );
  }

  return calendarId;
}

async function checkGoogleCalendar(
  accessToken: string,
  calendarId: string
): Promise<"exists" | "missing"> {
  let response: Response;
  try {
    response = await fetch(
      `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(calendarId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  } catch {
    throw new GoogleCalendarEnsureError("calendar_lookup_failed");
  }

  if (response.ok) return "exists";
  if (response.status === 404) return "missing";

  throw new GoogleCalendarEnsureError(
    "calendar_lookup_failed",
    response.status
  );
}

async function cleanupGoogleCalendar(
  accessToken: string,
  calendarId: string
): Promise<{ success: boolean; status: number | null }> {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(calendarId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return {
      success: response.ok || response.status === 404 || response.status === 410,
      status: response.status,
    };
  } catch {
    return { success: false, status: null };
  }
}

async function saveProvisionedCalendar(
  uid: string,
  operationId: string,
  calendarId: string
): Promise<EnsuredGoogleCalendar> {
  const connectionRef = adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid);

  try {
    return await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(connectionRef);

      if (!snapshot.exists || snapshot.data()?.connected !== true) {
        throw new GoogleCalendarEnsureError("not_connected");
      }

      const existingCalendarId = getStoredCalendarId(snapshot.data());
      const provisioning = getCalendarProvisioning(snapshot.data());

      if (existingCalendarId) {
        if (provisioning?.operationId === operationId) {
          transaction.update(connectionRef, {
            calendarProvisioning: FieldValue.delete(),
            updatedAt: Timestamp.now(),
          });
        }

        return { calendarId: existingCalendarId, created: false };
      }

      if (!provisioning || provisioning.operationId !== operationId) {
        throw new GoogleCalendarEnsureError("calendar_provisioning_lost");
      }

      transaction.update(connectionRef, {
        calendarId,
        calendarProvisioning: FieldValue.delete(),
        updatedAt: Timestamp.now(),
      });

      return { calendarId, created: true };
    });
  } catch (error) {
    if (error instanceof GoogleCalendarEnsureError) throw error;
    throw new GoogleCalendarEnsureError("connection_save_failed");
  }
}

export async function ensureGoogleCalendar(
  uid: string,
  providedAccessToken?: string
): Promise<EnsuredGoogleCalendar> {
  let claim = await claimCalendarProvisioning(uid);
  let accessToken = providedAccessToken;

  for (let attempt = 0; claim.kind === "existing"; attempt += 1) {
    if (attempt >= 3) {
      throw new GoogleCalendarEnsureError("calendar_lookup_failed");
    }

    accessToken ??= await getGoogleCalendarAccessToken(uid);
    const calendarState = await checkGoogleCalendar(
      accessToken,
      claim.calendarId
    );

    if (calendarState === "exists") {
      return { calendarId: claim.calendarId, created: false };
    }

    claim = await claimMissingCalendarProvisioning(
      uid,
      claim.calendarId
    );
  }

  const { operationId } = claim;
  if (!accessToken) {
    try {
      accessToken = await getGoogleCalendarAccessToken(uid);
    } catch (error) {
      await releaseCalendarProvisioningSafely(uid, operationId);
      throw error;
    }
  }

  let createdCalendarId: string;
  try {
    createdCalendarId = await createGoogleCalendar(accessToken);
  } catch (error) {
    await releaseCalendarProvisioningSafely(uid, operationId);
    throw error;
  }

  let result: EnsuredGoogleCalendar;
  try {
    result = await saveProvisionedCalendar(
      uid,
      operationId,
      createdCalendarId
    );
  } catch (error) {
    const cleanup = await cleanupGoogleCalendar(
      accessToken,
      createdCalendarId
    );
    await releaseCalendarProvisioningSafely(uid, operationId);

    if (!cleanup.success) {
      throw new GoogleCalendarEnsureError(
        "calendar_cleanup_failed",
        cleanup.status
      );
    }

    throw error;
  }

  if (!result.created) {
    const cleanup = await cleanupGoogleCalendar(
      accessToken,
      createdCalendarId
    );
    await releaseCalendarProvisioningSafely(uid, operationId);

    if (!cleanup.success) {
      throw new GoogleCalendarEnsureError(
        "calendar_cleanup_failed",
        cleanup.status
      );
    }
  }

  return result;
}
