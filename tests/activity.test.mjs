import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getActivityActorName,
  getChangedFields,
  getProductionActivityDefinition,
} from "../lib/activity.ts";

describe("activity changed fields", () => {
  const flyerFields = getProductionActivityDefinition("flyer", "flyer").fields;

  it("returns only the Japanese labels of values that actually changed", () => {
    deepStrictEqual(
      getChangedFields(
        { enabled: false, quantity: 100, printer: "印刷A" },
        { enabled: true, quantity: 200, printer: "印刷A" },
        flyerFields
      ),
      ["チラシ使用", "チラシ部数"]
    );
  });

  it("returns an empty array when values have not changed", () => {
    deepStrictEqual(getChangedFields({ enabled: false, quantity: 0 }, { enabled: false, quantity: 0 }, flyerFields), []);
  });

  it("coexists with undefined removal without dropping false, zero, empty strings, null, or empty arrays", () => {
    const fields = [
      { path: "missing", label: "未定義" },
      { path: "flag", label: "フラグ" },
      { path: "count", label: "件数" },
      { path: "text", label: "文字列" },
      { path: "nullable", label: "Null" },
      { path: "items", label: "配列" },
    ];
    deepStrictEqual(
      getChangedFields(
        { missing: undefined, flag: false, count: 0, text: "", nullable: null, items: [] },
        { flag: false, count: 0, text: "", nullable: null, items: [] },
        fields
      ),
      []
    );
  });
});

describe("activity actor name", () => {
  it("uses displayName and falls back without copying an email address", () => {
    strictEqual(getActivityActorName({ uid: "user-a", displayName: "田中" }), "田中");
    strictEqual(getActivityActorName({ uid: "user-b", displayName: " " }), "名前未設定のユーザー");
  });
});
