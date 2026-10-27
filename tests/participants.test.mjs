import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildParticipantValues,
  findLinkedUserDuplicate,
  getParticipantChangedFields,
  SPECIAL_PRACTICE_OPTIONS,
} from "../lib/participants.ts";
import {
  buildRehearsalParticipationTypes,
  formatRehearsalParticipationTypes,
  normalizeRehearsalParticipationTypes,
} from "../lib/rehearsal-participation.ts";

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
      rehearsalParticipationTypes: ["acting"],
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

  it("supports every explicit rehearsal participation combination", () => {
    deepStrictEqual(buildRehearsalParticipationTypes(["acting"], "none"), ["acting"]);
    deepStrictEqual(buildRehearsalParticipationTypes(["japanese_dance"], "none"), ["japanese_dance"]);
    deepStrictEqual(buildRehearsalParticipationTypes(["stage_combat"], "none"), ["stage_combat"]);
    deepStrictEqual(buildRehearsalParticipationTypes(["stage_combat", "acting"], "none"), ["acting", "stage_combat"]);
    deepStrictEqual(
      buildRehearsalParticipationTypes(["stage_combat", "acting", "japanese_dance"], "none"),
      ["acting", "japanese_dance", "stage_combat"]
    );
    strictEqual(formatRehearsalParticipationTypes(["acting", "stage_combat"]), "芝居 / 殺陣");
    throws(() => buildRehearsalParticipationTypes(["meeting"], "none"), /不正/);
    throws(() => buildRehearsalParticipationTypes(["acting", "acting"], "none"), /重複/);
  });

  it("reads legacy special-practice values without migration", () => {
    deepStrictEqual(normalizeRehearsalParticipationTypes(undefined, "none"), ["acting"]);
    deepStrictEqual(normalizeRehearsalParticipationTypes(undefined, "stage_combat"), ["acting", "stage_combat"]);
    deepStrictEqual(normalizeRehearsalParticipationTypes(undefined, "japanese_dance"), ["acting", "japanese_dance"]);
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
