import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  getPublicEventBySlug,
  listPublicEventSitemapSlugs,
  listRelatedPublicEvents,
  queryPublicEvents,
} from "../../lib/server/public/events.ts";
import { InputValidationError } from "../../lib/validation/index.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const ORGANIZATION_ID = "org_phase_2_public";
const NOW_UTC_MS = Date.parse("2026-07-25T12:00:00.000Z");
const TODAY_DATE = "2026-07-25";
const PRIVATE_SENTINELS = Object.freeze([
  "PRIVATE_EVENT_NOTE_SENTINEL",
  "PRIVATE_MEETING_SENTINEL",
  "PRIVATE_VENUE_ADDRESS_SENTINEL",
  "PRIVATE_VENUE_DIRECTIONS_SENTINEL",
  "PRIVATE_WITHHELD_LOCATION_SENTINEL",
  "PRIVATE_FEED_TOKEN_SENTINEL",
  "private-organizer@synthetic.invalid",
  "PENDING_TITLE_SENTINEL",
  "PENDING_ADDITION_SENTINEL",
]);

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.ok(migrations.length > 0, "generated migrations must exist");
  const sql = migrations
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");
  assert.match(
    sql,
    /CREATE TABLE `club_public_profiles`/u,
    "the generated Phase 2 catalog migration must be present",
  );
  assert.match(
    sql,
    /CREATE TABLE `event_public_details`/u,
    "the generated Phase 2 public-event migration must be present",
  );
  return sql;
}

async function createFixture(t) {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  t.after(() => database.close());

  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES
      (
        'profile_owner', 'email:owner@synthetic.invalid',
        'owner@synthetic.invalid', 'Synthetic owner', 0, 'active', 1, 1
      ),
      (
        'profile_public_host', 'email:private-organizer@synthetic.invalid',
        'private-organizer@synthetic.invalid', 'Public Host', 1, 'active',
        1, 1
      ),
      (
        'profile_no_consent', 'email:hidden@synthetic.invalid',
        'hidden@synthetic.invalid', 'Hidden Host', 0, 'active', 1, 1
      );

    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      '${ORGANIZATION_ID}', 'Synthetic public projection organization',
      'synthetic-public-projection', 'America/Vancouver', 1,
      'profile_owner', 'profile_owner', 1, 1
    );

    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'lane_think', '${ORGANIZATION_ID}', 'Think', 'think',
        'Synthetic lane.', 10, 'profile_owner', 1, 1
      ),
      (
        'lane_explore', '${ORGANIZATION_ID}', 'Explore', 'explore',
        'Synthetic lane.', 30, 'profile_owner', 1, 1
      ),
      (
        'lane_eat_play', '${ORGANIZATION_ID}', 'Eat & Play',
        'eat-and-play', 'Synthetic lane.', 40, 'profile_owner', 1, 1
      );

    INSERT INTO clubs (
      id, organization_id, name, slug, description, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      (
        'club_vcc', '${ORGANIZATION_ID}', 'Vancouver Curiosity Club',
        'vancouver-curiosity-club', 'Synthetic public club.',
        'profile_owner', 1, 1
      ),
      (
        'club_literature', '${ORGANIZATION_ID}',
        'Vancouver Literature and Film', 'vancouver-literature-and-film',
        'Synthetic public club.', 'profile_owner', 1, 1
      ),
      (
        'club_draft', '${ORGANIZATION_ID}', 'Off-Radar Eats',
        'off-radar-eats', 'Synthetic draft club.', 'profile_owner', 1, 1
      );

    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id, publication_status,
      is_featured, public_group_url, published_at, created_at, updated_at
    ) VALUES
      (
        'club_vcc', '${ORGANIZATION_ID}', 'lane_think', 'published', 1,
        'https://www.meetup.com/synthetic-public-group/', 1, 1, 1
      ),
      (
        'club_literature', '${ORGANIZATION_ID}', 'lane_think', 'published', 1,
        'https://www.meetup.com/synthetic-literature-group/', 1, 1, 1
      ),
      (
        'club_draft', '${ORGANIZATION_ID}', 'lane_eat_play', 'draft', 0,
        NULL, NULL, 1, 1
      );

    INSERT INTO categories (
      id, organization_id, name, slug, description, color_token,
      created_at, updated_at
    ) VALUES
      (
        'category_ideas', '${ORGANIZATION_ID}', 'Ideas', 'ideas',
        'Synthetic category.', 'cobalt', 1, 1
      ),
      (
        'category_books', '${ORGANIZATION_ID}', 'Books', 'books',
        'Synthetic category.', 'forest', 1, 1
      );

    INSERT INTO venues (
      id, organization_id, name, slug, timezone, public_location_name,
      public_address, private_address, private_directions, is_public,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'venue_public', '${ORGANIZATION_ID}', 'Synthetic internal venue',
        'synthetic-venue', 'America/Vancouver', 'Public Reading Room',
        '100 Public Test Street', 'PRIVATE_VENUE_ADDRESS_SENTINEL',
        'PRIVATE_VENUE_DIRECTIONS_SENTINEL', 1, 'profile_owner',
        'profile_owner', 1, 1
      ),
      (
        'venue_private', '${ORGANIZATION_ID}', 'Private venue sentinel',
        'private-venue', 'America/Vancouver',
        'PRIVATE_WITHHELD_LOCATION_SENTINEL',
        'PRIVATE_VENUE_ADDRESS_SENTINEL',
        'PRIVATE_VENUE_ADDRESS_SENTINEL',
        'PRIVATE_VENUE_DIRECTIONS_SENTINEL', 0, 'profile_owner',
        'profile_owner', 1, 1
      );
  `);

  const fixtures = [
    timedEvent({
      id: "event_manual_upcoming",
      title: "Manual Ideas Gathering",
      slug: "manual-ideas-gathering",
      summary: "A searchable public summary about ideas.",
      description: "A public description for the manual event.",
      clubId: "club_vcc",
      categoryId: "category_ideas",
      venueId: "venue_public",
      startsAt: "2026-08-02T02:00:00.000Z",
      endsAt: "2026-08-02T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_manual_related",
      title: "Related Manual Conversation",
      slug: "related-manual-conversation",
      summary: "Another ideas gathering.",
      clubId: "club_vcc",
      categoryId: "category_ideas",
      startsAt: "2026-08-03T02:00:00.000Z",
      endsAt: "2026-08-03T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_private_venue",
      title: "Published Event With Withheld Location",
      slug: "published-event-with-withheld-location",
      clubId: "club_vcc",
      categoryId: "category_ideas",
      venueId: "venue_private",
      startsAt: "2026-08-03T05:00:00.000Z",
      endsAt: "2026-08-03T07:00:00.000Z",
    }),
    timedEvent({
      id: "event_tentative",
      title: "Tentative Online Reading",
      slug: "tentative-online-reading",
      status: "tentative",
      clubId: "club_literature",
      eventLaneId: "lane_explore",
      categoryId: "category_books",
      startsAt: "2026-08-04T02:00:00.000Z",
      endsAt: "2026-08-04T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_manual_cancelled",
      title: "Cancelled Manual Event",
      slug: "cancelled-manual-event",
      status: "cancelled",
      startsAt: "2026-08-05T02:00:00.000Z",
      endsAt: "2026-08-05T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_past_early",
      title: "Early Past Event",
      slug: "early-past-event",
      startsAt: "2026-06-01T02:00:00.000Z",
      endsAt: "2026-06-01T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_past_late",
      title: "Late Past Event",
      slug: "late-past-event",
      startsAt: "2026-07-20T02:00:00.000Z",
      endsAt: "2026-07-20T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_draft",
      title: "Draft Event Sentinel",
      slug: "draft-event-sentinel",
      status: "draft",
      startsAt: "2026-08-06T02:00:00.000Z",
      endsAt: "2026-08-06T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_hold",
      title: "Hold Event Sentinel",
      slug: "hold-event-sentinel",
      status: "hold",
      holdExpiresAt: Date.parse("2026-08-07T01:00:00.000Z"),
      startsAt: "2026-08-07T02:00:00.000Z",
      endsAt: "2026-08-07T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_private",
      title: "Private Event Sentinel",
      slug: "private-event-sentinel",
      visibility: "private",
      startsAt: "2026-08-08T02:00:00.000Z",
      endsAt: "2026-08-08T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_unpublished",
      title: "Unpublished Event Sentinel",
      slug: "unpublished-event-sentinel",
      publishedAt: null,
      startsAt: "2026-08-09T02:00:00.000Z",
      endsAt: "2026-08-09T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_deleted",
      title: "Deleted Event Sentinel",
      slug: "deleted-event-sentinel",
      deletedAt: 2,
      startsAt: "2026-08-10T02:00:00.000Z",
      endsAt: "2026-08-10T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_draft_club",
      title: "Draft Club Event Sentinel",
      slug: "draft-club-event-sentinel",
      clubId: "club_draft",
      startsAt: "2026-08-11T02:00:00.000Z",
      endsAt: "2026-08-11T04:00:00.000Z",
    }),
    timedEvent({
      id: "event_meetup_active",
      title: "PENDING_TITLE_SENTINEL",
      slug: "meetup-active-event",
      status: "cancelled",
      clubId: "club_draft",
      categoryId: "category_ideas",
      startsAt: "2026-12-01T02:00:00.000Z",
      endsAt: "2026-12-01T04:00:00.000Z",
      updatedAt: 900,
    }),
    timedEvent({
      id: "event_meetup_cancelled",
      title: "Canonical Cancelled Source Event",
      slug: "meetup-cancelled-event",
      status: "cancelled",
      categoryId: "category_books",
      startsAt: "2026-08-13T02:00:00.000Z",
      endsAt: "2026-08-13T04:00:00.000Z",
      updatedAt: 100,
    }),
    timedEvent({
      id: "event_pending_addition",
      title: "PENDING_ADDITION_SENTINEL",
      slug: "pending-addition-sentinel",
      startsAt: "2026-08-14T02:00:00.000Z",
      endsAt: "2026-08-14T04:00:00.000Z",
      updatedAt: 900,
    }),
  ];
  for (const fixture of fixtures) {
    await insertTimedEvent(database, fixture);
  }

  database.exec(`
    INSERT INTO event_public_details (
      event_id, organization_id, attendance_mode, created_at, updated_at
    ) VALUES
      (
        'event_manual_upcoming', '${ORGANIZATION_ID}', 'in_person', 1, 1
      ),
      (
        'event_manual_related', '${ORGANIZATION_ID}', 'hybrid', 1, 1
      ),
      (
        'event_private_venue', '${ORGANIZATION_ID}', 'in_person', 1, 1
      ),
      (
        'event_tentative', '${ORGANIZATION_ID}', 'online', 1, 1
      ),
      (
        'event_meetup_active', '${ORGANIZATION_ID}',
        'location_undecided', 1, 1
      );

    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role, is_publicly_listed,
      created_by_profile_id, created_at
    ) VALUES
      (
        'organizer_public', '${ORGANIZATION_ID}', 'event_manual_upcoming',
        'profile_public_host', 'primary', 1, 'profile_owner', 1
      ),
      (
        'organizer_no_consent', '${ORGANIZATION_ID}',
        'event_manual_upcoming', 'profile_no_consent', 'co_organizer', 1,
        'profile_owner', 1
      );

    INSERT INTO sync_sources (
      id, organization_id, club_id, source_type, source_url, enabled,
      refresh_interval_minutes, last_attempt_at, last_success_at,
      last_error_at, last_error_code, active_generation_id,
      pending_generation_id, pending_snapshot_hash, pending_cursor,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'source_synthetic', '${ORGANIZATION_ID}', 'club_vcc', 'meetup_ics',
      'https://synthetic.invalid/PRIVATE_FEED_TOKEN_SENTINEL', 1, 15,
      900, 100, 900, 'synthetic_failed_continuation', 'generation_active',
      'generation_pending',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      3, 'profile_owner', 'profile_owner', 1, 900
    );

    INSERT INTO meetup_sync_generations (
      id, organization_id, sync_source_id, previous_generation_id,
      snapshot_hash, expected_item_count, processed_item_count,
      rejected_item_count, state, removed_count, created_at, updated_at,
      published_at, failed_at
    ) VALUES
      (
        'generation_previous', '${ORGANIZATION_ID}', 'source_synthetic', NULL,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        1, 1, 0, 'published', 0, 10, 10, 10, NULL
      ),
      (
        'generation_active', '${ORGANIZATION_ID}', 'source_synthetic',
        'generation_previous',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        2, 2, 0, 'published', 0, 100, 100, 100, NULL
      ),
      (
        'generation_pending', '${ORGANIZATION_ID}', 'source_synthetic',
        'generation_active',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        4, 3, 0, 'staging', 0, 900, 900, NULL, NULL
      );

    INSERT INTO external_source_links (
      id, organization_id, entity_type, entity_id, source_type,
      sync_source_id, external_id, external_url, source_fingerprint,
      last_imported_at, created_at, updated_at
    ) VALUES
      (
        'source_link_active', '${ORGANIZATION_ID}', 'event',
        'event_meetup_active', 'meetup_ics', 'source_synthetic',
        'synthetic-active-uid',
        'https://www.meetup.com/synthetic-public-group/events/9001/',
        'active-fingerprint', 900, 1, 900
      ),
      (
        'source_link_cancelled', '${ORGANIZATION_ID}', 'event',
        'event_meetup_cancelled', 'meetup_ics', 'source_synthetic',
        'synthetic-cancelled-uid',
        'https://www.meetup.com/synthetic-public-group/events/9002/',
        'cancelled-fingerprint', 100, 1, 100
      ),
      (
        'source_link_pending', '${ORGANIZATION_ID}', 'event',
        'event_pending_addition', 'meetup_ics', 'source_synthetic',
        'synthetic-pending-uid',
        'https://www.meetup.com/synthetic-public-group/events/9003/',
        'pending-fingerprint', 900, 900, 900
      );
  `);

  await insertSnapshot(database, {
    id: "snapshot_previous_cancelled",
    generationId: "generation_previous",
    externalId: "synthetic-cancelled-uid",
    eventId: "event_meetup_cancelled",
    eventSlug: "meetup-cancelled-event",
    title: "Previously Published Source Event",
    status: "confirmed",
    startsAt: "2026-08-13T02:00:00.000Z",
    endsAt: "2026-08-13T04:00:00.000Z",
    ordinal: 0,
    updatedAt: 10,
    eventNumber: "9002",
  });
  await insertSnapshot(database, {
    id: "snapshot_active",
    generationId: "generation_active",
    externalId: "synthetic-active-uid",
    eventId: "event_meetup_active",
    eventSlug: "meetup-active-event",
    title: "Active Snapshot Authority",
    status: "confirmed",
    startsAt: "2026-08-12T02:00:00.000Z",
    endsAt: "2026-08-12T04:00:00.000Z",
    ordinal: 0,
    updatedAt: 100,
    eventNumber: "9001",
  });
  await insertSnapshot(database, {
    id: "snapshot_active_cancelled",
    generationId: "generation_active",
    externalId: "synthetic-cancelled-uid",
    eventId: "event_meetup_cancelled",
    eventSlug: "meetup-cancelled-event",
    title: "Previously Published Source Event",
    status: "cancelled",
    startsAt: "2026-08-13T02:00:00.000Z",
    endsAt: "2026-08-13T04:00:00.000Z",
    ordinal: 1,
    updatedAt: 100,
    eventNumber: "9002",
  });
  await insertSnapshot(database, {
    id: "snapshot_pending_changed",
    generationId: "generation_pending",
    externalId: "synthetic-active-uid",
    eventId: "event_meetup_active",
    eventSlug: "meetup-active-event",
    title: "PENDING_TITLE_SENTINEL",
    status: "cancelled",
    startsAt: "2026-12-01T02:00:00.000Z",
    endsAt: "2026-12-01T04:00:00.000Z",
    ordinal: 0,
    updatedAt: 900,
    eventNumber: "9001",
  });
  await insertSnapshot(database, {
    id: "snapshot_pending_cancelled",
    generationId: "generation_pending",
    externalId: "synthetic-cancelled-uid",
    eventId: "event_meetup_cancelled",
    eventSlug: "meetup-cancelled-event",
    title: "PENDING CANCEL CHANGE SENTINEL",
    status: "confirmed",
    startsAt: "2026-12-02T02:00:00.000Z",
    endsAt: "2026-12-02T04:00:00.000Z",
    ordinal: 1,
    updatedAt: 900,
    eventNumber: "9002",
  });
  await insertSnapshot(database, {
    id: "snapshot_pending_addition",
    generationId: "generation_pending",
    externalId: "synthetic-pending-uid",
    eventId: "event_pending_addition",
    eventSlug: "pending-addition-sentinel",
    title: "PENDING_ADDITION_SENTINEL",
    status: "confirmed",
    startsAt: "2026-08-14T02:00:00.000Z",
    endsAt: "2026-08-14T04:00:00.000Z",
    ordinal: 2,
    updatedAt: 900,
    eventNumber: "9003",
  });
  return database;
}

test("returns only explicit allowlisted public DTOs from migrated schema", async (t) => {
  const database = await createFixture(t);
  const page = await queryPublicEvents(database, upcomingInput());
  const manual = page.events.find(
    (event) => event.slug === "manual-ideas-gathering",
  );
  assert.ok(manual);
  assert.deepEqual(Object.keys(manual).sort(), [
    "attendanceMode",
    "category",
    "club",
    "isCancelled",
    "lane",
    "rsvpUrl",
    "schedule",
    "slug",
    "status",
    "summary",
    "title",
    "venue",
  ]);
  assert.deepEqual(Object.keys(manual.club).sort(), ["name", "slug"]);
  assert.deepEqual(Object.keys(manual.venue).sort(), ["address", "name"]);
  assert.equal(manual.attendanceMode, "in-person");
  assert.deepEqual(manual.club, {
    name: "Vancouver Curiosity Club",
    slug: "vancouver-curiosity-club",
  });
  assert.deepEqual(manual.lane, { name: "Think", slug: "think" });
  assert.deepEqual(manual.category, {
    colorToken: "cobalt",
    name: "Ideas",
    slug: "ideas",
  });
  assert.deepEqual(manual.venue, {
    address: "100 Public Test Street",
    name: "Public Reading Room",
  });
  const withheldLocation = page.events.find(
    (event) => event.slug === "published-event-with-withheld-location",
  );
  assert.ok(withheldLocation);
  assert.equal(withheldLocation.attendanceMode, "in-person");
  assert.equal(withheldLocation.venue, null);

  const detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: manual.slug,
  });
  assert.ok(detail);
  assert.deepEqual(Object.keys(detail).sort(), [
    "attendanceMode",
    "category",
    "club",
    "description",
    "isCancelled",
    "lane",
    "organizers",
    "rsvpUrl",
    "schedule",
    "slug",
    "status",
    "summary",
    "title",
    "venue",
  ]);
  assert.deepEqual(detail.organizers, [{ displayName: "Public Host" }]);

  const serialized = JSON.stringify({ page, detail });
  for (const sentinel of PRIVATE_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
  for (const forbiddenKey of [
    "id",
    "organizationId",
    "eventId",
    "sourceUrl",
    "generationId",
    "normalizedEmail",
    "privateNotes",
    "privateMeetingDetails",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(detail, forbiddenKey),
      false,
      forbiddenKey,
    );
  }
});

test("hides restricted records and enforces upcoming, past, and cancelled detail rules", async (t) => {
  const database = await createFixture(t);
  const upcoming = await queryPublicEvents(database, upcomingInput());
  const upcomingSlugs = new Set(upcoming.events.map((event) => event.slug));
  for (const hiddenSlug of [
    "cancelled-manual-event",
    "draft-event-sentinel",
    "hold-event-sentinel",
    "private-event-sentinel",
    "unpublished-event-sentinel",
    "deleted-event-sentinel",
    "draft-club-event-sentinel",
    "pending-addition-sentinel",
    "meetup-cancelled-event",
    "early-past-event",
    "late-past-event",
  ]) {
    assert.equal(upcomingSlugs.has(hiddenSlug), false, hiddenSlug);
  }
  assert.equal(upcomingSlugs.has("tentative-online-reading"), true);
  assert.equal(upcomingSlugs.has("meetup-active-event"), true);

  const past = await queryPublicEvents(database, {
    ...upcomingInput(),
    view: "past",
  });
  assert.deepEqual(
    past.events.map((event) => event.slug),
    ["late-past-event", "early-past-event"],
  );

  const manualCancelled = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "cancelled-manual-event",
  });
  assert.equal(manualCancelled?.status, "cancelled");
  assert.equal(manualCancelled?.isCancelled, true);
  const meetupCancelled = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "meetup-cancelled-event",
  });
  assert.equal(meetupCancelled?.status, "cancelled");
  assert.equal(meetupCancelled?.title, "Previously Published Source Event");

  for (const hiddenSlug of [
    "draft-event-sentinel",
    "hold-event-sentinel",
    "private-event-sentinel",
    "unpublished-event-sentinel",
    "deleted-event-sentinel",
    "draft-club-event-sentinel",
    "pending-addition-sentinel",
    "guessed-event-slug",
  ]) {
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: ORGANIZATION_ID,
        slug: hiddenSlug,
      }),
      null,
      hiddenSlug,
    );
  }
});

test("pending failed Meetup generation cannot leak through any unified read path", async (t) => {
  const database = await createFixture(t);
  const failedContinuationState = await database
    .prepare(
      `SELECT source.active_generation_id, source.pending_generation_id,
              source.last_error_code, generation.state,
              generation.processed_item_count, generation.expected_item_count
       FROM sync_sources AS source
       JOIN meetup_sync_generations AS generation
         ON generation.id = source.pending_generation_id
       WHERE source.id = 'source_synthetic'`,
    )
    .first();
  assert.deepEqual(
    { ...failedContinuationState },
    {
      active_generation_id: "generation_active",
      pending_generation_id: "generation_pending",
      last_error_code: "synthetic_failed_continuation",
      state: "staging",
      processed_item_count: 3,
      expected_item_count: 4,
    },
    "the fixture represents a failed continuation with an incomplete pending generation",
  );

  const fullPage = await queryPublicEvents(database, upcomingInput());
  const active = fullPage.events.find(
    (event) => event.slug === "meetup-active-event",
  );
  assert.ok(active);
  assert.equal(active.title, "Active Snapshot Authority");
  assert.equal(active.status, "confirmed");
  assert.equal(active.schedule.kind, "timed");
  assert.equal(active.schedule.startsAtUtc, "2026-08-12T02:00:00.000Z");
  assert.equal(
    fullPage.events.filter((event) => event.slug === "meetup-active-event")
      .length,
    1,
    "the source-backed canonical row and active snapshot must not duplicate",
  );
  assert.equal(
    fullPage.events.some(
      (event) => event.slug === "pending-addition-sentinel",
    ),
    false,
  );

  const detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "meetup-active-event",
  });
  assert.equal(detail?.title, "Active Snapshot Authority");
  assert.equal(detail?.status, "confirmed");
  assert.equal(detail?.schedule.kind, "timed");
  assert.equal(detail?.schedule.startsAtUtc, "2026-08-12T02:00:00.000Z");
  assert.equal(
    await getPublicEventBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug: "pending-addition-sentinel",
    }),
    null,
  );

  const clubFacing = await queryPublicEvents(database, {
    ...upcomingInput(),
    clubSlug: "vancouver-curiosity-club",
  });
  assert.equal(
    clubFacing.events.some(
      (event) =>
        event.slug === "meetup-active-event" &&
        event.title === "Active Snapshot Authority",
    ),
    true,
    "the completed source club must win over the pending canonical club",
  );
  assert.equal(
    clubFacing.events.some(
      (event) => event.slug === "pending-addition-sentinel",
    ),
    false,
  );

  const related = await listRelatedPublicEvents(database, {
    organizationId: ORGANIZATION_ID,
    slug: "manual-ideas-gathering",
    nowUtcMs: NOW_UTC_MS,
    todayDate: TODAY_DATE,
    limit: 6,
  });
  assert.equal(
    related.some(
      (event) =>
        event.slug === "meetup-active-event" &&
        event.title === "Active Snapshot Authority",
    ),
    true,
  );
  assert.equal(
    related.some((event) => event.slug === "pending-addition-sentinel"),
    false,
  );

  const serialized = JSON.stringify({
    fullPage,
    detail,
    clubFacing,
    related,
  });
  for (const sentinel of PRIVATE_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
  assert.equal(
    fullPage.events.some(
      (event) => event.slug === "manual-ideas-gathering",
    ),
    true,
    "a failed source generation must not affect manual publication",
  );
});

test("combines validated filters and provides bounded stable pagination", async (t) => {
  const database = await createFixture(t);
  const combined = await queryPublicEvents(database, {
    ...upcomingInput(),
    keyword: "ideas",
    clubSlug: "vancouver-curiosity-club",
    laneSlug: "think",
    categorySlug: "ideas",
    attendanceMode: "in-person",
    fromDate: "2026-08-01",
    toDate: "2026-08-02",
  });
  assert.deepEqual(
    combined.events.map((event) => event.slug),
    ["manual-ideas-gathering"],
  );
  const online = await queryPublicEvents(database, {
    ...upcomingInput(),
    laneSlug: "explore",
    categorySlug: "books",
    attendanceMode: "online",
  });
  assert.deepEqual(
    online.events.map((event) => event.slug),
    ["tentative-online-reading"],
  );

  const all = await queryPublicEvents(database, upcomingInput());
  const firstPage = await queryPublicEvents(database, {
    ...upcomingInput(),
    page: "1",
    pageSize: "1",
  });
  const secondPage = await queryPublicEvents(database, {
    ...upcomingInput(),
    page: "2",
    pageSize: "1",
  });
  assert.equal(firstPage.totalCount, all.totalCount);
  assert.equal(firstPage.events.length, 1);
  assert.equal(firstPage.hasMore, true);
  assert.equal(secondPage.totalCount, all.totalCount);
  assert.equal(secondPage.events.length, 1);
  assert.notEqual(firstPage.events[0].slug, secondPage.events[0].slug);

  for (const invalid of [
    { page: 0 },
    { page: 1_001 },
    { pageSize: 49 },
    { keyword: "x".repeat(101) },
    { view: "everything" },
    { attendanceMode: "teleportation" },
    { fromDate: "2026-02-30" },
    { fromDate: "2026-08-03", toDate: "2026-08-02" },
    { clubSlug: "not a slug" },
  ]) {
    await assert.rejects(
      queryPublicEvents(database, {
        ...upcomingInput(),
        ...invalid,
      }),
      InputValidationError,
      JSON.stringify(invalid),
    );
  }
});

test("sitemap slugs include only accessible stable public detail routes", async (t) => {
  const database = await createFixture(t);
  const slugs = await listPublicEventSitemapSlugs(database, {
    organizationId: ORGANIZATION_ID,
  });
  assert.equal(slugs.includes("manual-ideas-gathering"), true);
  assert.equal(slugs.includes("meetup-active-event"), true);
  assert.equal(slugs.includes("meetup-cancelled-event"), true);
  assert.equal(slugs.includes("cancelled-manual-event"), true);
  for (const hiddenSlug of [
    "draft-event-sentinel",
    "hold-event-sentinel",
    "private-event-sentinel",
    "unpublished-event-sentinel",
    "deleted-event-sentinel",
    "draft-club-event-sentinel",
    "pending-addition-sentinel",
  ]) {
    assert.equal(slugs.includes(hiddenSlug), false, hiddenSlug);
  }
  assert.deepEqual([...slugs].sort(), [...slugs]);
  assert.equal(JSON.stringify(slugs).includes("PRIVATE_FEED"), false);
});

test("public event branches use their bounded projection indexes", async (t) => {
  const database = await createFixture(t);
  const { results: manualPlanRows } = await database
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT event.id
       FROM events AS event
       WHERE event.organization_id = ?
         AND event.visibility = 'public'
         AND event.status IN ('confirmed', 'tentative')
         AND event.published_at IS NOT NULL
         AND event.deleted_at IS NULL`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  const manualPlan = manualPlanRows.map((row) => row.detail).join("\n");
  assert.match(manualPlan, /events_public_projection_idx/u);

  const { results: snapshotPlanRows } = await database
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT snapshot.id
       FROM meetup_event_snapshots AS snapshot
       WHERE snapshot.organization_id = ?
         AND snapshot.sync_source_id = ?
         AND snapshot.generation_id = ?
         AND snapshot.status IN ('confirmed', 'tentative')
         AND snapshot.ends_at_utc > ?`,
    )
    .bind(
      ORGANIZATION_ID,
      "source_synthetic",
      "generation_active",
      NOW_UTC_MS,
    )
    .all();
  const snapshotPlan = snapshotPlanRows
    .map((row) => row.detail)
    .join("\n");
  assert.match(snapshotPlan, /meetup_event_snapshots_public_timed_idx/u);
});

function upcomingInput() {
  return {
    organizationId: ORGANIZATION_ID,
    nowUtcMs: NOW_UTC_MS,
    todayDate: TODAY_DATE,
    view: "upcoming",
    page: 1,
    pageSize: 48,
  };
}

function timedEvent({
  categoryId = null,
  clubId = "club_vcc",
  deletedAt = null,
  description = null,
  endsAt,
  eventLaneId = null,
  holdExpiresAt = null,
  id,
  publishedAt = 1,
  slug,
  startsAt,
  status = "confirmed",
  summary = null,
  title,
  updatedAt = 1,
  venueId = null,
  visibility = "public",
}) {
  return {
    categoryId,
    clubId,
    deletedAt,
    description,
    endsAtUtcMs: Date.parse(endsAt),
    eventLaneId,
    holdExpiresAt,
    id,
    publishedAt,
    slug,
    startsAtUtcMs: Date.parse(startsAt),
    status,
    summary,
    title,
    updatedAt,
    venueId,
    visibility,
  };
}

async function insertTimedEvent(database, event) {
  await database
    .prepare(
      `INSERT INTO events (
         id, organization_id, club_id, event_lane_id, category_id, venue_id,
         primary_organizer_profile_id, title, slug, summary, description,
         status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
         all_day_start_date, all_day_end_date_exclusive,
         buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
         schedule_version, schedule_review_state, hold_expires_at,
         private_notes, private_meeting_details, published_at,
         created_by_profile_id, updated_by_profile_id, created_at, updated_at,
         deleted_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'timed', ?, ?,
         'America/Vancouver', NULL, NULL, 0, 0, '[]', 1, 'unreviewed', ?,
         'PRIVATE_EVENT_NOTE_SENTINEL', 'PRIVATE_MEETING_SENTINEL', ?,
         'profile_owner', 'profile_owner', 1, ?, ?
       )`,
    )
    .bind(
      event.id,
      ORGANIZATION_ID,
      event.clubId,
      event.eventLaneId,
      event.categoryId,
      event.venueId,
      event.title,
      event.slug,
      event.summary,
      event.description,
      event.status,
      event.visibility,
      event.startsAtUtcMs,
      event.endsAtUtcMs,
      event.holdExpiresAt,
      event.publishedAt,
      event.updatedAt,
      event.deletedAt,
    )
    .run();
}

async function insertSnapshot(
  database,
  {
    endsAt,
    eventId,
    eventNumber,
    eventSlug,
    externalId,
    generationId,
    id,
    ordinal,
    startsAt,
    status,
    title,
    updatedAt,
  },
) {
  await database
    .prepare(
      `INSERT INTO meetup_event_snapshots (
         id, organization_id, sync_source_id, generation_id, external_id,
         event_id, ordinal, event_slug, title, event_url, status, time_kind,
         starts_at_utc, ends_at_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, source_fingerprint, source_sequence,
         source_last_modified_at, created_at, updated_at
       ) VALUES (
         ?, ?, 'source_synthetic', ?, ?, ?, ?, ?, ?,
         ?, ?, 'timed', ?, ?, 'America/Vancouver', NULL, NULL,
         ?, 1, ?, ?, ?
       )`,
    )
    .bind(
      id,
      ORGANIZATION_ID,
      generationId,
      externalId,
      eventId,
      ordinal,
      eventSlug,
      title,
      `https://www.meetup.com/synthetic-public-group/events/${eventNumber}/`,
      status,
      Date.parse(startsAt),
      Date.parse(endsAt),
      `fingerprint-${id}`,
      updatedAt,
      updatedAt,
      updatedAt,
    )
    .run();
}
