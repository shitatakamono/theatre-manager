import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildParticipantValues,
  findLinkedUserDuplicate,
  getParticipantChangedFields,
  SPECIAL_PRACTICE_OPTIONS,
} from "../lib/participants.ts";

const baseInput = {
  displayName: " 田中 太郎 ",
  specialPractice: "none",
  linkedUserUid: null,
  publicNote: " 連絡は夕方以降 ",
  active: true,
};

describe("participant values", () => {
  it("builds a new active participant and trims public values", () => {
    deepStrictEqual(buildParticipantValues(baseInput), {
      displayName: "田中 太郎",
      specialPractice: "none",
      linkedUserUid: null,
      publicNote: "連絡は夕方以降",
      active: true,
    });
  });

  it("rejects an empty display name after trimming", () => {
    throws(() => buildParticipantValues({ ...baseInput, displayName: "   " }), /氏名/);
  });

  it("accepts only the three special practice values", () => {
    deepStrictEqual(SPECIAL_PRACTICE_OPTIONS.map(({ value }) => value), ["none", "stage_combat", "japanese_dance"]);
    strictEqual(buildParticipantValues({ ...baseInput, specialPractice: "stage_combat" }).specialPractice, "stage_combat");
    strictEqual(buildParticipantValues({ ...baseInput, specialPractice: "japanese_dance" }).specialPractice, "japanese_dance");
    throws(() => buildParticipantValues({ ...baseInput, specialPractice: "acting" }), /不正/);
  });

  it("normalizes an empty linked UID to null and accepts active false", () => {
    const values = buildParticipantValues({ ...baseInput, linkedUserUid: "  ", active: false });
    strictEqual(values.linkedUserUid, null);
    strictEqual(values.active, false);
  });

  it("detects a linked UID used by another participant", () => {
    const participants = [
      { id: "participant-a", linkedUserUid: "user-a" },
      { id: "participant-b", linkedUserUid: null },
    ];
    strictEqual(findLinkedUserDuplicate(participants, "user-a"), "participant-a");
    strictEqual(findLinkedUserDuplicate(participants, "user-a", "participant-a"), null);
    strictEqual(findLinkedUserDuplicate(participants, null), null);
  });

  it("returns participant field labels including finish and resume", () => {
    const before = buildParticipantValues(baseInput);
    const finished = buildParticipantValues({ ...baseInput, active: false });
    deepStrictEqual(getParticipantChangedFields(before, finished), ["参加終了"]);
    deepStrictEqual(getParticipantChangedFields(finished, before), ["参加再開"]);
    deepStrictEqual(getParticipantChangedFields(before, before), []);
  });
});
