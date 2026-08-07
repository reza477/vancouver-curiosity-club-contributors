import assert from "node:assert/strict";
import test from "node:test";
import {
  runRequestMaintenance,
  schedulePublicMeetupRefresh,
  shouldReconcilePhase7StarterCopy,
  shouldReconcileScheduledPublication,
  shouldRefreshPublicMeetupCalendar,
} from "../../lib/server/database/request-maintenance.ts";
import {
  ORGANIZER_PUBLICATION_RECONCILIATION_STATEMENT_MAXIMUM,
} from "../../lib/server/organizer/publication.ts";

const DATABASE_INVARIANT_FAST_PATH = 2;
const PUBLICATION_NO_DUE = 2;
const PUBLICATION_DUE_MAXIMUM =
  ORGANIZER_PUBLICATION_RECONCILIATION_STATEMENT_MAXIMUM;

test("synchronous request maintenance excludes Meetup refresh work", async (t) => {
  await t.test("no due publication continues to the route within budget", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult(),
    );
    assert.deepEqual(result, { kind: "continue" });
    assert.deepEqual(trace, ["publication"]);
    assert.equal(
      DATABASE_INVARIANT_FAST_PATH + PUBLICATION_NO_DUE,
      4,
    );
  });

  await t.test("a due publication still redirects before route work", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult({ executed: 1, inspected: 1 }),
    );
    assert.deepEqual(result, {
      kind: "redirect",
      source: "publication",
    });
    assert.deepEqual(trace, ["publication"]);
    assert.equal(
      DATABASE_INVARIANT_FAST_PATH + PUBLICATION_DUE_MAXIMUM,
      31,
    );
  });

  await t.test("transient publication failure remains fail closed", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult({
        inspected: 1,
        transientFailures: 1,
      }),
    );
    assert.deepEqual(result, {
      kind: "unavailable",
      source: "publication",
    });
    assert.deepEqual(trace, ["publication"]);
  });
});

test("public Meetup refresh is one bounded background task per eligible request", async (t) => {
  await t.test("rendering can complete while a due refresh remains pending", async () => {
    const tasks = [];
    const failures = [];
    let refreshCalls = 0;
    let releaseRefresh;
    let settled = false;
    const pendingRefresh = new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    const synchronousMaintenance = await maintenance(
      [],
      publicationResult(),
    );
    assert.deepEqual(synchronousMaintenance, { kind: "continue" });

    const scheduled = schedulePublicMeetupRefresh(
      {},
      { method: "GET", pathname: "/events.rsc" },
      (task) => {
        tasks.push(task);
        task.then(() => {
          settled = true;
        });
      },
      (failure) => failures.push(failure),
      {
        async refreshMeetup() {
          refreshCalls += 1;
          return pendingRefresh;
        },
      },
    );

    assert.equal(scheduled, true);
    assert.equal(tasks.length, 1);
    assert.equal(settled, false);
    await Promise.resolve();
    assert.equal(refreshCalls, 1);
    assert.equal(settled, false);

    releaseRefresh(meetupResult("partial"));
    await tasks[0];
    assert.equal(settled, true);
    assert.deepEqual(failures, []);
  });

  await t.test("durable and unexpected failures resolve organizer/log-only", async () => {
    for (const scenario of [
      {
        expectedFailure: "refresh_failed",
        refresh: async () => meetupResult("failed"),
      },
      {
        expectedFailure: "refresh_unavailable",
        refresh: async () => {
          throw new Error("private technical failure");
        },
      },
    ]) {
      const tasks = [];
      const failures = [];
      assert.equal(
        schedulePublicMeetupRefresh(
          {},
          { method: "GET", pathname: "/calendar" },
          (task) => tasks.push(task),
          (failure) => failures.push(failure),
          { refreshMeetup: scenario.refresh },
        ),
        true,
      );
      assert.equal(tasks.length, 1);
      await assert.doesNotReject(tasks[0]);
      assert.deepEqual(failures, [scenario.expectedFailure]);
    }
  });

  await t.test("every eligible document or RSC request registers one refresh", async () => {
    for (const request of [
      { method: "GET", pathname: "/" },
      { method: "HEAD", pathname: "/calendar" },
      { method: "GET", pathname: "/events.rsc" },
    ]) {
      const tasks = [];
      let refreshCalls = 0;
      assert.equal(
        schedulePublicMeetupRefresh(
          {},
          request,
          (task) => tasks.push(task),
          undefined,
          {
            async refreshMeetup() {
              refreshCalls += 1;
              return meetupResult("busy");
            },
          },
        ),
        true,
      );
      assert.equal(tasks.length, 1, request.pathname);
      await tasks[0];
      assert.equal(refreshCalls, 1, request.pathname);
    }
  });

  await t.test("ineligible requests schedule no work", async () => {
    let refreshCalls = 0;
    const tasks = [];
    for (const request of [
      { method: "POST", pathname: "/events" },
      { method: "GET", pathname: "/events/example" },
      { method: "GET", pathname: "/about" },
    ]) {
      assert.equal(
        schedulePublicMeetupRefresh(
          {},
          request,
          (task) => tasks.push(task),
          undefined,
          {
            async refreshMeetup() {
              refreshCalls += 1;
              return meetupResult("not_due");
            },
          },
        ),
        false,
      );
    }
    await Promise.resolve();
    assert.equal(tasks.length, 0);
    assert.equal(refreshCalls, 0);
  });
});

test("only safe read routes run bounded pre-dispatch maintenance", () => {
  for (const pathname of [
    "/contact",
    "/get-involved",
    "/host-an-event",
    "/privacy",
  ]) {
    assert.equal(
      shouldReconcilePhase7StarterCopy("GET", pathname),
      true,
    );
    assert.equal(
      shouldReconcilePhase7StarterCopy("HEAD", pathname),
      true,
    );
  }
  assert.equal(
    shouldReconcilePhase7StarterCopy("POST", "/contact"),
    false,
  );
  assert.equal(
    shouldReconcilePhase7StarterCopy("GET", "/events"),
    false,
  );
  assert.equal(
    shouldReconcileScheduledPublication("GET", "/events"),
    true,
  );
  assert.equal(
    shouldReconcileScheduledPublication("GET", "/calendar"),
    true,
  );
  assert.equal(
    shouldReconcileScheduledPublication("HEAD", "/events/example"),
    true,
  );
  assert.equal(
    shouldReconcileScheduledPublication("POST", "/events"),
    false,
  );
  assert.equal(
    shouldRefreshPublicMeetupCalendar("GET", "/events"),
    true,
  );
  assert.equal(
    shouldRefreshPublicMeetupCalendar("GET", "/"),
    true,
  );
  assert.equal(
    shouldRefreshPublicMeetupCalendar("HEAD", "/calendar"),
    true,
  );
  for (const pathname of ["/.rsc", "/calendar.rsc", "/events.rsc"]) {
    assert.equal(
      shouldReconcileScheduledPublication("GET", pathname),
      true,
    );
    assert.equal(
      shouldRefreshPublicMeetupCalendar("GET", pathname),
      true,
    );
  }
  assert.equal(
    shouldReconcilePhase7StarterCopy("GET", "/contact.rsc"),
    true,
  );
  assert.equal(
    shouldRefreshPublicMeetupCalendar("GET", "/events/example"),
    false,
  );
  assert.equal(
    shouldRefreshPublicMeetupCalendar("POST", "/events"),
    false,
  );
});

test("one starter-copy outcome redirects before ordinary public work", async () => {
  const trace = [];
  const result = await runRequestMaintenance(
    {},
    { method: "GET", pathname: "/contact" },
    {
      async reconcilePublication() {
        trace.push("publication");
        return publicationResult();
      },
      async reconcileStarterCopy() {
        trace.push("starter-copy");
        return "processed";
      },
    },
  );
  assert.deepEqual(result, { kind: "redirect", source: "cms" });
  assert.deepEqual(trace, ["starter-copy"]);
});

async function maintenance(
  trace,
  publication,
) {
  return runRequestMaintenance(
    {},
    { method: "GET", pathname: "/events" },
    {
      async reconcilePublication() {
        trace.push("publication");
        return publication;
      },
    },
  );
}

function publicationResult(overrides = {}) {
  return Object.freeze({
    executed: 0,
    inspected: 0,
    invalidated: 0,
    transientFailures: 0,
    ...overrides,
  });
}

function meetupResult(outcome) {
  return Object.freeze({
    counts: Object.freeze({
      cancelled: 0,
      created: 0,
      rejected: 0,
      removed: 0,
      updated: 0,
    }),
    outcome,
    state: Object.freeze({
      clubId: null,
      enabled: true,
      lastAttemptAt: null,
      lastErrorCode: null,
      lastSuccessAt: null,
      nextRefreshAt: null,
      status: outcome === "partial" ? "partial" : "current",
    }),
  });
}
