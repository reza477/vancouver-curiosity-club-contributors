import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

const PRIVATE_SOURCE_URL =
  "https://private.invalid/owner-calendar.ics?secret=PRIVATE_SYNTHETIC_TOKEN";
const ACTIVE_HASH = "a".repeat(64);
const PENDING_HASH = "b".repeat(64);
const ACTIVE_FINGERPRINT = "c".repeat(64);
const PENDING_FINGERPRINT = "d".repeat(64);

function migrationFiles() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
}

function migrationSql(names) {
  return names
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}

test("populated version-5 D1 upgrades without losing private or scheduling state", async (t) => {
  const names = migrationFiles();
  const version5Names = names.filter((name) => /^000[0-5]_/u.test(name));
  const phase2Names = names.filter((name) => !version5Names.includes(name));
  assert.deepEqual(
    version5Names.map((name) => name.slice(0, 4)),
    ["0000", "0001", "0002", "0003", "0004", "0005"],
  );
  assert.ok(
    phase2Names.length > 0,
    "at least one generated Phase 2 migration must follow version 5",
  );

  const database = new SqliteD1TestDatabase(migrationSql(version5Names));
  t.after(() => database.close());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_v5_owner', 'email:v5-owner@example.com',
      'v5-owner@example.com', 'V5 Owner', 'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'org_v5', 'Private internal organization name',
      'vancouver-curiosity-and-education-society', 'America/Vancouver',
      1, 'profile_v5_owner', 'profile_v5_owner', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_v5_owner', 'org_v5', 'profile_v5_owner',
      'v5-owner@example.com', 'owner', 'active',
      'profile_v5_owner', 1, 1
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, description,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'club_v5', 'org_v5', 'Vancouver Curiosity Club',
      'vancouver-curiosity-club', 'V5 club description',
      'profile_v5_owner', 1, 1
    );
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane_v5', 'org_v5', 'Think', 'think', 'V5 lane description', 10,
      'profile_v5_owner', 1, 1
    );
    INSERT INTO events (
      id, organization_id, club_id, event_lane_id,
      primary_organizer_profile_id, title, slug, summary, description,
      status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
      buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
      schedule_version, schedule_review_state, hold_expires_at,
      private_notes, private_meeting_details, published_at,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'event_v5', 'org_v5', 'club_v5', 'lane_v5',
      'profile_v5_owner', 'V5 Published Event', 'v5-published-event',
      'V5 public summary', 'V5 public description',
      'confirmed', 'public', 'timed', 1900000000000, 1900003600000,
      'America/Vancouver', 15, 20, '["profile_v5_owner"]',
      4, 'unreviewed', NULL, 'PRIVATE_NOTES_SENTINEL',
      'PRIVATE_MEETING_SENTINEL', 1,
      'profile_v5_owner', 'profile_v5_owner', 1, 1
    );
    INSERT INTO sync_sources (
      id, organization_id, club_id, source_type, source_url, enabled,
      refresh_interval_minutes, last_attempt_at, last_success_at,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'source_v5', 'org_v5', 'club_v5', 'meetup_ics',
      '${PRIVATE_SOURCE_URL}', 1, 15, 4_000, 4_000,
      'profile_v5_owner', 'profile_v5_owner', 1, 1
    );
    INSERT INTO meetup_sync_generations (
      id, organization_id, sync_source_id, previous_generation_id,
      snapshot_hash, expected_item_count, processed_item_count,
      rejected_item_count, state, removed_count, created_at, updated_at,
      published_at, failed_at
    ) VALUES
      (
        'generation_v5_active', 'org_v5', 'source_v5', NULL,
        '${ACTIVE_HASH}', 1, 1, 0, 'published', 2, 2_000, 2_000, 2_000, NULL
      ),
      (
        'generation_v5_pending', 'org_v5', 'source_v5',
        'generation_v5_active', '${PENDING_HASH}', 1, 1, 0,
        'staging', 0, 3_000, 3_000, NULL, NULL
      );
    UPDATE sync_sources
    SET active_generation_id = 'generation_v5_active',
        pending_generation_id = 'generation_v5_pending',
        pending_snapshot_hash = '${PENDING_HASH}',
        pending_cursor = 1
    WHERE id = 'source_v5';
    INSERT INTO meetup_event_snapshots (
      id, organization_id, sync_source_id, generation_id, external_id,
      event_id, ordinal, event_slug, title, event_url, status, time_kind,
      starts_at_utc, ends_at_utc, timezone, source_fingerprint,
      source_sequence, source_last_modified_at, created_at, updated_at
    ) VALUES
      (
        'snapshot_v5_active', 'org_v5', 'source_v5',
        'generation_v5_active', 'v5-external-event', 'event_v5', 0,
        'v5-published-event', 'V5 Published Event',
        'https://www.meetup.com/vancouver-meetup-group/events/1001/',
        'confirmed', 'timed', 1900000000000, 1900003600000,
        'America/Vancouver', '${ACTIVE_FINGERPRINT}', 4, 2_000, 2_000, 2_000
      ),
      (
        'snapshot_v5_pending', 'org_v5', 'source_v5',
        'generation_v5_pending', 'v5-external-event', 'event_v5', 0,
        'v5-published-event', 'UNPUBLISHED V5 PENDING TITLE',
        'https://www.meetup.com/vancouver-meetup-group/events/1001/',
        'confirmed', 'timed', 1900007200000, 1900010800000,
        'America/Vancouver', '${PENDING_FINGERPRINT}', 5, 3_000, 3_000, 3_000
      );
  `);

  const before = {
    event: await database
      .prepare(
        `SELECT title, slug, status, visibility, schedule_version,
                private_notes, private_meeting_details
         FROM events WHERE id = 'event_v5'`,
      )
      .first(),
    membership: await database
      .prepare(
        `SELECT organization_id, profile_id, normalized_email, role, status
         FROM organization_memberships
         WHERE id = 'membership_v5_owner'`,
      )
      .first(),
    snapshots: await database
      .prepare(
        `SELECT id, generation_id, title, starts_at_utc
         FROM meetup_event_snapshots
         WHERE sync_source_id = 'source_v5'
         ORDER BY id`,
      )
      .all(),
    source: await database
      .prepare(
        `SELECT source_url, active_generation_id, pending_generation_id,
                pending_snapshot_hash, pending_cursor
         FROM sync_sources WHERE id = 'source_v5'`,
      )
      .first(),
  };
  const triggersBefore = await reservationTriggerNames(database);
  assert.deepEqual(triggersBefore, [
    "events_reservation_guard_before_insert",
    "events_reservation_guard_before_update",
  ]);

  for (const name of phase2Names) {
    database.exec(migrationSql([name]));
  }

  assert.deepEqual(
    await database
      .prepare(
        `SELECT organization_id, profile_id, normalized_email, role, status
         FROM organization_memberships
         WHERE id = 'membership_v5_owner'`,
      )
      .first(),
    before.membership,
  );
  assert.deepEqual(
    await database
      .prepare(
        `SELECT title, slug, status, visibility, schedule_version,
                private_notes, private_meeting_details
         FROM events WHERE id = 'event_v5'`,
      )
      .first(),
    before.event,
  );
  assert.deepEqual(
    await database
      .prepare(
        `SELECT source_url, active_generation_id, pending_generation_id,
                pending_snapshot_hash, pending_cursor
         FROM sync_sources WHERE id = 'source_v5'`,
      )
      .first(),
    before.source,
  );
  assert.equal(before.source.source_url, PRIVATE_SOURCE_URL);
  assert.deepEqual(
    await database
      .prepare(
        `SELECT id, generation_id, title, starts_at_utc
         FROM meetup_event_snapshots
         WHERE sync_source_id = 'source_v5'
         ORDER BY id`,
      )
      .all(),
    before.snapshots,
  );
  assert.deepEqual(
    await database
      .prepare(
        `SELECT id, previous_generation_id, state, removed_count
         FROM meetup_sync_generations
         WHERE sync_source_id = 'source_v5'
         ORDER BY id`,
      )
      .all()
      .then((result) => result.results.map((row) => ({ ...row }))),
    [
      {
        id: "generation_v5_active",
        previous_generation_id: null,
        removed_count: 2,
        state: "published",
      },
      {
        id: "generation_v5_pending",
        previous_generation_id: "generation_v5_active",
        removed_count: 0,
        state: "staging",
      },
    ],
  );
  assert.deepEqual(await reservationTriggerNames(database), triggersBefore);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('club_public_profiles', 'event_public_details')`,
      )
      .first("count"),
    2,
  );
  assert.equal(
    await database
      .prepare("PRAGMA foreign_key_check")
      .all()
      .then((result) => result.results.length),
    0,
  );

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO events (
          id, organization_id, club_id, event_lane_id,
          primary_organizer_profile_id, title, slug, status, visibility,
          time_kind, starts_at_utc, ends_at_utc, timezone,
          buffer_before_minutes, buffer_after_minutes, organizer_scope_json,
          schedule_version, schedule_review_state, hold_expires_at,
          created_by_profile_id, updated_by_profile_id, created_at, updated_at
        ) VALUES (
          'event_v5_overlap', 'org_v5', 'club_v5', 'lane_v5',
          'profile_v5_owner', 'Overlapping Event', 'overlapping-event',
          'confirmed', 'private', 'timed', 1900001000000, 1900002000000,
          'America/Vancouver', 0, 0, '["profile_v5_owner"]',
          1, 'unreviewed', NULL,
          'profile_v5_owner', 'profile_v5_owner', 4_000, 4_000
        );
      `),
    /conflict_guard_overlap_(?:organization|organizer|venue)/u,
  );
});

async function reservationTriggerNames(database) {
  const result = await database
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'trigger'
         AND name LIKE 'events_reservation_guard_%'
       ORDER BY name`,
    )
    .all();
  return result.results.map((row) => row.name);
}
