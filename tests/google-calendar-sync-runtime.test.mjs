import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isGoogleCalendarRetryJobDue,
  runGoogleCalendarPendingJobIfNeeded,
  runGoogleCalendarRetryJobsSequentially,
  shouldRunGoogleCalendarPendingJob,
} from "../lib/google-calendar-sync-runtime.ts";

function job(overrides = {}) {
  return {
    uid: "user-a",
    projectId: "project-a",
    status: "retry",
    generation: 2,
    nextAttemptAtMillis: 1_000,
    ...overrides,
  };
}

describe("Google Calendar pending job trigger", () => {
  it("runs a newly created pending job", () => {
    strictEqual(shouldRunGoogleCalendarPendingJob(null, job({ status: "pending" })), true);
  });

  for (const status of ["running", "retry", "succeeded", "failed", "waiting_connection"]) {
    it(`does not run a ${status} job`, () => {
      strictEqual(shouldRunGoogleCalendarPendingJob(
        job({ status: "pending" }),
        job({ status })
      ), false);
    });
  }

  for (const status of ["running", "retry"]) {
    it(`runs a ${status} to pending transition`, () => {
      strictEqual(shouldRunGoogleCalendarPendingJob(
        job({ status }),
        job({ status: "pending" })
      ), true);
    });
  }

  it("runs when a pending generation increases", () => {
    strictEqual(shouldRunGoogleCalendarPendingJob(
      job({ status: "pending", generation: 2 }),
      job({ status: "pending", generation: 3 })
    ), true);
  });

  it("ignores unrelated updates while status and generation remain pending", () => {
    strictEqual(shouldRunGoogleCalendarPendingJob(
      job({ status: "pending", generation: 2 }),
      job({ status: "pending", generation: 2 })
    ), false);
  });

  it("calls the worker exactly once for one pending transition", async () => {
    const calls = [];
    const invoked = await runGoogleCalendarPendingJobIfNeeded({
      before: job({ status: "running", generation: 2 }),
      after: job({ status: "pending", generation: 2 }),
      runWorker: async (value) => {
        calls.push(value);
        return { kind: "completed" };
      },
    });
    strictEqual(invoked, true);
    deepStrictEqual(calls, [{ uid: "user-a", projectId: "project-a" }]);
  });

  it("does not call the worker for an unrelated pending update", async () => {
    let calls = 0;
    const invoked = await runGoogleCalendarPendingJobIfNeeded({
      before: job({ status: "pending", generation: 2 }),
      after: job({ status: "pending", generation: 2 }),
      runWorker: async () => {
        calls += 1;
        return { kind: "completed" };
      },
    });
    strictEqual(invoked, false);
    strictEqual(calls, 0);
  });

  for (const result of [
    { kind: "not_claimed", claimKind: "in_progress" },
    { kind: "failed", jobStatus: "retry" },
    { kind: "failed", jobStatus: "waiting_connection" },
  ]) {
    it(`treats worker ${result.kind}/${result.jobStatus ?? result.claimKind} as a normal trigger return`, async () => {
      const invoked = await runGoogleCalendarPendingJobIfNeeded({
        before: null,
        after: job({ status: "pending" }),
        runWorker: async () => result,
      });
      strictEqual(invoked, true);
    });
  }
});

describe("Google Calendar retry scheduler", () => {
  it("selects only due retry jobs", () => {
    strictEqual(isGoogleCalendarRetryJobDue(job(), 1_000), true);
    strictEqual(isGoogleCalendarRetryJobDue(job({ nextAttemptAtMillis: 1_001 }), 1_000), false);
    strictEqual(isGoogleCalendarRetryJobDue(job({ status: "pending" }), 1_000), false);
    strictEqual(isGoogleCalendarRetryJobDue(job({ status: "waiting_connection" }), 1_000), false);
    strictEqual(isGoogleCalendarRetryJobDue(job({ status: "failed" }), 1_000), false);
  });

  it("honors the batch limit and processes sequentially", async () => {
    const calls = [];
    let active = 0;
    let maximumActive = 0;
    const result = await runGoogleCalendarRetryJobsSequentially({
      jobs: [
        job({ uid: "user-a" }),
        job({ uid: "user-b" }),
        job({ uid: "user-c" }),
      ],
      nowMillis: 1_000,
      limit: 2,
      runWorker: async ({ uid }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        calls.push(uid);
        await Promise.resolve();
        active -= 1;
        return { kind: "completed" };
      },
    });
    deepStrictEqual(calls, ["user-a", "user-b"]);
    strictEqual(maximumActive, 1);
    deepStrictEqual(result, {
      selectedCount: 2,
      processedCount: 2,
      failedCount: 0,
      errorCodes: [],
    });
  });

  it("continues after one worker invocation throws", async () => {
    const calls = [];
    const result = await runGoogleCalendarRetryJobsSequentially({
      jobs: [job({ uid: "user-a" }), job({ uid: "user-b" })],
      nowMillis: 1_000,
      limit: 10,
      runWorker: async ({ uid }) => {
        calls.push(uid);
        if (uid === "user-a") throw new Error("private provider response");
        return { kind: "not_claimed" };
      },
    });
    deepStrictEqual(calls, ["user-a", "user-b"]);
    deepStrictEqual(result, {
      selectedCount: 2,
      processedCount: 1,
      failedCount: 1,
      errorCodes: ["sync_worker_invocation_failed"],
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["user-a", "token", "secret", "calendarId", "eventId"] ) {
      strictEqual(serialized.includes(forbidden), false);
    }
  });

  it("treats duplicate scheduler execution as safe worker outcomes", async () => {
    const outcomes = [
      await runGoogleCalendarRetryJobsSequentially({
        jobs: [job()],
        nowMillis: 1_000,
        limit: 10,
        runWorker: async () => ({ kind: "completed" }),
      }),
      await runGoogleCalendarRetryJobsSequentially({
        jobs: [job()],
        nowMillis: 1_000,
        limit: 10,
        runWorker: async () => ({ kind: "not_claimed" }),
      }),
    ];
    strictEqual(outcomes.every(({ failedCount }) => failedCount === 0), true);
  });
});
