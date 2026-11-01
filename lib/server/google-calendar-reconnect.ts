import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import {
  runGoogleCalendarReconnectCatchUp,
  selectGoogleCalendarRelatedProjectIds,
  type GoogleCalendarRelatedProjectCandidate,
  type GoogleCalendarReconnectCatchUpResult,
} from "@/lib/google-calendar-reconnect";
import { adminDb } from "@/lib/server/firebase-admin";
import {
  enqueueGoogleCalendarProjectSync,
} from "@/lib/server/google-calendar-sync-jobs";

const DISCOVERY_PAGE_SIZE = 100;

function validId(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && !normalized.includes("/") ? normalized : null;
}

export async function getGoogleCalendarRelatedProjectIdsForUid(
  uid: string
): Promise<string[]> {
  const normalizedUid = validId(uid);
  if (!normalizedUid) throw new Error("uid is required");

  async function loadAll(query: FirebaseFirestore.Query) {
    const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let pageQuery = query
      .orderBy(FieldPath.documentId())
      .limit(DISCOVERY_PAGE_SIZE);
    while (true) {
      const page = await pageQuery.get();
      documents.push(...page.docs);
      if (page.size < DISCOVERY_PAGE_SIZE) return documents;
      pageQuery = query
        .orderBy(FieldPath.documentId())
        .startAfter(page.docs.at(-1)!)
        .limit(DISCOVERY_PAGE_SIZE);
    }
  }

  const [projectDocuments, waitingJobDocuments] = await Promise.all([
    loadAll(adminDb.collection("projects")
      .where("memberUids", "array-contains", normalizedUid)),
    loadAll(adminDb.collection("googleCalendarSyncJobs")
      .where("uid", "==", normalizedUid)),
  ]);

  const projectRefs = projectDocuments.map((document) => document.ref);
  const memberRefs = projectRefs.map((project) =>
    project.collection("members").doc(normalizedUid));
  const linkRefs = projectRefs.map((project) =>
    project.collection("participantLinkedUsers").doc(normalizedUid));
  const [members, links] = await Promise.all([
    memberRefs.length > 0 ? adminDb.getAll(...memberRefs) : [],
    linkRefs.length > 0 ? adminDb.getAll(...linkRefs) : [],
  ]);
  const participantIds = links.map((link) => validId(link.data()?.participantId));
  const personRefs = projectRefs.flatMap((project, index) => {
    const participantId = participantIds[index];
    return participantId ? [project.collection("people").doc(participantId)] : [];
  });
  const people = personRefs.length > 0 ? await adminDb.getAll(...personRefs) : [];
  const existingPersonPaths = new Set(
    people.filter((person) => person.exists).map((person) => person.ref.path)
  );

  const linkedProjectCandidates: GoogleCalendarRelatedProjectCandidate[] =
    projectDocuments.map((project, index) => {
      const participantId = participantIds[index];
      return {
        projectId: project.id,
        memberExists: members[index]?.exists === true,
        linkedParticipantId: participantId,
        personExists: participantId
          ? existingPersonPaths.has(
              project.ref.collection("people").doc(participantId).path
            )
          : false,
      };
    });
  const waitingJobProjectIds = waitingJobDocuments.flatMap((document) => {
    const data = document.data();
    const projectId = validId(data.projectId);
    return data.status === "waiting_connection" && projectId ? [projectId] : [];
  });

  return selectGoogleCalendarRelatedProjectIds({
    linkedProjectCandidates,
    waitingJobProjectIds,
  });
}

export async function enqueueGoogleCalendarReconnectCatchUp(
  uid: string
): Promise<GoogleCalendarReconnectCatchUpResult> {
  return runGoogleCalendarReconnectCatchUp({
    uid,
    discoverProjectIds: getGoogleCalendarRelatedProjectIdsForUid,
    enqueue: enqueueGoogleCalendarProjectSync,
  });
}
