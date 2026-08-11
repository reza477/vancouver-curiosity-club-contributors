import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  getEditorialPublicEvents,
  getAuthorizedOrganizerEventPublicPreview,
  getPublicEventBySlug,
  getPublicEventExportRecordBySlug,
  listUpcomingPublicEvents,
  listUpcomingPublicMeetupEvents,
  listPublishedEventSelections,
  listPublicEventCategoryOptions,
  listPublicEventSitemapSlugs,
  listRelatedPublicEvents,
  queryPublicCalendarMonth,
  queryPublicEvents,
  queryPublicCalendarLandingBundle,
  queryPublicEventsForExport,
  resolveEditorialPublishedEventSelectionProofs,
  resolvePublishedEventSelections,
} from "../../lib/server/public/events.ts";
import {
  buildPublicEventJsonLd,
} from "../../lib/server/public/event-structured-data.ts";
import {
  createFilteredPublicCsvDownload,
  createFilteredPublicIcsDownload,
  createOneEventIcsDownload,
} from "../../lib/server/phase7/public-exports.ts";
import { InputValidationError } from "../../lib/validation/index.ts";
import { MEETUP_EVENT_ALIAS_URLS } from "../../lib/server/meetup/event-aliases.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { countD1Statements } from "../auth/intercept-d1.mjs";

const ORGANIZATION_ID = "org_phase_2_public";
const NOW_UTC_MS = Date.parse("2026-07-25T12:00:00.000Z");
const TODAY_DATE = "2026-07-25";
const ACTIVE_MEETUP_POSTER_SOURCE =
  "https://secure.meetupstatic.com/photos/event/a/b/c/highres_535545462.jpeg";
const PENDING_MEETUP_POSTER_SOURCE =
  "https://secure.meetupstatic.com/photos/event/d/e/f/highres_999999999.jpeg";
const PRIVATE_SENTINELS = Object.freeze([
  "PRIVATE_EVENT_NOTE_SENTINEL",
  "PRIVATE_MEETING_SENTINEL",
  "PRIVATE_VENUE_ADDRESS_SENTINEL",
  "PRIVATE_VENUE_DIRECTIONS_SENTINEL",
  "PRIVATE_WITHHELD_LOCATION_SENTINEL",
  "PRIVATE_FEED_TOKEN_SENTINEL",
  "PRIVATE-R2-OBJECT-KEY-SENTINEL",
  "PRIVATE-ORIGINAL-NAME.png",
  "PRIVATE-R2-ORIGINAL-SENTINEL",
  "PRIVATE-R2-480-SENTINEL",
  "PRIVATE-R2-960-SENTINEL",
  "PRIVATE-R2-1600-SENTINEL",
  "PRIVATE-RIGHTS-NOTE-SENTINEL",
  "PRIVATE-CONSENT-NOTE-SENTINEL",
  "private-organizer@synthetic.invalid",
  "PENDING_TITLE_SENTINEL",
  "PENDING_ADDITION_SENTINEL",
  ACTIVE_MEETUP_POSTER_SOURCE,
  PENDING_MEETUP_POSTER_SOURCE,
]);
const PUBLIC_HOST = Object.freeze({
  biography: "A confirmed public biography for event attribution.",
  displayName: "Public Host",
  photo: Object.freeze({
    altText: "Abstract cobalt and forest profile artwork.",
    credit: "Vancouver Curiosity Club",
    height: 320,
    url: "/media/asset_public_host/webp_480",
    width: 480,
  }),
});

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
    /CREATE TABLE IF NOT EXISTS `club_public_profiles`/u,
    "the generated Phase 2 catalog migration must be present",
  );
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS `event_public_details`/u,
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

    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'membership_owner', '${ORGANIZATION_ID}', 'profile_owner',
        'owner@synthetic.invalid', 'owner', 'active', 'profile_owner', 1, 1
      ),
      (
        'membership_public_host', '${ORGANIZATION_ID}',
        'profile_public_host', 'private-organizer@synthetic.invalid',
        'organizer', 'active', 'profile_owner', 1, 1
      ),
      (
        'membership_no_consent', '${ORGANIZATION_ID}',
        'profile_no_consent', 'hidden@synthetic.invalid', 'organizer',
        'active', 'profile_owner', 1, 1
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
  await seedConfirmedPublicAttribution(database, {
    displayName: "Public Host",
    profileId: "profile_public_host",
  });
  seedCurrentPublishedClubProjection(database, {
    clubId: "club_vcc",
    description: "Synthetic public club.",
    featured: true,
    laneId: "lane_think",
    meetupGroupUrl: "https://www.meetup.com/synthetic-public-group/",
    name: "Vancouver Curiosity Club",
    slug: "vancouver-curiosity-club",
  });
  seedCurrentPublishedClubProjection(database, {
    clubId: "club_literature",
    description: "Synthetic public club.",
    featured: true,
    laneId: "lane_think",
    meetupGroupUrl:
      "https://www.meetup.com/synthetic-literature-group/",
    name: "Vancouver Literature and Film",
    slug: "vancouver-literature-and-film",
  });

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
      ),
      (
        'organizer_public_meetup', '${ORGANIZATION_ID}',
        'event_meetup_active', 'profile_public_host', 'primary', 1,
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
    posterAltText: "Active snapshot event poster.",
    posterCredit: "Vancouver Curiosity Club via Meetup",
    posterSourceUrl: ACTIVE_MEETUP_POSTER_SOURCE,
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
    posterAltText: "PENDING POSTER ALT SENTINEL",
    posterCredit: "PENDING POSTER CREDIT SENTINEL",
    posterSourceUrl: PENDING_MEETUP_POSTER_SOURCE,
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
    "artwork",
    "attendanceMode",
    "category",
    "club",
    "isCancelled",
    "lane",
    "program",
    "rsvpMode",
    "rsvpUrl",
    "schedule",
    "slug",
    "status",
    "summary",
    "title",
    "venue",
  ]);
  assert.equal(manual.artwork, null);
  assert.equal(manual.rsvpMode, null);
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
    "arrivalInstructions",
    "artwork",
    "attendanceMode",
    "availabilityState",
    "capacity",
    "category",
    "club",
    "costText",
    "description",
    "descriptionBlocks",
    "externalMapUrl",
    "isCancelled",
    "lane",
    "metaDescription",
    "organizers",
    "preparationInformation",
    "program",
    "publicAccessNote",
    "publicOnlineUrl",
    "rsvpMode",
    "rsvpUrl",
    "schedule",
    "seoTitle",
    "slug",
    "status",
    "summary",
    "title",
    "venue",
    "verifiedAccessibilityNotes",
    "weatherNote",
    "whatToBring",
  ]);
  assert.equal(detail.artwork, null);
  assert.deepEqual(detail.organizers, [PUBLIC_HOST]);

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

test("active Meetup snapshots project only first-party synchronized poster URLs", async (t) => {
  const database = await createFixture(t);
  const page = await queryPublicEvents(database, upcomingInput());
  const active = page.events.find(
    (event) => event.slug === "meetup-active-event",
  );
  assert.ok(active);
  const expectedArtwork = {
    altText: "Active snapshot event poster.",
    credit: "Vancouver Curiosity Club via Meetup",
    dimensions: {
      large: { height: 900, width: 1_600 },
      medium: { height: 540, width: 960 },
      small: { height: 270, width: 480 },
    },
    focalPoint: { x: 5_000, y: 5_000 },
    srcSet: {
      large: "/meetup-posters/synthetic-public-group/9001/large",
      medium: "/meetup-posters/synthetic-public-group/9001/medium",
      small: "/meetup-posters/synthetic-public-group/9001/small",
    },
    url: "/meetup-posters/synthetic-public-group/9001/large",
  };
  assert.deepEqual(active.artwork, expectedArtwork);

  const detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "meetup-active-event",
  });
  assert.ok(detail);
  assert.deepEqual(detail.artwork, expectedArtwork);
  const serialized = JSON.stringify({ active, detail });
  assert.equal(serialized.includes("secure.meetupstatic.com"), false);
  assert.equal(serialized.includes("PENDING POSTER"), false);
});

test("owner venue selection atomically overrides or suppresses synchronized Meetup venue data", async (t) => {
  const database = await createFixture(t);
  database.exec(`
    UPDATE meetup_event_snapshot_public_contents
    SET public_venue_name = 'Meetup Source Venue',
        public_venue_address = '900 Source Address'
    WHERE snapshot_id = 'snapshot_active';
    UPDATE venues
    SET public_location_name = 'Owner Public Venue',
        public_address = NULL
    WHERE id = 'venue_public';
    UPDATE events
    SET venue_id = 'venue_public'
    WHERE id = 'event_meetup_active';
  `);

  let event = (await queryPublicEvents(database, upcomingInput())).events.find(
    ({ slug }) => slug === "meetup-active-event",
  );
  assert.deepEqual(event?.venue, {
    address: null,
    name: "Owner Public Venue",
  });
  assert.equal(JSON.stringify(event).includes("900 Source Address"), false);

  database.exec(`
    UPDATE events
    SET venue_id = 'venue_private'
    WHERE id = 'event_meetup_active'
  `);
  event = (await queryPublicEvents(database, upcomingInput())).events.find(
    ({ slug }) => slug === "meetup-active-event",
  );
  assert.equal(event?.venue, null);
  assert.equal(JSON.stringify(event).includes("Meetup Source Venue"), false);

  database.exec(`
    UPDATE events
    SET venue_id = NULL
    WHERE id = 'event_meetup_active'
  `);
  event = (await queryPublicEvents(database, upcomingInput())).events.find(
    ({ slug }) => slug === "meetup-active-event",
  );
  assert.deepEqual(event?.venue, {
    address: "900 Source Address",
    name: "Meetup Source Venue",
  });
  assert.equal(event?.attendanceMode, "in-person");

  const inPerson = await queryPublicEvents(database, {
    ...upcomingInput(),
    attendanceMode: "in-person",
  });
  assert.equal(
    inPerson.events.some(({ slug }) => slug === "meetup-active-event"),
    true,
  );
  const undecided = await queryPublicEvents(database, {
    ...upcomingInput(),
    attendanceMode: "location-undecided",
  });
  assert.equal(
    undecided.events.some(({ slug }) => slug === "meetup-active-event"),
    false,
  );

  const detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "meetup-active-event",
  });
  assert.ok(detail);
  const jsonLd = buildPublicEventJsonLd(
    detail,
    "https://site.synthetic.invalid/events/meetup-active-event",
    "Synthetic Site",
  );
  assert.equal(
    jsonLd.eventAttendanceMode,
    "https://schema.org/OfflineEventAttendanceMode",
  );
  assert.deepEqual(jsonLd.location, {
    "@type": "Place",
    address: "900 Source Address",
    name: "Meetup Source Venue",
  });
});

test("all exact cross-post aliases stay out of public projections while the canonical event and Reset remain visible", async (t) => {
  const database = await createFixture(t);
  const aliasUrls = [
    "https://www.meetup.com/vancouver-meetup-group/events/315511475/",
    "https://www.meetup.com/vancouver-meetup-group/events/315511480/",
    "https://www.meetup.com/vancouver-meetup-group/events/315675704/",
    "https://www.meetup.com/vancouver-meetup-group/events/315772829/",
    "https://www.meetup.com/vancouver-meetup-group/events/315823081/",
    "https://www.meetup.com/vancouver-meetup-group/events/315976207/",
    "https://www.meetup.com/vancouver-meetup-group/events/315511485/",
    "https://www.meetup.com/vancouver-meetup-group/events/315851495/",
    "https://www.meetup.com/vancouver-meetup-group/events/315776403/",
    "https://www.meetup.com/vancouver-meetup-group/events/315511487/",
    "https://www.meetup.com/vancouver-meetup-group/events/315777485/",
  ];
  assert.deepEqual(MEETUP_EVENT_ALIAS_URLS, aliasUrls);
  const canonicalUrl =
    "https://www.meetup.com/vancouver-literature-and-film/events/315508432/";
  const resetUrl =
    "https://www.meetup.com/vancouver-meetup-group/events/316010049/";

  await insertTimedEvent(
    database,
    timedEvent({
      clubId: "club_literature",
      endsAt: "2026-08-11T03:30:00.000Z",
      id: "event_exact_alias_canonical",
      slug: "exact-alias-canonical",
      startsAt: "2026-08-11T01:00:00.000Z",
      title: "Canonical specialized gathering",
    }),
  );
  await insertTimedEvent(
    database,
    timedEvent({
      endsAt: "2026-08-13T03:00:00.000Z",
      id: "event_wednesday_reset",
      slug: "wednesday-night-reset",
      startsAt: "2026-08-13T01:00:00.000Z",
      title: "Wednesday Night Reset",
    }),
  );
  database.exec(`
    INSERT INTO sync_sources (
      id, organization_id, club_id, source_type, source_url, enabled,
      refresh_interval_minutes, last_attempt_at, last_success_at,
      last_error_at, last_error_code, active_generation_id,
      pending_generation_id, pending_snapshot_hash, pending_cursor,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'source_exact_alias_canonical', '${ORGANIZATION_ID}',
      'club_literature', 'meetup_ics',
      'https://www.meetup.com/vancouver-literature-and-film/events/ical/',
      1, 15, 200, 200, NULL, NULL, 'generation_exact_alias_canonical',
      NULL, NULL, NULL, 'profile_owner', 'profile_owner', 2, 200
    );
    INSERT INTO meetup_sync_generations (
      id, organization_id, sync_source_id, previous_generation_id,
      snapshot_hash, expected_item_count, processed_item_count,
      rejected_item_count, state, removed_count, created_at, updated_at,
      published_at, failed_at
    ) VALUES (
      'generation_exact_alias_canonical', '${ORGANIZATION_ID}',
      'source_exact_alias_canonical', NULL,
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      1, 1, 0, 'published', 0, 200, 200, 200, NULL
    );
    UPDATE meetup_sync_generations
    SET expected_item_count = 14,
        processed_item_count = 14
    WHERE id = 'generation_active';
  `);

  await insertSnapshot(database, {
    endsAt: "2026-08-11T03:30:00.000Z",
    eventId: "event_exact_alias_canonical",
    eventNumber: "315508432",
    eventUrl: canonicalUrl,
    eventSlug: "exact-alias-canonical",
    externalId: "canonical-specialized-315508432",
    generationId: "generation_exact_alias_canonical",
    id: "snapshot_exact_alias_canonical",
    ordinal: 0,
    sourceId: "source_exact_alias_canonical",
    startsAt: "2026-08-11T01:00:00.000Z",
    status: "confirmed",
    title: "Canonical specialized gathering",
    updatedAt: 200,
  });
  await database
    .prepare(
      `INSERT INTO external_source_links (
         id, organization_id, entity_type, entity_id, source_type,
         sync_source_id, external_id, external_url, source_fingerprint,
         last_imported_at, created_at, updated_at
       ) VALUES (?, ?, 'event', ?, 'meetup_ics', ?, ?, ?, ?, 200, 200, 200)`,
    )
    .bind(
      "link_exact_alias_canonical",
      ORGANIZATION_ID,
      "event_exact_alias_canonical",
      "source_exact_alias_canonical",
      "canonical-specialized-315508432",
      canonicalUrl,
      "fingerprint-exact-alias-canonical",
    )
    .run();

  for (const [index, aliasUrl] of aliasUrls.entries()) {
    const externalId = `exact-alias-${index + 1}`;
    await insertSnapshot(database, {
      endsAt: "2026-08-11T03:30:00.000Z",
      eventId: "event_exact_alias_canonical",
      eventNumber: `alias-${index + 1}`,
      eventUrl: aliasUrl,
      eventSlug: "exact-alias-canonical",
      externalId,
      generationId: "generation_active",
      id: `snapshot_exact_alias_${index + 1}`,
      ordinal: index + 2,
      startsAt: "2026-08-11T01:00:00.000Z",
      status: "confirmed",
      title: `Hidden exact alias ${index + 1}`,
      updatedAt: 200,
    });
    await database
      .prepare(
        `INSERT INTO external_source_links (
           id, organization_id, entity_type, entity_id, source_type,
           sync_source_id, external_id, external_url, source_fingerprint,
           last_imported_at, created_at, updated_at
         ) VALUES (?, ?, 'event', ?, 'meetup_ics', ?, ?, ?, ?, 200, 200, 200)`,
      )
      .bind(
        `link_exact_alias_${index + 1}`,
        ORGANIZATION_ID,
        "event_exact_alias_canonical",
        "source_synthetic",
        externalId,
        aliasUrl,
        `fingerprint-exact-alias-${index + 1}`,
      )
      .run();
  }
  await insertSnapshot(database, {
    endsAt: "2026-08-13T03:00:00.000Z",
    eventId: "event_wednesday_reset",
    eventNumber: "316010049",
    eventUrl: resetUrl,
    eventSlug: "wednesday-night-reset",
    externalId: "wednesday-reset-316010049",
    generationId: "generation_active",
    id: "snapshot_wednesday_reset",
    ordinal: 13,
    startsAt: "2026-08-13T01:00:00.000Z",
    status: "confirmed",
    title: "Wednesday Night Reset",
    updatedAt: 200,
  });
  await database
    .prepare(
      `INSERT INTO external_source_links (
         id, organization_id, entity_type, entity_id, source_type,
         sync_source_id, external_id, external_url, source_fingerprint,
         last_imported_at, created_at, updated_at
       ) VALUES (?, ?, 'event', ?, 'meetup_ics', ?, ?, ?, ?, 200, 200, 200)`,
    )
    .bind(
      "link_wednesday_reset",
      ORGANIZATION_ID,
      "event_wednesday_reset",
      "source_synthetic",
      "wednesday-reset-316010049",
      resetUrl,
      "fingerprint-wednesday-reset",
    )
    .run();

  const page = await queryPublicEvents(database, upcomingInput());
  const compatibility = await listUpcomingPublicEvents(database, {
    fromUtcMs: NOW_UTC_MS,
    limit: 100,
    organizationId: ORGANIZATION_ID,
    todayDate: TODAY_DATE,
  });
  const meetupCompatibility = await listUpcomingPublicMeetupEvents(database, {
    fromUtcMs: NOW_UTC_MS,
    limit: 100,
    organizationId: ORGANIZATION_ID,
    todayDate: TODAY_DATE,
  });
  const exports = await queryPublicEventsForExport(database, {
    ...upcomingInput(),
    maxEvents: 500,
  });
  const sitemap = await listPublicEventSitemapSlugs(database, {
    organizationId: ORGANIZATION_ID,
  });
  const publicUrls = [
    ...page.events.map((event) => event.rsvpUrl),
    ...compatibility.map((event) => event.rsvpUrl),
    ...meetupCompatibility.map((event) => event.rsvpUrl),
    ...exports.map((record) => record.event.rsvpUrl),
  ];
  for (const aliasUrl of aliasUrls) {
    assert.equal(publicUrls.includes(aliasUrl), false, aliasUrl);
  }
  for (const visibleUrl of [canonicalUrl, resetUrl]) {
    assert.equal(publicUrls.includes(visibleUrl), true, visibleUrl);
  }
  assert.ok(sitemap.includes("exact-alias-canonical"));
  assert.ok(sitemap.includes("wednesday-night-reset"));
});

test("public export projection is bounded, exact-materialization verified, and allowlisted", async (t) => {
  const database = await createFixture(t);
  const events = await queryPublicEventsForExport(database, {
    ...upcomingInput(),
    maxEvents: 500,
  });
  const manual = events.find(
    (record) => record.event.slug === "manual-ideas-gathering",
  );
  assert.ok(manual);
  assert.deepEqual(Object.keys(manual.event).sort(), [
    "attendanceMode",
    "availabilityState",
    "category",
    "club",
    "costText",
    "description",
    "isCancelled",
    "lane",
    "program",
    "rsvpUrl",
    "schedule",
    "slug",
    "status",
    "summary",
    "title",
    "venue",
  ]);
  const record = await getPublicEventExportRecordBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: manual.event.slug,
  });
  assert.ok(record);
  assert.equal(record.event.slug, manual.event.slug);
  assert.equal(Number.isSafeInteger(record.sourceVersion), true);
  const serialized = JSON.stringify({ events, record });
  for (const sentinel of PRIVATE_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
});

test("public ICS and CSV downloads execute against the exact public projection and exclude private sentinels", async (t) => {
  const database = await createFixture(t);
  database.exec(
    `UPDATE organizations
     SET slug = 'vancouver-curiosity-and-education-society'
     WHERE id = '${ORGANIZATION_ID}'`,
  );
  const origin = "https://vcc.example.test";
  const published = await createOneEventIcsDownload(database, {
    generatedAt: NOW_UTC_MS,
    origin,
    slug: "manual-ideas-gathering",
  });
  assert.ok(published);
  assert.equal(published.contentType, "text/calendar; charset=utf-8");
  assert.equal(published.fileName, "manual-ideas-gathering.ics");
  assert.equal(occurrences(published.body, "BEGIN:VEVENT"), 1);
  assert.match(published.body, /SUMMARY:Manual Ideas Gathering\r\n/u);
  assert.match(
    published.body,
    /URL:https:\/\/vcc\.example\.test\/events\/manual-ideas-gathering\r\n/u,
  );
  assert.match(
    published.body.replaceAll("\r\n ", ""),
    /UID:[0-9a-f]{40}@calendar\.vancouver-curiosity-club\r\n/u,
  );
  assert.match(published.body, /STATUS:CONFIRMED\r\n/u);
  assert.doesNotMatch(published.body, /event_manual_upcoming/iu);
  database.exec(
    `UPDATE events
     SET private_notes = 'PRIVATE-ONLY-ICS-REVISION-SENTINEL'
     WHERE id = 'event_manual_upcoming'`,
  );
  const privateOnlyEdit = await createOneEventIcsDownload(database, {
    generatedAt: NOW_UTC_MS,
    origin,
    slug: "manual-ideas-gathering",
  });
  assert.ok(privateOnlyEdit);
  assert.equal(
    privateOnlyEdit.body,
    published.body,
    "private-only facts must not advance or alter the public component",
  );
  assert.doesNotMatch(
    privateOnlyEdit.body,
    /PRIVATE-ONLY-ICS-REVISION-SENTINEL/u,
  );

  assert.equal(
    await createOneEventIcsDownload(database, {
      generatedAt: NOW_UTC_MS,
      origin,
      slug: "private-event-sentinel",
    }),
    null,
  );
  assert.equal(
    await createOneEventIcsDownload(database, {
      generatedAt: NOW_UTC_MS,
      origin,
      slug: "guessed-private-event",
    }),
    null,
  );
  const cancelled = await createOneEventIcsDownload(database, {
    generatedAt: NOW_UTC_MS,
    origin,
    slug: "cancelled-manual-event",
  });
  assert.ok(cancelled);
  assert.match(cancelled.body, /STATUS:CANCELLED\r\n/u);

  const searchParams = new URLSearchParams(
    "state=upcoming&from=2026-08-02&to=2026-08-05&club=vancouver-curiosity-club",
  );
  const expected = await queryPublicEventsForExport(database, {
    clubSlug: "vancouver-curiosity-club",
    fromDate: "2026-08-02",
    maxEvents: 500,
    nowUtcMs: NOW_UTC_MS,
    organizationId: ORGANIZATION_ID,
    todayDate: TODAY_DATE,
    toDate: "2026-08-05",
    view: "upcoming",
  });
  const [calendar, csv] = await Promise.all([
    createFilteredPublicIcsDownload(database, {
      generatedAt: NOW_UTC_MS,
      origin,
      searchParams,
    }),
    createFilteredPublicCsvDownload(database, {
      generatedAt: NOW_UTC_MS,
      origin,
      searchParams,
    }),
  ]);
  assert.equal(occurrences(calendar.body, "BEGIN:VEVENT"), expected.length);
  assert.equal(nonblankLines(csv.body).length, expected.length + 1);
  for (const { event } of expected) {
    assert.equal(calendar.body.includes(event.title), true, event.title);
    assert.equal(csv.body.includes(event.title), true, event.title);
  }
  const serialized = `${published.body}\n${cancelled.body}\n${calendar.body}\n${csv.body}`;
  for (const sentinel of PRIVATE_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
  assert.doesNotMatch(serialized, /private-organizer@synthetic\.invalid/iu);
  assert.doesNotMatch(serialized, /source_synthetic|generation_active/iu);
});

test("public ICS revalidates exact event and materialization proofs after revision reconciliation", async (t) => {
  const slug = "manual-ideas-gathering";
  const mutations = [
    {
      label: "unpublish",
      mutate(database) {
        database.exec(`
          UPDATE events
          SET visibility = 'private', updated_at = 2
          WHERE id = 'event_manual_upcoming'
        `);
      },
    },
    {
      label: "club materialization tamper",
      mutate(database) {
        database.exec(`
          UPDATE clubs
          SET name = 'Raced public ICS club identity'
          WHERE id = 'club_vcc'
        `);
      },
    },
    {
      label: "event edit",
      mutate(database) {
        database.exec(`
          UPDATE events
          SET title = 'Raced public ICS title', updated_at = 2
          WHERE id = 'event_manual_upcoming'
        `);
      },
    },
    {
      async arrange(database) {
        await insertOrganizerPublicEvent(database, {
          id: "organizer_ics_collision",
          slug: "organizer-ics-collision",
          title: "Organizer ICS collision candidate",
        });
      },
      label: "cross-source slug collision",
      mutate(database) {
        database.exec(`
          UPDATE organizer_events
          SET slug = 'manual-ideas-gathering', updated_at = 11
          WHERE id = 'organizer_ics_collision'
        `);
      },
    },
  ];
  const surfaces = [
    {
      label: "one-event",
      async read(database) {
        return createOneEventIcsDownload(database, {
          generatedAt: NOW_UTC_MS,
          origin: "https://vcc.example.test",
          slug,
        });
      },
      async verify(read) {
        assert.equal(await read(), null);
      },
    },
    {
      label: "filtered",
      async read(database) {
        return createFilteredPublicIcsDownload(database, {
          generatedAt: NOW_UTC_MS,
          origin: "https://vcc.example.test",
          searchParams: new URLSearchParams(
            "state=upcoming&from=2026-08-01&to=2026-08-05",
          ),
        });
      },
      async verify(read) {
        await assert.rejects(
          read,
          (error) =>
            error?.code === "service_unavailable" &&
            error?.status === 503,
        );
      },
    },
  ];

  for (const mutation of mutations) {
    for (const surface of surfaces) {
      await t.test(`${surface.label}: ${mutation.label}`, async (surfaceTest) => {
        const database = await createFixture(surfaceTest);
        database.exec(`
          UPDATE organizations
          SET slug = 'vancouver-curiosity-and-education-society'
          WHERE id = '${ORGANIZATION_ID}'
        `);
        await mutation.arrange?.(database);
        let revalidationReads = 0;
        let mutated = false;
        const racedDatabase = injectBeforeMatchingQuery(
          database,
          "requested_public_event AS",
          2,
          async () => {
            assert.equal(
              database.sqlite
                .prepare(
                  `SELECT count(*) AS revision_count
                   FROM event_calendar_component_revisions
                   WHERE organization_id = ?
                     AND scope = 'public'
                     AND event_key = 'legacy:event_manual_upcoming'`,
                )
                .get(ORGANIZATION_ID).revision_count,
              1,
              "the race must land after component revision reconciliation",
            );
            mutated = true;
            mutation.mutate(database);
          },
          () => {
            revalidationReads += 1;
          },
        );

        await surface.verify(() => surface.read(racedDatabase));
        assert.equal(mutated, true);
        assert.equal(
          revalidationReads,
          2,
          "the initial proof and post-reconciliation proof must both execute",
        );
      });
    }
  }
});

test("public filtered ICS and CSV reject exact max-plus-one result sets instead of truncating", async (t) => {
  const database = await createFixture(t);
  database.exec(
    `UPDATE organizations
     SET slug = 'vancouver-curiosity-and-education-society'
     WHERE id = '${ORGANIZATION_ID}'`,
  );
  insertPublicExportCapacityEvents(database, 2_001);
  const input = {
    generatedAt: NOW_UTC_MS,
    origin: "https://vcc.example.test",
    searchParams: new URLSearchParams(
      "state=upcoming&from=2026-09-01&to=2026-09-02&q=Capacity%20boundary",
    ),
  };
  await assert.rejects(
    createFilteredPublicIcsDownload(database, input),
    (error) =>
      error?.name === "InputValidationError" &&
      error?.issues?.[0]?.code === "result_limit_exceeded",
    "501 rows must reject the 500-event ICS limit",
  );
  await assert.rejects(
    createFilteredPublicCsvDownload(database, input),
    (error) =>
      error?.name === "InputValidationError" &&
      error?.issues?.[0]?.code === "result_limit_exceeded",
    "2,001 rows must reject the 2,000-row CSV limit",
  );
});

test("public ICS persists one revision for each visible title, schedule, status, and venue change", async (t) => {
  const database = await createFixture(t);
  database.exec(
    `UPDATE organizations
     SET slug = 'vancouver-curiosity-and-education-society'
     WHERE id = '${ORGANIZATION_ID}'`,
  );
  const input = {
    generatedAt: NOW_UTC_MS,
    origin: "https://vcc.example.test",
    slug: "manual-ideas-gathering",
  };
  const initial = await createOneEventIcsDownload(database, input);
  assert.ok(initial);
  const initialRevision = publicCalendarRevision(database);
  assert.equal(initialRevision.sequence, 0);

  database.exec(
    `UPDATE events
     SET title = 'Manual Ideas Gathering revised', updated_at = 2
     WHERE id = 'event_manual_upcoming'`,
  );
  const titleChanged = await createOneEventIcsDownload(database, input);
  assert.ok(titleChanged);
  assert.match(
    titleChanged.body,
    /SUMMARY:Manual Ideas Gathering revised\r\n/u,
  );
  const titleRevision = publicCalendarRevision(database);
  assertCalendarRevisionStep(initialRevision, titleRevision);

  database.exec(
    `UPDATE events
     SET starts_at_utc = starts_at_utc + 3600000,
         ends_at_utc = ends_at_utc + 3600000,
         schedule_version = schedule_version + 1,
         updated_at = 3
     WHERE id = 'event_manual_upcoming'`,
  );
  const scheduleChanged = await createOneEventIcsDownload(database, input);
  assert.ok(scheduleChanged);
  assert.match(scheduleChanged.body, /DTSTART:20260802T030000Z\r\n/u);
  const scheduleRevision = publicCalendarRevision(database);
  assertCalendarRevisionStep(titleRevision, scheduleRevision);

  database.exec(
    `UPDATE events
     SET status = 'tentative', updated_at = 4
     WHERE id = 'event_manual_upcoming'`,
  );
  const statusChanged = await createOneEventIcsDownload(database, input);
  assert.ok(statusChanged);
  assert.match(statusChanged.body, /STATUS:TENTATIVE\r\n/u);
  const statusRevision = publicCalendarRevision(database);
  assertCalendarRevisionStep(scheduleRevision, statusRevision);

  database.exec(
    `UPDATE venues
     SET public_location_name = 'Changed public room',
         public_address = '200 Changed Street',
         updated_at = 5
     WHERE id = 'venue_public'`,
  );
  const venueChanged = await createOneEventIcsDownload(database, input);
  assert.ok(venueChanged);
  assert.match(
    venueChanged.body,
    /LOCATION:Changed public room — 200 Changed Street\r\n/u,
  );
  const venueRevision = publicCalendarRevision(database);
  assertCalendarRevisionStep(statusRevision, venueRevision);
});

test("public category options follow taxonomy order and retain archived categories only while public projections use them", async (t) => {
  const database = await createFixture(t);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_category_projection",
    slug: "organizer-category-projection",
    title: "Organizer Category Projection",
  });

  const legacy = await listPublicEventCategoryOptions(
    database,
    ORGANIZATION_ID,
  );
  assert.deepEqual(
    legacy.map((category) => category.slug),
    ["books", "ideas"],
  );

  database.exec(`
    INSERT INTO taxonomy_write_intents (
      id, organization_id, entity_type, entity_id, operation,
      expected_content_version, proposed_content_version,
      proposed_name, proposed_slug, proposed_description,
      proposed_color_token, proposed_sort_order,
      proposed_deleted_at, mutation_group_id, mutation_group_size,
      actor_profile_id, created_at, completed_at
    ) VALUES
      (
        'intent-category-ideas-adopt', '${ORGANIZATION_ID}',
        'category', 'category_ideas', 'adopt', 0, 1,
        'Ideas', 'ideas', 'Synthetic category.', 'cobalt', 10,
        NULL, NULL, NULL, 'profile_owner', 2, 2
      ),
      (
        'intent-category-books-adopt', '${ORGANIZATION_ID}',
        'category', 'category_books', 'adopt', 0, 1,
        'Books', 'books', 'Synthetic category.', 'forest', 20,
        NULL, NULL, NULL, 'profile_owner', 2, 2
      );
    INSERT INTO category_taxonomy_states (
      category_id, organization_id, sort_order, content_version,
      active_intent_id, last_completed_intent_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'category_ideas', '${ORGANIZATION_ID}', 10, 1,
        NULL, 'intent-category-ideas-adopt', 'profile_owner', 2, 2
      ),
      (
        'category_books', '${ORGANIZATION_ID}', 20, 1,
        NULL, 'intent-category-books-adopt', 'profile_owner', 2, 2
      );
  `);

  const adopted = await listPublicEventCategoryOptions(
    database,
    ORGANIZATION_ID,
  );
  assert.deepEqual(
    adopted.map((category) => category.slug),
    ["ideas", "books"],
  );
  assert.deepEqual(adopted, [
    { name: "Ideas", slug: "ideas" },
    { name: "Books", slug: "books" },
  ]);

  database.exec(`
    UPDATE categories
    SET deleted_at = 3,
        updated_at = 3
    WHERE id = 'category_ideas';
  `);
  assert.deepEqual(
    (
      await listPublicEventCategoryOptions(
        database,
        ORGANIZATION_ID,
      )
    ).map((category) => category.slug),
    ["ideas", "books"],
    "an archived category remains filterable while visible events use it",
  );

  database.exec(`
    UPDATE events
    SET visibility = 'private',
        updated_at = 4
    WHERE category_id = 'category_ideas';
  `);
  assert.deepEqual(
    (
      await listPublicEventCategoryOptions(
        database,
        ORGANIZATION_ID,
      )
    ).map((category) => category.slug),
    ["ideas", "books"],
    "the organizer projection independently keeps the archived category visible",
  );

  database.exec(`
    UPDATE organizer_events
    SET publication_status = 'unpublished',
        updated_at = 5
    WHERE id = 'organizer_category_projection';
  `);
  assert.deepEqual(
    await listPublicEventCategoryOptions(database, ORGANIZATION_ID),
    [{ name: "Books", slug: "books" }],
    "an archived category disappears when no current public projection uses it",
  );
});

test("public events fail closed when the exact current club materialization is tampered", async (t) => {
  const database = await createFixture(t);
  const slug = "manual-ideas-gathering";
  const readManualEvent = () =>
    getPublicEventBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug,
    });
  const assertAbsentEverywhere = async () => {
    const list = await queryPublicEvents(database, upcomingInput());
    assert.equal(list.events.some((event) => event.slug === slug), false);
    assert.equal(await readManualEvent(), null);
    const editorial = await getEditorialPublicEvents(database, {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      requestedSlugs: [slug],
      todayDate: TODAY_DATE,
    });
    assert.equal(
      [...editorial.selected, ...editorial.defaultUpcoming].some(
        (event) => event.slug === slug,
      ),
      false,
    );
    assert.deepEqual(
      await listRelatedPublicEvents(database, {
        limit: 6,
        nowUtcMs: NOW_UTC_MS,
        organizationId: ORGANIZATION_ID,
        slug,
        todayDate: TODAY_DATE,
      }),
      [],
    );
    assert.equal(
      (await listPublicEventSitemapSlugs(database, {
        organizationId: ORGANIZATION_ID,
      })).includes(slug),
      false,
    );
    assert.equal(
      (await listPublishedEventSelections(database, {
        organizationId: ORGANIZATION_ID,
      })).some((event) => event.slug === slug),
      false,
    );
  };

  assert.equal(
    (await readManualEvent())?.club.name,
    "Vancouver Curiosity Club",
  );

  database.exec(`
    UPDATE clubs
    SET name = 'Tampered club identity'
    WHERE id = 'club_vcc';
  `);
  await assertAbsentEverywhere();

  database.exec(`
    UPDATE clubs
    SET name = 'Vancouver Curiosity Club'
    WHERE id = 'club_vcc';
    UPDATE club_public_profile_details
    SET public_display_name = 'Tampered club profile'
    WHERE club_id = 'club_vcc';
  `);
  await assertAbsentEverywhere();

  database.exec(`
    UPDATE club_public_profile_details
    SET public_display_name = 'Vancouver Curiosity Club'
    WHERE club_id = 'club_vcc';
  `);
  assert.equal(
    (await readManualEvent())?.club.name,
    "Vancouver Curiosity Club",
  );

  database.exec(`
    UPDATE clubs
    SET name = 'Forged club identity'
    WHERE id = 'club_vcc';
    UPDATE club_public_profile_details
    SET public_display_name = 'Forged club identity'
    WHERE club_id = 'club_vcc';
    UPDATE cms_public_materialization_receipts
    SET projection_json = json_set(
      projection_json,
      '$.club.name', 'Forged club identity',
      '$.details.publicDisplayName', 'Forged club identity'
    ),
        canonical_byte_size = length(CAST(json_set(
      projection_json,
      '$.club.name', 'Forged club identity',
      '$.details.publicDisplayName', 'Forged club identity'
    ) AS BLOB))
    WHERE entity_type = 'club_public_profile'
      AND entity_key = 'club_vcc';
  `);
  assert.equal(
    (await queryPublicEvents(database, upcomingInput())).events.some(
      (event) => event.slug === slug,
    ),
    false,
    "a forged receipt/live-row pair must not outrank its immutable revision",
  );
});

test("public event final identity checks suppress club edits racing every multi-read surface", async (t) => {
  const slug = "manual-ideas-gathering";
  const surfaces = [
    {
      label: "list",
      mutateAfterRead: 2,
      async read(database) {
        const page = await queryPublicEvents(database, upcomingInput());
        return page.events.some((event) => event.slug === slug);
      },
    },
    {
      label: "detail",
      mutateAfterRead: 1,
      async read(database) {
        return (
          (await getPublicEventBySlug(database, {
            organizationId: ORGANIZATION_ID,
            slug,
          })) !== null
        );
      },
    },
    {
      label: "editorial",
      mutateAfterRead: 1,
      async read(database) {
        const result = await getEditorialPublicEvents(database, {
          nowUtcMs: NOW_UTC_MS,
          organizationId: ORGANIZATION_ID,
          requestedSlugs: [slug],
          todayDate: TODAY_DATE,
        });
        return [...result.selected, ...result.defaultUpcoming].some(
          (event) => event.slug === slug,
        );
      },
    },
    {
      label: "related",
      mutateAfterRead: 1,
      async read(database) {
        return (await listRelatedPublicEvents(database, {
            limit: 6,
            nowUtcMs: NOW_UTC_MS,
            organizationId: ORGANIZATION_ID,
            slug,
            todayDate: TODAY_DATE,
          })).length > 0;
      },
    },
    {
      label: "sitemap",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listPublicEventSitemapSlugs(database, {
            organizationId: ORGANIZATION_ID,
          })
        ).includes(slug);
      },
    },
    {
      label: "private CMS selection",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await resolveEditorialPublishedEventSelectionProofs(database, {
            organizationId: ORGANIZATION_ID,
            selectionIds: ["legacy:event_manual_upcoming"],
          })
        ).some((event) => event.slug === slug);
      },
    },
  ];
  for (const surface of surfaces) {
    await t.test(surface.label, async (surfaceTest) => {
      const database = await createFixture(surfaceTest);
      let reads = 0;
      let mutated = false;
      const visible = await surface.read(
        injectAfterQuery(database, async () => {
          reads += 1;
          if (!mutated && reads === surface.mutateAfterRead) {
            mutated = true;
            database.exec(`
              UPDATE clubs
              SET name = 'Raced club identity'
              WHERE id = 'club_vcc'
            `);
          }
        }),
      );
      assert.equal(mutated, true);
      assert.equal(
        visible,
        false,
        `${surface.label} must drop an event whose Club receipt became stale`,
      );
    });
  }
});

test("a coherent Club republish racing a multi-read surface drops only the stale event snapshot", async (t) => {
  const slug = "manual-ideas-gathering";
  const republishedName = "Vancouver Curiosity Club — republished";
  const surfaces = [
    {
      label: "list",
      mutateAfterRead: 2,
      async read(database) {
        return (await queryPublicEvents(database, upcomingInput())).events.some(
          (event) => event.slug === slug,
        );
      },
    },
    {
      label: "detail",
      mutateAfterRead: 1,
      async read(database) {
        return (
          (await getPublicEventBySlug(database, {
            organizationId: ORGANIZATION_ID,
            slug,
          })) !== null
        );
      },
    },
    {
      label: "editorial",
      mutateAfterRead: 1,
      async read(database) {
        const result = await getEditorialPublicEvents(database, {
          nowUtcMs: NOW_UTC_MS,
          organizationId: ORGANIZATION_ID,
          requestedSlugs: [slug],
          todayDate: TODAY_DATE,
        });
        return [...result.selected, ...result.defaultUpcoming].some(
          (event) => event.slug === slug,
        );
      },
    },
    {
      label: "related",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listRelatedPublicEvents(database, {
            limit: 6,
            nowUtcMs: NOW_UTC_MS,
            organizationId: ORGANIZATION_ID,
            slug,
            todayDate: TODAY_DATE,
          })
        ).some((event) => event.slug === "related-manual-conversation");
      },
    },
    {
      label: "sitemap",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listPublicEventSitemapSlugs(database, {
            organizationId: ORGANIZATION_ID,
          })
        ).includes(slug);
      },
    },
    {
      label: "private CMS selection",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await resolveEditorialPublishedEventSelectionProofs(database, {
            organizationId: ORGANIZATION_ID,
            selectionIds: ["legacy:event_manual_upcoming"],
          })
        ).some((event) => event.slug === slug);
      },
    },
    {
      label: "legacy compatibility adapter",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listUpcomingPublicEvents(database, {
            fromUtcMs: NOW_UTC_MS,
            limit: 100,
            organizationId: ORGANIZATION_ID,
            todayDate: TODAY_DATE,
          })
        ).some((event) => event.slug === slug);
      },
    },
    {
      label: "Meetup compatibility adapter",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listUpcomingPublicMeetupEvents(database, {
            fromUtcMs: NOW_UTC_MS,
            limit: 100,
            organizationId: ORGANIZATION_ID,
            todayDate: TODAY_DATE,
          })
        ).some((event) => event.slug === "meetup-active-event");
      },
    },
  ];
  for (const surface of surfaces) {
    await t.test(surface.label, async (surfaceTest) => {
      const database = await createFixture(surfaceTest);
      let reads = 0;
      let republished = false;
      const visible = await surface.read(
        injectAfterQuery(database, async () => {
          reads += 1;
          if (!republished && reads === surface.mutateAfterRead) {
            republished = true;
            republishCurrentClubProjection(database, {
              clubId: "club_vcc",
              description: "A coherently republished public club.",
              featured: true,
              laneId: "lane_think",
              meetupGroupUrl:
                "https://www.meetup.com/synthetic-public-group/",
              name: republishedName,
              slug: "vancouver-curiosity-club",
            });
          }
        }),
      );
      assert.equal(republished, true);
      assert.equal(
        visible,
        false,
        `${surface.label} must not return fields from the prior valid Club revision`,
      );
      assert.equal(
        (await getPublicEventBySlug(database, {
          organizationId: ORGANIZATION_ID,
          slug,
        }))?.club.name,
        republishedName,
        "the coherently republished Club must remain visible on a fresh read",
      );
    });
  }
});

test("a published Program with mutable projection or receipt drift suppresses its event", async (t) => {
  const database = await createFixture(t);
  const slug = "manual-ideas-gathering";
  seedCurrentPublishedProgramProjection(database, {
    clubId: "club_vcc",
    description: "A confirmed recurring conversation.",
    laneId: "lane_think",
    name: "Ideas Program",
    programId: "program-ideas",
    slug: "ideas-program",
  });
  database.exec(`
    UPDATE events
    SET program_id = 'program-ideas',
        updated_at = updated_at + 1
    WHERE id = 'event_manual_upcoming'
  `);
  assert.equal(
    (await getPublicEventBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug,
    }))?.program?.name,
    "Ideas Program",
  );

  database.exec(`
    UPDATE program_public_profile_details
    SET public_display_name = 'Tampered Program'
    WHERE program_id = 'program-ideas'
  `);
  assert.equal(
    await getPublicEventBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug,
    }),
    null,
  );

  database.exec(`
    UPDATE program_public_profile_details
    SET public_display_name = 'Ideas Program'
    WHERE program_id = 'program-ideas';
    UPDATE cms_public_materialization_receipts
    SET projection_json = replace(
          projection_json,
          'Ideas Program',
          'Forged Program'
        ),
        canonical_byte_size = length(CAST(replace(
          projection_json,
          'Ideas Program',
          'Forged Program'
        ) AS BLOB))
    WHERE entity_type = 'program_public_profile'
      AND entity_key = 'program-ideas'
  `);
  assert.equal(
    (await queryPublicEvents(database, upcomingInput())).events.some(
      (event) => event.slug === slug,
    ),
    false,
  );
  assert.equal(
    (await listPublicEventSitemapSlugs(database, {
      organizationId: ORGANIZATION_ID,
    })).includes(slug),
    false,
  );
});

test("a coherent Program republish racing a multi-read surface drops only the stale event snapshot", async (t) => {
  const slug = "manual-ideas-gathering";
  const republishedName = "Ideas Program — republished";
  const surfaces = [
    {
      label: "list",
      mutateAfterRead: 2,
      async read(database) {
        return (await queryPublicEvents(database, upcomingInput())).events.some(
          (event) => event.slug === slug,
        );
      },
    },
    {
      label: "detail",
      mutateAfterRead: 1,
      async read(database) {
        return (
          (await getPublicEventBySlug(database, {
            organizationId: ORGANIZATION_ID,
            slug,
          })) !== null
        );
      },
    },
    {
      label: "editorial",
      mutateAfterRead: 1,
      async read(database) {
        const result = await getEditorialPublicEvents(database, {
          nowUtcMs: NOW_UTC_MS,
          organizationId: ORGANIZATION_ID,
          requestedSlugs: [slug],
          todayDate: TODAY_DATE,
        });
        return [...result.selected, ...result.defaultUpcoming].some(
          (event) => event.slug === slug,
        );
      },
    },
    {
      label: "related",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listRelatedPublicEvents(database, {
            limit: 6,
            nowUtcMs: NOW_UTC_MS,
            organizationId: ORGANIZATION_ID,
            slug,
            todayDate: TODAY_DATE,
          })
        ).some((event) => event.slug === "related-manual-conversation");
      },
    },
    {
      label: "sitemap",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listPublicEventSitemapSlugs(database, {
            organizationId: ORGANIZATION_ID,
          })
        ).includes(slug);
      },
    },
    {
      label: "private CMS selection",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await resolveEditorialPublishedEventSelectionProofs(database, {
            organizationId: ORGANIZATION_ID,
            selectionIds: ["legacy:event_manual_upcoming"],
          })
        ).some((event) => event.slug === slug);
      },
    },
    {
      label: "legacy compatibility adapter",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listUpcomingPublicEvents(database, {
            fromUtcMs: NOW_UTC_MS,
            limit: 100,
            organizationId: ORGANIZATION_ID,
            todayDate: TODAY_DATE,
          })
        ).some((event) => event.slug === slug);
      },
    },
    {
      label: "Meetup compatibility adapter",
      mutateAfterRead: 1,
      async read(database) {
        return (
          await listUpcomingPublicMeetupEvents(database, {
            fromUtcMs: NOW_UTC_MS,
            limit: 100,
            organizationId: ORGANIZATION_ID,
            todayDate: TODAY_DATE,
          })
        ).some((event) => event.slug === "meetup-active-event");
      },
    },
  ];
  for (const surface of surfaces) {
    await t.test(surface.label, async (surfaceTest) => {
      const database = await createFixture(surfaceTest);
      seedCurrentPublishedProgramProjection(database, {
        clubId: "club_vcc",
        description: "A confirmed recurring conversation.",
        laneId: "lane_think",
        name: "Ideas Program",
        programId: "program-ideas",
        slug: "ideas-program",
      });
      database.exec(`
        UPDATE events
        SET program_id = 'program-ideas',
            updated_at = updated_at + 1
        WHERE id IN (
          'event_manual_upcoming',
          'event_manual_related',
          'event_meetup_active'
        )
      `);
      let reads = 0;
      let republished = false;
      const visible = await surface.read(
        injectAfterQuery(database, async () => {
          reads += 1;
          if (!republished && reads === surface.mutateAfterRead) {
            republished = true;
            republishCurrentProgramProjection(database, {
              clubId: "club_vcc",
              description: "A coherently republished recurring conversation.",
              laneId: "lane_think",
              name: republishedName,
              programId: "program-ideas",
              slug: "ideas-program",
            });
          }
        }),
      );
      assert.equal(republished, true);
      assert.equal(
        visible,
        false,
        `${surface.label} must not return fields from the prior valid Program revision`,
      );
      assert.equal(
        (await getPublicEventBySlug(database, {
          organizationId: ORGANIZATION_ID,
          slug,
        }))?.program?.name,
        republishedName,
        "the coherently republished Program must remain visible on a fresh read",
      );
    });
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

test("protected legal claims are suppressed across legacy and Meetup public event branches", async (t) => {
  const database = await createFixture(t);
  database.exec(`
    UPDATE events
    SET title = 'Registered nonprofit society event'
    WHERE id = 'event_manual_upcoming';
    UPDATE meetup_event_snapshots
    SET title = 'BC incorporated society gathering'
    WHERE generation_id = 'generation_active'
      AND external_id = 'synthetic-active-uid';
  `);

  const page = await queryPublicEvents(database, upcomingInput());
  assert.equal(
    page.events.some(
      ({ slug }) =>
        slug === "manual-ideas-gathering" ||
        slug === "meetup-active-event",
    ),
    false,
  );
  for (const slug of [
    "manual-ideas-gathering",
    "meetup-active-event",
  ]) {
    assert.equal(
      await getPublicEventBySlug(database, {
        organizationId: ORGANIZATION_ID,
        slug,
      }),
      null,
    );
  }
  const sitemapSlugs = await listPublicEventSitemapSlugs(database, {
    organizationId: ORGANIZATION_ID,
  });
  assert.equal(sitemapSlugs.includes("manual-ideas-gathering"), false);
  assert.equal(sitemapSlugs.includes("meetup-active-event"), false);
  assert.doesNotMatch(
    JSON.stringify({ page, sitemapSlugs }),
    /registered nonprofit|incorporated society/iu,
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

test("calendar month matches the bounded list union and fails closed on exposed collisions", async (t) => {
  const database = await createFixture(t);
  database.exec(`
    UPDATE events
    SET status = 'completed'
    WHERE id = 'event_manual_related';
  `);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_calendar_completed_past",
    slug: "organizer-calendar-completed-past",
    title: "Completed July Organizer Event",
    planningStatus: "completed",
    startsAtUtcMs: Date.parse("2026-07-20T18:00:00.000Z"),
    endsAtUtcMs: Date.parse("2026-07-20T20:00:00.000Z"),
  });

  const augustBounds = {
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
  };
  const [past, upcoming, august] = await Promise.all([
    queryPublicEvents(database, {
      ...upcomingInput(),
      ...augustBounds,
      view: "past",
    }),
    queryPublicEvents(database, {
      ...upcomingInput(),
      ...augustBounds,
      view: "upcoming",
    }),
    queryPublicCalendarMonth(database, {
      organizationId: ORGANIZATION_ID,
      nowUtcMs: NOW_UTC_MS,
      todayDate: TODAY_DATE,
      ...augustBounds,
    }),
  ]);
  const boundedUnion = [
    ...new Set([...past.events, ...upcoming.events].map(({ slug }) => slug)),
  ].sort();
  assert.deepEqual(
    august.events.map(({ slug }) => slug).sort(),
    boundedUnion,
  );
  assert.equal(august.hasMore, false);

  const bundleStatements = countD1Statements(database);
  const bundled = await queryPublicCalendarLandingBundle(
    bundleStatements.database,
    {
      calendar: {
        organizationId: ORGANIZATION_ID,
        nowUtcMs: NOW_UTC_MS,
        todayDate: TODAY_DATE,
        ...augustBounds,
      },
      includeLandingEvent: true,
    },
  );
  assert.deepEqual(bundled.calendar, august);
  assert.deepEqual(bundled.landingEvent, upcoming.events[0] ?? null);
  assert.ok(
    bundleStatements.count() <= 4,
    `the mixed-source Events bundle used ${bundleStatements.count()} D1 statements`,
  );

  for (const excludedSlug of [
    "related-manual-conversation",
    "cancelled-manual-event",
    "meetup-cancelled-event",
  ]) {
    assert.equal(
      august.events.some(({ slug }) => slug === excludedSlug),
      false,
      excludedSlug,
    );
  }

  const july = await queryPublicCalendarMonth(database, {
    organizationId: ORGANIZATION_ID,
    nowUtcMs: NOW_UTC_MS,
    todayDate: TODAY_DATE,
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
  });
  assert.equal(
    july.events.some(
      ({ slug, status }) =>
        slug === "organizer-calendar-completed-past" && status === "completed",
    ),
    true,
  );

  await insertOrganizerPublicEvent(database, {
    id: "organizer_calendar_slug_collision",
    slug: "manual-ideas-gathering",
    title: "Calendar Collision Candidate",
    startsAtUtcMs: Date.parse("2026-08-02T02:00:00.000Z"),
    endsAtUtcMs: Date.parse("2026-08-02T04:00:00.000Z"),
  });
  await assert.rejects(
    () =>
      queryPublicCalendarMonth(database, {
        organizationId: ORGANIZATION_ID,
        nowUtcMs: NOW_UTC_MS,
        todayDate: TODAY_DATE,
        ...augustBounds,
      }),
    (error) => error?.code === "internal_error" && error?.status === 500,
  );
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

test("canonical organizer events publish from allowlisted sidecars only", async (t) => {
  const database = await createFixture(t);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_public",
    slug: "organizer-public-event",
    title: "Canonical Organizer Event",
    meetupEventUrl:
      "https://www.meetup.com/synthetic-public-group/events/9501/",
    confirmedMeetupEventUrl:
      "https://www.meetup.com/synthetic-public-group/events/9501/",
    rsvpMode: "meetup",
    publicHostsEnabled: true,
  });
  database.exec(`
    INSERT INTO organizer_event_public_hosts (
      id, organization_id, organizer_event_id, profile_id,
      selected_by_profile_id, selected_at
    ) VALUES
      (
        'public_host_selection', '${ORGANIZATION_ID}', 'organizer_public',
        'profile_public_host', 'profile_owner', 10
      ),
      (
        'hidden_host_selection', '${ORGANIZATION_ID}', 'organizer_public',
        'profile_no_consent', 'profile_owner', 10
      );
    INSERT INTO organizer_event_organizers (
      id, organization_id, organizer_event_id, profile_id,
      created_by_profile_id, created_at
    ) VALUES (
      'hidden_host_association', '${ORGANIZATION_ID}', 'organizer_public',
      'profile_no_consent', 'profile_owner', 10
    );
  `);

  const page = await queryPublicEvents(database, upcomingInput());
  const card = page.events.find(
    (event) => event.slug === "organizer-public-event",
  );
  assert.ok(card);
  assert.equal(card.rsvpMode, "meetup");
  assert.equal(
    card.rsvpUrl,
    "https://www.meetup.com/synthetic-public-group/events/9501/",
  );
  assert.equal(card.attendanceMode, "hybrid");
  assert.deepEqual(card.venue, {
    address: "100 Approved Public Street",
    name: "Approved Public Room",
  });

  const detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "organizer-public-event",
  });
  assert.ok(detail);
  assert.deepEqual(detail.organizers, [PUBLIC_HOST]);
  assert.equal(detail.publicAccessNote, "Use the public east entrance.");
  assert.equal(
    detail.publicOnlineUrl,
    "https://events.synthetic.invalid/join",
  );
  assert.equal(
    detail.externalMapUrl,
    "https://maps.synthetic.invalid/approved-room",
  );
  assert.equal(detail.availabilityState, "waitlist");
  assert.equal(detail.capacity, 42);
  assert.equal(detail.costText, "Pay what you can.");
  assert.equal(detail.preparationInformation, "Read the public handout.");
  assert.equal(detail.whatToBring, "A notebook.");
  assert.equal(detail.arrivalInstructions, "Arrive ten minutes early.");
  const structuredData = buildPublicEventJsonLd(
    detail,
    "https://site.synthetic.invalid/events/organizer-public-event",
    "Confirmed Site Identity",
  );
  assert.deepEqual(structuredData.organizer, [
    {
      "@type": "Organization",
      name: "Confirmed Site Identity",
      url: "https://site.synthetic.invalid/",
    },
    {
      "@type": "Person",
      name: "Public Host",
    },
  ]);
  assert.equal("performer" in structuredData, false);
  assert.equal(
    structuredData.organizer.some(
      (organizer) =>
        organizer["@type"] === "Organization" &&
        organizer.name === detail.club.name,
    ),
    false,
    "the club must not be mislabeled as the schema.org organizer",
  );
  assert.equal(detail.weatherNote, "The courtyard portion is weather dependent.");
  assert.equal(
    detail.verifiedAccessibilityNotes,
    "Step-free public entrance confirmed.",
  );

  const serialized = JSON.stringify({ page, detail });
  for (const sentinel of [
    "ORGANIZER_PRIVATE_NOTES_SENTINEL",
    "ORGANIZER_PRIVATE_MEETING_SENTINEL",
    "owner@synthetic.invalid",
    "hidden@synthetic.invalid",
  ]) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
  for (const forbiddenKey of [
    "organizationId",
    "organizerEventId",
    "primaryOrganizerProfileId",
    "contentVersion",
    "scheduleVersion",
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

test("CMS event selections use one collision-safe unified public projection", async (t) => {
  const database = await createFixture(t);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_selection",
    slug: "organizer-selection",
    title: "Selected Organizer Event",
  });

  const choices = await listPublishedEventSelections(database, {
    organizationId: ORGANIZATION_ID,
  });
  const choiceIds = new Set(choices.map((choice) => choice.id));
  assert.equal(choiceIds.has("legacy:event_manual_upcoming"), true);
  assert.equal(
    choiceIds.has("meetup:source_synthetic:synthetic-active-uid"),
    true,
  );
  assert.equal(choiceIds.has("organizer:organizer_selection"), true);
  assert.equal(
    choiceIds.has("meetup:source_synthetic:synthetic-pending-uid"),
    false,
  );

  const requestedIds = [
    "organizer:organizer_selection",
    "meetup:source_synthetic:synthetic-active-uid",
    "legacy:event_manual_upcoming",
    "meetup:source_synthetic:synthetic-pending-uid",
  ];
  let selectionQueries = 0;
  const selected = await resolvePublishedEventSelections(
    countAllQueries(database, () => {
      selectionQueries += 1;
    }),
    {
      organizationId: ORGANIZATION_ID,
      selectionIds: requestedIds,
    },
  );
  assert.equal(
    selectionQueries,
    2,
    "one bounded selection read plus one exact current projection revalidation",
  );
  assert.deepEqual(
    selected.map(({ id, slug, title }) => ({ id, slug, title })),
    [
      {
        id: "organizer:organizer_selection",
        slug: "organizer-selection",
        title: "Selected Organizer Event",
      },
      {
        id: "meetup:source_synthetic:synthetic-active-uid",
        slug: "meetup-active-event",
        title: "Active Snapshot Authority",
      },
      {
        id: "legacy:event_manual_upcoming",
        slug: "manual-ideas-gathering",
        title: "Manual Ideas Gathering",
      },
    ],
  );

  const legacyDraftSelection = await resolvePublishedEventSelections(
    database,
    {
      organizationId: ORGANIZATION_ID,
      selectionIds: ["organizer_selection"],
    },
  );
  assert.deepEqual(legacyDraftSelection, [
    {
      id: "organizer_selection",
      slug: "organizer-selection",
      title: "Selected Organizer Event",
    },
  ]);

  let editorialQueries = 0;
  const editorial = await getEditorialPublicEvents(
    countAllQueries(database, () => {
      editorialQueries += 1;
    }),
    {
      nowUtcMs: NOW_UTC_MS,
      organizationId: ORGANIZATION_ID,
      requestedSlugs: [
        "organizer-selection",
        "meetup-active-event",
        "manual-ideas-gathering",
        "pending-addition-sentinel",
        "manual-ideas-gathering",
      ],
      todayDate: TODAY_DATE,
    },
  );
  assert.equal(
    editorialQueries,
    4,
    "one authoritative event query, two bounded source enrichments, and one final identity revalidation replace the oversized monolithic D1 statement",
  );
  assert.deepEqual(
    editorial.selected.map((event) => event.slug),
    [
      "organizer-selection",
      "meetup-active-event",
      "manual-ideas-gathering",
      "manual-ideas-gathering",
    ],
  );
  assert.ok(editorial.defaultUpcoming.length <= 12);
  assert.equal(
    editorial.defaultUpcoming.some(
      (event) => event.slug === "pending-addition-sentinel",
    ),
    false,
  );
});

test("crafted protected media claims suppress organizer artwork from public cards, detail, and metadata inputs", async (t) => {
  const database = await createFixture(t);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_artwork_legal",
    slug: "organizer-artwork-legal",
    title: "Organizer artwork safety",
  });
  database.exec(`
    INSERT INTO organizer_event_revisions (
      id, organization_id, organizer_event_id, content_version,
      schedule_version, action, snapshot_json, actor_profile_id, created_at
    ) VALUES (
      'revision-organizer-artwork-legal', '${ORGANIZATION_ID}',
      'organizer_artwork_legal', 1, 1, 'created', '{}', 'profile_owner', 10
    );
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-organizer-artwork-legal', '${ORGANIZATION_ID}',
      'opaque/artwork/original', 'private-artwork.png', 'image/png', 100,
      'Safe abstract field-note shapes.', 'Vancouver Curiosity Club',
      'approved', 'not_applicable', 0, 'profile_owner', 10, 10
    );
    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, caption,
      private_rights_source_note, private_participant_consent_note,
      informative, content_version, original_sha256, width, height,
      pixel_count, finalized_at, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-organizer-artwork-legal', '${ORGANIZATION_ID}', 'ready',
      'Safe public artwork caption.',
      'Private CRA charity documentation.',
      'Private society registration evidence.',
      1, 1, '${"a".repeat(64)}', 1600, 900, 1440000, 10,
      'profile_owner', 10, 10
    );
    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key, mime_type,
      byte_size, width, height, pixel_count, sha256, state,
      finalized_at, created_at
    ) VALUES
      (
        'variant-artwork-original', '${ORGANIZATION_ID}',
        'asset-organizer-artwork-legal', 'original',
        'opaque/artwork/original', 'image/png', 100, 1600, 900, 1440000,
        '${"b".repeat(64)}', 'ready', 10, 10
      ),
      (
        'variant-artwork-480', '${ORGANIZATION_ID}',
        'asset-organizer-artwork-legal', 'webp_480',
        'opaque/artwork/480', 'image/webp', 80, 480, 270, 129600,
        '${"c".repeat(64)}', 'ready', 10, 10
      ),
      (
        'variant-artwork-960', '${ORGANIZATION_ID}',
        'asset-organizer-artwork-legal', 'webp_960',
        'opaque/artwork/960', 'image/webp', 80, 960, 540, 518400,
        '${"d".repeat(64)}', 'ready', 10, 10
      ),
      (
        'variant-artwork-1600', '${ORGANIZATION_ID}',
        'asset-organizer-artwork-legal', 'webp_1600',
        'opaque/artwork/1600', 'image/webp', 80, 1600, 900, 1440000,
        '${"e".repeat(64)}', 'ready', 10, 10
      );
    INSERT INTO media_usage_references (
      id, organization_id, asset_id, entity_type, entity_id, revision_id,
      usage_kind, publication_scope, created_by_profile_id, created_at
    ) VALUES (
      'usage-organizer-artwork-legal', '${ORGANIZATION_ID}',
      'asset-organizer-artwork-legal', 'organizer_event',
      'organizer_artwork_legal', 'revision-organizer-artwork-legal',
      'event_artwork', 'published', 'profile_owner', 10
    );
  `);

  const readDetail = () =>
    getPublicEventBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug: "organizer-artwork-legal",
    });
  const safe = await readDetail();
  assert.ok(safe?.artwork);
  assert.equal(safe.artwork.altText, "Safe abstract field-note shapes.");
  assert.equal(
    JSON.stringify(safe).includes("Private CRA charity documentation"),
    false,
  );
  assert.equal(
    JSON.stringify(safe).includes("Private society registration evidence"),
    false,
  );

  for (const mutation of [
    `UPDATE media_assets
     SET alt_text = 'Registered charity artwork', updated_at = 11
     WHERE id = 'asset-organizer-artwork-legal'`,
    `UPDATE media_asset_details
     SET caption = 'Tax-deductible artwork', updated_at = 12
     WHERE asset_id = 'asset-organizer-artwork-legal'`,
    `UPDATE media_assets
     SET credit = 'BC incorporated society', updated_at = 13
     WHERE id = 'asset-organizer-artwork-legal'`,
  ]) {
    database.exec(mutation);
    const hidden = await readDetail();
    assert.ok(hidden);
    assert.equal(hidden.artwork, null);
    database.exec(`
      UPDATE media_assets
      SET alt_text = 'Safe abstract field-note shapes.',
          credit = 'Vancouver Curiosity Club',
          updated_at = 14
      WHERE id = 'asset-organizer-artwork-legal';
      UPDATE media_asset_details
      SET caption = 'Safe public artwork caption.', updated_at = 14
      WHERE asset_id = 'asset-organizer-artwork-legal';
    `);
  }
});

test("organizer publication states fail closed while cancellation and completed past remain truthful", async (t) => {
  const database = await createFixture(t);
  const hiddenFixtures = [
    ["organizer_private", "private", "confirmed", null],
    ["organizer_scheduled", "scheduled", "confirmed", null],
    ["organizer_unpublished", "unpublished", "confirmed", null],
    ["organizer_draft", "published", "draft", null],
    ["organizer_hold", "published", "tentative_hold", null],
    ["organizer_archived", "published", "archived", null],
    ["organizer_deleted", "published", "confirmed", 20],
  ];
  for (const [id, publicationStatus, planningStatus, deletedAt] of hiddenFixtures) {
    await insertOrganizerPublicEvent(database, {
      id,
      slug: `${id}-slug`,
      title: `${id} title`,
      planningStatus,
      publicationStatus,
      deletedAt,
    });
  }
  await insertOrganizerPublicEvent(database, {
    id: "organizer_cancelled",
    slug: "organizer-cancelled",
    title: "Cancelled Organizer Event",
    planningStatus: "cancelled",
    publicationStatus: "published",
  });
  await insertOrganizerPublicEvent(database, {
    id: "organizer_completed",
    slug: "organizer-completed",
    title: "Completed Organizer Event",
    planningStatus: "completed",
    publicationStatus: "published",
    startsAtUtcMs: Date.parse("2026-07-01T02:00:00.000Z"),
    endsAtUtcMs: Date.parse("2026-07-01T04:00:00.000Z"),
  });
  await insertOrganizerPublicEvent(database, {
    id: "organizer_preview",
    slug: "organizer-preview",
    title: "Authorized Preview Event",
    publicationStatus: "scheduled",
  });
  await insertOrganizerPublicEvent(database, {
    id: "organizer_stale_publication_state",
    slug: "organizer-stale-publication-state",
    title: "Stale Publication State",
  });
  database.exec(`
    UPDATE organizer_event_publication_state
    SET most_recent_unpublished_at = 20
    WHERE organizer_event_id = 'organizer_stale_publication_state';
  `);

  const upcoming = await queryPublicEvents(database, upcomingInput());
  const upcomingSlugs = new Set(upcoming.events.map((event) => event.slug));
  for (const [id] of hiddenFixtures) {
    assert.equal(upcomingSlugs.has(`${id}-slug`), false, id);
  }
  assert.equal(upcomingSlugs.has("organizer-cancelled"), false);
  assert.equal(upcomingSlugs.has("organizer-completed"), false);
  assert.equal(upcomingSlugs.has("organizer-stale-publication-state"), false);

  const cancelled = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "organizer-cancelled",
  });
  assert.equal(cancelled?.isCancelled, true);
  assert.equal(cancelled?.status, "cancelled");

  const past = await queryPublicEvents(database, {
    ...upcomingInput(),
    view: "past",
  });
  assert.equal(
    past.events.some(
      (event) =>
        event.slug === "organizer-completed" && event.status === "completed",
    ),
    true,
  );

  const preview = await getAuthorizedOrganizerEventPublicPreview(database, {
    membershipId: "membership_owner",
    organizationId: ORGANIZATION_ID,
    organizerEventId: "organizer_preview",
    profileId: "profile_owner",
  });
  assert.equal(preview?.slug, "organizer-preview");
  assert.equal(preview?.rsvpMode, "coming_soon");
  assert.equal(preview?.rsvpUrl, null);
  assert.equal(
    JSON.stringify(preview).includes("ORGANIZER_PRIVATE"),
    false,
  );

  await insertOrganizerPublicEvent(database, {
    id: "organizer_preview_incomplete",
    slug: "organizer-preview-incomplete",
    title: "Incomplete Preview Event",
    publicationStatus: "private",
  });
  database.exec(`
    UPDATE organizer_events
    SET summary = NULL
    WHERE id = 'organizer_preview_incomplete';
  `);
  assert.equal(
    await getAuthorizedOrganizerEventPublicPreview(database, {
      membershipId: "membership_owner",
      organizationId: ORGANIZATION_ID,
      organizerEventId: "organizer_preview_incomplete",
      profileId: "profile_owner",
    }),
    null,
  );
  assert.equal(
    await getAuthorizedOrganizerEventPublicPreview(database, {
      membershipId: "membership_owner",
      organizationId: ORGANIZATION_ID,
      organizerEventId: "organizer_draft",
      profileId: "profile_owner",
    }),
    null,
  );

  await insertOrganizerPublicEvent(database, {
    id: "organizer_preview_hostless",
    slug: "organizer-preview-hostless",
    title: "Hostless Preview Event",
    publicHostsEnabled: true,
    publicationStatus: "private",
  });
  const hostlessPreview =
    await getAuthorizedOrganizerEventPublicPreview(database, {
      membershipId: "membership_owner",
      organizationId: ORGANIZATION_ID,
      organizerEventId: "organizer_preview_hostless",
      profileId: "profile_owner",
    });
  assert.ok(hostlessPreview);
  assert.deepEqual(hostlessPreview.organizers, []);
});

test("organizer public hosts require selection, event enablement, current assignment, membership, and canonical consent", async (t) => {
  const database = await createFixture(t);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_host_gates",
    slug: "organizer-host-gates",
    title: "Organizer Host Gates",
    publicHostsEnabled: true,
  });
  database.exec(`
    INSERT INTO organizer_event_public_hosts (
      id, organization_id, organizer_event_id, profile_id,
      selected_by_profile_id, selected_at
    ) VALUES
      (
        'host_gate_public', '${ORGANIZATION_ID}', 'organizer_host_gates',
        'profile_public_host', 'profile_owner', 10
      ),
      (
        'host_gate_no_consent', '${ORGANIZATION_ID}',
        'organizer_host_gates', 'profile_no_consent', 'profile_owner', 10
      );
  `);
  let detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "organizer-host-gates",
  });
  assert.deepEqual(detail?.organizers, [PUBLIC_HOST]);
  assert.deepEqual(
    (
      await getPublicEventBySlug(database, {
        organizationId: ORGANIZATION_ID,
        slug: "manual-ideas-gathering",
      })
    )?.organizers,
    [PUBLIC_HOST],
  );
  assert.deepEqual(
    (
      await getPublicEventBySlug(database, {
        organizationId: ORGANIZATION_ID,
        slug: "meetup-active-event",
      })
    )?.organizers,
    [PUBLIC_HOST],
  );

  database.exec(`
    UPDATE event_organizers
    SET is_publicly_listed = 0
    WHERE id = 'organizer_public';
  `);
  assert.deepEqual(
    (
      await getPublicEventBySlug(database, {
        organizationId: ORGANIZATION_ID,
        slug: "manual-ideas-gathering",
      })
    )?.organizers,
    [],
    "the legacy-manual source requires its event-level public-host flag",
  );
  database.exec(`
    UPDATE event_organizers
    SET is_publicly_listed = 1
    WHERE id = 'organizer_public';
    UPDATE event_organizers
    SET is_publicly_listed = 0
    WHERE id = 'organizer_public_meetup';
  `);
  assert.deepEqual(
    (
      await getPublicEventBySlug(database, {
        organizationId: ORGANIZATION_ID,
        slug: "meetup-active-event",
      })
    )?.organizers,
    [],
    "the Meetup-synced source requires its event-level public-host flag",
  );
  database.exec(`
    UPDATE event_organizers
    SET is_publicly_listed = 1
    WHERE id = 'organizer_public_meetup';
  `);

  database.exec(`
    UPDATE profiles
    SET public_attribution_consent = 1
    WHERE id = 'profile_no_consent';
  `);
  detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "organizer-host-gates",
  });
  assert.deepEqual(
    detail?.organizers,
    [PUBLIC_HOST],
    "a crafted legacy consent bit without a completed receipt stays private",
  );

  database.exec(`
    UPDATE organizer_event_public_details
    SET public_hosts_enabled = 0
    WHERE organizer_event_id = 'organizer_host_gates';
  `);
  detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "organizer-host-gates",
  });
  assert.deepEqual(detail?.organizers, []);

  database.exec(`
    UPDATE organizer_event_public_details
    SET public_hosts_enabled = 1
    WHERE organizer_event_id = 'organizer_host_gates';
    UPDATE organization_memberships
    SET status = 'suspended'
    WHERE id = 'membership_public_host';
  `);
  detail = await getPublicEventBySlug(database, {
    organizationId: ORGANIZATION_ID,
    slug: "organizer-host-gates",
  });
  assert.deepEqual(detail?.organizers, []);
  for (const slug of [
    "manual-ideas-gathering",
    "meetup-active-event",
  ]) {
    assert.deepEqual(
      (
        await getPublicEventBySlug(database, {
          organizationId: ORGANIZATION_ID,
          slug,
        })
      )?.organizers,
      [],
      `${slug} must suppress a host whose membership is suspended`,
    );
  }
});

async function seedConfirmedPublicAttribution(
  database,
  { displayName, profileId },
) {
  const intentId = `intent_confirmed_${profileId}`;
  const receiptId = `receipt_confirmed_${profileId}`;
  const photoAssetId = "asset_public_host";
  const snapshotJson = JSON.stringify({
    biography: PUBLIC_HOST.biography,
    consent: true,
    displayName,
    draftVersion: 1,
    legacyAdopted: false,
    photoAssetId,
  });
  const snapshotHash = createHash("sha256")
    .update(snapshotJson)
    .digest("hex");
  seedPublicHostMedia(database, { photoAssetId });
  await database
    .prepare(
      `INSERT INTO organizer_public_attribution_states (
         profile_id, organization_id, attribution_version,
         published_attribution_version, workflow_status,
         draft_photo_media_asset_id, public_display_name,
         public_biography, public_photo_media_asset_id,
         current_receipt_id, confirmed_at, revoked_at,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (?, ?, 1, 0, 'unconfirmed', NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL, ?, 1, 1)`,
    )
    .bind(profileId, ORGANIZATION_ID, profileId)
    .run();
  await database
    .prepare(
      `INSERT INTO organizer_public_attribution_write_intents (
         id, organization_id, profile_id, operation,
         expected_draft_version, expected_published_version,
         proposed_published_version, snapshot_hash,
         actor_profile_id, created_at, completed_at
       ) VALUES (?, ?, ?, 'confirmed', 1, 0, 1, ?, ?, 1, 1)`,
    )
    .bind(
      intentId,
      ORGANIZATION_ID,
      profileId,
      snapshotHash,
      profileId,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO organizer_public_attribution_receipts (
         id, organization_id, profile_id, action,
         attribution_version, display_name, biography,
         photo_media_asset_id, consent, draft_version,
         legacy_adopted, prior_published_version,
         snapshot_json, snapshot_hash, actor_profile_id,
         write_intent_id, related_receipt_id, created_at
       ) VALUES (
         ?, ?, ?, 'confirmed', 1, ?, ?, ?, 1, 1, 0, NULL,
         ?, ?, ?, ?, NULL, 1
       )`,
    )
    .bind(
      receiptId,
      ORGANIZATION_ID,
      profileId,
      displayName,
      PUBLIC_HOST.biography,
      photoAssetId,
      snapshotJson,
      snapshotHash,
      profileId,
      intentId,
    )
    .run();
  await database
    .prepare(
      `UPDATE organizer_public_attribution_states
       SET published_attribution_version = 1,
           workflow_status = 'confirmed',
           public_display_name = ?,
           public_biography = ?,
           public_photo_media_asset_id = ?,
           current_receipt_id = ?,
           confirmed_at = 1,
           updated_at = 1
       WHERE profile_id = ?
         AND organization_id = ?`,
    )
    .bind(
      displayName,
      PUBLIC_HOST.biography,
      photoAssetId,
      receiptId,
      profileId,
      ORGANIZATION_ID,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO media_usage_references (
         id, organization_id, asset_id, entity_type, entity_id,
         revision_id, usage_kind, publication_scope,
         created_by_profile_id, created_at
       ) VALUES (
         'usage-public-host-photo', ?, ?, 'organizer_profile', ?, ?,
         'profile_photo', 'published', ?, 1
       )`,
    )
    .bind(
      ORGANIZATION_ID,
      photoAssetId,
      profileId,
      receiptId,
      profileId,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       ) VALUES (?, ?, ?, 'profile.public_attribution_confirmed',
                 'profile', ?, ?, 1)`,
    )
    .bind(
      `audit_confirmed_${profileId}`,
      ORGANIZATION_ID,
      profileId,
      profileId,
      JSON.stringify({
        draftVersion: 1,
        publishedVersion: 1,
        writeIntentId: intentId,
      }),
    )
    .run();
}

function seedPublicHostMedia(database, { photoAssetId }) {
  database.exec(`
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at
    ) VALUES (
      '${photoAssetId}', '${ORGANIZATION_ID}',
      'PRIVATE-R2-OBJECT-KEY-SENTINEL', 'PRIVATE-ORIGINAL-NAME.png',
      'image/png', 100, '${PUBLIC_HOST.photo.altText}',
      '${PUBLIC_HOST.photo.credit}', 'approved', 'not_applicable', 0,
      'profile_owner', 1, 1
    );
    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, caption,
      private_rights_source_note, private_participant_consent_note,
      informative, content_version, original_sha256, width, height,
      pixel_count, finalized_at, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      '${photoAssetId}', '${ORGANIZATION_ID}', 'ready',
      'Public-safe profile artwork.',
      'PRIVATE-RIGHTS-NOTE-SENTINEL',
      'PRIVATE-CONSENT-NOTE-SENTINEL',
      1, 1, '${"2".repeat(64)}', 1600, 1067, 1707200, 1,
      'profile_owner', 1, 1
    );
    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key, mime_type,
      byte_size, width, height, pixel_count, sha256, state,
      finalized_at, created_at
    ) VALUES
      (
        'variant-public-host-original', '${ORGANIZATION_ID}',
        '${photoAssetId}', 'original', 'PRIVATE-R2-ORIGINAL-SENTINEL',
        'image/png', 100, 1600, 1067, 1707200, '${"3".repeat(64)}',
        'ready', 1, 1
      ),
      (
        'variant-public-host-480', '${ORGANIZATION_ID}',
        '${photoAssetId}', 'webp_480', 'PRIVATE-R2-480-SENTINEL',
        'image/webp', 80, 480, 320, 153600, '${"4".repeat(64)}',
        'ready', 1, 1
      ),
      (
        'variant-public-host-960', '${ORGANIZATION_ID}',
        '${photoAssetId}', 'webp_960', 'PRIVATE-R2-960-SENTINEL',
        'image/webp', 80, 960, 640, 614400, '${"5".repeat(64)}',
        'ready', 1, 1
      ),
      (
        'variant-public-host-1600', '${ORGANIZATION_ID}',
        '${photoAssetId}', 'webp_1600', 'PRIVATE-R2-1600-SENTINEL',
        'image/webp', 80, 1600, 1067, 1707200, '${"6".repeat(64)}',
        'ready', 1, 1
      );
  `);
}

test("organizer Meetup confirmation must match the current canonical event URL", async (t) => {
  const database = await createFixture(t);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_rsvp_match",
    slug: "organizer-rsvp-match",
    title: "Matching RSVP Event",
    meetupEventUrl:
      "https://www.meetup.com/synthetic-public-group/events/9601/",
    confirmedMeetupEventUrl:
      "https://www.meetup.com/synthetic-public-group/events/9601/",
    rsvpMode: "meetup",
  });
  await insertOrganizerPublicEvent(database, {
    id: "organizer_rsvp_stale",
    slug: "organizer-rsvp-stale",
    title: "Stale RSVP Event",
    meetupEventUrl:
      "https://www.meetup.com/synthetic-public-group/events/9602/",
    confirmedMeetupEventUrl:
      "https://www.meetup.com/synthetic-public-group/events/9603/",
    rsvpMode: "meetup",
  });

  const page = await queryPublicEvents(database, upcomingInput());
  const matching = page.events.find(
    (event) => event.slug === "organizer-rsvp-match",
  );
  assert.equal(
    matching?.rsvpUrl,
    "https://www.meetup.com/synthetic-public-group/events/9601/",
  );
  assert.equal(
    page.events.some((event) => event.slug === "organizer-rsvp-stale"),
    false,
  );
  assert.equal(
    await getPublicEventBySlug(database, {
      organizationId: ORGANIZATION_ID,
      slug: "organizer-rsvp-stale",
    }),
    null,
  );
});

test("cross-source public slug collisions fail closed instead of ranking away a candidate", async (t) => {
  const database = await createFixture(t);
  await insertOrganizerPublicEvent(database, {
    id: "organizer_slug_collision",
    slug: "manual-ideas-gathering",
    title: "Organizer Collision Candidate",
  });

  await assert.rejects(
    () => queryPublicEvents(database, upcomingInput()),
    (error) => error?.code === "internal_error" && error?.status === 500,
  );
  await assert.rejects(
    () =>
      getPublicEventBySlug(database, {
        organizationId: ORGANIZATION_ID,
        slug: "manual-ideas-gathering",
      }),
    (error) => error?.code === "internal_error" && error?.status === 500,
  );
  await assert.rejects(
    () =>
      listPublicEventSitemapSlugs(database, {
        organizationId: ORGANIZATION_ID,
      }),
    (error) => error?.code === "internal_error" && error?.status === 500,
  );
  assert.deepEqual(
    await resolveEditorialPublishedEventSelectionProofs(database, {
      organizationId: ORGANIZATION_ID,
      selectionIds: ["organizer:organizer_slug_collision"],
    }),
    [],
    "a colliding slug cannot receive a CMS featured-event publication proof",
  );
});

test("split public enrichment fails closed across publish-state and content races", async (t) => {
  const cases = [
    {
      label: "legacy unpublish",
      prepare: async () => ({
        slug: "manual-ideas-gathering",
        mutate(database) {
          database.sqlite
            .prepare(
              `UPDATE events
               SET published_at = NULL
               WHERE id = 'event_manual_upcoming'`,
            )
            .run();
        },
      }),
    },
    {
      label: "legacy content edit",
      prepare: async () => ({
        slug: "manual-ideas-gathering",
        mutate(database) {
          database.sqlite
            .prepare(
              `UPDATE events
               SET title = 'Raced legacy title',
                   updated_at = updated_at + 1
               WHERE id = 'event_manual_upcoming'`,
            )
            .run();
        },
      }),
    },
    {
      label: "organizer unpublish",
      prepare: async (database) => {
        await insertOrganizerPublicEvent(database, {
          id: "organizer_race_unpublish",
          slug: "organizer-race-unpublish",
          title: "Organizer Race Unpublish",
        });
        return {
          slug: "organizer-race-unpublish",
          mutate(target) {
            target.sqlite
              .prepare(
                `UPDATE organizer_events
                 SET publication_status = 'unpublished'
                 WHERE id = 'organizer_race_unpublish'`,
              )
              .run();
          },
        };
      },
    },
    {
      label: "organizer content edit",
      prepare: async (database) => {
        await insertOrganizerPublicEvent(database, {
          id: "organizer_race_edit",
          slug: "organizer-race-edit",
          title: "Organizer Race Edit",
        });
        return {
          slug: "organizer-race-edit",
          mutate(target) {
            target.sqlite
              .prepare(
                `UPDATE organizer_events
                 SET title = 'Raced organizer title',
                     updated_at = updated_at + 1
                 WHERE id = 'organizer_race_edit'`,
              )
              .run();
          },
        };
      },
    },
  ];

  for (const race of cases) {
    await t.test(race.label, async (raceTest) => {
      const database = await createFixture(raceTest);
      const prepared = await race.prepare(database);
      let queryCount = 0;
      const result = await getPublicEventBySlug(
        injectAfterQuery(database, async () => {
          queryCount += 1;
          if (queryCount === 1) prepared.mutate(database);
        }),
        {
          organizationId: ORGANIZATION_ID,
          slug: prepared.slug,
        },
      );
      assert.equal(
        result,
        null,
        "the final identity/version proof must suppress a row changed after the authoritative base read",
      );
      assert.ok(queryCount >= 2);
    });
  }
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

  const { results: organizerPlanRows } = await database
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT organizer_event.id
       FROM organizer_events AS organizer_event
       WHERE organizer_event.organization_id = ?
         AND organizer_event.planning_status IN (
           'confirmed',
           'cancelled',
           'completed'
         )
         AND organizer_event.publication_status = 'published'
         AND organizer_event.deleted_at IS NULL`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  const organizerPlan = organizerPlanRows
    .map((row) => row.detail)
    .join("\n");
  assert.match(organizerPlan, /organizer_events_org_status_idx/u);
});

function seedCurrentPublishedClubProjection(
  database,
  {
    clubId,
    description,
    featured,
    laneId,
    meetupGroupUrl,
    name,
    slug,
  },
) {
  const stateId = `state-${clubId}`;
  const revisionId = `revision-${clubId}`;
  const revisionHash =
    clubId === "club_vcc" ? "a".repeat(64) : "b".repeat(64);
  const snapshotJson = JSON.stringify({
    contentConfirmed: true,
    coverAssetId: null,
    description,
    featured,
    laneId,
    metaDescription: null,
    meetupGroupUrl,
    name,
    openGraphAssetId: null,
    preparation: null,
    programType: "club",
    relatedResourceIds: [],
    seoTitle: null,
    slug,
    socialUrls: [],
    summary: description,
    themeColor: null,
    thumbnailAssetId: null,
    typicalFormat: null,
    whatToExpect: null,
  });
  const projectionJson = JSON.stringify({
    club: { description, name, slug },
    details: {
      confirmedSocialLinks: [],
      coverAssetId: null,
      fullDescription: description,
      imageAltText: null,
      metaDescription: null,
      openGraphAssetId: null,
      participantExpectations: null,
      preparationInformation: null,
      programType: "club",
      publicDisplayName: name,
      relatedResources: [],
      seoTitle: null,
      shortSummary: description,
      themeColor: null,
      thumbnailAssetId: null,
      typicalFormat: null,
    },
    profile: {
      featured,
      laneId,
      meetupGroupUrl,
      summary: description,
    },
  });
  database
    .prepare(
      `UPDATE club_public_profiles
       SET description = ?
       WHERE organization_id = ?
         AND club_id = ?`,
    )
    .bind(description, ORGANIZATION_ID, clubId)
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO club_public_profile_details (
         club_id, organization_id, public_display_name, short_summary,
         full_description, program_type, cover_media_asset_id,
         thumbnail_media_asset_id, image_alt_text, theme_color,
         participant_expectations, preparation_information, typical_format,
         confirmed_social_links_json, related_resources_json, seo_title,
         meta_description, og_media_asset_id, updated_by_profile_id,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, 'club', NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, '[]', '[]', NULL, NULL, NULL,
         'profile_owner', 1, 1
       )`,
    )
    .bind(
      clubId,
      ORGANIZATION_ID,
      name,
      description,
      description,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_entity_publication_states (
         id, organization_id, entity_type, entity_key, workflow_status,
         content_version, published_revision_id, last_editor_profile_id,
         published_at, created_at, updated_at
       ) VALUES (
         ?, ?, 'club_public_profile', ?, 'published', 1, ?,
         'profile_owner', 1, 1, 1
       )`,
    )
    .bind(stateId, ORGANIZATION_ID, clubId, revisionId)
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_number, snapshot_json, content_hash, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'club_public_profile', ?, 1, ?, ?, ?,
         'profile_owner', 1
       )`,
    )
    .bind(
      revisionId,
      ORGANIZATION_ID,
      stateId,
      clubId,
      snapshotJson,
      revisionHash,
      Buffer.byteLength(snapshotJson),
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'club_public_profile', ?, ?, ?, ?, ?,
         'profile_owner', 1
       )`,
    )
    .bind(
      `receipt-${clubId}`,
      ORGANIZATION_ID,
      stateId,
      clubId,
      revisionId,
      revisionHash,
      projectionJson,
      Buffer.byteLength(projectionJson),
    )
    .runSynchronously();
}

function republishCurrentClubProjection(
  database,
  {
    clubId,
    description,
    featured,
    laneId,
    meetupGroupUrl,
    name,
    slug,
  },
) {
  const stateId = `state-${clubId}`;
  const revisionId = `revision-${clubId}-2`;
  const revisionHash = "d".repeat(64);
  const snapshotJson = JSON.stringify({
    contentConfirmed: true,
    coverAssetId: null,
    description,
    featured,
    laneId,
    metaDescription: null,
    meetupGroupUrl,
    name,
    openGraphAssetId: null,
    preparation: null,
    programType: "club",
    relatedResourceIds: [],
    seoTitle: null,
    slug,
    socialUrls: [],
    summary: description,
    themeColor: null,
    thumbnailAssetId: null,
    typicalFormat: null,
    whatToExpect: null,
  });
  const projectionJson = JSON.stringify({
    club: { description, name, slug },
    details: {
      confirmedSocialLinks: [],
      coverAssetId: null,
      fullDescription: description,
      imageAltText: null,
      metaDescription: null,
      openGraphAssetId: null,
      participantExpectations: null,
      preparationInformation: null,
      programType: "club",
      publicDisplayName: name,
      relatedResources: [],
      seoTitle: null,
      shortSummary: description,
      themeColor: null,
      thumbnailAssetId: null,
      typicalFormat: null,
    },
    profile: {
      featured,
      laneId,
      meetupGroupUrl,
      summary: description,
    },
  });
  database
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_number, snapshot_json, content_hash, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'club_public_profile', ?, 2, ?, ?, ?,
         'profile_owner', 2
       )`,
    )
    .bind(
      revisionId,
      ORGANIZATION_ID,
      stateId,
      clubId,
      snapshotJson,
      revisionHash,
      Buffer.byteLength(snapshotJson),
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'club_public_profile', ?, ?, ?, ?, ?,
         'profile_owner', 2
       )`,
    )
    .bind(
      `receipt-${clubId}-2`,
      ORGANIZATION_ID,
      stateId,
      clubId,
      revisionId,
      revisionHash,
      projectionJson,
      Buffer.byteLength(projectionJson),
    )
    .runSynchronously();
  database
    .prepare(
      `UPDATE clubs
       SET name = ?,
           slug = ?,
           description = ?,
           updated_at = 2
       WHERE organization_id = ?
         AND id = ?`,
    )
    .bind(name, slug, description, ORGANIZATION_ID, clubId)
    .runSynchronously();
  database
    .prepare(
      `UPDATE club_public_profiles
       SET primary_event_lane_id = ?,
           publication_status = 'published',
           is_featured = ?,
           public_group_url = ?,
           description = ?,
           published_at = 2,
           updated_at = 2
       WHERE organization_id = ?
         AND club_id = ?`,
    )
    .bind(
      laneId,
      featured ? 1 : 0,
      meetupGroupUrl,
      description,
      ORGANIZATION_ID,
      clubId,
    )
    .runSynchronously();
  database
    .prepare(
      `UPDATE club_public_profile_details
       SET public_display_name = ?,
           short_summary = ?,
           full_description = ?,
           program_type = 'club',
           cover_media_asset_id = NULL,
           thumbnail_media_asset_id = NULL,
           image_alt_text = NULL,
           theme_color = NULL,
           participant_expectations = NULL,
           preparation_information = NULL,
           typical_format = NULL,
           confirmed_social_links_json = '[]',
           related_resources_json = '[]',
           seo_title = NULL,
           meta_description = NULL,
           og_media_asset_id = NULL,
           updated_by_profile_id = 'profile_owner',
           updated_at = 2
       WHERE organization_id = ?
         AND club_id = ?`,
    )
    .bind(
      name,
      description,
      description,
      ORGANIZATION_ID,
      clubId,
    )
    .runSynchronously();
  database
    .prepare(
      `UPDATE cms_entity_publication_states
       SET workflow_status = 'published',
           content_version = 2,
           published_revision_id = ?,
           last_editor_profile_id = 'profile_owner',
           published_at = 2,
           updated_at = 2
       WHERE organization_id = ?
         AND id = ?
         AND entity_type = 'club_public_profile'
         AND entity_key = ?`,
    )
    .bind(revisionId, ORGANIZATION_ID, stateId, clubId)
    .runSynchronously();
}

function seedCurrentPublishedProgramProjection(
  database,
  {
    clubId,
    description,
    laneId,
    name,
    programId,
    slug,
  },
) {
  const stateId = `state-${programId}`;
  const revisionId = `revision-${programId}`;
  const revisionHash = "c".repeat(64);
  const snapshotJson = JSON.stringify({
    clubId,
    contentConfirmed: true,
    coverAssetId: null,
    description,
    displayOrder: 10,
    featured: false,
    laneId,
    meetupGroupUrl: null,
    metaDescription: null,
    name,
    openGraphAssetId: null,
    preparation: null,
    programType: "program",
    relatedResourceIds: [],
    seoTitle: null,
    slug,
    socialUrls: [],
    summary: description,
    themeColor: null,
    thumbnailAssetId: null,
    typicalFormat: null,
    whatToExpect: null,
  });
  const projectionJson = JSON.stringify({
    details: {
      clubId,
      confirmedSocialLinks: [],
      coverAssetId: null,
      displayOrder: 10,
      featured: false,
      fullDescription: description,
      laneId,
      meetupGroupUrl: null,
      metaDescription: null,
      name,
      openGraphAssetId: null,
      participantExpectations: null,
      preparationInformation: null,
      programType: "program",
      relatedResources: [],
      seoTitle: null,
      slug,
      summary: description,
      themeColor: null,
      thumbnailAssetId: null,
      typicalFormat: null,
    },
  });
  database.exec(`
    INSERT INTO programs (
      id, organization_id, club_id, name, slug, description,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      '${programId}', '${ORGANIZATION_ID}', '${clubId}',
      '${name}', '${slug}', '${description}', 'profile_owner', 1, 1
    );
  `);
  database
    .prepare(
      `INSERT INTO program_public_profile_details (
         program_id, organization_id, club_id, primary_event_lane_id,
         publication_status, public_display_name, public_slug,
         short_summary, full_description, program_type,
         public_group_url, cover_media_asset_id, thumbnail_media_asset_id,
         theme_color, participant_expectations, preparation_information,
         typical_format, is_featured, display_order,
         confirmed_social_links_json, related_resources_json,
         seo_title, meta_description, og_media_asset_id, published_at,
         updated_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (
         ?, ?, ?, ?, 'published', ?, ?, ?, ?, 'program',
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 10,
         '[]', '[]', NULL, NULL, NULL, 1, 'profile_owner', 1, 1, NULL
       )`,
    )
    .bind(
      programId,
      ORGANIZATION_ID,
      clubId,
      laneId,
      name,
      slug,
      description,
      description,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_entity_publication_states (
         id, organization_id, entity_type, entity_key, workflow_status,
         content_version, published_revision_id, last_editor_profile_id,
         published_at, created_at, updated_at
       ) VALUES (
         ?, ?, 'program_public_profile', ?, 'published', 1, ?,
         'profile_owner', 1, 1, 1
       )`,
    )
    .bind(stateId, ORGANIZATION_ID, programId, revisionId)
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_number, snapshot_json, content_hash, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'program_public_profile', ?, 1, ?, ?, ?,
         'profile_owner', 1
       )`,
    )
    .bind(
      revisionId,
      ORGANIZATION_ID,
      stateId,
      programId,
      snapshotJson,
      revisionHash,
      Buffer.byteLength(snapshotJson),
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'program_public_profile', ?, ?, ?, ?, ?,
         'profile_owner', 1
       )`,
    )
    .bind(
      `receipt-${programId}`,
      ORGANIZATION_ID,
      stateId,
      programId,
      revisionId,
      revisionHash,
      projectionJson,
      Buffer.byteLength(projectionJson),
    )
    .runSynchronously();
}

function republishCurrentProgramProjection(
  database,
  {
    clubId,
    description,
    laneId,
    name,
    programId,
    slug,
  },
) {
  const stateId = `state-${programId}`;
  const revisionId = `revision-${programId}-2`;
  const revisionHash = "e".repeat(64);
  const snapshotJson = JSON.stringify({
    clubId,
    contentConfirmed: true,
    coverAssetId: null,
    description,
    displayOrder: 10,
    featured: false,
    laneId,
    meetupGroupUrl: null,
    metaDescription: null,
    name,
    openGraphAssetId: null,
    preparation: null,
    programType: "program",
    relatedResourceIds: [],
    seoTitle: null,
    slug,
    socialUrls: [],
    summary: description,
    themeColor: null,
    thumbnailAssetId: null,
    typicalFormat: null,
    whatToExpect: null,
  });
  const projectionJson = JSON.stringify({
    details: {
      clubId,
      confirmedSocialLinks: [],
      coverAssetId: null,
      displayOrder: 10,
      featured: false,
      fullDescription: description,
      laneId,
      meetupGroupUrl: null,
      metaDescription: null,
      name,
      openGraphAssetId: null,
      participantExpectations: null,
      preparationInformation: null,
      programType: "program",
      relatedResources: [],
      seoTitle: null,
      slug,
      summary: description,
      themeColor: null,
      thumbnailAssetId: null,
      typicalFormat: null,
    },
  });
  database
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_number, snapshot_json, content_hash, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'program_public_profile', ?, 2, ?, ?, ?,
         'profile_owner', 2
       )`,
    )
    .bind(
      revisionId,
      ORGANIZATION_ID,
      stateId,
      programId,
      snapshotJson,
      revisionHash,
      Buffer.byteLength(snapshotJson),
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_public_materialization_receipts (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_id, revision_hash, projection_json, canonical_byte_size,
         actor_profile_id, created_at
       ) VALUES (
         ?, ?, ?, 'program_public_profile', ?, ?, ?, ?, ?,
         'profile_owner', 2
       )`,
    )
    .bind(
      `receipt-${programId}-2`,
      ORGANIZATION_ID,
      stateId,
      programId,
      revisionId,
      revisionHash,
      projectionJson,
      Buffer.byteLength(projectionJson),
    )
    .runSynchronously();
  database
    .prepare(
      `UPDATE programs
       SET club_id = ?,
           name = ?,
           slug = ?,
           description = ?,
           updated_at = 2
       WHERE organization_id = ?
         AND id = ?`,
    )
    .bind(
      clubId,
      name,
      slug,
      description,
      ORGANIZATION_ID,
      programId,
    )
    .runSynchronously();
  database
    .prepare(
      `UPDATE program_public_profile_details
       SET club_id = ?,
           primary_event_lane_id = ?,
           publication_status = 'published',
           public_display_name = ?,
           public_slug = ?,
           short_summary = ?,
           full_description = ?,
           program_type = 'program',
           public_group_url = NULL,
           cover_media_asset_id = NULL,
           thumbnail_media_asset_id = NULL,
           theme_color = NULL,
           participant_expectations = NULL,
           preparation_information = NULL,
           typical_format = NULL,
           is_featured = 0,
           display_order = 10,
           confirmed_social_links_json = '[]',
           related_resources_json = '[]',
           seo_title = NULL,
           meta_description = NULL,
           og_media_asset_id = NULL,
           published_at = 2,
           updated_by_profile_id = 'profile_owner',
           updated_at = 2,
           deleted_at = NULL
       WHERE organization_id = ?
         AND program_id = ?`,
    )
    .bind(
      clubId,
      laneId,
      name,
      slug,
      description,
      description,
      ORGANIZATION_ID,
      programId,
    )
    .runSynchronously();
  database
    .prepare(
      `UPDATE cms_entity_publication_states
       SET workflow_status = 'published',
           content_version = 2,
           published_revision_id = ?,
           last_editor_profile_id = 'profile_owner',
           published_at = 2,
           updated_at = 2
       WHERE organization_id = ?
         AND id = ?
         AND entity_type = 'program_public_profile'
         AND entity_key = ?`,
    )
    .bind(revisionId, ORGANIZATION_ID, stateId, programId)
    .runSynchronously();
}

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

function insertPublicExportCapacityEvents(database, count) {
  const statement = database.sqlite.prepare(
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
       ?, ?, 'club_vcc', NULL, NULL, NULL, NULL, ?, ?, NULL, NULL,
       'confirmed', 'public', 'timed', ?, ?, 'America/Vancouver',
       NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL,
       'PRIVATE_EVENT_NOTE_SENTINEL', 'PRIVATE_MEETING_SENTINEL', 1,
       'profile_owner', 'profile_owner', 1, 1, NULL
     )`,
  );
  database.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < count; index += 1) {
      const suffix = String(index + 1).padStart(4, "0");
      statement.run(
        `event_capacity_${suffix}`,
        ORGANIZATION_ID,
        `Capacity boundary ${suffix}`,
        `capacity-boundary-${suffix}`,
        Date.parse("2026-09-01T20:00:00.000Z"),
        Date.parse("2026-09-01T22:00:00.000Z"),
      );
    }
    database.sqlite.exec("COMMIT");
  } catch (error) {
    database.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function publicCalendarRevision(database) {
  const row = database.sqlite
    .prepare(
      `SELECT sequence, last_modified_at
       FROM event_calendar_component_revisions
       WHERE organization_id = ?
         AND scope = 'public'
         AND event_key = 'legacy:event_manual_upcoming'`,
    )
    .get(ORGANIZATION_ID);
  assert.ok(row);
  return {
    lastModifiedAt: row.last_modified_at,
    sequence: row.sequence,
  };
}

function assertCalendarRevisionStep(previous, current) {
  assert.equal(current.sequence, previous.sequence + 1);
  assert.equal(current.lastModifiedAt, previous.lastModifiedAt + 1_000);
}

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}

function nonblankLines(value) {
  return value.split(/\r\n|\n/gu).filter(Boolean);
}

async function insertOrganizerPublicEvent(
  database,
  {
    confirmedMeetupEventUrl = null,
    deletedAt = null,
    endsAtUtcMs = Date.parse("2026-09-10T04:00:00.000Z"),
    id,
    meetupEventUrl = null,
    planningStatus = "confirmed",
    publicHostsEnabled = false,
    publicationStatus = "published",
    rsvpMode = "coming_soon",
    slug,
    startsAtUtcMs = Date.parse("2026-09-10T02:00:00.000Z"),
    title,
  },
) {
  await database
    .prepare(
      `INSERT INTO organizer_events (
         id, organization_id, club_id, program_id, event_lane_id, category_id,
         venue_id, primary_organizer_profile_id, title, slug, summary,
         description, private_notes, private_meeting_details, meetup_event_url,
         planning_status, publication_status, schedule_shape, starts_at_utc,
         ends_at_utc, timezone, all_day_start_date,
         all_day_end_date_exclusive, buffer_before_minutes,
         buffer_after_minutes, content_version, schedule_version,
         created_by_profile_id, updated_by_profile_id, created_at, updated_at,
         deleted_at
       ) VALUES (
         ?, ?, 'club_vcc', NULL, 'lane_think', 'category_ideas', NULL,
         'profile_public_host', ?, ?,
         'A complete public organizer summary.',
         'A complete public organizer description.',
         'ORGANIZER_PRIVATE_NOTES_SENTINEL',
         'ORGANIZER_PRIVATE_MEETING_SENTINEL', ?, ?, ?, 'timed', ?, ?,
         'America/Vancouver', NULL, NULL, 0, 0, 1, 1, 'profile_owner',
         'profile_owner', 10, 10, ?
       )`,
    )
    .bind(
      id,
      ORGANIZATION_ID,
      title,
      slug,
      meetupEventUrl,
      planningStatus,
      publicationStatus,
      startsAtUtcMs,
      endsAtUtcMs,
      deletedAt,
    )
    .run();

  const confirmedBy =
    rsvpMode === "meetup" ? "profile_owner" : null;
  const confirmedAt = rsvpMode === "meetup" ? 10 : null;
  await database
    .prepare(
      `INSERT INTO organizer_event_public_details (
         organizer_event_id, organization_id, attendance_mode,
         public_location_name, public_address, public_access_note,
         public_online_url, external_map_url, cost_text, capacity,
         availability_state, preparation_information, what_to_bring,
         arrival_instructions, weather_note, verified_accessibility_notes,
         public_hosts_enabled, rsvp_mode, confirmed_meetup_event_url,
         meetup_url_confirmed_by_profile_id, meetup_url_confirmed_at,
         created_by_profile_id, updated_by_profile_id, created_at, updated_at
       ) VALUES (
         ?, ?, 'hybrid', 'Approved Public Room',
         '100 Approved Public Street', 'Use the public east entrance.',
         'https://events.synthetic.invalid/join',
         'https://maps.synthetic.invalid/approved-room',
         'Pay what you can.', 42, 'waitlist', 'Read the public handout.',
         'A notebook.', 'Arrive ten minutes early.',
         'The courtyard portion is weather dependent.',
         'Step-free public entrance confirmed.', ?, ?, ?, ?, ?,
         'profile_owner', 'profile_owner', 10, 10
       )`,
    )
    .bind(
      id,
      ORGANIZATION_ID,
      publicHostsEnabled ? 1 : 0,
      rsvpMode,
      confirmedMeetupEventUrl,
      confirmedBy,
      confirmedAt,
    )
    .run();

  const wasPublished = publicationStatus === "published";
  const wasCancelled = wasPublished && planningStatus === "cancelled";
  await database
    .prepare(
      `INSERT INTO organizer_event_publication_state (
         organizer_event_id, organization_id, first_published_at,
         most_recent_published_at, most_recent_unpublished_at,
         public_cancellation_at, last_mutation_actor_profile_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, 'profile_owner', 10, 10)`,
    )
    .bind(
      id,
      ORGANIZATION_ID,
      wasPublished ? 10 : null,
      wasPublished ? 10 : null,
      wasCancelled ? 10 : null,
    )
    .run();
}

async function insertSnapshot(
  database,
  {
    endsAt,
    eventId,
    eventNumber,
    eventUrl = null,
    eventSlug,
    externalId,
    generationId,
    id,
    ordinal,
    posterAltText = null,
    posterCredit = null,
    posterSourceUrl = null,
    sourceId = "source_synthetic",
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
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, 'timed', ?, ?, 'America/Vancouver', NULL, NULL,
         ?, 1, ?, ?, ?
       )`,
    )
    .bind(
      id,
      ORGANIZATION_ID,
      sourceId,
      generationId,
      externalId,
      eventId,
      ordinal,
      eventSlug,
      title,
      eventUrl ??
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

  if (
    posterSourceUrl !== null ||
    posterAltText !== null ||
    posterCredit !== null
  ) {
    const descriptionBlocksJson = JSON.stringify([
      {
        content: [{ text: title, type: "text" }],
        type: "paragraph",
      },
    ]);
    await database
      .prepare(
        `INSERT INTO meetup_event_snapshot_public_contents (
           snapshot_id, public_summary, public_description,
           public_description_blocks_json, poster_source_url,
           poster_alt_text, poster_credit, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        title,
        title,
        descriptionBlocksJson,
        posterSourceUrl,
        posterAltText,
        posterCredit,
        updatedAt,
        updatedAt,
      )
      .run();
  }
}

function countAllQueries(database, onAll) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            async all() {
              onAll();
              return bound.all();
            },
          };
        },
      };
    },
  };
}

function injectAfterQuery(database, afterQuery) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            async all() {
              const result = await bound.all();
              await afterQuery();
              return result;
            },
            async first() {
              const result = await bound.first();
              await afterQuery();
              return result;
            },
          };
        },
      };
    },
  };
}

function injectBeforeMatchingQuery(
  database,
  sqlNeedle,
  matchingQueryNumber,
  beforeQuery,
  onMatchingQuery = () => {},
) {
  let matchingQueries = 0;
  return {
    batch(statements) {
      return database.batch(statements);
    },
    prepare(sql) {
      const statement = database.prepare(sql);
      if (!sql.includes(sqlNeedle)) return statement;
      return {
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            async all() {
              matchingQueries += 1;
              onMatchingQuery();
              if (matchingQueries === matchingQueryNumber) {
                await beforeQuery();
              }
              return bound.all();
            },
            async first() {
              matchingQueries += 1;
              onMatchingQuery();
              if (matchingQueries === matchingQueryNumber) {
                await beforeQuery();
              }
              return bound.first();
            },
          };
        },
      };
    },
  };
}
