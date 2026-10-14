import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { removeUndefinedValues } from "../lib/firestore-values.ts";

describe("removeUndefinedValues", () => {
  it("recursively removes undefined object fields and array entries", () => {
    const value = {
      enabled: true,
      quantity: undefined,
      nested: {
        printer: undefined,
        sides: "",
      },
      items: [undefined, { plannedDate: undefined, actualDate: "2026-10-14" }],
    };

    deepStrictEqual(removeUndefinedValues(value), {
      enabled: true,
      nested: { sides: "" },
      items: [{ actualDate: "2026-10-14" }],
    });
    strictEqual(Object.hasOwn(value, "quantity"), true);
  });

  it("preserves false, zero, empty strings, empty arrays, and null", () => {
    const value = {
      enabled: false,
      quantity: 0,
      size: "",
      entries: [],
      note: null,
    };

    deepStrictEqual(removeUndefinedValues(value), value);
  });

  it("sanitizes flyer, poster, and distribution payloads", () => {
    const payload = {
      flyer: {
        enabled: true,
        size: undefined,
        sides: "",
        quantity: undefined,
        printer: undefined,
        submissionPlannedDate: undefined,
        submissionDate: undefined,
        deliveryPlannedDate: undefined,
        deliveryDate: undefined,
        printCost: undefined,
      },
      poster: {
        enabled: true,
        size: undefined,
        sides: undefined,
        quantity: undefined,
        printer: undefined,
        submissionPlannedDate: undefined,
        submissionDate: undefined,
        deliveryPlannedDate: undefined,
        deliveryDate: undefined,
        printCost: undefined,
      },
      distribution: {
        distributionStartDate: "",
        venue: false,
        other: undefined,
        note: "",
      },
    };

    deepStrictEqual(removeUndefinedValues(payload), {
      flyer: { enabled: true, sides: "" },
      poster: { enabled: true },
      distribution: {
        distributionStartDate: "",
        venue: false,
        note: "",
      },
    });
  });

  it("preserves entered flyer and poster quantities and costs", () => {
    const payload = {
      flyer: { enabled: true, quantity: 100, printCost: 12_000 },
      poster: { enabled: true, quantity: 250, printCost: 0 },
    };

    deepStrictEqual(removeUndefinedValues(payload), payload);
  });

  it("leaves non-plain Firestore-compatible values untouched", () => {
    const date = new Date("2026-10-14T00:00:00.000Z");
    const result = removeUndefinedValues({ date });
    strictEqual(result.date, date);
  });
});
