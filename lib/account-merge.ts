import { createHash } from "node:crypto";

export type AccountMergeClassification = "safe" | "needs_review" | "blocked" | "unsupported";

export type AccountMergeReasonCode =
  | "PRIMARY_MISSING_GOOGLE"
  | "SECONDARY_ONLY_GOOGLE"
  | "BOTH_HAVE_GOOGLE"
  | "ROLE_CONFLICT"
  | "SECONDARY_IS_OWNER"
  | "MEMBERSHIP_INCONSISTENT"
  | "PERSON_CONFLICT"
  | "PERSON_LINK_INCONSISTENT"
  | "LINE_MAPPING_CONFLICT"
  | "BOTH_HAVE_LINE"
  | "SECONDARY_HAS_CALENDAR"
  | "BOTH_HAVE_CALENDAR"
  | "ACTIVE_LINE_AUTH"
  | "ACTIVE_SIGNUP"
  | "ACTIVE_GOOGLE_OAUTH"
  | "ACTIVE_CALENDAR_OPERATION"
  | "ACTIVE_INVITE_CLAIM"
  | "UNKNOWN_ACTIVE_REFERENCE";

export type AccountAuthInventory = {
  exists: true;
  disabled: boolean;
  providers: string[];
  hasGoogle: boolean;
  hasEmail: boolean;
  hasDisplayName: boolean;
  hasPhotoUrl: boolean;
  creationTime: string | null;
  lastSignInTime: string | null;
};

export type MembershipInventory = {
  projectId: string;
  primary: { inMemberUids: boolean; memberExists: boolean; role: string | null; hasDisplayName: boolean; hasEmail: boolean };
  secondary: { inMemberUids: boolean; memberExists: boolean; role: string | null; hasDisplayName: boolean; hasEmail: boolean };
  primaryPersonIds: string[];
  secondaryPersonIds: string[];
  primaryParticipantIds: string[];
  secondaryParticipantIds: string[];
  primaryLinkedParticipantId: string | null;
  secondaryLinkedParticipantId: string | null;
  primaryTaskIds: string[];
  secondaryTaskIds: string[];
};

export type AccountMergeInventory = {
  primaryUid: string;
  secondaryUid: string;
  auth: { primary: AccountAuthInventory; secondary: AccountAuthInventory };
  projects: MembershipInventory[];
  line: {
    primaryLinked: boolean;
    secondaryLinked: boolean;
    primaryMappingConsistent: boolean;
    secondaryMappingConsistent: boolean;
    sameLineIdentity: boolean;
  };
  calendar: {
    primaryConnection: boolean;
    secondaryConnection: boolean;
    primaryMappingCount: number;
    secondaryMappingCount: number;
  };
  active: {
    lineAuth: number;
    signup: number;
    googleOAuth: number;
    calendarOperation: number;
    inviteClaim: number;
  };
  unknownActiveReferences: string[];
  historyReferencesExcluded: true;
};

export type AccountMergeFinding = {
  classification: Exclude<AccountMergeClassification, "safe">;
  code: AccountMergeReasonCode;
  scope: "auth" | "project" | "person" | "line" | "calendar" | "active" | "unknown";
  projectId?: string;
};

export type AccountMergePlanItem = {
  scope: "membership" | "person" | "task" | "line" | "calendar" | "history";
  action: string;
  projectId?: string;
  count?: number;
  requiresReview: boolean;
};

export type AccountMergeAssessment = {
  classification: AccountMergeClassification;
  findings: AccountMergeFinding[];
  plan: AccountMergePlanItem[];
};

function inconsistentMembership(side: MembershipInventory["primary"]): boolean {
  return side.inMemberUids !== side.memberExists;
}

function personSet(project: MembershipInventory, side: "primary" | "secondary"): Set<string> {
  return new Set([
    ...(side === "primary" ? project.primaryPersonIds : project.secondaryPersonIds),
    ...(side === "primary" ? project.primaryParticipantIds : project.secondaryParticipantIds),
    ...((side === "primary" ? project.primaryLinkedParticipantId : project.secondaryLinkedParticipantId)
      ? [side === "primary" ? project.primaryLinkedParticipantId! : project.secondaryLinkedParticipantId!]
      : []),
  ]);
}

export function assessAccountMerge(inventory: AccountMergeInventory): AccountMergeAssessment {
  const findings: AccountMergeFinding[] = [];
  const plan: AccountMergePlanItem[] = [];
  const add = (finding: AccountMergeFinding) => findings.push(finding);

  if (!inventory.auth.primary.hasGoogle) add({ classification: "unsupported", code: "PRIMARY_MISSING_GOOGLE", scope: "auth" });
  if (!inventory.auth.primary.hasGoogle && inventory.auth.secondary.hasGoogle) add({ classification: "unsupported", code: "SECONDARY_ONLY_GOOGLE", scope: "auth" });
  if (inventory.auth.primary.hasGoogle && inventory.auth.secondary.hasGoogle) add({ classification: "needs_review", code: "BOTH_HAVE_GOOGLE", scope: "auth" });

  for (const project of inventory.projects) {
    if (inconsistentMembership(project.primary) || inconsistentMembership(project.secondary)) {
      add({ classification: "needs_review", code: "MEMBERSHIP_INCONSISTENT", scope: "project", projectId: project.projectId });
    }
    if (project.secondary.memberExists && project.secondary.role === "owner") {
      add({ classification: "needs_review", code: "SECONDARY_IS_OWNER", scope: "project", projectId: project.projectId });
    }
    if (project.primary.memberExists && project.secondary.memberExists && project.primary.role !== project.secondary.role) {
      add({ classification: "needs_review", code: "ROLE_CONFLICT", scope: "project", projectId: project.projectId });
    }
    if (project.secondary.memberExists) {
      plan.push({ scope: "membership", action: project.primary.memberExists ? "converge_membership" : "move_secondary_membership", projectId: project.projectId, requiresReview: project.primary.role !== project.secondary.role });
    }

    const primaryPeople = personSet(project, "primary");
    const secondaryPeople = personSet(project, "secondary");
    const primarySignals = project.primaryPersonIds.length + project.primaryParticipantIds.length + Number(Boolean(project.primaryLinkedParticipantId));
    const secondarySignals = project.secondaryPersonIds.length + project.secondaryParticipantIds.length + Number(Boolean(project.secondaryLinkedParticipantId));
    if (primaryPeople.size > 1 || secondaryPeople.size > 1 || primarySignals > 0 && primaryPeople.size === 0 || secondarySignals > 0 && secondaryPeople.size === 0) {
      add({ classification: "needs_review", code: "PERSON_LINK_INCONSISTENT", scope: "person", projectId: project.projectId });
    }
    const crossLayerMismatch = project.primaryPersonIds.some((id) => project.secondaryParticipantIds.includes(id)
      || project.secondaryLinkedParticipantId === id)
      || project.secondaryPersonIds.some((id) => project.primaryParticipantIds.includes(id)
        || project.primaryLinkedParticipantId === id);
    if (crossLayerMismatch) {
      add({ classification: "needs_review", code: "PERSON_LINK_INCONSISTENT", scope: "person", projectId: project.projectId });
    }
    if (primaryPeople.size && secondaryPeople.size && [...primaryPeople].some((id) => !secondaryPeople.has(id))) {
      add({ classification: "blocked", code: "PERSON_CONFLICT", scope: "person", projectId: project.projectId });
    } else if (secondaryPeople.size) {
      plan.push({ scope: "person", action: "move_or_converge_person_link", projectId: project.projectId, requiresReview: false });
    }
    if (project.secondaryTaskIds.length) {
      plan.push({ scope: "task", action: "reassign_secondary_tasks", projectId: project.projectId, count: project.secondaryTaskIds.length, requiresReview: false });
    }
  }

  if (!inventory.line.primaryMappingConsistent || !inventory.line.secondaryMappingConsistent || inventory.line.sameLineIdentity) {
    add({ classification: "blocked", code: "LINE_MAPPING_CONFLICT", scope: "line" });
  } else if (inventory.line.primaryLinked && inventory.line.secondaryLinked) {
    add({ classification: "needs_review", code: "BOTH_HAVE_LINE", scope: "line" });
  } else if (inventory.line.secondaryLinked) {
    plan.push({ scope: "line", action: "move_secondary_line_link", requiresReview: false });
  }

  if (inventory.calendar.primaryConnection && inventory.calendar.secondaryConnection) {
    add({ classification: "needs_review", code: "BOTH_HAVE_CALENDAR", scope: "calendar" });
  } else if (inventory.calendar.secondaryConnection) {
    add({ classification: "needs_review", code: "SECONDARY_HAS_CALENDAR", scope: "calendar" });
    plan.push({ scope: "calendar", action: "review_secondary_calendar_connection", count: inventory.calendar.secondaryMappingCount, requiresReview: true });
  }

  if (inventory.active.lineAuth) add({ classification: "blocked", code: "ACTIVE_LINE_AUTH", scope: "active" });
  if (inventory.active.signup) add({ classification: "blocked", code: "ACTIVE_SIGNUP", scope: "active" });
  if (inventory.active.googleOAuth) add({ classification: "blocked", code: "ACTIVE_GOOGLE_OAUTH", scope: "active" });
  if (inventory.active.calendarOperation) add({ classification: "blocked", code: "ACTIVE_CALENDAR_OPERATION", scope: "active" });
  if (inventory.active.inviteClaim) add({ classification: "blocked", code: "ACTIVE_INVITE_CLAIM", scope: "active" });
  if (inventory.unknownActiveReferences.length) add({ classification: "blocked", code: "UNKNOWN_ACTIVE_REFERENCE", scope: "unknown" });
  plan.push({ scope: "history", action: "preserve_historical_uid_references", requiresReview: false });

  const classification: AccountMergeClassification = findings.some((item) => item.classification === "blocked")
    ? "blocked"
    : findings.some((item) => item.classification === "unsupported")
      ? "unsupported"
      : findings.some((item) => item.classification === "needs_review")
        ? "needs_review"
        : "safe";
  return { classification, findings, plan };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function hashAccountMergeInventory(inventory: AccountMergeInventory): string {
  return createHash("sha256").update(JSON.stringify(canonical(inventory))).digest("base64url");
}
