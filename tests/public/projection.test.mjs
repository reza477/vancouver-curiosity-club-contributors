import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_EVENT_SELECT_SQL,
  listUpcomingPublicEvents,
  toPublicEventDto,
} from "../../lib/server/public/events.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const PUBLIC_SCHEMA = `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    color_token TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE venues (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    timezone TEXT,
    public_location_name TEXT,
    public_address TEXT,
    private_address TEXT,
    private_directions TEXT,
    accessibility_notes TEXT,
    is_public INTEGER NOT NULL,
    created_by_profile_id TEXT,
    updated_by_profile_id TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    siwc_subject TEXT,
    normalized_email TEXT NOT NULL,
    display_name TEXT,
    public_attribution_consent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    category_id TEXT,
    venue_id TEXT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    summary TEXT,
    description TEXT,
    status TEXT NOT NULL,
    visibility TEXT NOT NULL,
    time_kind TEXT NOT NULL,
    starts_at_utc INTEGER,
    ends_at_utc INTEGER,
    timezone TEXT,
    all_day_start_date TEXT,
    all_day_end_date_exclusive TEXT,
    private_notes TEXT,
    private_meeting_details TEXT,
    conflict_override_reason TEXT,
    schedule_review_state TEXT,
    published_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
  );
  CREATE TABLE event_organizers (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    role TEXT NOT NULL,
    is_publicly_listed INTEGER NOT NULL,
    created_by_profile_id TEXT,
    created_at INTEGER,
    deleted_at INTEGER
  );
`;

function createPublicDatabase() {
  const database = new SqliteD1TestDatabase(PUBLIC_SCHEMA);
  database.exec(`
    INSERT INTO categories (
      id, organization_id, name, slug, color_token
    ) VALUES ('category_ideas', 'org_vcc', 'Big Ideas', 'big-ideas', 'cobalt');

    INSERT INTO venues (
      id, organization_id, name, slug, public_location_name, public_address,
      private_address, private_directions, is_public
    ) VALUES (
      'venue_public', 'org_vcc', 'Internal venue record', 'reading-room',
      'The Reading Room', '123 Public Street', 'Unit 999, Private',
      'Use the private door code 1234', 1
    );

    INSERT INTO profiles (
      id, normalized_email, display_name, public_attribution_consent, status
    ) VALUES
      ('profile_public', 'ada@example.com', 'Ada', 1, 'active'),
      ('profile_email_name', 'email@example.com', 'email@example.com', 1,
       'active'),
      ('profile_private', 'private@example.com', 'Private Person', 1, 'active'),
      ('profile_no_consent', 'no-consent@example.com', 'No Consent', 0,
       'active');

    INSERT INTO events (
      id, organization_id, category_id, venue_id, title, slug, summary,
      description, status, visibility, time_kind, starts_at_utc, ends_at_utc,
      timezone, private_notes, private_meeting_details,
      conflict_override_reason, schedule_review_state, published_at
    ) VALUES
      (
        'event_public', 'org_vcc', 'category_ideas', 'venue_public',
        'Ideas After Dark', 'ideas-after-dark', 'A thoughtful evening.',
        'A public conversation about how cities learn.', 'confirmed', 'public',
        'timed', 1784869200000, 1784876400000, 'America/Vancouver',
        'PRIVATE_NOTE_SENTINEL', 'PRIVATE_MEETING_SENTINEL',
        'PRIVATE_OVERRIDE_SENTINEL', 'overridden', 100
      ),
      (
        'event_draft', 'org_vcc', NULL, NULL, 'Draft Sentinel',
        'draft-sentinel', NULL, NULL, 'draft', 'public', 'timed',
        1784869200000, 1784876400000, 'America/Vancouver', NULL, NULL, NULL,
        'unreviewed', 100
      ),
      (
        'event_hold', 'org_vcc', NULL, NULL, 'Hold Sentinel', 'hold-sentinel',
        NULL, NULL, 'hold', 'public', 'timed', 1784869200000, 1784876400000,
        'America/Vancouver', NULL, NULL, NULL, 'unreviewed', 100
      ),
      (
        'event_private', 'org_vcc', NULL, NULL, 'Private Sentinel',
        'private-sentinel', NULL, NULL, 'confirmed', 'private', 'timed',
        1784869200000, 1784876400000, 'America/Vancouver', NULL, NULL, NULL,
        'unreviewed', 100
      ),
      (
        'event_unpublished', 'org_vcc', NULL, NULL, 'Unpublished Sentinel',
        'unpublished-sentinel', NULL, NULL, 'confirmed', 'public', 'timed',
        1784869200000, 1784876400000, 'America/Vancouver', NULL, NULL, NULL,
        'unreviewed', NULL
      ),
      (
        'event_all_day', 'org_vcc', NULL, NULL, 'Reading Weekend',
        'reading-weekend', NULL, NULL, 'confirmed', 'public', 'all_day',
        NULL, NULL, 'America/Vancouver', NULL, NULL, NULL, 'unreviewed', 100
      );

    UPDATE events
    SET all_day_start_date = '2026-08-01',
        all_day_end_date_exclusive = '2026-08-03'
    WHERE id = 'event_all_day';

    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role, is_publicly_listed
    ) VALUES
      ('eo_public', 'org_vcc', 'event_public', 'profile_public', 'primary', 1),
      ('eo_email', 'org_vcc', 'event_public', 'profile_email_name',
       'co_organizer', 1),
      ('eo_private', 'org_vcc', 'event_public', 'profile_private',
       'co_organizer', 0),
      ('eo_no_consent', 'org_vcc', 'event_public', 'profile_no_consent',
       'co_organizer', 1);
  `);
  return database;
}

test("uses an explicit public SQL allowlist and publication filters", () => {
  assert.doesNotMatch(PUBLIC_EVENT_SELECT_SQL, /\bevent\.\*/iu);
  assert.match(PUBLIC_EVENT_SELECT_SQL, /event\.status = 'confirmed'/u);
  assert.match(PUBLIC_EVENT_SELECT_SQL, /event\.visibility = 'public'/u);
  assert.match(PUBLIC_EVENT_SELECT_SQL, /event\.published_at IS NOT NULL/u);
  assert.match(PUBLIC_EVENT_SELECT_SQL, /event\.deleted_at IS NULL/u);
  assert.match(
    PUBLIC_EVENT_SELECT_SQL,
    /profile\.public_attribution_consent = 1/u,
  );

  for (const forbiddenColumn of [
    "private_notes",
    "private_meeting_details",
    "conflict_override_reason",
    "token_hash",
    "normalized_email AS",
  ]) {
    assert.equal(
      PUBLIC_EVENT_SELECT_SQL.toLowerCase().includes(
        forbiddenColumn.toLowerCase(),
      ),
      false,
    );
  }
});

test("returns only published confirmed public records and no private fields", async (t) => {
  const database = createPublicDatabase();
  t.after(() => database.close());

  const events = await listUpcomingPublicEvents(database, {
    organizationId: "org_vcc",
    fromUtcMs: 1,
    todayDate: "2026-07-01",
  });
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.slug).sort(),
    ["ideas-after-dark", "reading-weekend"],
  );

  const timed = events.find((event) => event.slug === "ideas-after-dark");
  assert.deepEqual(timed.organizers, [{ displayName: "Ada" }]);
  assert.deepEqual(timed.venue, {
    name: "The Reading Room",
    address: "123 Public Street",
  });
  assert.deepEqual(timed.category, {
    name: "Big Ideas",
    slug: "big-ideas",
    colorToken: "cobalt",
  });
  assert.equal(timed.schedule.kind, "timed");

  const allDay = events.find((event) => event.slug === "reading-weekend");
  assert.deepEqual(allDay.schedule, {
    kind: "all_day",
    startDate: "2026-08-01",
    endDateExclusive: "2026-08-03",
  });

  const serialized = JSON.stringify(events);
  for (const sentinel of [
    "PRIVATE_NOTE_SENTINEL",
    "PRIVATE_MEETING_SENTINEL",
    "PRIVATE_OVERRIDE_SENTINEL",
    "Unit 999",
    "door code",
    "ada@example.com",
    "email@example.com",
    "Private Person",
    "No Consent",
    "Draft Sentinel",
    "Hold Sentinel",
    "Private Sentinel",
    "Unpublished Sentinel",
  ]) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
  for (const forbiddenKey of [
    "id",
    "status",
    "visibility",
    "privateNotes",
    "conflicts",
    "invitations",
    "auditLogs",
    "normalizedEmail",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(timed, forbiddenKey),
      false,
      forbiddenKey,
    );
  }
});

test("organizer attribution requires both profile consent and per-event listing", async (t) => {
  const database = createPublicDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO profiles (
      id, normalized_email, display_name, public_attribution_consent, status
    ) VALUES
      ('matrix_yes_yes', 'yes-yes@example.com', 'Consent yes, listing yes', 1,
       'active'),
      ('matrix_yes_no', 'yes-no@example.com', 'Consent yes, listing no', 1,
       'active'),
      ('matrix_no_yes', 'no-yes@example.com', 'Consent no, listing yes', 0,
       'active'),
      ('matrix_no_no', 'no-no@example.com', 'Consent no, listing no', 0,
       'active');

    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role, is_publicly_listed
    ) VALUES
      ('matrix_eo_yes_yes', 'org_vcc', 'event_public', 'matrix_yes_yes',
       'co_organizer', 1),
      ('matrix_eo_yes_no', 'org_vcc', 'event_public', 'matrix_yes_no',
       'co_organizer', 0),
      ('matrix_eo_no_yes', 'org_vcc', 'event_public', 'matrix_no_yes',
       'co_organizer', 1),
      ('matrix_eo_no_no', 'org_vcc', 'event_public', 'matrix_no_no',
       'co_organizer', 0);
  `);

  const events = await listUpcomingPublicEvents(database, {
    organizationId: "org_vcc",
    fromUtcMs: 1,
    todayDate: "2026-07-01",
  });
  const timed = events.find((event) => event.slug === "ideas-after-dark");
  const publicNames = new Set(
    timed.organizers.map((organizer) => organizer.displayName),
  );
  const matrix = [
    {
      consent: true,
      listed: true,
      name: "Consent yes, listing yes",
    },
    {
      consent: true,
      listed: false,
      name: "Consent yes, listing no",
    },
    {
      consent: false,
      listed: true,
      name: "Consent no, listing yes",
    },
    {
      consent: false,
      listed: false,
      name: "Consent no, listing no",
    },
  ];

  for (const combination of matrix) {
    assert.equal(
      publicNames.has(combination.name),
      combination.consent && combination.listed,
      `consent=${combination.consent}, listed=${combination.listed}`,
    );
  }
});

test("the DTO mapper ignores malicious extra private properties", () => {
  const dto = toPublicEventDto({
    slug: "safe-event",
    title: "Safe event",
    summary: null,
    description: null,
    time_kind: "timed",
    starts_at_utc: 1_000,
    ends_at_utc: 2_000,
    timezone: "America/Vancouver",
    all_day_start_date: null,
    all_day_end_date_exclusive: null,
    category_slug: null,
    category_name: null,
    category_color_token: null,
    venue_public_name: null,
    venue_public_address: null,
    organizer_names_json: "[]",
    private_notes: "LEAK_ME",
    invitations: [{ token_hash: "LEAK_ME" }],
    audit_logs: [{ actor_email: "LEAK_ME@example.com" }],
    conflict_override_reason: "LEAK_ME",
    organizer_email: "LEAK_ME@example.com",
    account_id: "LEAK_ME",
  });

  assert.equal(JSON.stringify(dto).includes("LEAK_ME"), false);
});
