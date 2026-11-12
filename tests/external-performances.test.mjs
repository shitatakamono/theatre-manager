import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildExternalPerformanceValues, filterExternalPerformances,
  getExternalPerformanceCapabilities, getExternalPerformanceChangedFields,
  getInsertionDateTimeLabel, getInsertionStatusLabel, getInsertionSummary, sortExternalPerformances,
} from "../lib/external-performances.ts";

const base = {
  organizationName: " 劇団テスト ", performanceName: " 秋公演 ", startDate: "2026-11-15", endDate: "2026-11-16",
  venue: " テスト劇場 ", contact: " contact@example.test ", contactMethod: " メール ", contactPerson: " 担当者 ", note: " 確認中 ", insertion: null,
};

function item(id, overrides = {}) {
  return { id, ...buildExternalPerformanceValues(base), revision: 0, createdByUid: "u", updatedByUid: "u", ...overrides };
}

describe("external performance values", () => {
  it("requires organization and performance names while keeping other fields optional", () => {
    const value = buildExternalPerformanceValues({ ...base, startDate: "", endDate: "", venue: "" });
    strictEqual(value.organizationName, "劇団テスト");
    strictEqual(value.performanceName, "秋公演");
    strictEqual(value.startDate, "");
    throws(() => buildExternalPerformanceValues({ ...base, organizationName: "" }), /団体名/);
    throws(() => buildExternalPerformanceValues({ ...base, performanceName: "" }), /公演名/);
    throws(() => buildExternalPerformanceValues({ ...base, endDate: "2026-11-14" }), /終了日/);
  });

  it("supports all insertion methods and stores postal details only for postal delivery", () => {
    for (const method of ["with_work", "without_work", "postal"]) {
      const value = buildExternalPerformanceValues({ ...base, insertion: {
        method, dateTimeText: "11/1 14時", quantity: "500", postalAddress: "住所", postalRecipient: "担当者様",
        postalArrivalText: "11/1午前", note: "折込メモ", status: "confirmed",
      }});
      strictEqual(value.insertion?.quantity, 500);
      strictEqual(value.insertion?.postalAddress, method === "postal" ? "住所" : "");
    }
    throws(() => buildExternalPerformanceValues({ ...base, insertion: {
      method: "postal", dateTimeText: "", quantity: "1.5", postalAddress: "", postalRecipient: "",
      postalArrivalText: "", note: "", status: "before_contact",
    }}), /整数/);
  });

  it("allows an undecided quantity but rejects zero, negative, decimal, and oversized values", () => {
    const insertion = { method: "with_work", dateTimeText: "11/20 18時頃", quantity: "", postalAddress: "", postalRecipient: "", postalArrivalText: "", note: "", status: "contacted" };
    const undecided = buildExternalPerformanceValues({ ...base, insertion });
    strictEqual(Object.hasOwn(undecided.insertion ?? {}, "quantity"), false);
    for (const quantity of ["0", "-1", "1.5", "1000001"]) {
      throws(() => buildExternalPerformanceValues({ ...base, insertion: { ...insertion, quantity } }), /整数/);
    }
  });

  it("sorts dated records first and uses organization, performance, and id as stable ties", () => {
    const sorted = sortExternalPerformances([
      item("z", { startDate: "" }), item("b", { startDate: "2026-11-10", organizationName: "B団体" }),
      item("c", { startDate: "2026-11-10", organizationName: "A団体", performanceName: "B公演" }),
      item("a", { startDate: "2026-11-10", organizationName: "A団体", performanceName: "A公演" }),
    ]);
    deepStrictEqual(sorted.map(({ id }) => id), ["a", "c", "b", "z"]);
  });

  it("filters insertion plans and formats summaries without exposing details", () => {
    const pending = item("pending", { insertion: { method: "with_work", dateTimeText: "", quantity: 300, postalAddress: "", postalRecipient: "", postalArrivalText: "", note: "", status: "contacted" } });
    const completed = item("complete", { insertion: { ...pending.insertion, method: "postal", quantity: 500, status: "completed" } });
    const none = item("none");
    deepStrictEqual(filterExternalPerformances([pending, completed, none], "planned").map(({ id }) => id), ["pending", "complete"]);
    deepStrictEqual(filterExternalPerformances([pending, completed, none], "incomplete").map(({ id }) => id), ["pending"]);
    deepStrictEqual(filterExternalPerformances([pending, completed, none], "completed").map(({ id }) => id), ["complete"]);
    strictEqual(getInsertionSummary(null), "―");
    strictEqual(getInsertionSummary(pending.insertion), "300部・持込");
    strictEqual(getInsertionSummary(completed.insertion), "500部・郵送");
    strictEqual(getInsertionSummary({ ...pending.insertion, quantity: undefined }), "部数未定・持込");
    strictEqual(getInsertionDateTimeLabel(pending.insertion), "未定");
    strictEqual(getInsertionDateTimeLabel({ ...pending.insertion, dateTimeText: "11/20 18時頃" }), "11/20 18時頃");
    strictEqual(getInsertionDateTimeLabel({ ...completed.insertion, dateTimeText: "", postalArrivalText: "11/20必着" }), "到着：11/20必着");
    strictEqual(getInsertionStatusLabel(completed.insertion), "完了");
  });

  it("separates insertion-only changes and grants writes only to owner and editor", () => {
    const before = buildExternalPerformanceValues(base);
    const after = buildExternalPerformanceValues({ ...base, insertion: { method: "with_work", dateTimeText: "", quantity: "100", postalAddress: "", postalRecipient: "", postalArrivalText: "", note: "", status: "before_contact" } });
    deepStrictEqual(getExternalPerformanceChangedFields(before, after), ["折込情報追加"]);
    const completed = buildExternalPerformanceValues({ ...base, insertion: { ...after.insertion, quantity: "100", status: "completed" } });
    deepStrictEqual(getExternalPerformanceChangedFields(after, completed), ["折込完了"]);
    deepStrictEqual(getExternalPerformanceChangedFields(completed, before), ["折込情報削除"]);
    deepStrictEqual(getExternalPerformanceCapabilities("owner"), { canView: true, canEdit: true });
    deepStrictEqual(getExternalPerformanceCapabilities("editor"), { canView: true, canEdit: true });
    deepStrictEqual(getExternalPerformanceCapabilities("viewer"), { canView: true, canEdit: false });
  });

  it("keeps internal labels out of the UI and hides editing controls from viewers", async () => {
    const source = await readFile(new URL("../app/projects/[projectId]/external-performances/page.tsx", import.meta.url), "utf8");
    const csvSource = await readFile(new URL("../app/projects/[projectId]/external-performances/ExternalPerformanceCsvImport.tsx", import.meta.url), "utf8");
    strictEqual(source.includes("この公演に折込する"), true);
    strictEqual(source.includes("折込情報を編集"), true);
    strictEqual(source.includes("折込情報も削除されます"), true);
    strictEqual(source.includes("折込情報だけを削除"), true);
    strictEqual(source.includes("折込・受渡日時"), true);
    strictEqual(source.includes("到着日時指定"), true);
    strictEqual(source.includes("未定の場合は空欄"), true);
    strictEqual(source.includes("{canEdit && <div className={styles.rowActions}"), true);
    strictEqual(source.includes("canEdit && <div className={styles.headingActions}"), true);
    strictEqual(csvSource.includes("CSV取込"), true);
    strictEqual(csvSource.includes("重複スキップ"), true);
    strictEqual(csvSource.includes("確認した公演を登録"), true);
  });
});
