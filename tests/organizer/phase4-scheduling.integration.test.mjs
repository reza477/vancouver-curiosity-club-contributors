import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  getOrganizerConflictPolicy,
  updateOrganizerConflictPolicy,
} from "../../lib/server/organizer/conflict-policy.ts";
import { normalizeAllDayConflictInterval } from "../../lib/server/organizer/conflict-domain.ts";
import {
  listOrganizerConflictCenter,
  markInformationalConflictReviewed,
} from "../../lib/server/organizer/conflicts.ts";
import {
  createOrganizerEvent,
  duplicateOrganizerEvent,
  getOrganizerEvent,
  restoreOrganizerEvent,
  softDeleteOrganizerEvent,
  updateOrganizerEvent,
} from "../../lib/server/organizer/events.ts";
import {
  decideOrganizerConflictReview,
  performOrganizerLifecycleAction,
} from "../../lib/server/organizer/scheduling.ts";
import { reconcileOrganizerHoldNotices } from "../../lib/server/organizer/hold-reconciliation.ts";
import {
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const ownerIdentity = Object.freeze({
  displayName: "Owner",
  email: "owner@example.test",
  source: "sites-siwc",
});
const administratorIdentity = Object.freeze({
  displayName: "Administrator",
  email: "admin@example.test",
  source: "sites-siwc",
});
const assignedOrganizerIdentity = Object.freeze({
  displayName: "Organizer A",
  email: "organizer-a@example.test",
  source: "sites-siwc",
});
const unrelatedOrganizerIdentity = Object.freeze({
  displayName: "Organizer B",
  email: "organizer-b@example.test",
  source: "sites-siwc",
});

test("a timed Draft becomes an active hold through the authoritative D1 write path", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());

  const draft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Independent hold",
      startLocal: "2032-08-15T16:00",
      endLocal: "2032-08-15T18:00",
    }),
  );
  const result = await placeHold(database, ownerIdentity, draft);

  assert.equal(result.outcome, "applied");
  assert.equal(result.reviewRequestId, null);
  assert.equal(result.event.planningStatus, "tentative_hold");
  assert.equal(result.event.publicationStatus, "private");
  assert.equal(result.event.contentVersion, draft.contentVersion + 1);
  assert.equal(result.event.scheduleVersion, draft.scheduleVersion + 1);
  assert.equal(result.event.holdState, "active");

  const reservation = await row(
    database,
    `SELECT planning_status, schedule_version, hold_expires_at,
            write_intent_id
     FROM organizer_reservation_states
     WHERE organizer_event_id = ?`,
    draft.id,
  );
  assert.equal(reservation.planning_status, "tentative_hold");
  assert.equal(reservation.schedule_version, draft.scheduleVersion + 1);
  assert.equal(typeof reservation.hold_expires_at, "number");
  assert.match(reservation.write_intent_id, /^schedule-intent:/u);
  assert.equal(
    (
      await row(
        database,
        `SELECT policy_mode
         FROM organizer_schedule_write_intents
         WHERE id = ?`,
        reservation.write_intent_id,
      )
    ).policy_mode,
    "warn_reason",
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_schedule_write_intents",
      "organizer_event_id = ? AND operation = 'place_hold' AND completed_at IS NOT NULL",
      draft.id,
    ),
    1,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_event_revisions",
      "organizer_event_id = ? AND schedule_version = ?",
      draft.id,
      draft.scheduleVersion + 1,
    ),
    1,
  );
});

test("Organizer lifecycle actions stay ownership and club scoped through the committing batch", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const ownedDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      primaryOrganizerProfileId: "profile-organizer-a",
      title: "Organizer-scoped reservation",
    }),
  );
  await assert.rejects(
    placeHold(database, unrelatedOrganizerIdentity, ownedDraft),
    (error) =>
      error?.code === "not_found" ||
      error?.code === "authorization_denied",
  );
  const held = await placeHold(
    database,
    assignedOrganizerIdentity,
    ownedDraft,
  );
  assert.equal(held.outcome, "applied");
  assert.equal(held.event.planningStatus, "tentative_hold");

  const raceDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      primaryOrganizerProfileId: "profile-organizer-a",
      startLocal: "2032-08-18T18:00",
      endLocal: "2032-08-18T20:00",
      title: "Membership race",
    }),
  );
  const before = await mutationResidueCounts(database, raceDraft.id);
  const originalBatch = database.batch.bind(database);
  let intercepted = false;
  database.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      database.exec(`
        UPDATE organization_memberships
        SET status = 'suspended',
            updated_at = updated_at + 1
        WHERE id = 'membership-a';
      `);
    }
    return originalBatch(statements);
  };
  try {
    await assert.rejects(
      placeHold(database, assignedOrganizerIdentity, raceDraft),
      (error) =>
        error?.code === "authorization_denied" ||
        error?.code === "not_found",
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.equal(intercepted, true);
  assert.deepEqual(
    await mutationResidueCounts(database, raceDraft.id),
    before,
    "a suspended actor must leave no intent, revision, or override residue",
  );
  const unchanged = await getOrganizerEvent(
    database,
    ownerIdentity,
    raceDraft.id,
  );
  assert.equal(unchanged.planningStatus, "draft");
  assert.equal(unchanged.contentVersion, raceDraft.contentVersion);
  assert.equal(unchanged.scheduleVersion, raceDraft.scheduleVersion);

  database.exec(`
    UPDATE organization_memberships
    SET status = 'active',
        updated_at = updated_at + 1
    WHERE id = 'membership-a';
  `);
  const clubRaceDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      primaryOrganizerProfileId: "profile-organizer-a",
      startLocal: "2032-08-19T18:00",
      endLocal: "2032-08-19T20:00",
      title: "Club assignment race",
    }),
  );
  const clubBefore = await mutationResidueCounts(
    database,
    clubRaceDraft.id,
  );
  let clubIntercepted = false;
  database.batch = async (statements) => {
    if (!clubIntercepted) {
      clubIntercepted = true;
      database.exec(`
        UPDATE club_memberships
        SET status = 'suspended',
            updated_at = updated_at + 1
        WHERE id = 'club-a-main';
      `);
    }
    return originalBatch(statements);
  };
  try {
    await assert.rejects(
      placeHold(database, assignedOrganizerIdentity, clubRaceDraft),
      (error) =>
        error?.code === "authorization_denied" ||
        error?.code === "not_found",
    );
  } finally {
    database.batch = originalBatch;
  }
  assert.equal(clubIntercepted, true);
  assert.deepEqual(
    await mutationResidueCounts(database, clubRaceDraft.id),
    clubBefore,
    "a lost club assignment must leave no scheduling residue",
  );
});

test("Warn mode commits a buffer-only overlap with the exact bounded reason and artifacts", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());

  const existingDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Cleanup buffer source",
      startLocal: "2032-08-15T16:00",
      endLocal: "2032-08-15T18:00",
      bufferAfterMinutes: 30,
      venueId: "venue-main",
    }),
  );
  await placeHold(database, ownerIdentity, existingDraft);

  const proposedDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Starts inside cleanup buffer",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2032-08-15T18:15",
      endLocal: "2032-08-15T19:15",
      venueId: "venue-alt",
    }),
  );
  const reason =
    "The groups use separate rooms and the organizers coordinated cleanup.";
  const committed = await placeHold(
    database,
    ownerIdentity,
    proposedDraft,
    reason,
  );

  assert.equal(committed.outcome, "applied");
  assert.equal(committed.event.planningStatus, "tentative_hold");
  const intent = await row(
    database,
    `SELECT id, reason, policy_mode, proposed_schedule_version, completed_at
     FROM organizer_schedule_write_intents
     WHERE organizer_event_id = ?
       AND operation = 'place_hold'
     ORDER BY rowid DESC
     LIMIT 1`,
    proposedDraft.id,
  );
  assert.equal(intent.reason, reason);
  assert.equal(intent.policy_mode, "warn_reason");
  assert.equal(intent.proposed_schedule_version, proposedDraft.scheduleVersion + 1);
  assert.equal(typeof intent.completed_at, "number");

  const incidents = await all(
    database,
    `SELECT classification, resources_json, proposed_schedule_version,
            conflicting_schedule_version, write_intent_id, state
     FROM organizer_conflict_incidents
     WHERE organizer_event_id = ?
       AND write_intent_id = ?
     ORDER BY conflicting_candidate_key, classification`,
    proposedDraft.id,
    intent.id,
  );
  assert.ok(incidents.length >= 1);
  assert.ok(
    incidents.every(
      (incident) =>
        incident.classification === "buffer" &&
        incident.state === "approved" &&
        incident.proposed_schedule_version ===
          proposedDraft.scheduleVersion + 1,
    ),
  );
  assert.ok(
    incidents.some((incident) =>
      JSON.parse(incident.resources_json).some(
        (resource) => resource.type === "organization",
      ),
    ),
  );
  const overrides = await all(
    database,
    `SELECT reason, proposed_schedule_version, conflicting_schedule_version,
            state_fingerprint, actor_profile_id
     FROM organizer_conflict_overrides
     WHERE organizer_event_id = ?
       AND invalidated_at IS NULL`,
    proposedDraft.id,
  );
  assert.equal(overrides.length, incidents.length);
  assert.ok(overrides.every((override) => override.reason === reason));
  assert.ok(
    overrides.every(
      (override) =>
        override.proposed_schedule_version ===
          proposedDraft.scheduleVersion + 1 &&
        override.actor_profile_id === "profile-owner" &&
        typeof override.conflicting_schedule_version === "number" &&
        override.state_fingerprint.length === 64,
    ),
  );
  const center = await listOrganizerConflictCenter(database, ownerIdentity);
  const centerItem = center.find(
    (item) =>
      item.eventA.eventId === proposedDraft.id &&
      item.state === "approved",
  );
  assert.ok(centerItem, "committed overlap remains visible in Conflicts");
  assert.equal(centerItem.state, "approved");
  assert.equal(centerItem.reason, reason);
  assert.ok(
    centerItem.resources.some(
      (resource) => resource.type === "organization",
    ),
  );
  const createdNotification = await row(
    database,
    `SELECT recipient_profile_id, type, payload_json
     FROM notifications
     WHERE type = 'conflict_created'
       AND json_extract(payload_json, '$.eventId') = ?`,
    proposedDraft.id,
  );
  assert.equal(createdNotification.recipient_profile_id, "profile-admin");
  assert.equal(createdNotification.type, "conflict_created");
  assert.deepEqual(JSON.parse(createdNotification.payload_json), {
    eventId: proposedDraft.id,
    title: proposedDraft.title,
  });
  assert.doesNotMatch(createdNotification.payload_json, /coordinated|reason/iu);
});

test("an Organizer on conflict side B can review their informational warning without gaining access to side A", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const organizerAEvent = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Side B organizer event",
      primaryOrganizerProfileId: "profile-organizer-a",
      startLocal: "2032-08-25T18:00",
      endLocal: "2032-08-25T20:00",
    }),
  );
  await placeHold(database, assignedOrganizerIdentity, organizerAEvent);
  const organizerBEvent = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Side A organizer event",
      primaryOrganizerProfileId: "profile-organizer-b",
      startLocal: "2032-08-25T19:00",
      endLocal: "2032-08-25T21:00",
      venueId: "venue-alt",
    }),
  );
  const center = await listOrganizerConflictCenter(
    database,
    assignedOrganizerIdentity,
  );
  const warning = center.find(
    (item) =>
      item.state === "warning" &&
      item.eventA.eventId === organizerBEvent.id &&
      item.eventB.eventId === organizerAEvent.id,
  );
  assert.ok(
    warning,
    "the side-B Organizer sees the shared warning",
  );
  assert.equal(
    warning.allowedActions.some(
      (action) =>
        action.kind === "edit" &&
        action.eventId === organizerBEvent.id,
    ),
    false,
  );
  assert.ok(
    warning.allowedActions.some(
      (action) =>
        action.kind === "mark_reviewed" &&
        action.eventId === organizerAEvent.id,
    ),
  );
  const reviewed = await markInformationalConflictReviewed(
    database,
    assignedOrganizerIdentity,
    warning.id,
  );
  assert.equal(reviewed.state, "resolved");
});

test("Block mode permits at most one of two synchronized reservations for one empty slot", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  await setPolicy(database, "block");

  const first = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Concurrent reservation A",
      startLocal: "2032-09-12T18:00",
      endLocal: "2032-09-12T20:00",
      venueId: "venue-main",
    }),
  );
  const second = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Concurrent reservation B",
      clubId: "club-secondary",
      startLocal: "2032-09-12T18:00",
      endLocal: "2032-09-12T20:00",
      venueId: "venue-alt",
    }),
  );
  const [firstBinding, secondBinding] = synchronizedBatchBindings(database);
  const outcomes = await Promise.allSettled([
    placeHold(firstBinding, ownerIdentity, first),
    placeHold(secondBinding, ownerIdentity, second),
  ]);

  const fulfilled = outcomes.filter(({ status }) => status === "fulfilled");
  const rejected = outcomes.filter(({ status }) => status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "conflict");
  assert.equal(
    await countWhere(
      database,
      "organizer_reservation_states",
      "planning_status = 'tentative_hold'",
    ),
    1,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_events",
      "planning_status = 'tentative_hold'",
    ),
    1,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_schedule_write_intents",
      "operation = 'place_hold' AND completed_at IS NOT NULL",
    ),
    1,
  );
});

test("Administrator-approval mode keeps the request non-reserving until an Owner atomically approves", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  await setPolicy(database, "require_admin_approval");

  const reserved = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Existing reservation",
      startLocal: "2032-10-20T18:00",
      endLocal: "2032-10-20T20:00",
    }),
  );
  await placeHold(database, ownerIdentity, reserved);

  const requestedDraft = await createOrganizerEvent(
    database,
    administratorIdentity,
    timedDraftInput({
      title: "Approval request",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2032-10-20T19:00",
      endLocal: "2032-10-20T21:00",
      venueId: "venue-alt",
    }),
  );
  const pending = await placeHold(
    database,
    administratorIdentity,
    requestedDraft,
    "The Administrator requests an intentional coordinated overlap.",
  );

  assert.equal(pending.outcome, "pending_approval");
  assert.match(pending.reviewRequestId, /^conflict-review:/u);
  assert.equal(pending.event.planningStatus, "draft");
  assert.equal(pending.event.scheduleVersion, requestedDraft.scheduleVersion);
  assert.equal(
    await countWhere(
      database,
      "organizer_reservation_states",
      "organizer_event_id = ? AND planning_status = 'tentative_hold'",
      requestedDraft.id,
    ),
    0,
  );
  const reviewBefore = await row(
    database,
    `SELECT state, requester_profile_id, requested_schedule_version
     FROM organizer_conflict_review_requests
     WHERE id = ?`,
    pending.reviewRequestId,
  );
  assert.equal(reviewBefore.state, "pending");
  assert.equal(reviewBefore.requester_profile_id, "profile-admin");
  assert.equal(
    reviewBefore.requested_schedule_version,
    requestedDraft.scheduleVersion + 1,
  );
  assert.deepEqual(
    (
      await all(
        database,
        `SELECT recipient_profile_id, type
         FROM notifications
         WHERE type = 'conflict_review_requested'
           AND json_extract(payload_json, '$.eventId') = ?
         ORDER BY recipient_profile_id`,
        requestedDraft.id,
      )
    ).map((notification) => ({ ...notification })),
    [
      {
        recipient_profile_id: "profile-owner",
        type: "conflict_review_requested",
      },
    ],
  );

  const approved = await decideOrganizerConflictReview(
    database,
    ownerIdentity,
    pending.reviewRequestId,
    {
      decision: "approve",
      note: "Approved after direct coordination.",
    },
  );
  assert.equal(approved.decision, "approve");
  assert.equal(approved.event.planningStatus, "tentative_hold");
  assert.equal(
    approved.event.scheduleVersion,
    requestedDraft.scheduleVersion + 1,
  );
  const reviewAfter = await row(
    database,
    `SELECT state, decided_by_profile_id, decision_note
     FROM organizer_conflict_review_requests
     WHERE id = ?`,
    pending.reviewRequestId,
  );
  assert.equal(reviewAfter.state, "approved");
  assert.equal(reviewAfter.decided_by_profile_id, "profile-owner");
  assert.equal(reviewAfter.decision_note, "Approved after direct coordination.");
  assert.ok(
    (await countWhere(
      database,
      "organizer_conflict_overrides",
      "organizer_event_id = ? AND review_request_id = ? AND invalidated_at IS NULL",
      requestedDraft.id,
      pending.reviewRequestId,
    )) >= 1,
  );
  assert.deepEqual(
    (
      await all(
        database,
        `SELECT recipient_profile_id, type
         FROM notifications
         WHERE type = 'conflict_approved'
           AND json_extract(payload_json, '$.eventId') = ?
         ORDER BY recipient_profile_id`,
        requestedDraft.id,
      )
    ).map((notification) => ({ ...notification })),
    [
      {
        recipient_profile_id: "profile-admin",
        type: "conflict_approved",
      },
    ],
  );
});

test("policy changes atomically invalidate exact-version conflict artifacts while stale CAS preserves them", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());

  const reserved = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Policy-bound reservation",
      startLocal: "2032-10-28T18:00",
      endLocal: "2032-10-28T20:00",
    }),
  );
  await placeHold(database, ownerIdentity, reserved);
  const warnedDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Warn-policy overlap",
      startLocal: "2032-10-28T19:00",
      endLocal: "2032-10-28T21:00",
      venueId: "venue-alt",
    }),
  );
  const warned = await confirmEvent(
    database,
    ownerIdentity,
    warnedDraft,
    "The owner recorded a coordinated policy-bound overlap.",
  );
  assert.equal(warned.outcome, "applied");
  assert.ok(
    (await countWhere(
      database,
      "organizer_conflict_overrides",
      "organizer_event_id = ? AND invalidated_at IS NULL",
      warnedDraft.id,
    )) >= 1,
  );

  const warnPolicy = await getOrganizerConflictPolicy(
    database,
    ownerIdentity,
  );
  const blockPolicy = await updateOrganizerConflictPolicy(
    database,
    ownerIdentity,
    {
      defaultHoldHours: warnPolicy.defaultHoldHours,
      expectedPolicyVersion: warnPolicy.version,
      mode: "block",
      nearingExpiryHours: warnPolicy.nearingExpiryHours,
    },
  );
  assert.equal(blockPolicy.mode, "block");
  assert.equal(blockPolicy.version, warnPolicy.version + 1);
  await ensureReady(database);
  assert.equal(
    (
      await row(
        database,
        `SELECT policy_version
         FROM organizer_reservation_states
         WHERE organizer_event_id = ?`,
        reserved.id,
      )
    ).policy_version,
    warnPolicy.version,
    "a policy change preserves the reservation's historical write version",
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_conflict_overrides",
      "policy_version = ? AND invalidated_at IS NULL",
      warnPolicy.version,
    ),
    0,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_conflict_incidents",
      "policy_version = ? AND state IN ('open', 'pending_approval', 'approved', 'informational')",
      warnPolicy.version,
    ),
    0,
  );

  const approvalPolicy = await updateOrganizerConflictPolicy(
    database,
    ownerIdentity,
    {
      defaultHoldHours: blockPolicy.defaultHoldHours,
      expectedPolicyVersion: blockPolicy.version,
      mode: "require_admin_approval",
      nearingExpiryHours: blockPolicy.nearingExpiryHours,
    },
  );
  const requestedDraft = await createOrganizerEvent(
    database,
    administratorIdentity,
    timedDraftInput({
      title: "Policy-change pending request",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2032-10-28T18:30",
      endLocal: "2032-10-28T20:30",
      venueId: "venue-alt",
    }),
  );
  const pending = await placeHold(
    database,
    administratorIdentity,
    requestedDraft,
    "The Administrator requests a version-bound approval.",
  );
  assert.equal(pending.outcome, "pending_approval");

  await assert.rejects(
    updateOrganizerConflictPolicy(database, ownerIdentity, {
      defaultHoldHours: approvalPolicy.defaultHoldHours,
      expectedPolicyVersion: blockPolicy.version,
      mode: "warn_reason",
      nearingExpiryHours: approvalPolicy.nearingExpiryHours,
    }),
    (error) => error?.status === 409 && error?.code === "stale_edit",
  );
  assert.equal(
    (
      await row(
        database,
        `SELECT state
         FROM organizer_conflict_review_requests
         WHERE id = ?`,
        pending.reviewRequestId,
      )
    ).state,
    "pending",
  );
  assert.ok(
    (await countWhere(
      database,
      "organizer_conflict_incidents",
      "review_request_id = ? AND state = 'pending_approval'",
      pending.reviewRequestId,
    )) >= 1,
  );

  const finalPolicy = await updateOrganizerConflictPolicy(
    database,
    ownerIdentity,
    {
      defaultHoldHours: approvalPolicy.defaultHoldHours,
      expectedPolicyVersion: approvalPolicy.version,
      mode: "warn_reason",
      nearingExpiryHours: approvalPolicy.nearingExpiryHours,
    },
  );
  assert.equal(finalPolicy.version, approvalPolicy.version + 1);
  await ensureReady(database);
  assert.equal(
    (
      await row(
        database,
        `SELECT state
         FROM organizer_conflict_review_requests
         WHERE id = ?`,
        pending.reviewRequestId,
      )
    ).state,
    "invalidated",
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_conflict_incidents",
      "review_request_id = ? AND state <> 'invalidated'",
      pending.reviewRequestId,
    ),
    0,
  );
});

test("a rejected review mutates no event schedule and a fresh request can be made", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  await setPolicy(database, "require_admin_approval");

  const existing = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Existing hold",
      startLocal: "2032-11-08T17:00",
      endLocal: "2032-11-08T19:00",
    }),
  );
  await placeHold(database, ownerIdentity, existing);
  const proposed = await createOrganizerEvent(
    database,
    administratorIdentity,
    timedDraftInput({
      title: "Rejected then retried",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2032-11-08T18:00",
      endLocal: "2032-11-08T20:00",
      venueId: "venue-alt",
    }),
  );

  const firstRequest = await placeHold(
    database,
    administratorIdentity,
    proposed,
    "First bounded request reason.",
  );
  const revisionCount = await countWhere(
    database,
    "organizer_event_revisions",
    "organizer_event_id = ?",
    proposed.id,
  );
  const intentCount = await countWhere(
    database,
    "organizer_schedule_write_intents",
    "organizer_event_id = ?",
    proposed.id,
  );
  await decideOrganizerConflictReview(
    database,
    ownerIdentity,
    firstRequest.reviewRequestId,
    { decision: "reject", note: "Choose another time first." },
  );
  const afterReject = await getOrganizerEvent(
    database,
    ownerIdentity,
    proposed.id,
  );
  assert.equal(afterReject.planningStatus, "draft");
  assert.equal(afterReject.contentVersion, proposed.contentVersion);
  assert.equal(afterReject.scheduleVersion, proposed.scheduleVersion);
  assert.equal(
    await countWhere(
      database,
      "organizer_event_revisions",
      "organizer_event_id = ?",
      proposed.id,
    ),
    revisionCount,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_schedule_write_intents",
      "organizer_event_id = ?",
      proposed.id,
    ),
    intentCount,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_conflict_overrides",
      "organizer_event_id = ?",
      proposed.id,
    ),
    0,
  );
  assert.deepEqual(
    (
      await all(
        database,
        `SELECT recipient_profile_id, type
         FROM notifications
         WHERE type = 'conflict_rejected'
           AND json_extract(payload_json, '$.eventId') = ?`,
        proposed.id,
      )
    ).map((notification) => ({ ...notification })),
    [
      {
        recipient_profile_id: "profile-admin",
        type: "conflict_rejected",
      },
    ],
  );

  const secondRequest = await placeHold(
    database,
    administratorIdentity,
    proposed,
    "A fresh request after the rejection.",
  );
  assert.equal(secondRequest.outcome, "pending_approval");
  assert.notEqual(secondRequest.reviewRequestId, firstRequest.reviewRequestId);
  assert.equal(
    await countWhere(
      database,
      "organizer_conflict_review_requests",
      "organizer_event_id = ? AND state = 'pending'",
      proposed.id,
    ),
    1,
  );
});

test("a schedule edit invalidates a pending approval and stale approval leaves no mutation residue", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  await setPolicy(database, "require_admin_approval");

  const existing = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Reservation before stale review",
      startLocal: "2033-01-15T18:00",
      endLocal: "2033-01-15T20:00",
    }),
  );
  await placeHold(database, ownerIdentity, existing);
  const originalInput = timedDraftInput({
    title: "Request that becomes stale",
    primaryOrganizerProfileId: "profile-admin",
    startLocal: "2033-01-15T19:00",
    endLocal: "2033-01-15T21:00",
    venueId: "venue-alt",
  });
  const proposed = await createOrganizerEvent(
    database,
    administratorIdentity,
    originalInput,
  );
  const request = await placeHold(
    database,
    administratorIdentity,
    proposed,
    "Request before the schedule changes.",
  );
  const edited = await updateOrganizerEvent(
    database,
    administratorIdentity,
    proposed.id,
    proposed.contentVersion,
    {
      ...originalInput,
      startLocal: "2033-01-15T19:15",
      endLocal: "2033-01-15T21:15",
    },
  );
  assert.equal(edited.scheduleVersion, proposed.scheduleVersion + 1);
  const countsBeforeApproval = await mutationResidueCounts(database, proposed.id);

  await assert.rejects(
    decideOrganizerConflictReview(
      database,
      ownerIdentity,
      request.reviewRequestId,
      { decision: "approve", note: "This approval is stale." },
    ),
    (error) =>
      error?.status === 409 ||
      error?.status === 404,
  );
  assert.deepEqual(
    await mutationResidueCounts(database, proposed.id),
    countsBeforeApproval,
  );
  const after = await getOrganizerEvent(database, ownerIdentity, proposed.id);
  assert.equal(after.planningStatus, "draft");
  assert.equal(after.contentVersion, edited.contentVersion);
  assert.equal(after.scheduleVersion, edited.scheduleVersion);
  assert.notEqual(
    (
      await row(
        database,
        `SELECT state
         FROM organizer_conflict_review_requests
         WHERE id = ?`,
        request.reviewRequestId,
      )
    ).state,
    "approved",
  );
});

test("changing a venue increments the distinct content and schedule versions and updates the guarded reservation projection", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());

  const input = timedDraftInput({
    title: "Venue version proof",
    venueId: "venue-main",
    startLocal: "2033-02-12T18:00",
    endLocal: "2033-02-12T20:00",
  });
  const draft = await createOrganizerEvent(database, ownerIdentity, input);
  const edited = await updateOrganizerEvent(
    database,
    ownerIdentity,
    draft.id,
    draft.contentVersion,
    { ...input, venueId: "venue-alt" },
  );

  assert.equal(edited.venueId, "venue-alt");
  assert.equal(edited.contentVersion, draft.contentVersion + 1);
  assert.equal(edited.scheduleVersion, draft.scheduleVersion + 1);
  const projected = await row(
    database,
    `SELECT venue_id, schedule_version, planning_status
     FROM organizer_reservation_states
     WHERE organizer_event_id = ?`,
    draft.id,
  );
  assert.equal(projected.venue_id, "venue-alt");
  assert.equal(projected.schedule_version, edited.scheduleVersion);
  assert.equal(projected.planning_status, "draft");
});

test("held and confirmed schedule edits use the same authoritative guard, policy, and stale CAS", async (t) => {
  await t.test("Warn reason atomically edits a hold across time, venue, buffers, and organizer scope", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    const existing = await createOrganizerEvent(
      database,
      ownerIdentity,
      timedDraftInput({
        title: "Existing edit conflict",
        startLocal: "2033-02-18T18:00",
        endLocal: "2033-02-18T20:00",
      }),
    );
    await placeHold(database, ownerIdentity, existing);
    const targetInput = timedDraftInput({
      title: "Held event to reschedule",
      startLocal: "2033-02-18T20:00",
      endLocal: "2033-02-18T22:00",
      venueId: "venue-alt",
    });
    const targetDraft = await createOrganizerEvent(
      database,
      ownerIdentity,
      targetInput,
    );
    const held = (await placeHold(database, ownerIdentity, targetDraft)).event;
    const reason =
      "Both organizers confirmed the shared interval and separate rooms.";
    const edited = await updateOrganizerEvent(
      database,
      ownerIdentity,
      targetDraft.id,
      held.contentVersion,
      {
        ...targetInput,
        bufferAfterMinutes: 20,
        bufferBeforeMinutes: 15,
        coOrganizerProfileIds: ["profile-admin"],
        planningStatus: "tentative_hold",
        startLocal: "2033-02-18T19:00",
        endLocal: "2033-02-18T21:00",
        venueId: "venue-main",
      },
      held.scheduleVersion,
      reason,
    );
    assert.equal(edited.planningStatus, "tentative_hold");
    assert.equal(edited.venueId, "venue-main");
    assert.deepEqual(edited.coOrganizerProfileIds, ["profile-admin"]);
    assert.equal(edited.bufferBeforeMinutes, 15);
    assert.equal(edited.bufferAfterMinutes, 20);
    assert.equal(edited.contentVersion, held.contentVersion + 1);
    assert.equal(edited.scheduleVersion, held.scheduleVersion + 1);
    const reservation = await row(
      database,
      `SELECT venue_id, organizer_scope_json, buffer_before_minutes,
              buffer_after_minutes, schedule_version
       FROM organizer_reservation_states
       WHERE organizer_event_id = ?`,
      targetDraft.id,
    );
    assert.equal(reservation.venue_id, "venue-main");
    assert.deepEqual(JSON.parse(reservation.organizer_scope_json), [
      "profile-admin",
      "profile-owner",
    ]);
    assert.equal(reservation.buffer_before_minutes, 15);
    assert.equal(reservation.buffer_after_minutes, 20);
    assert.equal(reservation.schedule_version, edited.scheduleVersion);
    assert.ok(
      (await countWhere(
        database,
        "organizer_conflict_overrides",
        "organizer_event_id = ? AND proposed_schedule_version = ? AND reason = ? AND invalidated_at IS NULL",
        targetDraft.id,
        edited.scheduleVersion,
        reason,
      )) >= 1,
    );
  });

  await t.test("confirmed schedule edits remain confirmed and guarded", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    const input = timedDraftInput({
      title: "Confirmed event edit",
      startLocal: "2033-02-19T18:00",
      endLocal: "2033-02-19T20:00",
    });
    const draft = await createOrganizerEvent(database, ownerIdentity, input);
    const confirmed = (await confirmEvent(database, ownerIdentity, draft)).event;
    const edited = await updateOrganizerEvent(
      database,
      ownerIdentity,
      draft.id,
      confirmed.contentVersion,
      {
        ...input,
        bufferAfterMinutes: 30,
        endLocal: "2033-02-19T21:00",
        planningStatus: "confirmed",
        venueId: "venue-alt",
      },
      confirmed.scheduleVersion,
    );
    assert.equal(edited.planningStatus, "confirmed");
    assert.equal(edited.venueId, "venue-alt");
    assert.equal(edited.bufferAfterMinutes, 30);
    assert.equal(edited.scheduleVersion, confirmed.scheduleVersion + 1);
    assert.equal(
      (
        await row(
          database,
          `SELECT planning_status
           FROM organizer_reservation_states
           WHERE organizer_event_id = ?`,
          draft.id,
        )
      ).planning_status,
      "confirmed",
    );
  });

  await t.test("Block refuses a held reschedule and rolls back every artifact", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    const existing = await createOrganizerEvent(
      database,
      ownerIdentity,
      timedDraftInput({
        title: "Block edit source",
        startLocal: "2033-02-20T18:00",
        endLocal: "2033-02-20T20:00",
      }),
    );
    await placeHold(database, ownerIdentity, existing);
    const input = timedDraftInput({
      title: "Blocked held edit",
      startLocal: "2033-02-20T20:00",
      endLocal: "2033-02-20T22:00",
      venueId: "venue-alt",
    });
    const draft = await createOrganizerEvent(database, ownerIdentity, input);
    const held = (await placeHold(database, ownerIdentity, draft)).event;
    await setPolicy(database, "block");
    const before = await mutationResidueCounts(database, draft.id);
    await assert.rejects(
      updateOrganizerEvent(
        database,
        ownerIdentity,
        draft.id,
        held.contentVersion,
        {
          ...input,
          planningStatus: "tentative_hold",
          startLocal: "2033-02-20T19:00",
          endLocal: "2033-02-20T21:00",
        },
        held.scheduleVersion,
      ),
      (error) => error?.status === 409 && error?.code === "conflict",
    );
    assert.deepEqual(await mutationResidueCounts(database, draft.id), before);
    const unchanged = await getOrganizerEvent(
      database,
      ownerIdentity,
      draft.id,
    );
    assert.equal(unchanged.contentVersion, held.contentVersion);
    assert.equal(unchanged.scheduleVersion, held.scheduleVersion);
    assert.equal(unchanged.schedule.startsAtUtc, draft.schedule.startsAtUtc);
  });

  await t.test("Administrator approval preserves the old hold until exact proposed schedule and resources apply", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    await setPolicy(database, "require_admin_approval");
    const existing = await createOrganizerEvent(
      database,
      ownerIdentity,
      timedDraftInput({
        title: "Approval edit conflict",
        startLocal: "2033-02-22T18:00",
        endLocal: "2033-02-22T20:00",
      }),
    );
    await placeHold(database, ownerIdentity, existing);
    const input = timedDraftInput({
      title: "Held approval edit",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2033-02-22T20:00",
      endLocal: "2033-02-22T22:00",
      venueId: "venue-alt",
    });
    const draft = await createOrganizerEvent(
      database,
      administratorIdentity,
      input,
    );
    const held = (
      await placeHold(database, administratorIdentity, draft)
    ).event;
    const reason =
      "Requesting approval for the exact revised time and organizer scope.";
    const pending = await updateOrganizerEvent(
      database,
      administratorIdentity,
      draft.id,
      held.contentVersion,
      {
        ...input,
        bufferAfterMinutes: 25,
        bufferBeforeMinutes: 10,
        coOrganizerProfileIds: ["profile-organizer-a"],
        planningStatus: "tentative_hold",
        startLocal: "2033-02-22T19:00",
        endLocal: "2033-02-22T21:00",
        venueId: "venue-main",
      },
      held.scheduleVersion,
      reason,
    );
    assert.equal(pending.outcome, "pending_approval");
    assert.match(pending.reviewRequestId, /^conflict-review:/u);
    assert.equal(pending.event.contentVersion, held.contentVersion);
    assert.equal(pending.event.scheduleVersion, held.scheduleVersion);
    assert.equal(pending.event.schedule.startsAtUtc, draft.schedule.startsAtUtc);
    const storedRequest = await row(
      database,
      `SELECT requested_state_json, state
       FROM organizer_conflict_review_requests
       WHERE id = ?`,
      pending.reviewRequestId,
    );
    const requestedState = JSON.parse(storedRequest.requested_state_json);
    assert.equal(storedRequest.state, "pending");
    assert.equal(requestedState.action, "update_schedule");
    assert.equal(requestedState.clubId, "club-main");
    assert.equal(requestedState.venueId, "venue-main");
    assert.deepEqual(requestedState.organizerScope, [
      "profile-admin",
      "profile-organizer-a",
    ]);
    assert.equal(requestedState.bufferBeforeMinutes, 10);
    assert.equal(requestedState.bufferAfterMinutes, 25);

    const approval = await decideOrganizerConflictReview(
      database,
      ownerIdentity,
      pending.reviewRequestId,
      {
        decision: "approve",
        note: "Approved after direct coordination.",
      },
    );
    assert.equal(approval.decision, "approve");
    const approved = await getOrganizerEvent(
      database,
      ownerIdentity,
      draft.id,
    );
    assert.equal(approved.planningStatus, "tentative_hold");
    assert.equal(approved.venueId, "venue-main");
    assert.equal(approved.bufferBeforeMinutes, 10);
    assert.equal(approved.bufferAfterMinutes, 25);
    assert.deepEqual(approved.coOrganizerProfileIds, [
      "profile-organizer-a",
    ]);
    assert.equal(approved.contentVersion, held.contentVersion + 1);
    assert.equal(approved.scheduleVersion, held.scheduleVersion + 1);
    assert.equal(
      (
        await row(
          database,
          `SELECT state
           FROM organizer_conflict_review_requests
           WHERE id = ?`,
          pending.reviewRequestId,
        )
      ).state,
      "approved",
    );
    assert.ok(
      (await countWhere(
        database,
        "organizer_conflict_overrides",
        "organizer_event_id = ? AND review_request_id = ? AND invalidated_at IS NULL",
        draft.id,
        pending.reviewRequestId,
      )) >= 1,
    );
  });

  await t.test("two concurrent held edits produce one commit and one stale_edit with no loser residue", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    const input = timedDraftInput({
      title: "Concurrent held edit",
      startLocal: "2033-02-21T18:00",
      endLocal: "2033-02-21T20:00",
    });
    const draft = await createOrganizerEvent(database, ownerIdentity, input);
    const held = (await placeHold(database, ownerIdentity, draft)).event;
    const [firstBinding, secondBinding] = synchronizedBatchBindings(database);
    const outcomes = await Promise.allSettled([
      updateOrganizerEvent(
        firstBinding,
        ownerIdentity,
        draft.id,
        held.contentVersion,
        {
          ...input,
          planningStatus: "tentative_hold",
          startLocal: "2033-02-21T19:00",
          endLocal: "2033-02-21T21:00",
        },
        held.scheduleVersion,
      ),
      updateOrganizerEvent(
        secondBinding,
        ownerIdentity,
        draft.id,
        held.contentVersion,
        {
          ...input,
          planningStatus: "tentative_hold",
          startLocal: "2033-02-21T20:00",
          endLocal: "2033-02-21T22:00",
        },
        held.scheduleVersion,
      ),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    const rejected = outcomes.find(
      (outcome) => outcome.status === "rejected",
    );
    assert.equal(rejected?.reason?.code, "stale_edit");
    assert.equal(
      await countWhere(
        database,
        "organizer_schedule_write_intents",
        "organizer_event_id = ? AND operation = 'update' AND completed_at IS NOT NULL",
        draft.id,
      ),
      1,
    );
  });
});

test("an all-day Draft reserves Vancouver-local date boundaries without midnight-UTC coercion", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());

  const draft = await createOrganizerEvent(
    database,
    ownerIdentity,
    allDayDraftInput({
      title: "All-day DST hold",
      allDayStartDate: "2032-11-07",
      allDayEndDateExclusive: "2032-11-09",
    }),
  );
  const held = await placeHold(database, ownerIdentity, draft);
  assert.equal(held.event.planningStatus, "tentative_hold");

  const expected = normalizeAllDayConflictInterval({
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    endDateExclusive: "2032-11-09",
    startDate: "2032-11-07",
    timeZone: "America/Vancouver",
  });
  const reservation = await row(
    database,
    `SELECT schedule_shape, timezone, all_day_start_date,
            all_day_end_date_exclusive, actual_start_utc, actual_end_utc
     FROM organizer_reservation_states
     WHERE organizer_event_id = ?`,
    draft.id,
  );
  assert.equal(reservation.schedule_shape, "all_day");
  assert.equal(reservation.timezone, "America/Vancouver");
  assert.equal(reservation.all_day_start_date, "2032-11-07");
  assert.equal(reservation.all_day_end_date_exclusive, "2032-11-09");
  assert.equal(reservation.actual_start_utc, expected.actualStartUtc);
  assert.equal(reservation.actual_end_utc, expected.actualEndUtc);
  assert.notEqual(
    reservation.actual_start_utc,
    Date.parse("2032-11-07T00:00:00.000Z"),
  );
});

test("duplicate creates a source-free private non-reserving Draft", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());

  const source = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Duplicate source",
      meetupEventUrl:
        "https://www.meetup.com/example-group/events/source-event/",
      startLocal: "2033-03-20T18:00",
      endLocal: "2033-03-20T20:00",
    }),
  );
  const copy = await duplicateOrganizerEvent(
    database,
    ownerIdentity,
    source.id,
    source.contentVersion,
  );

  assert.notEqual(copy.id, source.id);
  assert.equal(copy.planningStatus, "draft");
  assert.equal(copy.publicationStatus, "private");
  assert.equal(copy.meetupEventUrl, null);
  assert.equal(copy.holdExpiresAt, null);
  assert.equal(copy.holdState, null);
  const reservation = await row(
    database,
    `SELECT planning_status, hold_expires_at, schedule_version
     FROM organizer_reservation_states
     WHERE organizer_event_id = ?`,
    copy.id,
  );
  assert.equal(reservation.planning_status, "draft");
  assert.equal(reservation.hold_expires_at, null);
  assert.equal(reservation.schedule_version, copy.scheduleVersion);
  assert.equal(
    await countWhere(
      database,
      "organizer_conflict_overrides",
      "organizer_event_id = ?",
      copy.id,
    ),
    0,
  );
});

test("concurrent hold reconciliation emits one nearing and one exact-boundary expiry notice per schedule version", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const draft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Durably deduplicated hold notices",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2033-03-15T18:00",
      endLocal: "2033-03-15T20:00",
    }),
  );
  const held = await placeHold(database, ownerIdentity, draft);
  const reservation = await row(
    database,
    `SELECT hold_expires_at
     FROM organizer_reservation_states
     WHERE organizer_event_id = ?`,
    draft.id,
  );

  setD1Now(database, reservation.hold_expires_at - 12 * 60 * 60_000);
  await Promise.all([
    reconcileOrganizerHoldNotices(database, ownerIdentity),
    reconcileOrganizerHoldNotices(database, ownerIdentity),
  ]);
  assert.equal(
    await countWhere(
      database,
      "notifications",
      "recipient_profile_id = ? AND type = 'hold_nearing_expiry' AND json_extract(payload_json, '$.eventId') = ?",
      "profile-admin",
      draft.id,
    ),
    1,
  );

  setD1Now(database, reservation.hold_expires_at);
  await Promise.all([
    reconcileOrganizerHoldNotices(database, ownerIdentity),
    reconcileOrganizerHoldNotices(database, ownerIdentity),
  ]);
  assert.equal(
    await countWhere(
      database,
      "notifications",
      "recipient_profile_id = ? AND type = 'hold_expired' AND json_extract(payload_json, '$.eventId') = ?",
      "profile-admin",
      draft.id,
    ),
    1,
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_hold_notice_receipts",
      "organizer_event_id = ? AND schedule_version = ? AND recipient_profile_id = ?",
      draft.id,
      held.event.scheduleVersion,
      "profile-admin",
    ),
    2,
  );
});

test("completion is refused before end, allowed at the exact boundary and after end, and stale CAS leaves no residue", async (t) => {
  await t.test("before end", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    const { confirmed, draft } = await createConfirmedEvent(
      database,
      "Complete too early",
      "2033-04-10T18:00",
      "2033-04-10T20:00",
    );
    setD1Now(database, draft.schedule.endsAtUtc - 1);
    const before = await mutationResidueCounts(database, draft.id);
    await assert.rejects(
      performOrganizerLifecycleAction(
        database,
        ownerIdentity,
        draft.id,
        {
          action: "complete",
          expectedContentVersion: confirmed.contentVersion,
          expectedScheduleVersion: confirmed.scheduleVersion,
        },
      ),
      (error) =>
        error?.status === 422 && error?.code === "validation_failed",
    );
    assert.deepEqual(await mutationResidueCounts(database, draft.id), before);
    assert.equal(
      (await getOrganizerEvent(database, ownerIdentity, draft.id))
        .planningStatus,
      "confirmed",
    );
  });

  for (const [label, offset] of [
    ["at exact end", 0],
    ["after end", 1],
  ]) {
    await t.test(label, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      const { confirmed, draft } = await createConfirmedEvent(
        database,
        `Complete ${label}`,
        "2033-04-11T18:00",
        "2033-04-11T20:00",
      );
      setD1Now(database, draft.schedule.endsAtUtc + offset);
      const completed = await performOrganizerLifecycleAction(
        database,
        ownerIdentity,
        draft.id,
        {
          action: "complete",
          expectedContentVersion: confirmed.contentVersion,
          expectedScheduleVersion: confirmed.scheduleVersion,
        },
      );
      assert.equal(completed.outcome, "applied");
      assert.equal(completed.event.planningStatus, "completed");
      assert.equal(
        completed.event.scheduleVersion,
        confirmed.scheduleVersion + 1,
      );
      assert.equal(
        (
          await row(
            database,
            `SELECT planning_status, schedule_version
             FROM organizer_reservation_states
             WHERE organizer_event_id = ?`,
            draft.id,
          )
        ).planning_status,
        "completed",
      );
    });
  }

  await t.test("stale versions", async (t) => {
    const database = await newDatabase();
    t.after(() => database.close());
    const { confirmed, draft } = await createConfirmedEvent(
      database,
      "Stale completion",
      "2033-04-12T18:00",
      "2033-04-12T20:00",
    );
    setD1Now(database, draft.schedule.endsAtUtc + 1);
    const before = await mutationResidueCounts(database, draft.id);
    await assert.rejects(
      performOrganizerLifecycleAction(
        database,
        ownerIdentity,
        draft.id,
        {
          action: "complete",
          expectedContentVersion: confirmed.contentVersion - 1,
          expectedScheduleVersion: confirmed.scheduleVersion - 1,
        },
      ),
      (error) => error?.status === 409 && error?.code === "stale_edit",
    );
    assert.deepEqual(await mutationResidueCounts(database, draft.id), before);
    assert.equal(
      (await getOrganizerEvent(database, ownerIdentity, draft.id))
        .planningStatus,
      "confirmed",
    );
  });
});

test("an Administrator may reject their own review request but cannot approve it", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  await setPolicy(database, "require_admin_approval");

  const existing = await createOrganizerEvent(
    database,
    administratorIdentity,
    timedDraftInput({
      title: "Self-review existing reservation",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2033-05-15T18:00",
      endLocal: "2033-05-15T20:00",
    }),
  );
  await placeHold(database, administratorIdentity, existing);
  const requested = await createOrganizerEvent(
    database,
    administratorIdentity,
    timedDraftInput({
      title: "Administrator self-review request",
      primaryOrganizerProfileId: "profile-admin",
      startLocal: "2033-05-15T19:00",
      endLocal: "2033-05-15T21:00",
      venueId: "venue-alt",
    }),
  );
  const pending = await placeHold(
    database,
    administratorIdentity,
    requested,
    "Administrator requests coordination approval.",
  );
  const requesterCenter = await listOrganizerConflictCenter(
    database,
    administratorIdentity,
  );
  const requesterReview = requesterCenter.find(
    (item) => item.id === pending.reviewRequestId,
  );
  assert.ok(requesterReview);
  assert.equal(
    requesterReview.allowedActions.some(
      (action) => action.kind === "approve",
    ),
    false,
  );
  assert.equal(
    requesterReview.allowedActions.some(
      (action) => action.kind === "reject",
    ),
    true,
  );

  await assert.rejects(
    decideOrganizerConflictReview(
      database,
      administratorIdentity,
      pending.reviewRequestId,
      { decision: "approve", note: "Self approval is forbidden." },
    ),
    (error) => error?.status === 403 && error?.code === "authorization_denied",
  );
  assert.equal(
    (
      await row(
        database,
        `SELECT state
         FROM organizer_conflict_review_requests
         WHERE id = ?`,
        pending.reviewRequestId,
      )
    ).state,
    "pending",
  );
  const rejected = await decideOrganizerConflictReview(
    database,
    administratorIdentity,
    pending.reviewRequestId,
    { decision: "reject", note: "I will choose another time." },
  );
  assert.equal(rejected.decision, "reject");
  assert.equal(rejected.event, null);
  assert.equal(
    (
      await row(
        database,
        `SELECT state, decided_by_profile_id
         FROM organizer_conflict_review_requests
         WHERE id = ?`,
        pending.reviewRequestId,
      )
    ).state,
    "rejected",
  );
  assert.equal(
    (
      await row(
        database,
        `SELECT decided_by_profile_id
         FROM organizer_conflict_review_requests
         WHERE id = ?`,
        pending.reviewRequestId,
      )
    ).decided_by_profile_id,
    "profile-admin",
  );
  assert.equal(
    await countWhere(
      database,
      "notifications",
      "type = 'conflict_rejected' AND json_extract(payload_json, '$.eventId') = ?",
      requested.id,
    ),
    0,
    "a valid self-rejection must not depend on notifying the acting Administrator",
  );
  assert.equal(
    await countWhere(
      database,
      "audit_logs",
      "action = 'conflict_review.rejected' AND entity_id = ?",
      requested.id,
    ),
    1,
  );
});

test("non-reserving lifecycle actions never create fresh conflict authorization artifacts across policy modes", async (t) => {
  const operations = [
    ["release_hold", "tentative_hold", "release_hold"],
    ["cancel_hold", "tentative_hold", "cancel"],
    ["cancel_confirmed", "confirmed", "cancel"],
    ["complete", "confirmed", "complete"],
    ["archive", "confirmed", "archive"],
    ["soft_delete", "draft", "soft_delete"],
  ];
  for (const mode of ["warn_reason", "require_admin_approval", "block"]) {
    for (const [label, initialStatus, action] of operations) {
      await t.test(`${mode}: ${label}`, async (t) => {
        const database = await newDatabase();
        t.after(() => database.close());
        await setPolicy(database, mode);
        const input = timedDraftInput({
          title: `${mode} ${label}`,
          startLocal: "2033-06-20T18:00",
          endLocal: "2033-06-20T20:00",
        });
        const draft = await createOrganizerEvent(
          database,
          ownerIdentity,
          input,
        );
        let current = draft;
        if (initialStatus === "tentative_hold") {
          current = (await placeHold(database, ownerIdentity, draft)).event;
        } else if (initialStatus === "confirmed") {
          current = (await confirmEvent(database, ownerIdentity, draft)).event;
        }
        if (action === "complete") {
          setD1Now(database, draft.schedule.endsAtUtc);
        }
        const before = {
          incidents: await countWhere(
            database,
            "organizer_conflict_incidents",
            "organizer_event_id = ?",
            draft.id,
          ),
          overrides: await countWhere(
            database,
            "organizer_conflict_overrides",
            "organizer_event_id = ?",
            draft.id,
          ),
        };
        let result;
        if (action === "soft_delete") {
          result = await softDeleteOrganizerEvent(
            database,
            ownerIdentity,
            draft.id,
            current.contentVersion,
            current.scheduleVersion,
          );
        } else {
          result = (
            await performOrganizerLifecycleAction(
              database,
              ownerIdentity,
              draft.id,
              {
                action,
                expectedContentVersion: current.contentVersion,
                expectedScheduleVersion: current.scheduleVersion,
              },
            )
          ).event;
        }
        assert.equal(
          await countWhere(
            database,
            "organizer_conflict_incidents",
            "organizer_event_id = ?",
            draft.id,
          ),
          before.incidents,
        );
        assert.equal(
          await countWhere(
            database,
            "organizer_conflict_overrides",
            "organizer_event_id = ?",
            draft.id,
          ),
          before.overrides,
        );
        assert.equal(result.publicationStatus, "private");
      });
    }
  }
});

test("soft deletion seals an exact scheduling intent, removes reservation state, and restores only a non-reserving Draft", async (t) => {
  for (const initialStatus of ["draft", "tentative_hold", "confirmed"]) {
    await t.test(initialStatus, async (t) => {
      const database = await newDatabase();
      t.after(() => database.close());
      const draft = await createOrganizerEvent(
        database,
        ownerIdentity,
        timedDraftInput({
          title: `Soft delete ${initialStatus}`,
          startLocal: "2033-07-20T18:00",
          endLocal: "2033-07-20T20:00",
        }),
      );
      let current = draft;
      if (initialStatus === "tentative_hold") {
        current = (await placeHold(database, ownerIdentity, draft)).event;
        setD1Now(database, current.holdExpiresAt);
      } else if (initialStatus === "confirmed") {
        current = (await confirmEvent(database, ownerIdentity, draft)).event;
      }
      assert.ok(
        await row(
          database,
          `SELECT organizer_event_id
           FROM organizer_reservation_states
           WHERE organizer_event_id = ?`,
          draft.id,
        ),
      );

      const before = await mutationResidueCounts(database, draft.id);
      await assert.rejects(
        softDeleteOrganizerEvent(
          database,
          ownerIdentity,
          draft.id,
          current.contentVersion + 1,
          current.scheduleVersion + 1,
        ),
        (error) => error?.status === 409 && error?.code === "stale_edit",
      );
      assert.deepEqual(await mutationResidueCounts(database, draft.id), before);
      await assert.rejects(
        softDeleteOrganizerEvent(
          database,
          unrelatedOrganizerIdentity,
          draft.id,
          current.contentVersion,
          current.scheduleVersion,
        ),
        (error) => error?.status === 404,
      );
      assert.deepEqual(await mutationResidueCounts(database, draft.id), before);

      const deleted = await softDeleteOrganizerEvent(
        database,
        ownerIdentity,
        draft.id,
        current.contentVersion,
        current.scheduleVersion,
      );
      assert.equal(deleted.planningStatus, initialStatus);
      assert.equal(deleted.contentVersion, current.contentVersion + 1);
      assert.equal(deleted.scheduleVersion, current.scheduleVersion + 1);
      assert.equal(typeof deleted.deletedAt, "number");
      assert.equal(
        await countWhere(
          database,
          "organizer_reservation_states",
          "organizer_event_id = ?",
          draft.id,
        ),
        0,
      );
      const deleteIntent = await row(
        database,
        `SELECT operation, completed_at
         FROM organizer_schedule_write_intents
         WHERE organizer_event_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        draft.id,
      );
      assert.equal(deleteIntent.operation, "soft_delete");
      assert.equal(typeof deleteIntent.completed_at, "number");

      const restored = await restoreOrganizerEvent(
        database,
        ownerIdentity,
        draft.id,
        deleted.contentVersion,
        deleted.scheduleVersion,
      );
      assert.equal(restored.planningStatus, "draft");
      assert.equal(restored.publicationStatus, "private");
      assert.equal(restored.holdExpiresAt, null);
      assert.equal(restored.deletedAt, null);
      assert.equal(restored.contentVersion, deleted.contentVersion + 1);
      assert.equal(restored.scheduleVersion, deleted.scheduleVersion + 1);
      assert.deepEqual(
        {
          ...(await row(
            database,
            `SELECT planning_status, schedule_shape, actual_start_utc,
                    actual_end_utc, hold_expires_at, schedule_version
             FROM organizer_reservation_states
             WHERE organizer_event_id = ?`,
            draft.id,
          )),
        },
        {
          actual_end_utc: draft.schedule.endsAtUtc,
          actual_start_utc: draft.schedule.startsAtUtc,
          hold_expires_at: null,
          planning_status: "draft",
          schedule_shape: "timed",
          schedule_version: restored.scheduleVersion,
        },
      );
    });
  }
});

test("hold notices use D1 time, notify only affected organizers, and dedupe across isolates", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const draft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({
      title: "Hold notice recipients",
      coOrganizerProfileIds: ["profile-organizer-a"],
      startLocal: "2033-08-20T18:00",
      endLocal: "2033-08-20T20:00",
    }),
  );
  const held = (await placeHold(database, ownerIdentity, draft)).event;
  assert.equal(typeof held.holdExpiresAt, "number");
  setD1Now(database, held.holdExpiresAt - 23 * 60 * 60_000);
  const nearing = await Promise.all([
    reconcileOrganizerHoldNotices(database, ownerIdentity),
    reconcileOrganizerHoldNotices(database, ownerIdentity),
  ]);
  assert.equal(
    nearing.reduce((total, result) => total + result.created, 0),
    2,
  );
  assert.deepEqual(
    (
      await database
        .prepare(
          `SELECT recipient_profile_id, type, payload_json
           FROM notifications
           WHERE type = 'hold_nearing_expiry'
           ORDER BY recipient_profile_id`,
        )
        .all()
    ).results.map((notification) => ({ ...notification })),
    [
      {
        payload_json: JSON.stringify({
          eventId: draft.id,
          title: "Hold notice recipients",
        }),
        recipient_profile_id: "profile-organizer-a",
        type: "hold_nearing_expiry",
      },
      {
        payload_json: JSON.stringify({
          eventId: draft.id,
          title: "Hold notice recipients",
        }),
        recipient_profile_id: "profile-owner",
        type: "hold_nearing_expiry",
      },
    ],
  );
  setD1Now(database, held.holdExpiresAt);
  const expired = await reconcileOrganizerHoldNotices(
    database,
    ownerIdentity,
  );
  assert.equal(expired.created, 2);
  assert.deepEqual(
    await reconcileOrganizerHoldNotices(database, ownerIdentity),
    { created: 0, examined: 0 },
  );
  assert.equal(
    await countWhere(
      database,
      "organizer_hold_notice_receipts",
      "organizer_event_id = ?",
      draft.id,
    ),
    4,
  );
  const serialized = JSON.stringify(
    (
      await database
        .prepare(
          `SELECT recipient_profile_id, type, payload_json
           FROM notifications
           WHERE type IN ('hold_nearing_expiry', 'hold_expired')`,
        )
        .all()
    ).results,
  );
  for (const forbidden of [
    "@example.test",
    "profile-admin",
    "profile-organizer-b",
    "PRIVATE",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

async function newDatabase() {
  const schemaSql = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
  const database = new SqliteD1TestDatabase(schemaSql);
  seed(database);
  await ensureReady(database);
  return database;
}

async function ensureReady(database) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await ensureDatabaseInvariants(database);
    const marker = await database
      .prepare(
        `SELECT version
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'`,
      )
      .first();
    if (marker?.version === DATABASE_INVARIANT_VERSION) return;
  }
  throw new Error("The runtime database invariants did not converge.");
}

async function setPolicy(database, mode) {
  const current = await getOrganizerConflictPolicy(database, ownerIdentity);
  if (current.mode === mode) return current;
  return updateOrganizerConflictPolicy(database, ownerIdentity, {
    defaultHoldHours: current.defaultHoldHours,
    expectedPolicyVersion: current.version,
    mode,
    nearingExpiryHours: current.nearingExpiryHours,
  });
}

function timedDraftInput(overrides = {}) {
  return {
    title: "Scheduled private Draft",
    clubId: "club-main",
    venueId: "venue-main",
    primaryOrganizerProfileId: "profile-owner",
    coOrganizerProfileIds: [],
    planningStatus: "draft",
    publicationStatus: "private",
    scheduleShape: "timed",
    timeZone: "America/Vancouver",
    startLocal: "2032-08-15T18:30",
    endLocal: "2032-08-15T20:30",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    ...overrides,
  };
}

function allDayDraftInput(overrides = {}) {
  return {
    title: "All-day private Draft",
    clubId: "club-main",
    venueId: "venue-main",
    primaryOrganizerProfileId: "profile-owner",
    coOrganizerProfileIds: [],
    planningStatus: "draft",
    publicationStatus: "private",
    scheduleShape: "all_day",
    timeZone: "America/Vancouver",
    allDayStartDate: "2032-08-15",
    allDayEndDateExclusive: "2032-08-16",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    ...overrides,
  };
}

function placeHold(database, identity, event, reason = undefined) {
  return performOrganizerLifecycleAction(database, identity, event.id, {
    action: "place_hold",
    expectedContentVersion: event.contentVersion,
    expectedScheduleVersion: event.scheduleVersion,
    holdDurationHours: 72,
    reason,
  });
}

function confirmEvent(database, identity, event, reason = undefined) {
  return performOrganizerLifecycleAction(database, identity, event.id, {
    action: "confirm",
    expectedContentVersion: event.contentVersion,
    expectedScheduleVersion: event.scheduleVersion,
    reason,
  });
}

async function createConfirmedEvent(database, title, startLocal, endLocal) {
  const draft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraftInput({ title, startLocal, endLocal }),
  );
  const confirmed = (
    await confirmEvent(database, ownerIdentity, draft)
  ).event;
  return { confirmed, draft };
}

function setD1Now(database, milliseconds) {
  database.sqlite.function(
    "unixepoch",
    { deterministic: true, varargs: true },
    () => milliseconds / 1_000,
  );
}

function synchronizedBatchBindings(database) {
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const binding = () => ({
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
      return database.batch(statements);
    },
  });
  return [binding(), binding()];
}

async function mutationResidueCounts(database, eventId) {
  return {
    intents: await countWhere(
      database,
      "organizer_schedule_write_intents",
      "organizer_event_id = ?",
      eventId,
    ),
    overrides: await countWhere(
      database,
      "organizer_conflict_overrides",
      "organizer_event_id = ?",
      eventId,
    ),
    revisions: await countWhere(
      database,
      "organizer_event_revisions",
      "organizer_event_id = ?",
      eventId,
    ),
  };
}

async function row(database, sql, ...bindings) {
  const result = await database.prepare(sql).bind(...bindings).first();
  assert.ok(result, "expected one persisted row");
  return result;
}

async function all(database, sql, ...bindings) {
  return (
    await database.prepare(sql).bind(...bindings).all()
  ).results;
}

async function countWhere(database, table, predicate, ...bindings) {
  return (
    await database
      .prepare(`SELECT count(*) AS count FROM "${table}" WHERE ${predicate}`)
      .bind(...bindings)
      .first()
  ).count;
}

function seed(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      ('profile-owner', 'subject-owner', 'owner@example.test', 'Owner', 'active', 1, 1),
      ('profile-admin', 'subject-admin', 'admin@example.test', 'Administrator', 'active', 1, 1),
      ('profile-organizer-a', 'subject-a', 'organizer-a@example.test', 'Organizer A', 'active', 1, 1),
      ('profile-organizer-b', 'subject-b', 'organizer-b@example.test', 'Organizer B', 'active', 1, 1);

    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-main', 'Main Organization', 'main-organization',
      'America/Vancouver', 1, 'profile-owner', 1, 1
    );

    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      ('membership-owner', 'org-main', 'profile-owner', 'owner@example.test', 'owner', 'active', 'profile-owner', 1, 1),
      ('membership-admin', 'org-main', 'profile-admin', 'admin@example.test', 'administrator', 'active', 'profile-owner', 1, 1),
      ('membership-a', 'org-main', 'profile-organizer-a', 'organizer-a@example.test', 'organizer', 'active', 'profile-owner', 1, 1),
      ('membership-b', 'org-main', 'profile-organizer-b', 'organizer-b@example.test', 'organizer', 'active', 'profile-owner', 1, 1);

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('club-main', 'org-main', 'Main Club', 'main-club', 'profile-owner', 1, 1),
      ('club-secondary', 'org-main', 'Secondary Club', 'secondary-club', 'profile-owner', 1, 1);

    INSERT INTO club_memberships (
      id, organization_id, club_id, organization_membership_id,
      profile_id, role, status, created_by_profile_id, created_at, updated_at
    ) VALUES
      ('club-a-main', 'org-main', 'club-main', 'membership-a', 'profile-organizer-a', 'organizer', 'active', 'profile-owner', 1, 1),
      ('club-a-secondary', 'org-main', 'club-secondary', 'membership-a', 'profile-organizer-a', 'organizer', 'active', 'profile-owner', 1, 1),
      ('club-b-main', 'org-main', 'club-main', 'membership-b', 'profile-organizer-b', 'organizer', 'active', 'profile-owner', 1, 1),
      ('club-b-secondary', 'org-main', 'club-secondary', 'membership-b', 'profile-organizer-b', 'organizer', 'active', 'profile-owner', 1, 1);

    INSERT INTO venues (
      id, organization_id, name, slug, timezone, created_at, updated_at
    ) VALUES
      ('venue-main', 'org-main', 'Main private venue', 'main-private-venue', 'America/Vancouver', 1, 1),
      ('venue-alt', 'org-main', 'Alternate private venue', 'alternate-private-venue', 'America/Vancouver', 1, 1);

    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase4-policy-org-main', 'org-main', 'warn_reason', 1, 72, 24,
      'profile-owner', 1, 1
    );
  `);
}
