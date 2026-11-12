import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildRehearsalValues,
  buildRehearsalCopyInput,
  getRehearsalChangedFields,
  getNextRehearsals,
  getRehearsalTypeLabel,
  getRehearsalScheduleCapabilities,
  normalizeStoredRehearsalType,
  REHEARSAL_TYPE_OPTIONS,
  timestampToTokyoInput,
  toTokyoTimestamp,
} from "../lib/rehearsals.ts";

const baseInput = {
  date: "2026-11-15",
  startTime: "13:00",
  endTime: "16:00",
  type: "acting",
  customType: "",
  venue: "会議室A",
  content: "立ち稽古",
  note: "台本持参",
};

const clientUrl = new URL("../app/projects/[projectId]/rehearsals/RehearsalClient.tsx", import.meta.url);
const timelineUrl = new URL("../app/projects/[projectId]/rehearsals/RehearsalTimeline.tsx", import.meta.url);
const mobileTimelineUrl = new URL("../app/projects/[projectId]/rehearsals/RehearsalMobileTimeline.tsx", import.meta.url);
const mobileTimelineCssUrl = new URL("../app/projects/[projectId]/rehearsals/rehearsal-mobile-timeline.module.css", import.meta.url);

describe("rehearsal values", () => {
  it("keeps schedule editing for owner and editor while import stays owner-only", () => {
    deepStrictEqual(getRehearsalScheduleCapabilities("owner"), { canEdit: true, canImport: true });
    deepStrictEqual(getRehearsalScheduleCapabilities("editor"), { canEdit: true, canImport: false });
    deepStrictEqual(getRehearsalScheduleCapabilities("viewer"), { canEdit: false, canImport: false });
  });

  it("converts Japanese local date and time to one Timestamp without duplicate date fields", () => {
    const value = buildRehearsalValues(baseInput);
    strictEqual(value.startAt.toDate().toISOString(), "2026-11-15T04:00:00.000Z");
    strictEqual(value.endAt?.toDate().toISOString(), "2026-11-15T07:00:00.000Z");
    deepStrictEqual(timestampToTokyoInput(value.startAt), { date: "2026-11-15", time: "13:00" });
    strictEqual("date" in value, false);
    strictEqual("startTime" in value, false);
  });

  it("accepts an omitted end time and rejects an end time at or before start", () => {
    strictEqual(buildRehearsalValues({ ...baseInput, endTime: "" }).endAt, null);
    throws(() => buildRehearsalValues({ ...baseInput, endTime: "13:00" }), /終了時刻/);
    throws(() => buildRehearsalValues({ ...baseInput, endTime: "12:59" }), /終了時刻/);
  });

  it("requires customType only for other", () => {
    throws(() => buildRehearsalValues({ ...baseInput, type: "other", customType: "" }), /種別名/);
    throws(() => buildRehearsalValues({ ...baseInput, customType: "自主稽古" }), /その他/);
    strictEqual(getRehearsalTypeLabel("other", "自主稽古"), "自主稽古");
  });

  it("keeps the five fixed types in one ordered definition", () => {
    deepStrictEqual(REHEARSAL_TYPE_OPTIONS, [
      { value: "acting", label: "芝居" },
      { value: "stage_combat", label: "殺陣" },
      { value: "japanese_dance", label: "日舞" },
      { value: "meeting", label: "打ち合わせ" },
      { value: "other", label: "その他" },
    ]);
    throws(() => buildRehearsalValues({ ...baseInput, type: "reading" }), /不正/);
    throws(() => buildRehearsalValues({ ...baseInput, type: "run_through" }), /不正/);
  });

  it("reads legacy reading and run-through records as acting without writing them", () => {
    strictEqual(normalizeStoredRehearsalType("reading"), "acting");
    strictEqual(normalizeStoredRehearsalType("run_through"), "acting");
    strictEqual(normalizeStoredRehearsalType("meeting"), "meeting");
  });

  it("returns only changed Japanese field groups", () => {
    const before = buildRehearsalValues(baseInput);
    const after = buildRehearsalValues({ ...baseInput, endTime: "17:00", venue: "和室", content: "" });
    deepStrictEqual(getRehearsalChangedFields(before, after), ["日時", "場所", "内容"]);
    deepStrictEqual(getRehearsalChangedFields(before, buildRehearsalValues(baseInput)), []);
  });

  it("builds a copy from editable fields without document or integration metadata", () => {
    const values = buildRehearsalValues(baseInput);
    const copied = buildRehearsalCopyInput({
      id: "original-rehearsal",
      ...values,
      revision: 7,
      createdAt: "created-at",
      updatedAt: "updated-at",
      createdByUid: "creator",
      updatedByUid: "updater",
      googleEventId: "must-not-be-copied",
      calendarId: "must-not-be-copied",
    });

    deepStrictEqual(copied, baseInput);
    strictEqual("id" in copied, false);
    strictEqual("revision" in copied, false);
    strictEqual("googleEventId" in copied, false);
    strictEqual("calendarId" in copied, false);
  });

  it("rejects invalid calendar values rather than normalizing them", () => {
    throws(() => toTokyoTimestamp("2026-02-30", "13:00"), /正しく/);
    throws(() => toTokyoTimestamp("2026-11-15", "25:00"), /正しく/);
  });

  it("returns every rehearsal sharing the earliest start time", () => {
    const early = buildRehearsalValues(baseInput);
    const late = buildRehearsalValues({ ...baseInput, startTime: "14:00", endTime: "17:00" });
    const items = [
      { id: "late", ...late },
      { id: "early-a", ...early },
      { id: "early-b", ...early },
    ];
    deepStrictEqual(getNextRehearsals(items).map((item) => item.id), ["early-a", "early-b"]);
  });

  it("opens a copy as an unsaved create draft and preserves the original date", async () => {
    const source = await readFile(clientUrl, "utf8");
    strictEqual(source.includes("buildRehearsalCopyInput(editing)"), true);
    strictEqual(source.includes('setMode("copy")'), true);
    strictEqual(source.includes("新しい稽古予定として登録します"), true);
    strictEqual(source.includes("日付を含む内容を確認してから登録してください"), true);
    strictEqual(source.includes("createProjectRehearsal(projectId, draft, actor)"), true);
  });

  it("deletes through the shared transaction helper only after confirmation", async () => {
    const source = await readFile(clientUrl, "utf8");
    strictEqual(source.includes("この操作は取り消せません"), true);
    strictEqual(source.includes("if (!confirmed) return"), true);
    strictEqual(source.includes("deleteProjectRehearsal(db, projectId, item.id"), true);
    strictEqual(source.includes("この稽古予定を削除"), true);
    strictEqual(source.includes("deleteDoc("), false);
  });

  it("keeps timeline blocks as accessible edit buttons for editors only", async () => {
    const [client, timeline] = await Promise.all([
      readFile(clientUrl, "utf8"),
      readFile(timelineUrl, "utf8"),
    ]);
    strictEqual(client.includes("onSelect={canEdit ?"), true);
    strictEqual(client.includes("if (item) openEdit(item)"), true);
    strictEqual(timeline.includes("を編集"), true);
    strictEqual(timeline.includes("onSelect(bar.id)"), true);
  });

  it("uses a mobile-only compact timeline without replacing the desktop or print timeline", async () => {
    const [client, mobileTimeline, mobileCss] = await Promise.all([
      readFile(clientUrl, "utf8"),
      readFile(mobileTimelineUrl, "utf8"),
      readFile(mobileTimelineCssUrl, "utf8"),
    ]);

    strictEqual(client.includes("<RehearsalTimeline model={timelineModel}"), true);
    strictEqual(client.includes("<RehearsalMobileTimeline model={timelineModel}"), true);
    strictEqual(mobileTimeline.includes("buildRehearsalMobileTimelineModel(model)"), true);
    strictEqual(mobileTimeline.includes("予定なし"), true);
    strictEqual(mobileTimeline.includes("onSelect(bar.id)"), true);
    strictEqual(mobileCss.includes("@media screen and (max-width: 700px)"), true);
    strictEqual(mobileCss.includes("overflow: clip"), true);
    strictEqual(mobileCss.includes("@media print"), true);
  });
});
