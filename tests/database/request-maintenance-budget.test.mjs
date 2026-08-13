import assert from "node:assert/strict";
import test from "node:test";
import {
  runRequestMaintenance,
  shouldReconcilePhase7StarterCopy,
  shouldReconcileScheduledPublication,
  shouldReconcileVisitorEventsCopy,
  shouldReconcileVisitorFeedbackCopy,
  shouldReconcileVisitorFormPageCopy,
  shouldReconcileVisitorPrivacyCopy,
} from "../../lib/server/database/request-maintenance.ts";
import {
  ORGANIZER_PUBLICATION_RECONCILIATION_STATEMENT_MAXIMUM,
} from "../../lib/server/organizer/publication.ts";

const DATABASE_INVARIANT_FAST_PATH = 2;
const PUBLICATION_NO_DUE = 1;
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
    assert.deepEqual(trace, ["visitor-events", "publication"]);
    assert.equal(
      DATABASE_INVARIANT_FAST_PATH + PUBLICATION_NO_DUE,
      3,
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
    assert.deepEqual(trace, ["visitor-events", "publication"]);
    assert.equal(
      DATABASE_INVARIANT_FAST_PATH + PUBLICATION_DUE_MAXIMUM,
      30,
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
    assert.deepEqual(trace, ["visitor-events", "publication"]);
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
  for (const pathname of ["/.rsc", "/calendar.rsc", "/events.rsc"]) {
    assert.equal(
      shouldReconcileScheduledPublication("GET", pathname),
      true,
    );
  }
  assert.equal(
    shouldReconcilePhase7StarterCopy("GET", "/contact.rsc"),
    true,
  );
  assert.equal(
    shouldReconcileVisitorFeedbackCopy("GET", "/contact"),
    true,
  );
  assert.equal(
    shouldReconcileVisitorFeedbackCopy("HEAD", "/contact.rsc"),
    true,
  );
  assert.equal(
    shouldReconcileVisitorFeedbackCopy("GET", "/privacy"),
    false,
  );
  assert.equal(
    shouldReconcileVisitorFeedbackCopy("POST", "/contact"),
    false,
  );
  assert.equal(
    shouldReconcileVisitorEventsCopy("GET", "/events"),
    true,
  );
  assert.equal(
    shouldReconcileVisitorEventsCopy("HEAD", "/events.rsc"),
    true,
  );
  for (const [method, pathname] of [
    ["POST", "/events"],
    ["GET", "/"],
    ["GET", "/events/example"],
    ["GET", "/calendar"],
    ["GET", "/events-more"],
  ]) {
    assert.equal(
      shouldReconcileVisitorEventsCopy(method, pathname),
      false,
    );
  }
  for (const pathname of ["/get-involved", "/host-an-event"]) {
    assert.equal(
      shouldReconcileVisitorFormPageCopy("GET", pathname),
      true,
    );
    assert.equal(
      shouldReconcileVisitorFormPageCopy("HEAD", `${pathname}.rsc`),
      true,
    );
  }
  for (const [method, pathname] of [
    ["POST", "/get-involved"],
    ["GET", "/contact"],
    ["GET", "/privacy"],
    ["GET", "/host-an-event/extra"],
    ["GET", "/get-involved-more"],
  ]) {
    assert.equal(
      shouldReconcileVisitorFormPageCopy(method, pathname),
      false,
    );
  }
  assert.equal(
    shouldReconcileVisitorPrivacyCopy("GET", "/privacy"),
    true,
  );
  assert.equal(
    shouldReconcileVisitorPrivacyCopy("HEAD", "/privacy.rsc"),
    true,
  );
  assert.equal(
    shouldReconcileVisitorPrivacyCopy("GET", "/contact"),
    false,
  );
  assert.equal(
    shouldReconcileVisitorPrivacyCopy("POST", "/privacy"),
    false,
  );
});

test("form-page copy runs after the existing starter upgrade and only on its exact routes", async () => {
  const firstTrace = [];
  const first = await runRequestMaintenance(
    {},
    { method: "GET", pathname: "/get-involved" },
    {
      async reconcilePublication() {
        firstTrace.push("publication");
        return publicationResult();
      },
      async reconcileStarterCopy() {
        firstTrace.push("starter-copy");
        return "processed";
      },
      async reconcileVisitorFormPages() {
        firstTrace.push("visitor-form-pages");
        return "processed";
      },
    },
  );
  assert.deepEqual(first, { kind: "redirect", source: "cms" });
  assert.deepEqual(firstTrace, ["starter-copy"]);

  const nextTrace = [];
  const next = await runRequestMaintenance(
    {},
    { method: "HEAD", pathname: "/host-an-event.rsc" },
    {
      async reconcilePublication() {
        nextTrace.push("publication");
        return publicationResult();
      },
      async reconcileStarterCopy() {
        nextTrace.push("starter-copy");
        return "ready";
      },
      async reconcileVisitorFormPages() {
        nextTrace.push("visitor-form-pages");
        return "processed";
      },
    },
  );
  assert.deepEqual(next, { kind: "redirect", source: "cms" });
  assert.deepEqual(nextTrace, ["starter-copy", "visitor-form-pages"]);

  const contactTrace = [];
  assert.deepEqual(
    await runRequestMaintenance(
      {},
      { method: "GET", pathname: "/contact" },
      {
        async reconcilePublication() {
          contactTrace.push("publication");
          return publicationResult();
        },
        async reconcileStarterCopy() {
          contactTrace.push("starter-copy");
          return "ready";
        },
        async reconcileVisitorFeedback() {
          contactTrace.push("visitor-feedback");
          return "ready";
        },
        async reconcileVisitorFormPages() {
          contactTrace.push("visitor-form-pages");
          return "processed";
        },
      },
    ),
    { kind: "continue" },
  );
  assert.deepEqual(contactTrace, ["starter-copy", "visitor-feedback"]);
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

test("Feedback runs the existing starter upgrade before its dedicated copy upgrade", async () => {
  const firstTrace = [];
  const first = await runRequestMaintenance(
    {},
    { method: "GET", pathname: "/contact" },
    {
      async reconcilePublication() {
        firstTrace.push("publication");
        return publicationResult();
      },
      async reconcileStarterCopy() {
        firstTrace.push("starter-copy");
        return "processed";
      },
      async reconcileVisitorFeedback() {
        firstTrace.push("visitor-feedback");
        return "processed";
      },
    },
  );
  assert.deepEqual(first, { kind: "redirect", source: "cms" });
  assert.deepEqual(firstTrace, ["starter-copy"]);

  const nextTrace = [];
  const next = await runRequestMaintenance(
    {},
    { method: "HEAD", pathname: "/contact.rsc" },
    {
      async reconcilePublication() {
        nextTrace.push("publication");
        return publicationResult();
      },
      async reconcileStarterCopy() {
        nextTrace.push("starter-copy");
        return "ready";
      },
      async reconcileVisitorFeedback() {
        nextTrace.push("visitor-feedback");
        return "processed";
      },
    },
  );
  assert.deepEqual(next, { kind: "redirect", source: "cms" });
  assert.deepEqual(nextTrace, ["starter-copy", "visitor-feedback"]);

  const privacyTrace = [];
  assert.deepEqual(
    await runRequestMaintenance(
      {},
      { method: "GET", pathname: "/privacy" },
      {
        async reconcilePublication() {
          privacyTrace.push("publication");
          return publicationResult();
        },
        async reconcileStarterCopy() {
          privacyTrace.push("starter-copy");
          return "ready";
        },
        async reconcileVisitorFeedback() {
          privacyTrace.push("visitor-feedback");
          return "processed";
        },
        async reconcileVisitorPrivacy() {
          privacyTrace.push("visitor-privacy");
          return "ready";
        },
      },
    ),
    { kind: "continue" },
  );
  assert.deepEqual(privacyTrace, ["starter-copy", "visitor-privacy"]);
});

test("Privacy runs the existing starter upgrade before its dedicated copy upgrade", async () => {
  const firstTrace = [];
  const first = await runRequestMaintenance(
    {},
    { method: "GET", pathname: "/privacy" },
    {
      async reconcilePublication() {
        firstTrace.push("publication");
        return publicationResult();
      },
      async reconcileStarterCopy() {
        firstTrace.push("starter-copy");
        return "processed";
      },
      async reconcileVisitorPrivacy() {
        firstTrace.push("visitor-privacy");
        return "processed";
      },
    },
  );
  assert.deepEqual(first, { kind: "redirect", source: "cms" });
  assert.deepEqual(firstTrace, ["starter-copy"]);

  const nextTrace = [];
  const next = await runRequestMaintenance(
    {},
    { method: "HEAD", pathname: "/privacy.rsc" },
    {
      async reconcilePublication() {
        nextTrace.push("publication");
        return publicationResult();
      },
      async reconcileStarterCopy() {
        nextTrace.push("starter-copy");
        return "ready";
      },
      async reconcileVisitorPrivacy() {
        nextTrace.push("visitor-privacy");
        return "processed";
      },
    },
  );
  assert.deepEqual(next, { kind: "redirect", source: "cms" });
  assert.deepEqual(nextTrace, ["starter-copy", "visitor-privacy"]);

  const contactTrace = [];
  assert.deepEqual(
    await runRequestMaintenance(
      {},
      { method: "GET", pathname: "/contact" },
      {
        async reconcilePublication() {
          contactTrace.push("publication");
          return publicationResult();
        },
        async reconcileStarterCopy() {
          contactTrace.push("starter-copy");
          return "ready";
        },
        async reconcileVisitorFeedback() {
          contactTrace.push("visitor-feedback");
          return "ready";
        },
        async reconcileVisitorPrivacy() {
          contactTrace.push("visitor-privacy");
          return "processed";
        },
      },
    ),
    { kind: "continue" },
  );
  assert.deepEqual(contactTrace, ["starter-copy", "visitor-feedback"]);
});

test("Events copy reconciliation precedes scheduled publication on only the Events route", async () => {
  const firstTrace = [];
  const first = await runRequestMaintenance(
    {},
    { method: "GET", pathname: "/events" },
    {
      async reconcilePublication() {
        firstTrace.push("publication");
        return publicationResult();
      },
      async reconcileVisitorEvents() {
        firstTrace.push("visitor-events");
        return "processed";
      },
    },
  );
  assert.deepEqual(first, { kind: "redirect", source: "cms" });
  assert.deepEqual(firstTrace, ["visitor-events"]);

  const nextTrace = [];
  const next = await runRequestMaintenance(
    {},
    { method: "HEAD", pathname: "/events.rsc" },
    {
      async reconcilePublication() {
        nextTrace.push("publication");
        return publicationResult();
      },
      async reconcileVisitorEvents() {
        nextTrace.push("visitor-events");
        return "ready";
      },
    },
  );
  assert.deepEqual(next, { kind: "continue" });
  assert.deepEqual(nextTrace, ["visitor-events", "publication"]);

  const detailTrace = [];
  const detail = await runRequestMaintenance(
    {},
    { method: "GET", pathname: "/events/example" },
    {
      async reconcilePublication() {
        detailTrace.push("publication");
        return publicationResult();
      },
      async reconcileVisitorEvents() {
        detailTrace.push("visitor-events");
        return "processed";
      },
    },
  );
  assert.deepEqual(detail, { kind: "continue" });
  assert.deepEqual(detailTrace, ["publication"]);
});

async function maintenance(
  trace,
  publication,
) {
  return runRequestMaintenance(
    {},
    { method: "GET", pathname: "/events" },
    {
      async reconcileVisitorEvents() {
        trace.push("visitor-events");
        return "ready";
      },
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
