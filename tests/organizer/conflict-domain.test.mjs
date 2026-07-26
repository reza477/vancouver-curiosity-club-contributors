import assert from "node:assert/strict";
import test from "node:test";

import {
  findConflictFacts,
  isPhase4TransitionAllowed,
  isReservingCandidate,
  normalizeAllDayConflictInterval,
  normalizeConflictInterval,
  requiresScheduleForPlanningStatus,
} from "../../lib/server/organizer/conflict-domain.ts";

const HOUR = 60 * 60_000;
const BASE = Date.UTC(2026, 6, 1, 16);

function candidate(overrides = {}) {
  const start = overrides.start ?? BASE;
  const end = overrides.end ?? BASE + 2 * HOUR;
  const before = overrides.before ?? 0;
  const after = overrides.after ?? 0;
  return Object.freeze({
    bufferAfterMinutes: after,
    bufferBeforeMinutes: before,
    candidateKey: overrides.key ?? "manual:event-a",
    clubId: overrides.clubId ?? "club-a",
    eventId: overrides.eventId ?? "event-a",
    holdExpiresAt: overrides.holdExpiresAt ?? null,
    interval: normalizeConflictInterval({
      startUtc: start,
      endUtc: end,
      bufferBeforeMinutes: before,
      bufferAfterMinutes: after,
    }),
    organizationId: overrides.organizationId ?? "org-a",
    organizerProfileIds:
      overrides.organizers ?? ["organizer-primary", "organizer-co"],
    planningStatus: overrides.status ?? "confirmed",
    primaryOrganizerProfileId:
      overrides.primaryOrganizer ?? "organizer-primary",
    scheduleVersion: overrides.version ?? 1,
    source: overrides.source ?? "manual",
    title: overrides.title ?? "Event",
    venueId: overrides.venueId ?? "venue-a",
  });
}

test("direct overlap returns every shared resource deterministically", () => {
  const proposed = candidate({
    key: "manual:proposed",
    eventId: "proposed",
    organizers: ["organizer-primary", "organizer-shared"],
  });
  const existing = candidate({
    key: "manual:existing",
    eventId: "existing",
    organizers: ["organizer-primary", "organizer-shared"],
    start: BASE + HOUR,
    end: BASE + 3 * HOUR,
  });
  const [fact] = findConflictFacts(proposed, [existing], BASE - HOUR);
  assert.equal(fact.classification, "direct");
  assert.equal(fact.overlapStartUtc, BASE + HOUR);
  assert.equal(fact.overlapEndUtc, BASE + 2 * HOUR);
  assert.deepEqual(
    fact.resources.map(({ type }) => type),
    ["organization", "primary_organizer", "co_organizer", "venue"],
  );
});

test("half-open exact boundary does not conflict with zero buffers", () => {
  const proposed = candidate({ key: "p", eventId: "p" });
  const next = candidate({
    key: "n",
    eventId: "n",
    start: BASE + 2 * HOUR,
    end: BASE + 3 * HOUR,
    organizers: ["someone-else"],
    venueId: "venue-b",
  });
  assert.deepEqual(findConflictFacts(proposed, [next], BASE), []);
});

test("cleanup buffer makes the 6:15 start a buffer conflict", () => {
  const sixPm = Date.UTC(2026, 6, 1, 18);
  const proposed = candidate({
    key: "p",
    eventId: "p",
    start: Date.UTC(2026, 6, 1, 16),
    end: sixPm,
    after: 30,
  });
  const next = candidate({
    key: "n",
    eventId: "n",
    start: sixPm + 15 * 60_000,
    end: sixPm + 2 * HOUR,
    before: 0,
    organizers: ["different"],
    venueId: "different",
  });
  const [fact] = findConflictFacts(proposed, [next], BASE);
  assert.equal(fact.classification, "buffer");
  assert.equal(fact.overlapStartUtc, sixPm + 15 * 60_000);
  assert.equal(fact.overlapEndUtc, sixPm + 30 * 60_000);
  assert.deepEqual(
    fact.resources.map(({ type }) => type),
    ["organization"],
  );
});

test("organization-wide overlap crosses clubs, organizers, and venues", () => {
  const proposed = candidate({
    key: "p",
    eventId: "p",
    clubId: "club-a",
    organizers: ["a"],
    venueId: "venue-a",
  });
  const existing = candidate({
    key: "e",
    eventId: "e",
    clubId: "club-b",
    organizers: ["b"],
    venueId: "venue-b",
    start: BASE + HOUR,
    end: BASE + 3 * HOUR,
  });
  const [fact] = findConflictFacts(proposed, [existing], BASE);
  assert.deepEqual(fact.resources, [
    { resourceId: "org-a", type: "organization" },
  ]);
});

test("self edits and non-reserving or expired candidates are excluded", () => {
  const proposed = candidate({ key: "p", eventId: "same" });
  const candidates = [
    candidate({ key: "old-self", eventId: "same" }),
    candidate({ key: "draft", eventId: "draft", status: "draft" }),
    candidate({
      key: "expired",
      eventId: "expired",
      status: "tentative_hold",
      holdExpiresAt: BASE,
    }),
    candidate({ key: "cancelled", eventId: "cancelled", status: "cancelled" }),
    candidate({ key: "completed", eventId: "completed", status: "completed" }),
    candidate({ key: "archived", eventId: "archived", status: "archived" }),
  ];
  assert.deepEqual(findConflictFacts(proposed, candidates, BASE), []);
  assert.equal(
    isReservingCandidate(
      { planningStatus: "tentative_hold", holdExpiresAt: BASE },
      BASE,
    ),
    false,
  );
  assert.equal(
    isReservingCandidate(
      { planningStatus: "tentative_hold", holdExpiresAt: BASE + 1 },
      BASE,
    ),
    true,
  );
  assert.equal(
    isReservingCandidate(
      {
        planningStatus: "tentative_hold",
        holdExpiresAt: null,
        source: "meetup",
      },
      BASE,
    ),
    true,
  );
});

test("all-day normalization honors Vancouver spring and fall DST", () => {
  const spring = normalizeAllDayConflictInterval({
    startDate: "2025-03-09",
    endDateExclusive: "2025-03-10",
    timeZone: "America/Vancouver",
  });
  const fall = normalizeAllDayConflictInterval({
    startDate: "2025-11-02",
    endDateExclusive: "2025-11-03",
    timeZone: "America/Vancouver",
  });
  assert.equal(spring.actualEndUtc - spring.actualStartUtc, 23 * HOUR);
  assert.equal(fall.actualEndUtc - fall.actualStartUtc, 25 * HOUR);
});

test("multi-day, leap-date, overnight, and non-Vancouver ranges normalize", () => {
  const leap = normalizeAllDayConflictInterval({
    startDate: "2028-02-29",
    endDateExclusive: "2028-03-02",
    timeZone: "America/Toronto",
  });
  assert.ok(leap.actualEndUtc > leap.actualStartUtc + 24 * HOUR);
  const overnight = normalizeConflictInterval({
    startUtc: Date.UTC(2026, 6, 1, 23),
    endUtc: Date.UTC(2026, 6, 2, 2),
  });
  assert.equal(overnight.actualEndUtc - overnight.actualStartUtc, 3 * HOUR);
});

test("Phase 4 lifecycle transitions and schedule requirements are explicit", () => {
  assert.equal(isPhase4TransitionAllowed("idea", "tentative_hold"), true);
  assert.equal(isPhase4TransitionAllowed("draft", "confirmed"), true);
  assert.equal(isPhase4TransitionAllowed("tentative_hold", "draft"), true);
  assert.equal(isPhase4TransitionAllowed("confirmed", "completed"), true);
  assert.equal(isPhase4TransitionAllowed("completed", "confirmed"), false);
  assert.equal(isPhase4TransitionAllowed("cancelled", "draft"), false);
  assert.equal(requiresScheduleForPlanningStatus("idea"), false);
  assert.equal(requiresScheduleForPlanningStatus("draft"), true);
  assert.equal(requiresScheduleForPlanningStatus("confirmed"), true);
});
