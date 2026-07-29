import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";
import { interceptD1Statements } from "../auth/intercept-d1.mjs";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { listOrganizerEventConflictSummaries } from "../../lib/server/organizer/event-conflicts.ts";
import { listOrganizerConflictCenter } from "../../lib/server/organizer/conflicts.ts";
import { OrganizerAccessDeniedError } from "../../lib/server/auth/index.ts";
import {
  createOrganizerEvent,
  softDeleteOrganizerEvent,
  updateOrganizerEvent,
} from "../../lib/server/organizer/events.ts";
import { performOrganizerLifecycleAction } from "../../lib/server/organizer/scheduling.ts";

const ownerIdentity = Object.freeze({
  displayName: "Owner",
  email: "owner@example.test",
  source: "sites-siwc",
});
const coOrganizerIdentity = Object.freeze({
  displayName: "Co-organizer",
  email: "co@example.test",
  source: "sites-siwc",
});
const unrelatedOrganizerIdentity = Object.freeze({
  displayName: "Unrelated organizer",
  email: "unrelated@example.test",
  source: "sites-siwc",
});

test("event detail reads real scoped conflict facts from either manual side without private reasons", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);

  const firstDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraft({
      coOrganizerProfileIds: ["profile-co"],
      endLocal: "2032-08-15T18:00",
      privateNotes: "PRIVATE-NOTE-FIRST",
      startLocal: "2032-08-15T16:00",
      title: "First private reservation",
    }),
  );
  const firstHold = (
    await performOrganizerLifecycleAction(
      database,
      ownerIdentity,
      firstDraft.id,
      {
        action: "place_hold",
        expectedContentVersion: firstDraft.contentVersion,
        expectedScheduleVersion: firstDraft.scheduleVersion,
        holdDurationHours: 72,
      },
    )
  ).event;

  const secondDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraft({
      endLocal: "2032-08-15T19:00",
      privateNotes: "PRIVATE-NOTE-SECOND",
      startLocal: "2032-08-15T17:00",
      title: "Second private reservation",
    }),
  );
  const secondConfirmed = (
    await performOrganizerLifecycleAction(
      database,
      ownerIdentity,
      secondDraft.id,
      {
        action: "confirm",
        expectedContentVersion: secondDraft.contentVersion,
        expectedScheduleVersion: secondDraft.scheduleVersion,
        reason: "PRIVATE-COORDINATION-REASON",
      },
    )
  ).event;

  const fromProposedSide = await listOrganizerEventConflictSummaries(
    database,
    ownerIdentity,
    secondConfirmed.id,
  );
  assert.equal(fromProposedSide.length, 1);
  assert.deepEqual(
    {
      destination: fromProposedSide[0].destination,
      sourceLabel: fromProposedSide[0].sourceLabel,
      state: fromProposedSide[0].state,
      title: fromProposedSide[0].title,
    },
    {
      destination: {
        external: false,
        href: `/organizer/events/${encodeURIComponent(firstHold.id)}`,
        label: "View event",
      },
      sourceLabel: "Manual event",
      state: "Approved",
      title: "First private reservation",
    },
  );

  const fromExistingSide = await listOrganizerEventConflictSummaries(
    database,
    ownerIdentity,
    firstHold.id,
  );
  assert.equal(fromExistingSide.length, 1);
  assert.equal(fromExistingSide[0].title, "Second private reservation");
  assert.equal(
    fromExistingSide[0].destination?.href,
    `/organizer/events/${encodeURIComponent(secondConfirmed.id)}`,
  );
  const fromCoOrganizer = await listOrganizerEventConflictSummaries(
    database,
    coOrganizerIdentity,
    firstHold.id,
  );
  assert.equal(fromCoOrganizer.length, 1);
  assert.equal(fromCoOrganizer[0].title, "Second private reservation");
  await assert.rejects(
    listOrganizerEventConflictSummaries(
      database,
      unrelatedOrganizerIdentity,
      firstHold.id,
    ),
    (error) => error?.code === "not_found",
  );

  const serialized = JSON.stringify([
    ...fromProposedSide,
    ...fromExistingSide,
  ]);
  for (const privateValue of [
    "PRIVATE-COORDINATION-REASON",
    "PRIVATE-NOTE-FIRST",
    "PRIVATE-NOTE-SECOND",
    "owner@example.test",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }

  await softDeleteOrganizerEvent(
    database,
    ownerIdentity,
    firstHold.id,
    firstHold.contentVersion,
    firstHold.scheduleVersion,
  );
  assert.deepEqual(
    await listOrganizerEventConflictSummaries(
      database,
      ownerIdentity,
      secondConfirmed.id,
    ),
    [],
  );
});

test("event conflict summaries deny a co-organizer removed before the final event seal", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);

  const firstDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraft({
      coOrganizerProfileIds: ["profile-co"],
      endLocal: "2032-08-15T18:00",
      startLocal: "2032-08-15T16:00",
      title: "Assignment-race first reservation",
    }),
  );
  const firstHold = (
    await performOrganizerLifecycleAction(
      database,
      ownerIdentity,
      firstDraft.id,
      {
        action: "place_hold",
        expectedContentVersion: firstDraft.contentVersion,
        expectedScheduleVersion: firstDraft.scheduleVersion,
        holdDurationHours: 72,
      },
    )
  ).event;
  const secondDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraft({
      endLocal: "2032-08-15T19:00",
      startLocal: "2032-08-15T17:00",
      title: "Assignment-race second reservation",
    }),
  );
  await performOrganizerLifecycleAction(
    database,
    ownerIdentity,
    secondDraft.id,
    {
      action: "confirm",
      expectedContentVersion: secondDraft.contentVersion,
      expectedScheduleVersion: secondDraft.scheduleVersion,
      reason: "Fixture conflict approval.",
    },
  );

  const intercepted = interceptD1Statements(database, {
    before: (sql) => sql.includes("WITH selected_event_ids AS"),
    hook: async () => {
      await updateOrganizerEvent(
        database,
        ownerIdentity,
        firstHold.id,
        firstHold.contentVersion,
        timedDraft({
          coOrganizerProfileIds: [],
          endLocal: "2032-08-15T18:00",
          planningStatus: "tentative_hold",
          startLocal: "2032-08-15T16:00",
          title: firstHold.title,
        }),
        firstHold.scheduleVersion,
        "The co-organizer assignment changed.",
      );
    },
  });
  await assert.rejects(
    listOrganizerEventConflictSummaries(
      intercepted.database,
      coOrganizerIdentity,
      firstHold.id,
    ),
    (error) => error instanceof OrganizerAccessDeniedError,
  );
  assert.equal(intercepted.fired(), true);
});

test("conflict center denies an Organizer removed from the involved event before its final seal", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);

  const firstDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraft({
      coOrganizerProfileIds: ["profile-co"],
      endLocal: "2032-08-15T18:00",
      startLocal: "2032-08-15T16:00",
      title: "Conflict-center first reservation",
    }),
  );
  const firstHold = (
    await performOrganizerLifecycleAction(
      database,
      ownerIdentity,
      firstDraft.id,
      {
        action: "place_hold",
        expectedContentVersion: firstDraft.contentVersion,
        expectedScheduleVersion: firstDraft.scheduleVersion,
        holdDurationHours: 72,
      },
    )
  ).event;
  const secondDraft = await createOrganizerEvent(
    database,
    ownerIdentity,
    timedDraft({
      endLocal: "2032-08-15T19:00",
      startLocal: "2032-08-15T17:00",
      title: "Conflict-center second reservation",
    }),
  );
  await performOrganizerLifecycleAction(
    database,
    ownerIdentity,
    secondDraft.id,
    {
      action: "confirm",
      expectedContentVersion: secondDraft.contentVersion,
      expectedScheduleVersion: secondDraft.scheduleVersion,
      reason: "Fixture conflict approval.",
    },
  );

  const intercepted = interceptD1Statements(database, {
    before: (sql) => sql.includes("WITH selected_incident_ids AS"),
    hook: async () => {
      await updateOrganizerEvent(
        database,
        ownerIdentity,
        firstHold.id,
        firstHold.contentVersion,
        timedDraft({
          coOrganizerProfileIds: [],
          endLocal: "2032-08-15T18:00",
          planningStatus: "tentative_hold",
          startLocal: "2032-08-15T16:00",
          title: firstHold.title,
        }),
        firstHold.scheduleVersion,
        "The co-organizer assignment changed.",
      );
    },
  });
  await assert.rejects(
    listOrganizerConflictCenter(
      intercepted.database,
      coOrganizerIdentity,
    ),
    (error) => error instanceof OrganizerAccessDeniedError,
  );
  assert.equal(intercepted.fired(), true);
});

function timedDraft(overrides = {}) {
  return {
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    clubId: "club-main",
    coOrganizerProfileIds: [],
    endLocal: "2032-08-15T20:00",
    planningStatus: "draft",
    primaryOrganizerProfileId: "profile-owner",
    privateNotes: null,
    publicationStatus: "private",
    scheduleShape: "timed",
    startLocal: "2032-08-15T18:00",
    timeZone: "America/Vancouver",
    title: "Private draft",
    venueId: "venue-main",
    ...overrides,
  };
}

function newDatabase() {
  const schemaSql = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
  const database = new SqliteD1TestDatabase(schemaSql);
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile-owner', 'subject-owner', 'owner@example.test',
        'Owner', 'active', 1, 1
      ),
      (
        'profile-co', 'subject-co', 'co@example.test',
        'Co-organizer', 'active', 1, 1
      ),
      (
        'profile-unrelated', 'subject-unrelated',
        'unrelated@example.test', 'Unrelated organizer', 'active', 1, 1
      );

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
      (
        'membership-owner', 'org-main', 'profile-owner',
        'owner@example.test', 'owner', 'active', 'profile-owner', 1, 1
      ),
      (
        'membership-co', 'org-main', 'profile-co',
        'co@example.test', 'organizer', 'active', 'profile-owner', 1, 1
      ),
      (
        'membership-unrelated', 'org-main', 'profile-unrelated',
        'unrelated@example.test', 'organizer', 'active', 'profile-owner',
        1, 1
      );

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club-main', 'org-main', 'Main Club', 'main-club',
      'profile-owner', 1, 1
    );

    INSERT INTO club_memberships (
      id, organization_id, club_id, organization_membership_id,
      profile_id, role, status, created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'club-co', 'org-main', 'club-main', 'membership-co',
        'profile-co', 'organizer', 'active', 'profile-owner', 1, 1
      ),
      (
        'club-unrelated', 'org-main', 'club-main',
        'membership-unrelated', 'profile-unrelated', 'organizer',
        'active', 'profile-owner', 1, 1
      );

    INSERT INTO venues (
      id, organization_id, name, slug, timezone, created_at, updated_at
    ) VALUES (
      'venue-main', 'org-main', 'Main private venue',
      'main-private-venue', 'America/Vancouver', 1, 1
    );

    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase4-policy-org-main', 'org-main', 'warn_reason', 1, 72, 24,
      'profile-owner', 1, 1
    );
  `);
  return database;
}
