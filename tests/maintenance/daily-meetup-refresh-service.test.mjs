import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";

const NOW = 2_000_000_000_000;
const REQUEST_ID = "8b6f5b6e-b558-46ed-94ed-297077e83fb6";
let meetupRefresh = async () => {
  throw new Error("The daily updater test did not install a Meetup mock.");
};
let materialize = async () => {
  throw new Error("The daily updater test did not install a snapshot mock.");
};

globalThis.__VCC_DAILY_REFRESH_MEETUP__ = (...args) =>
  meetupRefresh(...args);
globalThis.__VCC_DAILY_REFRESH_MATERIALIZE__ = (...args) =>
  materialize(...args);

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "@/lib/server/meetup" ||
      specifier === "../meetup" ||
      specifier === "../meetup/index"
    ) {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function refreshMeetupCalendarSourceIfDue(...args) { return globalThis.__VCC_DAILY_REFRESH_MEETUP__(...args); }",
        ),
      };
    }
    if (
      specifier ===
        "@/lib/server/public/event-materializations" ||
      specifier === "../public/event-materializations"
    ) {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function refreshPublicEventMaterializations(...args) { return globalThis.__VCC_DAILY_REFRESH_MATERIALIZE__(...args); }",
        ),
      };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});

const {
  MAX_DAILY_MEETUP_REFRESH_PASSES,
  runDailyMeetupRefresh,
} = await import(
  "../../lib/server/maintenance/daily-meetup-refresh.ts?bounded-daily-refresh"
);

test("one HTTP invocation performs exactly one bounded Meetup refresh pass", async () => {
  assert.equal(MAX_DAILY_MEETUP_REFRESH_PASSES, 1);
  const database = Object.freeze({ name: "daily-maintenance-db" });
  const refreshCalls = [];
  meetupRefresh = async (receivedDatabase, options) => {
    refreshCalls.push({ database: receivedDatabase, options });
    return refreshResult("partial", {
      created: 2,
      rejected: 1,
      updated: 3,
    });
  };
  let materializationCalls = 0;
  materialize = async () => {
    materializationCalls += 1;
    return {
      eventDetailCount: 29,
      eventsSnapshotCount: 3,
      homeEventCount: 6,
    };
  };

  const result = await runDailyMeetupRefresh(database, {
    maxPasses: 1,
    nowUtcMs: NOW,
    requestId: REQUEST_ID,
  });

  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].database, database);
  assert.equal(refreshCalls[0].options.nowUtcMs, NOW);
  assert.equal(materializationCalls, 0);
  assert.equal(result.status, "continue");
  assert.equal(result.outcome, "partial");
  assert.deepEqual(result.counts, {
    cancelled: 0,
    created: 2,
    materializations: null,
    passes: 1,
    rejected: 1,
    removed: 0,
    updated: 3,
  });
});

test("completed and unchanged source passes continue so later signed requests can drain other sources", async (t) => {
  for (const outcome of ["completed", "not_modified"]) {
    await t.test(outcome, async () => {
      meetupRefresh = async () => refreshResult(outcome);
      let materializationCalls = 0;
      materialize = async () => {
        materializationCalls += 1;
        return {
          eventDetailCount: 29,
          eventsSnapshotCount: 3,
          homeEventCount: 6,
        };
      };
      const result = await runDailyMeetupRefresh({}, {
        nowUtcMs: NOW,
        requestId: crypto.randomUUID(),
      });
      assert.equal(result.status, "continue");
      assert.equal(result.outcome, outcome);
      assert.equal(result.counts.passes, 1);
      assert.equal(result.counts.materializations, null);
      assert.equal(materializationCalls, 0);
    });
  }
});

test("terminal source outcomes materialize durable public snapshots exactly once", async (t) => {
  for (const outcome of ["not_due", "not_connected", "disabled"]) {
    await t.test(outcome, async () => {
      meetupRefresh = async () => refreshResult(outcome);
      const materializationCalls = [];
      materialize = async (database, options) => {
        materializationCalls.push({ database, options });
        return {
          eventDetailCount: 29,
          eventsSnapshotCount: 3,
          homeEventCount: 6,
        };
      };

      const database = {};
      const result = await runDailyMeetupRefresh(database, {
        nowUtcMs: NOW,
        requestId: crypto.randomUUID(),
      });
      assert.equal(result.status, "succeeded");
      assert.equal(result.outcome, outcome);
      assert.equal(result.counts.passes, 1);
      assert.deepEqual(result.counts.materializations, {
        eventDetailCount: 29,
        eventsSnapshotCount: 3,
        homeEventCount: 6,
      });
      assert.deepEqual(materializationCalls, [
        { database, options: { nowUtcMs: NOW } },
      ]);
    });
  }
});

test("busy, failed, or invalid multi-pass requests fail without materializing", async (t) => {
  for (const outcome of ["failed", "busy"]) {
    await t.test(outcome, async () => {
      meetupRefresh = async () => refreshResult(outcome);
      let materializationCalls = 0;
      materialize = async () => {
        materializationCalls += 1;
        return {
          eventDetailCount: 29,
          eventsSnapshotCount: 3,
          homeEventCount: 6,
        };
      };
      await assert.rejects(
        runDailyMeetupRefresh({}, {
          nowUtcMs: NOW,
          requestId: crypto.randomUUID(),
        }),
        (error) => error?.status === 503,
      );
      assert.equal(materializationCalls, 0);
    });
  }

  let refreshCalls = 0;
  meetupRefresh = async () => {
    refreshCalls += 1;
    return refreshResult("partial");
  };
  await assert.rejects(
    runDailyMeetupRefresh({}, {
      maxPasses: 2,
      nowUtcMs: NOW,
      requestId: REQUEST_ID,
    }),
    (error) => error?.status === 400,
  );
  assert.equal(refreshCalls, 0);
});

test("not-due never materializes while aggregate source state remains unresolved", async (t) => {
  for (const status of ["error", "partial", "pending", "stale"]) {
    await t.test(status, async () => {
      meetupRefresh = async () => ({
        ...refreshResult("not_due"),
        state: {
          ...refreshResult("not_due").state,
          status,
        },
      });
      let materializationCalls = 0;
      materialize = async () => {
        materializationCalls += 1;
        return {
          eventDetailCount: 29,
          eventsSnapshotCount: 3,
          homeEventCount: 6,
        };
      };
      await assert.rejects(
        runDailyMeetupRefresh({}, {
          nowUtcMs: NOW,
          requestId: crypto.randomUUID(),
        }),
        (error) => error?.status === 503,
      );
      assert.equal(materializationCalls, 0);
    });
  }
});

test("terminal source outcomes reject an unsafe event-detail count", async () => {
  meetupRefresh = async () => refreshResult("not_due");
  materialize = async () => ({
    eventDetailCount: "29",
    eventsSnapshotCount: 3,
    homeEventCount: 6,
  });

  await assert.rejects(
    runDailyMeetupRefresh({}, {
      nowUtcMs: NOW,
      requestId: crypto.randomUUID(),
    }),
    (error) => error?.status === 500,
  );
});

function refreshResult(outcome, counts = {}) {
  return {
    counts: {
      cancelled: 0,
      created: 0,
      rejected: 0,
      removed: 0,
      updated: 0,
      ...counts,
    },
    outcome,
    state: {
      clubId: null,
      enabled: true,
      lastAttemptAt: new Date(NOW).toISOString(),
      lastErrorCode: outcome === "failed" ? "internal_error" : null,
      lastSuccessAt: outcome === "completed" ? new Date(NOW).toISOString() : null,
      nextRefreshAt: null,
      status:
        outcome === "partial"
          ? "partial"
          : outcome === "failed"
            ? "error"
            : "current",
    },
  };
}

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
