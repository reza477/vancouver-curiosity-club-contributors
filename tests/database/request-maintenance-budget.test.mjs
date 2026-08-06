import assert from "node:assert/strict";
import test from "node:test";
import {
  runRequestMaintenance,
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
const MEETUP_NOT_DUE = 1;
const MEETUP_DUE_TWO_ROW_PARTIAL = 32;

test("the Worker maintenance contract separates publication and Meetup refresh invocations", async (t) => {
  await t.test("no due work continues to the route within budget", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult(),
      meetupResult("not_due"),
    );
    assert.deepEqual(result, { kind: "continue" });
    assert.deepEqual(trace, ["publication", "meetup"]);
    assert.equal(
      DATABASE_INVARIANT_FAST_PATH +
        PUBLICATION_NO_DUE +
        MEETUP_NOT_DUE,
      5,
    );
  });

  await t.test("a busy Meetup lease renders the last completed snapshot", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult(),
      meetupResult("busy"),
    );
    assert.deepEqual(result, { kind: "continue" });
    assert.deepEqual(trace, ["publication", "meetup"]);
  });

  await t.test("completed Meetup attempts still redirect before rendering", async () => {
    for (const outcome of [
      "completed",
      "partial",
      "failed",
      "not_modified",
    ]) {
      const trace = [];
      const result = await maintenance(
        trace,
        publicationResult(),
        meetupResult(outcome),
      );
      assert.deepEqual(
        result,
        { kind: "redirect", source: "meetup" },
        outcome,
      );
      assert.deepEqual(trace, ["publication", "meetup"], outcome);
    }
  });

  await t.test("a due Meetup slice redirects before route rendering", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult(),
      meetupResult("partial"),
    );
    assert.deepEqual(result, {
      kind: "redirect",
      source: "meetup",
    });
    assert.deepEqual(trace, ["publication", "meetup"]);
    assert.equal(
      DATABASE_INVARIANT_FAST_PATH +
        PUBLICATION_NO_DUE +
        MEETUP_DUE_TWO_ROW_PARTIAL,
      36,
    );
  });

  await t.test("a due publication redirects before Meetup or route work", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult({ executed: 1, inspected: 1 }),
      meetupResult("partial"),
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

  await t.test("co-due work takes two independently bounded invocations", async () => {
    const firstTrace = [];
    const first = await maintenance(
      firstTrace,
      publicationResult({ executed: 1, inspected: 1 }),
      meetupResult("partial"),
    );
    assert.deepEqual(first, {
      kind: "redirect",
      source: "publication",
    });
    assert.deepEqual(firstTrace, ["publication"]);

    const secondTrace = [];
    const second = await maintenance(
      secondTrace,
      publicationResult(),
      meetupResult("partial"),
    );
    assert.deepEqual(second, {
      kind: "redirect",
      source: "meetup",
    });
    assert.deepEqual(secondTrace, ["publication", "meetup"]);
    assert.deepEqual(
      [
        DATABASE_INVARIANT_FAST_PATH + PUBLICATION_DUE_MAXIMUM,
        DATABASE_INVARIANT_FAST_PATH +
          PUBLICATION_NO_DUE +
          MEETUP_DUE_TWO_ROW_PARTIAL,
      ],
      [31, 36],
    );
  });

  await t.test("transient publication failure returns unavailable without Meetup work", async () => {
    const trace = [];
    const result = await maintenance(
      trace,
      publicationResult({
        inspected: 1,
        transientFailures: 1,
      }),
      meetupResult("partial"),
    );
    assert.deepEqual(result, {
      kind: "unavailable",
      source: "publication",
    });
    assert.deepEqual(trace, ["publication"]);
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
      async refreshMeetup() {
        trace.push("meetup");
        return meetupResult("not_due");
      },
    },
  );
  assert.deepEqual(result, { kind: "redirect", source: "cms" });
  assert.deepEqual(trace, ["starter-copy"]);
});

async function maintenance(
  trace,
  publication,
  meetup,
) {
  return runRequestMaintenance(
    {},
    { method: "GET", pathname: "/events" },
    {
      async reconcilePublication() {
        trace.push("publication");
        return publication;
      },
      async refreshMeetup() {
        trace.push("meetup");
        return meetup;
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
