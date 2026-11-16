import type { CastMember, StaffRole } from "@/lib/performance";
import { getLegacyRehearsalParticipationTypes } from "@/lib/rehearsal-participation";
import type { RehearsalType } from "@/lib/rehearsals";
import {
  filterGoogleCalendarSyncRehearsals,
  resolveGoogleCalendarSyncTypes,
} from "@/lib/google-calendar-sync-preferences";
import {
  buildGoogleCalendarSyncPreview,
  type GoogleCalendarSyncPreview,
  type GoogleCalendarSyncSourceRehearsal,
} from "@/lib/google-calendar-sync-preview";
import type { GoogleCalendarSyncPerson } from "@/lib/google-calendar-sync";
import { adminDb } from "@/lib/server/firebase-admin";
import { getGoogleCalendarProjectSyncPreference } from "@/lib/server/google-calendar-sync-preferences";

export type GoogleCalendarSyncContext = {
  linked: boolean;
  projectName: string;
  totalRehearsals: number;
  targetCount: number;
  allRehearsals: GoogleCalendarSyncSourceRehearsal[];
  rehearsals: GoogleCalendarSyncSourceRehearsal[];
  selectedTypes: RehearsalType[];
  configured: boolean;
};

export type GoogleCalendarProjectRehearsalContext = {
  projectName: string;
  rehearsals: GoogleCalendarSyncSourceRehearsal[];
  projectData: Record<string, unknown>;
  projectRef: FirebaseFirestore.DocumentReference;
};

export type GoogleCalendarSyncPreviewErrorCode =
  | "not_member"
  | "project_not_found"
  | "linked_person_not_found"
  | "invalid_sync_data"
  | "preview_read_failed";

export class GoogleCalendarSyncPreviewError extends Error {
  readonly code: GoogleCalendarSyncPreviewErrorCode;
  readonly status: number;

  constructor(code: GoogleCalendarSyncPreviewErrorCode, status: number) {
    super(code);
    this.name = "GoogleCalendarSyncPreviewError";
    this.code = code;
    this.status = status;
  }
}

function buildSyncContext(
  preview: GoogleCalendarSyncPreview<string, GoogleCalendarSyncSourceRehearsal>,
  projectName: string,
  allRehearsals: GoogleCalendarSyncSourceRehearsal[],
  selectedTypes: RehearsalType[],
  configured: boolean
): GoogleCalendarSyncContext {
  return {
    linked: preview.linked,
    projectName,
    totalRehearsals: preview.totalRehearsals,
    targetCount: preview.targetCount,
    allRehearsals,
    rehearsals: preview.rehearsals,
    selectedTypes,
    configured,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function timestampToIso(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value)
    || typeof value.toDate !== "function") {
    throw new GoogleCalendarSyncPreviewError("invalid_sync_data", 500);
  }

  const date = value.toDate();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new GoogleCalendarSyncPreviewError("invalid_sync_data", 500);
  }
  return date.toISOString();
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapRehearsal(
  id: string,
  data: FirebaseFirestore.DocumentData
): GoogleCalendarSyncSourceRehearsal {
  const type = optionalString(data.type).trim();
  if (!type) {
    throw new GoogleCalendarSyncPreviewError("invalid_sync_data", 500);
  }

  return {
    rehearsalId: id,
    startAt: timestampToIso(data.startAt),
    endAt: data.endAt == null ? null : timestampToIso(data.endAt),
    type,
    customType: optionalString(data.customType),
    venue: optionalString(data.venue),
    content: optionalString(data.content),
    note: optionalString(data.note),
    revision: Number.isInteger(data.revision) && data.revision >= 0
      ? data.revision
      : 0,
  };
}

function mapPerson(
  id: string,
  data: FirebaseFirestore.DocumentData
): GoogleCalendarSyncPerson<RehearsalType> {
  const participationTypes = Array.isArray(data.rehearsalParticipationTypes)
    ? data.rehearsalParticipationTypes.filter(
        (value: unknown): value is RehearsalType =>
          typeof value === "string"
          && ["acting", "stage_combat", "japanese_dance", "meeting", "other"].includes(value)
      )
    : getLegacyRehearsalParticipationTypes(data.specialPractice);

  return {
    id,
    active: data.active === true,
    rehearsalParticipationTypes: participationTypes,
  };
}

function getProjectName(projectData: Record<string, unknown>): string {
  const performanceInfo = asRecord(projectData.performanceInfo);
  return optionalString(performanceInfo.performanceName).trim()
    || optionalString(performanceInfo.title).trim()
    || optionalString(projectData.title).trim()
    || "公演";
}

export async function getGoogleCalendarSyncContext(
  uid: string,
  projectId: string
): Promise<GoogleCalendarSyncContext> {
  const base = await loadGoogleCalendarProjectRehearsalContext(uid, projectId);
  const { projectName, rehearsals, projectData, projectRef } = base;

  try {
    const [linkedUser, preference] = await Promise.all([
      projectRef.collection("participantLinkedUsers").doc(uid).get(),
      getGoogleCalendarProjectSyncPreference(uid, projectId),
    ]);
    const cast = Array.isArray(projectData.cast)
      ? projectData.cast as CastMember[]
      : [];
    const staff = Array.isArray(projectData.staff)
      ? projectData.staff as StaffRole[]
      : [];

    if (!linkedUser.exists) {
      return buildSyncContext(
        buildGoogleCalendarSyncPreview(null, rehearsals, cast, staff),
        projectName,
        rehearsals,
        preference?.rehearsalTypes ?? [],
        preference !== null
      );
    }

    const participantId = optionalString(linkedUser.data()?.participantId).trim();
    if (!participantId || participantId.includes("/")) {
      throw new GoogleCalendarSyncPreviewError("invalid_sync_data", 500);
    }

    const personSnapshot = await projectRef.collection("people").doc(participantId).get();
    const personData = personSnapshot.data();
    if (!personSnapshot.exists || !personData) {
      throw new GoogleCalendarSyncPreviewError("linked_person_not_found", 409);
    }

    const person = mapPerson(personSnapshot.id, personData);
    const selectedTypes = resolveGoogleCalendarSyncTypes({
      person,
      cast,
      staff,
      configuredTypes: preference?.rehearsalTypes ?? null,
    });
    return buildSyncContext(
      {
        linked: true,
        totalRehearsals: rehearsals.length,
        targetCount: filterGoogleCalendarSyncRehearsals(rehearsals, selectedTypes).length,
        rehearsals: filterGoogleCalendarSyncRehearsals(rehearsals, selectedTypes),
      },
      projectName,
      rehearsals,
      selectedTypes,
      preference !== null
    );
  } catch (error) {
    if (error instanceof GoogleCalendarSyncPreviewError) throw error;
    throw new GoogleCalendarSyncPreviewError("preview_read_failed", 500);
  }
}

export async function loadGoogleCalendarProjectRehearsalContext(
  uid: string,
  projectId: string
): Promise<GoogleCalendarProjectRehearsalContext> {
  const projectRef = adminDb.collection("projects").doc(projectId);

  try {
    const member = await projectRef.collection("members").doc(uid).get();
    if (!member.exists) {
      throw new GoogleCalendarSyncPreviewError("not_member", 403);
    }

    const [project, rehearsalSnapshot] = await Promise.all([
      projectRef.get(),
      projectRef.collection("rehearsals").orderBy("startAt", "asc").get(),
    ]);

    if (!project.exists) {
      throw new GoogleCalendarSyncPreviewError("project_not_found", 404);
    }

    const rehearsals = rehearsalSnapshot.docs.map((snapshot) =>
      mapRehearsal(snapshot.id, snapshot.data())
    );
    const projectData = asRecord(project.data());
    const projectName = getProjectName(projectData);
    return { projectName, rehearsals, projectData, projectRef };
  } catch (error) {
    if (error instanceof GoogleCalendarSyncPreviewError) throw error;
    throw new GoogleCalendarSyncPreviewError("preview_read_failed", 500);
  }
}

export async function getGoogleCalendarSyncPreview(
  uid: string,
  projectId: string
): Promise<GoogleCalendarSyncPreview<string>> {
  const context = await getGoogleCalendarSyncContext(uid, projectId);
  return {
    linked: context.linked,
    totalRehearsals: context.totalRehearsals,
    targetCount: context.targetCount,
    rehearsals: context.rehearsals.map(({
      rehearsalId,
      startAt,
      endAt,
      type,
      customType,
      venue,
      content,
    }) => ({
      rehearsalId,
      startAt,
      endAt,
      type,
      customType,
      venue,
      content,
    })),
  };
}
