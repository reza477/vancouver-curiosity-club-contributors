import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { trustedIdentityFromSites } from "../../lib/server/auth/index.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import { ensurePublicCatalog } from "../../lib/server/public/catalog.ts";
import {
  LEGACY_PUBLIC_EVENT_ORGANIZER_ENRICHMENT_SQL,
  PUBLIC_EVENT_IDENTITY_CTE_SQL,
  PUBLIC_EVENT_SELECTION_PROOF_CTE_SQL,
  PUBLIC_EVENT_SELECT_SQL,
  PUBLIC_MEETUP_EVENT_SELECT_SQL,
  PUBLIC_MEETUP_PUBLICATION_WINDOW_SQL,
  UNIFIED_PUBLIC_EVENT_CTE_SQL,
  listUpcomingPublicEvents,
  toPublicEventDto,
} from "../../lib/server/public/events.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const OWNER_IDENTITY = trustedIdentityFromSites({
  displayName: "Projection owner",
  email: "projection-owner@example.com",
});
const OWNER_ACTOR = Object.freeze({
  membershipId: "membership_owner",
  organizationId: "org_vcc",
  profileId: "profile_owner",
  role: "owner",
});

function loadGeneratedMigrations() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(process.cwd(), "drizzle", name), "utf8"))
    .join("\n");
}

function seedConfirmedPublicAttribution(
  database,
  { displayName, profileId },
) {
  const intentId = `intent_${profileId}`;
  const receiptId = `receipt_${profileId}`;
  const snapshotJson = JSON.stringify({
    biography: null,
    consent: true,
    displayName,
    draftVersion: 1,
    legacyAdopted: false,
    photoAssetId: null,
  });
  const snapshotHash = createHash("sha256")
    .update(snapshotJson)
    .digest("hex");
  database
    .prepare(
      `INSERT INTO organization_memberships (
         id, organization_id, profile_id, normalized_email, role, status,
         created_by_profile_id, created_at, updated_at
       ) VALUES (?, 'org_vcc', ?, ?, 'organizer', 'active',
                 'profile_owner', 1, 1)`,
    )
    .bind(
      `membership_${profileId}`,
      profileId,
      `${profileId}@example.com`,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO organizer_public_attribution_states (
         profile_id, organization_id, attribution_version,
         published_attribution_version, workflow_status,
         draft_photo_media_asset_id, public_display_name,
         public_biography, public_photo_media_asset_id,
         current_receipt_id, confirmed_at, revoked_at,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (?, 'org_vcc', 1, 0, 'unconfirmed', NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL, ?, 1, 1)`,
    )
    .bind(profileId, profileId)
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO organizer_public_attribution_write_intents (
         id, organization_id, profile_id, operation,
         expected_draft_version, expected_published_version,
         proposed_published_version, snapshot_hash,
         actor_profile_id, created_at, completed_at
       ) VALUES (?, 'org_vcc', ?, 'confirmed', 1, 0, 1, ?, ?, 1, 1)`,
    )
    .bind(intentId, profileId, snapshotHash, profileId)
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO organizer_public_attribution_receipts (
         id, organization_id, profile_id, action,
         attribution_version, display_name, biography,
         photo_media_asset_id, consent, draft_version,
         legacy_adopted, prior_published_version,
         snapshot_json, snapshot_hash, actor_profile_id,
         write_intent_id, related_receipt_id, created_at
       ) VALUES (
         ?, 'org_vcc', ?, 'confirmed', 1, ?, NULL, NULL, 1, 1, 0, NULL,
         ?, ?, ?, ?, NULL, 1
       )`,
    )
    .bind(
      receiptId,
      profileId,
      displayName,
      snapshotJson,
      snapshotHash,
      profileId,
      intentId,
    )
    .runSynchronously();
  database
    .prepare(
      `UPDATE organizer_public_attribution_states
       SET published_attribution_version = 1,
           workflow_status = 'confirmed',
           public_display_name = ?,
           current_receipt_id = ?,
           confirmed_at = 1
       WHERE profile_id = ?
         AND organization_id = 'org_vcc'`,
    )
    .bind(displayName, receiptId, profileId)
    .runSynchronously();
}

async function createPublicDatabase() {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES
      ('profile_owner', 'email:projection-owner@example.com',
       'projection-owner@example.com', 'Projection owner', 0, 'active', 1, 1),
      ('profile_public', 'email:ada@example.com', 'ada@example.com', 'Ada', 1,
       'active', 1, 1),
      ('profile_email_name', 'email:email@example.com', 'email@example.com',
       'email@example.com', 1, 'active', 1, 1),
      ('profile_private', 'email:private@example.com', 'private@example.com',
       'Private Person', 1, 'active', 1, 1),
      ('profile_no_consent', 'email:no-consent@example.com',
       'no-consent@example.com', 'No Consent', 0, 'active', 1, 1);

    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'org_vcc', 'Projection organization', 'vancouver-curiosity-club',
      'America/Vancouver', 1, 'profile_owner', 'profile_owner', 1, 1
    );

    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_owner', 'org_vcc', 'profile_owner',
      'projection-owner@example.com', 'owner', 'active', 'profile_owner', 1, 1
    );
  `);
  await ensurePublicCatalog(database, OWNER_IDENTITY, 2);
  await ensureCmsAdoption(database, OWNER_ACTOR, 3);
  const clubId = await database
    .prepare(
      `SELECT id
       FROM clubs
       WHERE organization_id = 'org_vcc'
         AND slug = 'vancouver-curiosity-club'
         AND deleted_at IS NULL`,
    )
    .first("id");
  assert.equal(typeof clubId, "string");

  database.exec(`
    INSERT INTO categories (
      id, organization_id, name, slug, description, color_token,
      created_at, updated_at
    ) VALUES (
      'category_ideas', 'org_vcc', 'Big Ideas', 'big-ideas',
      'A public category.', 'cobalt', 4, 4
    );

    INSERT INTO venues (
      id, organization_id, name, slug, timezone, public_location_name,
      public_address, private_address, private_directions, is_public,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'venue_public', 'org_vcc', 'Internal venue record', 'reading-room',
      'America/Vancouver', 'The Reading Room', '123 Public Street',
      'Unit 999, Private', 'Use the private door code 1234', 1,
      'profile_owner', 'profile_owner', 4, 4
    );

    INSERT INTO events (
      id, organization_id, club_id, category_id, venue_id,
      primary_organizer_profile_id, title, slug, summary, description,
      status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
      all_day_start_date, all_day_end_date_exclusive,
      buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
      schedule_version, schedule_review_state, hold_expires_at,
      private_notes, private_meeting_details, published_at,
      created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES
      (
        'event_public', 'org_vcc', '${clubId}', 'category_ideas',
        'venue_public', NULL, 'Ideas After Dark', 'ideas-after-dark',
        'A thoughtful evening.',
        'A public conversation about how cities learn.', 'confirmed', 'public',
        'timed', 1784869200000, 1784876400000, 'America/Vancouver', NULL, NULL,
        0, 0, '[]', 1, 'overridden', NULL, 'PRIVATE_NOTE_SENTINEL',
        'PRIVATE_MEETING_SENTINEL', 100,
        'profile_owner', 'profile_owner', 4, 4
      ),
      (
        'event_draft', 'org_vcc', '${clubId}', NULL, NULL, NULL,
        'Draft Sentinel', 'draft-sentinel', NULL, NULL, 'draft', 'public',
        'timed', 1784869200000, 1784876400000, 'America/Vancouver', NULL, NULL,
        0, 0, '[]', 1, 'unreviewed', NULL, NULL, NULL, 100,
        'profile_owner', 'profile_owner', 4, 4
      ),
      (
        'event_hold', 'org_vcc', '${clubId}', NULL, NULL, NULL,
        'Hold Sentinel', 'hold-sentinel', NULL, NULL, 'hold', 'public', 'timed',
        1784869200000, 1784876400000, 'America/Vancouver', NULL, NULL, 0, 0,
        '[]', 1, 'unreviewed', 1784876400001, NULL, NULL, 100,
        'profile_owner', 'profile_owner', 4, 4
      ),
      (
        'event_private', 'org_vcc', '${clubId}', NULL, NULL, NULL,
        'Private Sentinel', 'private-sentinel', NULL, NULL, 'confirmed',
        'private', 'timed', 1784869200000, 1784876400000,
        'America/Vancouver', NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL,
        NULL, NULL, 100, 'profile_owner', 'profile_owner', 4, 4
      ),
      (
        'event_unpublished', 'org_vcc', '${clubId}', NULL, NULL, NULL,
        'Unpublished Sentinel', 'unpublished-sentinel', NULL, NULL, 'confirmed',
        'public', 'timed', 1784869200000, 1784876400000,
        'America/Vancouver', NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL,
        NULL, NULL, NULL, 'profile_owner', 'profile_owner', 4, 4
      ),
      (
        'event_all_day', 'org_vcc', '${clubId}', NULL, NULL, NULL,
        'Reading Weekend', 'reading-weekend', NULL, NULL, 'confirmed', 'public',
        'all_day', NULL, NULL, 'America/Vancouver', '2026-08-01', '2026-08-03',
        0, 0, '[]', 1, 'unreviewed', NULL, NULL, NULL, 100,
        'profile_owner', 'profile_owner', 4, 4
      ),
      (
        'event_meetup', 'org_vcc', '${clubId}', NULL, NULL, NULL,
        'Staged Meetup Sentinel', 'staged-meetup-sentinel', NULL, NULL,
        'confirmed', 'public', 'timed', 1784869200000, 1784876400000,
        'America/Vancouver', NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL,
        NULL, NULL, NULL, 'profile_owner', 'profile_owner', 4, 4
      );

    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role, is_publicly_listed,
      created_by_profile_id, created_at
    ) VALUES
      ('eo_public', 'org_vcc', 'event_public', 'profile_public', 'primary', 1,
       'profile_owner', 4),
      ('eo_email', 'org_vcc', 'event_public', 'profile_email_name',
       'co_organizer', 1, 'profile_owner', 4),
      ('eo_private', 'org_vcc', 'event_public', 'profile_private',
       'co_organizer', 0, 'profile_owner', 4),
      ('eo_no_consent', 'org_vcc', 'event_public', 'profile_no_consent',
       'co_organizer', 1, 'profile_owner', 4);

  `);
  seedConfirmedPublicAttribution(database, {
    displayName: "Ada",
    profileId: "profile_public",
  });
  database.exec("UPDATE events SET updated_at = COALESCE(updated_at, 0);");
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
    /meetup_source_link\.source_type = 'meetup_ics'/u,
  );
  assert.doesNotMatch(
    PUBLIC_EVENT_SELECT_SQL,
    /meetup_source_link\.deleted_at/u,
    "soft-deleting a source link must not make imported canonical fields manual",
  );
  assert.match(
    LEGACY_PUBLIC_EVENT_ORGANIZER_ENRICHMENT_SQL,
    /profile\.public_attribution_consent = 1/u,
  );
  assert.doesNotMatch(
    `${PUBLIC_EVENT_SELECT_SQL}\n${UNIFIED_PUBLIC_EVENT_CTE_SQL}`,
    /organizer_profile_(?:drafts|preferences)/u,
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

test("applies the September Meetup publication horizon to every public source projection", () => {
  assert.match(
    PUBLIC_MEETUP_PUBLICATION_WINDOW_SQL,
    /snapshot\.timezone = 'America\/Vancouver'/u,
  );
  for (const groupSlug of [
    "vancouver-meetup-group",
    "vancouver-fantasy-scifi-meetup-group",
    "vancouver-literature-and-film",
  ]) {
    assert.match(
      PUBLIC_MEETUP_PUBLICATION_WINDOW_SQL,
      new RegExp(`${groupSlug}/events/\\*`, "u"),
    );
  }
  assert.match(
    PUBLIC_MEETUP_PUBLICATION_WINDOW_SQL,
    /snapshot\.starts_at_utc < 1790838000000/u,
  );
  assert.match(
    PUBLIC_MEETUP_PUBLICATION_WINDOW_SQL,
    /generation\.published_at < 1787702400000/u,
  );
  assert.match(
    PUBLIC_MEETUP_PUBLICATION_WINDOW_SQL,
    /snapshot\.all_day_start_date < '2026-10-01'/u,
  );

  for (const sql of [
    PUBLIC_MEETUP_EVENT_SELECT_SQL,
    PUBLIC_EVENT_IDENTITY_CTE_SQL,
    PUBLIC_EVENT_SELECTION_PROOF_CTE_SQL,
    UNIFIED_PUBLIC_EVENT_CTE_SQL,
  ]) {
    assert.equal(
      sql
        .replace(/\s+/gu, " ")
        .includes(PUBLIC_MEETUP_PUBLICATION_WINDOW_SQL.replace(/\s+/gu, " ").trim()),
      true,
      "every Meetup-backed public projection must use the same cutoff",
    );
  }
});

test("returns only published confirmed public records and no private fields", async (t) => {
  const database = await createPublicDatabase();
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
  const database = await createPublicDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status, created_at, updated_at
    ) VALUES
      (
        'matrix_yes_yes', 'email:yes-yes@example.com', 'yes-yes@example.com',
        'Consent yes, listing yes', 1, 'active', 5, 5
      ),
      (
        'matrix_yes_no', 'email:yes-no@example.com', 'yes-no@example.com',
        'Consent yes, listing no', 1, 'active', 5, 5
      ),
      (
        'matrix_no_yes', 'email:no-yes@example.com', 'no-yes@example.com',
        'Consent no, listing yes', 0, 'active', 5, 5
      ),
      (
        'matrix_no_no', 'email:no-no@example.com', 'no-no@example.com',
        'Consent no, listing no', 0, 'active', 5, 5
      );

    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role, is_publicly_listed,
      created_by_profile_id, created_at
    ) VALUES
      ('matrix_eo_yes_yes', 'org_vcc', 'event_public', 'matrix_yes_yes',
       'co_organizer', 1, 'profile_owner', 5),
      ('matrix_eo_yes_no', 'org_vcc', 'event_public', 'matrix_yes_no',
       'co_organizer', 0, 'profile_owner', 5),
      ('matrix_eo_no_yes', 'org_vcc', 'event_public', 'matrix_no_yes',
       'co_organizer', 1, 'profile_owner', 5),
      ('matrix_eo_no_no', 'org_vcc', 'event_public', 'matrix_no_no',
       'co_organizer', 0, 'profile_owner', 5);
  `);
  for (const [profileId, displayName] of [
    ["matrix_yes_yes", "Consent yes, listing yes"],
    ["matrix_yes_no", "Consent yes, listing no"],
    ["matrix_no_yes", "Consent no, listing yes"],
    ["matrix_no_no", "Consent no, listing no"],
  ]) {
    seedConfirmedPublicAttribution(database, { displayName, profileId });
  }

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
    event_status: "confirmed",
    rsvp_url: null,
    private_notes: "LEAK_ME",
    invitations: [{ token_hash: "LEAK_ME" }],
    audit_logs: [{ actor_email: "LEAK_ME@example.com" }],
    conflict_override_reason: "LEAK_ME",
    organizer_email: "LEAK_ME@example.com",
    account_id: "LEAK_ME",
  });

  assert.equal(JSON.stringify(dto).includes("LEAK_ME"), false);
});
