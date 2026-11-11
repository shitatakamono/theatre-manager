import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { assessAccountMerge, hashAccountMergeInventory } from "../lib/account-merge.ts";

function auth(hasGoogle) {
  return {
    exists: true, disabled: false, providers: hasGoogle ? ["google.com"] : ["custom"],
    hasGoogle, hasEmail: hasGoogle, hasDisplayName: true, hasPhotoUrl: false,
    creationTime: null, lastSignInTime: null,
  };
}

function side(memberExists = false, role = null) {
  return { inMemberUids: memberExists, memberExists, role, hasDisplayName: memberExists, hasEmail: false };
}

function project(overrides = {}) {
  return {
    projectId: "project-a",
    primary: side(), secondary: side(),
    primaryPersonIds: [], secondaryPersonIds: [],
    primaryParticipantIds: [], secondaryParticipantIds: [],
    primaryLinkedParticipantId: null, secondaryLinkedParticipantId: null,
    primaryTaskIds: [], secondaryTaskIds: [],
    ...overrides,
  };
}

function inventory(overrides = {}) {
  return {
    primaryUid: "primary", secondaryUid: "secondary",
    auth: { primary: auth(true), secondary: auth(false) },
    projects: [],
    line: { primaryLinked: false, secondaryLinked: false, primaryMappingConsistent: true, secondaryMappingConsistent: true, sameLineIdentity: false },
    calendar: { primaryConnection: false, secondaryConnection: false, primaryMappingCount: 0, secondaryMappingCount: 0 },
    active: { lineAuth: 0, signup: 0, googleOAuth: 0, calendarOperation: 0, inviteClaim: 0 },
    unknownActiveReferences: [], historyReferencesExcluded: true,
    ...overrides,
  };
}

function reasonCodes(result) {
  return result.findings.map((finding) => finding.code);
}

describe("account merge classification", () => {
  it("supports the primary Google plus secondary LINE-only safe pattern", () => {
    const value = inventory({
      projects: [project({ secondary: side(true, "viewer"), secondaryTaskIds: ["task-a", "task-b"] })],
      line: { primaryLinked: false, secondaryLinked: true, primaryMappingConsistent: true, secondaryMappingConsistent: true, sameLineIdentity: false },
    });
    const result = assessAccountMerge(value);
    strictEqual(result.classification, "safe");
    strictEqual(result.plan.some((item) => item.action === "move_secondary_membership"), true);
    strictEqual(result.plan.some((item) => item.action === "reassign_secondary_tasks" && item.count === 2), true);
    strictEqual(result.plan.some((item) => item.action === "move_secondary_line_link"), true);
    strictEqual(result.plan.at(-1).action, "preserve_historical_uid_references");
  });

  it("requires review for role conflicts and a secondary owner", () => {
    const result = assessAccountMerge(inventory({ projects: [project({ primary: side(true, "viewer"), secondary: side(true, "owner") })] }));
    strictEqual(result.classification, "needs_review");
    deepStrictEqual(reasonCodes(result).sort(), ["ROLE_CONFLICT", "SECONDARY_IS_OWNER"]);
  });

  it("blocks different people and allows convergence on the same person", () => {
    const conflict = assessAccountMerge(inventory({ projects: [project({ primaryPersonIds: ["person-a"], secondaryPersonIds: ["person-b"] })] }));
    strictEqual(conflict.classification, "blocked");
    strictEqual(reasonCodes(conflict).includes("PERSON_CONFLICT"), true);
    const same = assessAccountMerge(inventory({ projects: [project({ primaryPersonIds: ["person-a"], secondaryParticipantIds: ["person-a"], secondaryLinkedParticipantId: "person-a" })] }));
    strictEqual(same.classification, "needs_review");
    strictEqual(reasonCodes(same).includes("PERSON_LINK_INCONSISTENT"), true);
    const converged = assessAccountMerge(inventory({ projects: [project({ primaryLinkedParticipantId: "person-a", secondaryLinkedParticipantId: "person-a" })] }));
    strictEqual(converged.classification, "safe");
  });

  it("detects LINE mapping conflicts and two distinct linked identities", () => {
    const inconsistent = assessAccountMerge(inventory({ line: { primaryLinked: false, secondaryLinked: true, primaryMappingConsistent: true, secondaryMappingConsistent: false, sameLineIdentity: false } }));
    strictEqual(inconsistent.classification, "blocked");
    const both = assessAccountMerge(inventory({ line: { primaryLinked: true, secondaryLinked: true, primaryMappingConsistent: true, secondaryMappingConsistent: true, sameLineIdentity: false } }));
    strictEqual(both.classification, "needs_review");
  });

  it("classifies Google provider and Calendar conflicts", () => {
    const bothGoogle = assessAccountMerge(inventory({ auth: { primary: auth(true), secondary: auth(true) } }));
    strictEqual(bothGoogle.classification, "needs_review");
    const secondaryGoogle = assessAccountMerge(inventory({ auth: { primary: auth(false), secondary: auth(true) } }));
    strictEqual(secondaryGoogle.classification, "unsupported");
    const bothCalendar = assessAccountMerge(inventory({ calendar: { primaryConnection: true, secondaryConnection: true, primaryMappingCount: 1, secondaryMappingCount: 1 } }));
    strictEqual(bothCalendar.classification, "needs_review");
  });

  it("blocks active processes and unknown active references but not history", () => {
    const active = assessAccountMerge(inventory({ active: { lineAuth: 1, signup: 1, googleOAuth: 1, calendarOperation: 1, inviteClaim: 1 } }));
    strictEqual(active.classification, "blocked");
    strictEqual(reasonCodes(active).includes("ACTIVE_SIGNUP"), true);
    const unknown = assessAccountMerge(inventory({ unknownActiveReferences: ["mystery.ownerUid"] }));
    strictEqual(unknown.classification, "blocked");
    strictEqual(assessAccountMerge(inventory()).classification, "safe");
  });
});

describe("account merge inventory hash", () => {
  it("is deterministic, order-insensitive for object keys, and changes with inventory", () => {
    const first = inventory();
    const clone = JSON.parse(JSON.stringify(first));
    strictEqual(hashAccountMergeInventory(first), hashAccountMergeInventory(clone));
    clone.active.signup = 1;
    notStrictEqual(hashAccountMergeInventory(first), hashAccountMergeInventory(clone));
    strictEqual(hashAccountMergeInventory(first).length, 43);
  });
});
