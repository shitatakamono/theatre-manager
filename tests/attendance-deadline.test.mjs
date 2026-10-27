import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAttendanceEditDeadline,
  getAttendanceLastEditableDate,
  isSelfAttendanceLocked,
} from "../lib/attendance-deadline.ts";

describe("viewer self-attendance deadline", () => {
  it("locks at midnight JST exactly ten days before rehearsal", () => {
    strictEqual(getAttendanceEditDeadline("2026-11-20").toISOString(), "2026-11-09T15:00:00.000Z");
    strictEqual(getAttendanceLastEditableDate("2026-11-20"), "2026-11-09");
    strictEqual(isSelfAttendanceLocked("2026-11-20", new Date("2026-11-09T14:59:00.000Z")), false);
    strictEqual(isSelfAttendanceLocked("2026-11-20", new Date("2026-11-09T15:00:00.000Z")), true);
  });

  it("keeps the rehearsal day and past days locked", () => {
    strictEqual(isSelfAttendanceLocked("2026-11-20", new Date("2026-11-18T15:00:00.000Z")), true);
    strictEqual(isSelfAttendanceLocked("2026-11-20", new Date("2026-11-19T15:00:00.000Z")), true);
    strictEqual(isSelfAttendanceLocked("2026-11-19", new Date("2026-11-20T00:00:00.000Z")), true);
  });
});
