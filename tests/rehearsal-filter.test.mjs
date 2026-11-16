import { deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_REHEARSAL_FILTER_TYPES,
  filterRehearsalsByTypes,
  parseRehearsalFilterTypes,
  serializeRehearsalFilterTypes,
} from "../lib/rehearsal-filter.ts";

describe("rehearsal display filter", () => {
  const rehearsals = ALL_REHEARSAL_FILTER_TYPES.map((type) => ({ id: type, type }));

  it("defaults to every existing rehearsal type", () => {
    deepStrictEqual(parseRehearsalFilterTypes(null), ALL_REHEARSAL_FILTER_TYPES);
    deepStrictEqual(filterRehearsalsByTypes(rehearsals, ALL_REHEARSAL_FILTER_TYPES), rehearsals);
  });

  it("filters multiple types without changing source order", () => {
    deepStrictEqual(
      filterRehearsalsByTypes(rehearsals, ["acting", "stage_combat"]),
      rehearsals.filter(({ type }) => type === "acting" || type === "stage_combat")
    );
  });

  it("represents an explicit clear-all selection and survives print navigation", () => {
    deepStrictEqual(parseRehearsalFilterTypes(""), []);
    deepStrictEqual(filterRehearsalsByTypes(rehearsals, []), []);
    deepStrictEqual(parseRehearsalFilterTypes(serializeRehearsalFilterTypes([])), []);
  });

  it("ignores unknown and duplicate query values safely", () => {
    deepStrictEqual(
      parseRehearsalFilterTypes("stage_combat,unknown,acting,acting"),
      ["acting", "stage_combat"]
    );
  });
});
