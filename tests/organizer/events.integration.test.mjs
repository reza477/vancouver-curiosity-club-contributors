import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createOrganizerEvent,
  duplicateOrganizerEvent,
  listOrganizerEventRevisions,
  listOrganizerEvents,
  queryOrganizerEventIndex,
  restoreOrganizerEvent,
  softDeleteOrganizerEvent,
  updateOrganizerEvent,
} from "../../lib/server/organizer/events.ts";
import {
  getOrganizerCalendarEvent,
  listOrganizerCalendarEvents,
} from "../../lib/server/organizer/calendar.ts";
import {
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import { listUpcomingPublicEvents } from "../../lib/server/public/events.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const ownerIdentity = Object.freeze({
  displayName: "Owner",
  email: "owner@example.test",
  source: "sites-siwc",
});
const organizerIdentity = Object.freeze({
  displayName: "Organizer One",
  email: "organizer1@example.test",
  source: "sites-siwc",
});
const unrelatedIdentity = Object.freeze({
  displayName: "Organizer Three",
  email: "organizer3@example.test",
  source: "sites-siwc",
});

function newDatabase() {
  const sql = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
  const database = new SqliteD1TestDatabase(sql);
  seed(database);
  return database;
}

test("private Ideas and Drafts have atomic CRUD, revisions, audits, and stale CAS", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);
  assert.equal(
    (
      await database
        .prepare(
          `SELECT version
           FROM database_invariant_state
           WHERE singleton_key = 'database-guards'`,
        )
        .first()
    ).version,
    DATABASE_INVARIANT_VERSION,
  );

  const created = await createOrganizerEvent(
    database,
    ownerIdentity,
    ideaInput({
      primaryOrganizerProfileId: "profile-organizer-1",
      coOrganizerProfileIds: ["profile-organizer-2"],
      meetupEventUrl:
        "https://www.meetup.com/example-group/events/real-event/?tracking=removed",
    }),
  );
  assert.equal(created.planningStatus, "idea");
  assert.equal(created.publicationStatus, "private");
  assert.equal(created.schedule.shape, "unscheduled");
  assert.equal(created.contentVersion, 1);
  assert.equal(created.scheduleVersion, 1);
  assert.equal(created.createdAt, created.updatedAt);
  assert.equal(
    created.meetupEventUrl,
    "https://www.meetup.com/example-group/events/real-event/",
  );

  const updated = await updateOrganizerEvent(
    database,
    ownerIdentity,
    created.id,
    1,
    draftInput({
      primaryOrganizerProfileId: "profile-organizer-1",
      coOrganizerProfileIds: ["profile-organizer-2"],
    }),
  );
  assert.equal(updated.planningStatus, "draft");
  assert.equal(updated.schedule.shape, "timed");
  assert.equal(updated.contentVersion, 2);
  assert.equal(updated.scheduleVersion, 2);
  const notificationPayloads = (
    await database
      .prepare(
        `SELECT type, payload_json, recipient_profile_id
         FROM notifications
         ORDER BY created_at, id`,
      )
      .all()
  ).results;
  assert.equal(notificationPayloads.length, 4);
  assert.deepEqual(
    new Set(notificationPayloads.map(({ type }) => type)),
    new Set(["event_assignment", "event_schedule_changed"]),
  );
  assert.ok(
    notificationPayloads.every(
      ({ payload_json }) =>
        !payload_json.includes("@") &&
        !payload_json.includes("privateNotes") &&
        !payload_json.includes("meetup.com"),
    ),
    "allowlisted notification payloads exclude email, notes, and URLs",
  );

  const revisionCountBeforeStale = await count(
    database,
    "organizer_event_revisions",
  );
  const auditCountBeforeStale = await count(database, "audit_logs");
  await assert.rejects(
    updateOrganizerEvent(
      database,
      ownerIdentity,
      created.id,
      1,
      draftInput({
        title: "Stale overwrite",
        primaryOrganizerProfileId: "profile-organizer-1",
        coOrganizerProfileIds: ["profile-organizer-2"],
      }),
    ),
    (error) => error?.code === "stale_edit" && error?.status === 409,
  );
  assert.equal(
    (await getOrganizerCalendarEvent(database, ownerIdentity, created.id))
      .title,
    "Scheduled private Draft",
  );
  assert.equal(
    await count(database, "organizer_event_revisions"),
    revisionCountBeforeStale,
  );
  assert.equal(await count(database, "audit_logs"), auditCountBeforeStale);

  const copied = await duplicateOrganizerEvent(
    database,
    ownerIdentity,
    created.id,
    2,
  );
  assert.match(copied.title, /^Copy of /u);
  assert.equal(copied.publicationStatus, "private");
  assert.equal(copied.meetupEventUrl, null);
  assert.notEqual(copied.id, created.id);

  const deleted = await softDeleteOrganizerEvent(
    database,
    ownerIdentity,
    created.id,
    2,
  );
  assert.equal(deleted.contentVersion, 3);
  assert.equal(
    deleted.scheduleVersion,
    2,
    "soft deletion is a content edit, not a schedule edit",
  );
  assert.equal(typeof deleted.deletedAt, "number");

  const restored = await restoreOrganizerEvent(
    database,
    ownerIdentity,
    created.id,
    3,
  );
  assert.equal(restored.contentVersion, 4);
  assert.equal(restored.scheduleVersion, 2);
  assert.equal(restored.deletedAt, null);

  const revisions = await listOrganizerEventRevisions(
    database,
    ownerIdentity,
    created.id,
  );
  assert.deepEqual(
    revisions.map(({ action }) => action),
    ["restored", "deleted", "updated", "created"],
  );
  assert.ok(
    revisions.every(
      ({ snapshot }) =>
        !Object.hasOwn(snapshot, "token") &&
        !Object.hasOwn(snapshot, "normalizedEmail"),
    ),
  );
});

test("ordinary editor updates preserve adopted venue and private meeting data", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);
  const created = await createOrganizerEvent(
    database,
    ownerIdentity,
    draftInput({
      privateMeetingDetails: "PRIVATE-MEETING-PRESERVED",
      venueId: "venue-main",
    }),
  );
  const updated = await updateOrganizerEvent(
    database,
    ownerIdentity,
    created.id,
    created.contentVersion,
    draftInput({
      privateMeetingDetails: null,
      title: "Title-only edit from an older open form",
      venueId: null,
    }),
  );

  assert.equal(updated.contentVersion, 2);
  assert.equal(updated.scheduleVersion, 1);
  assert.equal(updated.venueId, "venue-main");
  assert.equal(
    updated.privateMeetingDetails,
    "PRIVATE-MEETING-PRESERVED",
  );
  const stored = await database
    .prepare(
      `SELECT venue_id, private_meeting_details
       FROM organizer_events
       WHERE id = ?`,
    )
    .bind(created.id)
    .first();
  assert.equal(stored.venue_id, "venue-main");
  assert.equal(
    stored.private_meeting_details,
    "PRIVATE-MEETING-PRESERVED",
  );
  const latestRevision = await database
    .prepare(
      `SELECT snapshot_json
       FROM organizer_event_revisions
       WHERE organizer_event_id = ?
       ORDER BY content_version DESC
       LIMIT 1`,
    )
    .bind(created.id)
    .first();
  const snapshot = JSON.parse(latestRevision.snapshot_json);
  assert.equal(snapshot.venueId, "venue-main");
  assert.equal(
    snapshot.privateMeetingDetails,
    "PRIVATE-MEETING-PRESERVED",
  );
  assert.equal(
    (
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM notifications
           WHERE type = 'event_schedule_changed'`,
        )
        .first()
    ).count,
    0,
  );
});

test("duplicate rechecks the source version atomically and leaves no stale-copy residue", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);
  const sourceInput = ideaInput({
    title: "Source for guarded duplicate",
    primaryOrganizerProfileId: "profile-organizer-1",
    coOrganizerProfileIds: ["profile-organizer-2"],
  });
  const source = await createOrganizerEvent(
    database,
    ownerIdentity,
    sourceInput,
  );
  const originalBatch = database.batch.bind(database);
  let raced = false;
  const racingBatch = async (statements) => {
    if (!raced) {
      raced = true;
      database.batch = originalBatch;
      try {
        await updateOrganizerEvent(
          database,
          ownerIdentity,
          source.id,
          source.contentVersion,
          {
            ...sourceInput,
            title: "Concurrent source update",
          },
        );
      } finally {
        database.batch = racingBatch;
      }
    }
    return originalBatch(statements);
  };
  database.batch = racingBatch;

  await assert.rejects(
    duplicateOrganizerEvent(
      database,
      ownerIdentity,
      source.id,
      source.contentVersion,
    ),
    (error) => error?.code === "stale_edit" && error?.status === 409,
  );
  database.batch = originalBatch;
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM organizer_events
         WHERE title LIKE 'Copy of Source for guarded duplicate%'`,
      )
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM audit_logs
         WHERE action = 'organizer_event.duplicated'
           AND metadata_json LIKE '%' || ? || '%'`,
      )
      .bind(source.id)
      .first("count"),
    0,
  );

  const deletedSource = await createOrganizerEvent(
    database,
    ownerIdentity,
    ideaInput({ title: "Source deleted during duplicate" }),
  );
  let deletionRaced = false;
  const deletingBatch = async (statements) => {
    if (!deletionRaced) {
      deletionRaced = true;
      database.batch = originalBatch;
      try {
        await softDeleteOrganizerEvent(
          database,
          ownerIdentity,
          deletedSource.id,
          deletedSource.contentVersion,
        );
      } finally {
        database.batch = deletingBatch;
      }
    }
    return originalBatch(statements);
  };
  database.batch = deletingBatch;
  await assert.rejects(
    duplicateOrganizerEvent(
      database,
      ownerIdentity,
      deletedSource.id,
      deletedSource.contentVersion,
    ),
    (error) => error?.code === "stale_edit" && error?.status === 409,
  );
  database.batch = originalBatch;
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM organizer_events
         WHERE title LIKE 'Copy of Source deleted during duplicate%'`,
      )
      .first("count"),
    0,
  );
});

test("Organizer mutation access is own/co-organizer and club scoped", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);
  const created = await createOrganizerEvent(
    database,
    ownerIdentity,
    ideaInput({
      primaryOrganizerProfileId: "profile-organizer-1",
      coOrganizerProfileIds: ["profile-organizer-2"],
    }),
  );

  assert.equal(
    (await listOrganizerEvents(database, organizerIdentity)).length,
    1,
  );
  assert.equal(
    (await listOrganizerEvents(database, unrelatedIdentity)).length,
    0,
    "full private DTOs are not returned for unrelated Organizer records",
  );
  const unrelatedCalendar = await listOrganizerCalendarEvents(
    database,
    unrelatedIdentity,
  );
  assert.equal(unrelatedCalendar.resultCount, 1);
  assert.equal(unrelatedCalendar.events[0].readOnly, true);

  await assert.rejects(
    updateOrganizerEvent(
      database,
      unrelatedIdentity,
      created.id,
      1,
      ideaInput({
        primaryOrganizerProfileId: "profile-organizer-3",
      }),
    ),
    (error) => error?.code === "not_found",
  );
  const organizerEdit = await updateOrganizerEvent(
    database,
    organizerIdentity,
    created.id,
    1,
    ideaInput({
      title: "Organizer-owned revision",
      primaryOrganizerProfileId: "profile-organizer-1",
      coOrganizerProfileIds: ["profile-organizer-2"],
    }),
  );
  assert.equal(organizerEdit.title, "Organizer-owned revision");
  await assert.rejects(
    updateOrganizerEvent(
      database,
      organizerIdentity,
      created.id,
      2,
      ideaInput({
        title: "Crafted reassignment",
        primaryOrganizerProfileId: "profile-organizer-2",
        coOrganizerProfileIds: [],
      }),
    ),
    (error) => error?.code === "not_found",
    "an Organizer cannot transfer primary ownership by crafting a profile ID",
  );
  assert.equal(
    (await getOrganizerCalendarEvent(database, ownerIdentity, created.id))
      .primaryOrganizerProfileId,
    "profile-organizer-1",
  );
  for (const assignment of [
    {
      primaryOrganizerProfileId: "profile-organizer-4",
      coOrganizerProfileIds: [],
    },
    {
      primaryOrganizerProfileId: "profile-owner",
      coOrganizerProfileIds: ["profile-organizer-4"],
    },
  ]) {
    await assert.rejects(
      createOrganizerEvent(
        database,
        ownerIdentity,
        ideaInput(assignment),
      ),
      (error) => error?.code === "not_found",
      "an organization member without the event club assignment cannot be assigned as an Organizer",
    );
  }
});

test("calendar filtering includes co-organizers, all-day boundaries, and truthful counts beyond the response cap", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);

  const allDay = await createOrganizerEvent(
    database,
    ownerIdentity,
    {
      ...ideaInput({
        coOrganizerProfileIds: ["profile-organizer-2"],
        planningStatus: "draft",
        scheduleShape: "all_day",
        title: "Vancouver DST all-day Draft",
      }),
      allDayEndDateExclusive: "2026-03-09",
      allDayStartDate: "2026-03-08",
    },
  );
  const coOrganizerView = await listOrganizerCalendarEvents(
    database,
    ownerIdentity,
    {
      organizerProfileId: "profile-organizer-2",
      limit: 20,
    },
  );
  assert.equal(coOrganizerView.resultCount, 1);
  assert.equal(coOrganizerView.events[0].id, allDay.id);
  assert.deepEqual(coOrganizerView.events[0].coOrganizerProfileIds, [
    "profile-organizer-2",
  ]);

  const beforeExclusiveBoundary = await listOrganizerCalendarEvents(
    database,
    ownerIdentity,
    {
      fromUtc: Date.parse("2026-03-09T06:30:00.000Z"),
      toUtc: Date.parse("2026-03-09T06:45:00.000Z"),
      limit: 20,
    },
  );
  assert.equal(beforeExclusiveBoundary.resultCount, 1);
  assert.equal(beforeExclusiveBoundary.events[0].id, allDay.id);
  const atExclusiveBoundary = await listOrganizerCalendarEvents(
    database,
    ownerIdentity,
    {
      fromUtc: Date.parse("2026-03-09T07:00:00.000Z"),
      toUtc: Date.parse("2026-03-09T08:00:00.000Z"),
      limit: 20,
    },
  );
  assert.equal(atExclusiveBoundary.resultCount, 0);

  const bulkValues = Array.from({ length: 505 }, (_, index) => {
    const id = `bulk-calendar-${String(index).padStart(3, "0")}`;
    return `(
      '${id}', 'org-main', 'club-main', 'profile-owner',
      'Bulk private Idea ${index}', '${id}', 'idea', 'private', 'unscheduled',
      'America/Vancouver', 1, 1, 'profile-owner', 'profile-owner', 2, 2
    )`;
  }).join(",\n");
  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES ${bulkValues};
  `);

  const bounded = await listOrganizerCalendarEvents(
    database,
    ownerIdentity,
    { limit: 500 },
  );
  assert.equal(bounded.events.length, 500);
  assert.equal(bounded.loadedCount, 500);
  assert.equal(bounded.hasMore, true);
  assert.equal(bounded.nextLimit, 506);
  assert.equal(
    bounded.resultCount,
    506,
    "the bounded response reports every matching row rather than three source-local LIMIT 500 subsets",
  );

  const expanded = await listOrganizerCalendarEvents(
    database,
    ownerIdentity,
    { limit: bounded.nextLimit },
  );
  assert.equal(expanded.events.length, 506);
  assert.equal(expanded.loadedCount, 506);
  assert.equal(expanded.resultCount, 506);
  assert.equal(expanded.hasMore, false);
  assert.equal(expanded.nextLimit, null);
  assert.equal(
    new Set(expanded.events.map((event) => event.id)).size,
    506,
    "the cumulative load-more path returns every record exactly once",
  );
});

test("private event index pages keep older and deleted records reachable", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);

  const activeValues = Array.from({ length: 205 }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    const id = `index-page-${suffix}`;
    const timestamp = 10_000 + index;
    return `(
      '${id}', 'org-main', 'club-main', 'profile-owner',
      'Index record ${suffix}', '${id}', 'idea', 'private', 'unscheduled',
      'America/Vancouver', 1, 1, 'profile-owner', 'profile-owner',
      ${timestamp}, ${timestamp}
    )`;
  }).join(",\n");
  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES ${activeValues};

    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at,
      deleted_at
    ) VALUES (
      'index-deleted-oldest', 'org-main', 'club-secondary', 'profile-owner',
      'Recoverable archived planning record', 'index-deleted-oldest',
      'idea', 'private', 'unscheduled', 'America/Vancouver', 1, 1,
      'profile-owner', 'profile-owner', 2, 2, 3
    );
  `);

  const first = await queryOrganizerEventIndex(
    database,
    ownerIdentity,
    { page: 1, status: "active" },
  );
  assert.deepEqual(
    {
      firstResult: first.firstResult,
      hasNextPage: first.hasNextPage,
      hasPreviousPage: first.hasPreviousPage,
      lastResult: first.lastResult,
      page: first.page,
      totalCount: first.totalCount,
    },
    {
      firstResult: 1,
      hasNextPage: true,
      hasPreviousPage: false,
      lastResult: 200,
      page: 1,
      totalCount: 205,
    },
  );

  const second = await queryOrganizerEventIndex(
    database,
    ownerIdentity,
    { page: 2, status: "active" },
  );
  assert.equal(second.events.length, 5);
  assert.equal(second.firstResult, 201);
  assert.equal(second.lastResult, 205);
  assert.equal(second.hasNextPage, false);
  assert.equal(second.hasPreviousPage, true);
  assert.equal(second.totalCount, 205);
  assert.equal(
    new Set([...first.events, ...second.events].map((event) => event.id)).size,
    205,
  );
  assert.ok(
    second.events.some((event) => event.id === "index-page-000"),
    "the oldest active record remains reachable on the next page",
  );

  const deleted = await queryOrganizerEventIndex(
    database,
    ownerIdentity,
    {
      search: "secondary club",
      status: "deleted",
    },
  );
  assert.equal(deleted.totalCount, 1);
  assert.deepEqual(
    deleted.events.map((event) => event.id),
    ["index-deleted-oldest"],
    "server-side club search reaches a soft-deleted record outside the active page",
  );

  await assert.rejects(
    queryOrganizerEventIndex(database, ownerIdentity, {
      page: "not-a-page",
    }),
    (error) => error?.name === "InputValidationError",
  );
  await assert.rejects(
    queryOrganizerEventIndex(database, ownerIdentity, {
      search: "x".repeat(121),
    }),
    (error) => error?.name === "InputValidationError",
  );
});

test("atomic edits validate the final organizer assignment set", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);

  const promoted = await createOrganizerEvent(
    database,
    ownerIdentity,
    ideaInput({
      primaryOrganizerProfileId: "profile-organizer-1",
      coOrganizerProfileIds: ["profile-organizer-2"],
    }),
  );
  const afterPromotion = await updateOrganizerEvent(
    database,
    ownerIdentity,
    promoted.id,
    promoted.contentVersion,
    ideaInput({
      primaryOrganizerProfileId: "profile-organizer-2",
      coOrganizerProfileIds: ["profile-organizer-1"],
    }),
  );
  assert.equal(
    afterPromotion.primaryOrganizerProfileId,
    "profile-organizer-2",
  );
  assert.deepEqual(
    afterPromotion.coOrganizerProfileIds,
    ["profile-organizer-1"],
  );

  const moving = await createOrganizerEvent(
    database,
    ownerIdentity,
    ideaInput({
      primaryOrganizerProfileId: "profile-owner",
      coOrganizerProfileIds: ["profile-organizer-2"],
    }),
  );
  const afterMove = await updateOrganizerEvent(
    database,
    ownerIdentity,
    moving.id,
    moving.contentVersion,
    ideaInput({
      clubId: "club-secondary",
      primaryOrganizerProfileId: "profile-owner",
      coOrganizerProfileIds: [],
    }),
  );
  assert.equal(afterMove.clubId, "club-secondary");
  assert.deepEqual(afterMove.coOrganizerProfileIds, []);
});

test("runtime guards reject crafted lifecycle and cross-organization writes", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);

  assert.throws(
    () =>
      insertCraftedOrganizerEvent(database, {
        id: "crafted-confirmed",
        planningStatus: "confirmed",
        publicationStatus: "private",
        clubId: "club-main",
        organizationId: "org-main",
      }),
    /phase3_event_lifecycle_forbidden/u,
  );
  assert.throws(
    () =>
      insertCraftedOrganizerEvent(database, {
        id: "crafted-published",
        planningStatus: "draft",
        publicationStatus: "published",
        clubId: "club-main",
        organizationId: "org-main",
      }),
    /phase3_event_lifecycle_forbidden/u,
  );
  assert.throws(
    () =>
      insertCraftedOrganizerEvent(database, {
        id: "crafted-cross-org",
        planningStatus: "idea",
        publicationStatus: "private",
        clubId: "club-other",
        organizationId: "org-main",
      }),
    /organizer_event_organization_mismatch/u,
  );
  assert.equal(await count(database, "organizer_events"), 0);
});

test("runtime guards enforce Organizer club assignment on direct writes and restore", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);

  database.exec(`
    UPDATE club_memberships
    SET status = 'suspended', updated_at = 2
    WHERE id = 'club-o3';
  `);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO organizer_events (
          id, organization_id, club_id, primary_organizer_profile_id,
          title, slug, planning_status, publication_status, schedule_shape,
          timezone, content_version, schedule_version,
          created_by_profile_id, updated_by_profile_id, created_at, updated_at
        ) VALUES (
          'unassigned-primary', 'org-main', 'club-main',
          'profile-organizer-3', 'Unassigned primary', 'unassigned-primary',
          'idea', 'private', 'unscheduled', 'America/Vancouver', 1, 1,
          'profile-owner', 'profile-owner', 1, 1
        );
      `),
    /organizer_event_organization_mismatch/u,
  );

  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'restore-guard-event', 'org-main', 'club-main', 'profile-owner',
      'Restore guard', 'restore-guard', 'idea', 'private', 'unscheduled',
      'America/Vancouver', 1, 1, 'profile-owner', 'profile-owner', 1, 1
    );
  `);
  assert.throws(
    () =>
      database.exec(`
        INSERT INTO organizer_event_organizers (
          id, organization_id, organizer_event_id, profile_id,
          created_by_profile_id, created_at
        ) VALUES (
          'unassigned-association', 'org-main', 'restore-guard-event',
          'profile-organizer-3', 'profile-owner', 1
        );
      `),
    /organizer_event_organizer_organization_mismatch/u,
  );

  database.exec(`
    INSERT INTO organizer_event_organizers (
      id, organization_id, organizer_event_id, profile_id,
      created_by_profile_id, created_at
    ) VALUES (
      'valid-association', 'org-main', 'restore-guard-event',
      'profile-organizer-2', 'profile-owner', 1
    );
    UPDATE organizer_events
    SET deleted_at = 3, updated_at = 3
    WHERE id = 'restore-guard-event';
    UPDATE club_memberships
    SET status = 'suspended', updated_at = 4
    WHERE id = 'club-o2';
  `);
  assert.throws(
    () =>
      database.exec(`
        UPDATE organizer_events
        SET deleted_at = NULL, updated_at = 5
        WHERE id = 'restore-guard-event';
      `),
    /organizer_event_organization_mismatch/u,
  );
  await assert.rejects(
    restoreOrganizerEvent(
      database,
      ownerIdentity,
      "restore-guard-event",
      1,
    ),
    (error) =>
      error?.code === "conflict" &&
      error?.status === 409 &&
      /assigned planning references are active/u.test(error?.publicMessage),
  );
  assert.equal(
    (
      await database
        .prepare(
          `SELECT deleted_at
           FROM organizer_events
           WHERE id = 'restore-guard-event'`,
        )
        .first()
    ).deleted_at,
    3,
  );
});

test("malformed existing Phase 3 data leaves no v3 marker or partial guard set", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  insertCraftedOrganizerEvent(database, {
    id: "preexisting-cross-org",
    planningStatus: "idea",
    publicationStatus: "private",
    clubId: "club-other",
    organizationId: "org-main",
  });

  await assert.rejects(
    ensureDatabaseInvariants(database),
    /Database integrity guards are unavailable/u,
  );
  assert.equal(
    (
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM database_invariant_state
           WHERE singleton_key = 'database-guards'`,
        )
        .first()
    ).count,
    0,
  );
  assert.equal(
    (
      await database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger'",
        )
        .first()
    ).count,
    0,
    "the aborting v2 probe rolls back the complete trigger installation",
  );
});

test("manual Phase 3 rows and source-controlled legacy rows cannot leak or mutate", async (t) => {
  const database = newDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariants(database);
  const created = await createOrganizerEvent(
    database,
    ownerIdentity,
    ideaInput(),
  );
  const publicEvents = await listUpcomingPublicEvents(database, {
    organizationId: "org-main",
    fromUtcMs: 1,
    todayDate: "2026-07-25",
  });
  assert.deepEqual(publicEvents, []);
  await assert.rejects(
    updateOrganizerEvent(
      database,
      ownerIdentity,
      "legacy-source-event",
      1,
      draftInput(),
    ),
    (error) => error?.code === "not_found",
  );
  assert.equal(
    (
      await database
        .prepare("SELECT status FROM events WHERE id = 'legacy-source-event'")
        .first()
    ).status,
    "confirmed",
  );
  assert.equal(
    (
      await database
        .prepare(
          "SELECT count(*) AS count FROM events WHERE id = ?",
        )
        .bind(created.id)
        .first()
    ).count,
    0,
    "manual private records never enter the Phase 2 events table",
  );
});

function ideaInput(overrides = {}) {
  return {
    title: "Unscheduled private Idea",
    clubId: "club-main",
    primaryOrganizerProfileId: "profile-owner",
    coOrganizerProfileIds: [],
    planningStatus: "idea",
    publicationStatus: "private",
    scheduleShape: "unscheduled",
    timeZone: "America/Vancouver",
    ...overrides,
  };
}

function draftInput(overrides = {}) {
  return {
    title: "Scheduled private Draft",
    clubId: "club-main",
    primaryOrganizerProfileId: "profile-owner",
    coOrganizerProfileIds: [],
    planningStatus: "draft",
    publicationStatus: "private",
    scheduleShape: "timed",
    timeZone: "America/Vancouver",
    startLocal: "2026-08-15T18:30",
    endLocal: "2026-08-15T20:30",
    ...overrides,
  };
}

function insertCraftedOrganizerEvent(
  database,
  { id, planningStatus, publicationStatus, clubId, organizationId },
) {
  database.exec(`
    INSERT INTO organizer_events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, planning_status, publication_status, schedule_shape,
      timezone, content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      '${id}', '${organizationId}', '${clubId}', 'profile-owner',
      'Crafted', '${id}', '${planningStatus}', '${publicationStatus}',
      'unscheduled', 'America/Vancouver', 1, 1,
      'profile-owner', 'profile-owner', 1, 1
    );
  `);
}

function seed(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      ('profile-owner', 'subject-owner', 'owner@example.test', 'Owner', 'active', 1, 1),
      ('profile-organizer-1', 'subject-o1', 'organizer1@example.test', 'Organizer One', 'active', 1, 1),
      ('profile-organizer-2', 'subject-o2', 'organizer2@example.test', 'Organizer Two', 'active', 1, 1),
      ('profile-organizer-3', 'subject-o3', 'organizer3@example.test', 'Organizer Three', 'active', 1, 1),
      ('profile-organizer-4', 'subject-o4', 'organizer4@example.test', 'Organizer Four', 'active', 1, 1),
      ('profile-other', 'subject-other', 'other@example.test', 'Other Owner', 'active', 1, 1);

    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      ('org-main', 'Main Organization', 'main-organization', 'America/Vancouver', 1, 'profile-owner', 1, 1),
      ('org-other', 'Other Organization', 'other-organization', 'America/Vancouver', 1, 'profile-other', 1, 1);

    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      ('membership-owner', 'org-main', 'profile-owner', 'owner@example.test', 'owner', 'active', 'profile-owner', 1, 1),
      ('membership-o1', 'org-main', 'profile-organizer-1', 'organizer1@example.test', 'organizer', 'active', 'profile-owner', 1, 1),
      ('membership-o2', 'org-main', 'profile-organizer-2', 'organizer2@example.test', 'organizer', 'active', 'profile-owner', 1, 1),
      ('membership-o3', 'org-main', 'profile-organizer-3', 'organizer3@example.test', 'organizer', 'active', 'profile-owner', 1, 1),
      ('membership-o4', 'org-main', 'profile-organizer-4', 'organizer4@example.test', 'organizer', 'active', 'profile-owner', 1, 1),
      ('membership-other', 'org-other', 'profile-other', 'other@example.test', 'owner', 'active', 'profile-other', 1, 1);

    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('club-main', 'org-main', 'Main Club', 'main-club', 'profile-owner', 1, 1),
      ('club-secondary', 'org-main', 'Secondary Club', 'secondary-club', 'profile-owner', 1, 1),
      ('club-other', 'org-other', 'Other Club', 'other-club', 'profile-other', 1, 1);

    INSERT INTO venues (
      id, organization_id, name, slug, created_at, updated_at
    ) VALUES (
      'venue-main', 'org-main', 'Private planning venue',
      'private-planning-venue', 1, 1
    );

    INSERT INTO club_memberships (
      id, organization_id, club_id, organization_membership_id,
      profile_id, role, status, created_by_profile_id, created_at, updated_at
    ) VALUES
      ('club-o1', 'org-main', 'club-main', 'membership-o1', 'profile-organizer-1', 'organizer', 'active', 'profile-owner', 1, 1),
      ('club-o2', 'org-main', 'club-main', 'membership-o2', 'profile-organizer-2', 'organizer', 'active', 'profile-owner', 1, 1),
      ('club-o3', 'org-main', 'club-main', 'membership-o3', 'profile-organizer-3', 'organizer', 'active', 'profile-owner', 1, 1);

    INSERT INTO events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, status, visibility, time_kind, starts_at_utc, ends_at_utc,
      timezone, buffer_before_minutes, buffer_after_minutes,
      organizer_scope_json, schedule_version, schedule_review_state,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'legacy-source-event', 'org-main', 'club-main', 'profile-owner',
      'Published source event', 'published-source-event', 'confirmed', 'public',
      'timed', 1900000000000, 1900003600000, 'America/Vancouver',
      0, 0, '["profile-owner"]', 1, 'unreviewed', 1800000000000,
      'profile-owner', 'profile-owner', 1, 1
    );

    INSERT INTO external_source_links (
      id, organization_id, entity_type, entity_id, source_type,
      sync_source_id, external_id, external_url, created_at, updated_at
    ) VALUES (
      'source-link-event', 'org-main', 'event', 'legacy-source-event',
      'meetup_ics', 'source-existing', 'external-event',
      'https://www.meetup.com/example-group/events/external-event/', 1, 1
    );
  `);
}

async function count(database, table) {
  return (
    await database
      .prepare(`SELECT count(*) AS count FROM "${table}"`)
      .first()
  ).count;
}
