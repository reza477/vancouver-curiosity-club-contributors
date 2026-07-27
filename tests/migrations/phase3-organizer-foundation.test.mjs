import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  getOrganizerCalendarEvent,
  listOrganizerCalendarEvents,
} from "../../lib/server/organizer/calendar.ts";
import { updateOrganizerEvent } from "../../lib/server/organizer/events.ts";
import {
  DATABASE_INVARIANT_TRIGGER_NAMES,
  DATABASE_INVARIANT_VERSION,
} from "../../lib/server/database/invariants.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";

const DRIZZLE = join(process.cwd(), "drizzle");
const V8_FILES = [
  "0008_preproduction_reset.sql",
  "0009_sites_compatible_baseline.sql",
  "0010_sites_compatible_indexes_a.sql",
  "0011_sites_compatible_indexes_b.sql",
];
const PHASE3_FILE = "0012_phase3_organizer_foundation.sql";
const V8_HASHES = [
  "066e8ea2f6bd95e9e9cdd5680031627fd2a63e38d848fff7c31a49517d8da366",
  "956be86cb19dd6bf7f8843585a6014dffeca060bc7cd386606e69a82846afe78",
  "9dce8c6d88a4c84d64e84b9cb969a5204a9b602186750ef2e60d443669f1d319",
  "1b2b571eb745f7b56021fb8f8825344aabd24ea186cfa6efaa638aee01f144ad",
];
const ownerIdentity = Object.freeze({
  displayName: "Owner",
  email: "owner@example.test",
  source: "sites-siwc",
});

test("Phase 3 is one additive tokenizer-safe migration after immutable v8", () => {
  assert.deepEqual(
    V8_FILES.map((file) =>
      createHash("sha256").update(sql(file)).digest("hex"),
    ),
    V8_HASHES,
    "migrations 0008-0011 must remain byte-for-byte unchanged",
  );
  const migration = sql(PHASE3_FILE);
  assert.doesNotMatch(migration, /\bCREATE\s+TRIGGER\b/iu);
  assert.doesNotMatch(migration, /\bALTER\s+TABLE\b/iu);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|INDEX)\b/iu);
  assert.doesNotMatch(migration, /\bPRAGMA\b/iu);
  const fragments = productionFragments(migration);
  assert.equal(fragments.length, 24);
  for (const fragment of fragments) {
    if (/^CREATE\b/iu.test(fragment)) {
      assert.match(fragment, /\bIF\s+NOT\s+EXISTS\b/iu);
    } else {
      assert.match(fragment, /^INSERT\s+OR\s+IGNORE\b/iu);
    }
  }
});

test("clean and populated-v8 databases preserve data and gain Phase 3 tables", () => {
  for (const populated of [false, true]) {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      apply(database, V8_FILES.flatMap((file) => productionFragments(sql(file))));
      if (populated) seedV8(database);
      apply(database, productionFragments(sql(PHASE3_FILE)));
      assertPhase3Shape(database);
      if (populated) {
        assert.deepEqual(
          {
            ...database
            .prepare(
              `SELECT id, normalized_email
               FROM profiles
               WHERE id = 'profile-owner'`,
            )
            .get(),
          },
          { id: "profile-owner", normalized_email: "owner@example.test" },
        );
        assert.equal(
          database
            .prepare(
              "SELECT count(*) AS count FROM sync_sources WHERE id = 'source-existing'",
            )
            .get().count,
          1,
        );
        assert.equal(
          database
            .prepare(
              `SELECT count(*) AS count
               FROM organizer_events
               WHERE id IN (
                 'legacy-unassigned-primary',
                 'legacy-unassigned-co',
                 'legacy-inactive-co',
                 'legacy-active-suspended-updater',
                 'legacy-scope-missing-row',
                 'legacy-scope-extra-row',
                 'legacy-scope-duplicate',
                 'legacy-scope-nontext',
                 'legacy-cross-org-creator'
               )`,
            )
            .get().count,
          0,
          "ineligible organizer, scope, creator, or updater data leaves the complete legacy record read-only",
        );
        assert.deepEqual(
          database
            .prepare(
              `SELECT id
               FROM events
               WHERE id IN (
                 'legacy-unassigned-primary',
                 'legacy-unassigned-co',
                 'legacy-inactive-co',
                 'legacy-active-suspended-updater',
                 'legacy-scope-missing-row',
                 'legacy-scope-extra-row',
                 'legacy-scope-duplicate',
                 'legacy-scope-nontext',
                 'legacy-cross-org-creator'
               )
               ORDER BY id`,
            )
            .all()
            .map(({ id }) => id),
          [
            "legacy-active-suspended-updater",
            "legacy-cross-org-creator",
            "legacy-inactive-co",
            "legacy-scope-duplicate",
            "legacy-scope-extra-row",
            "legacy-scope-missing-row",
            "legacy-scope-nontext",
            "legacy-unassigned-co",
            "legacy-unassigned-primary",
          ],
          "the original legacy records remain intact",
        );
        assert.deepEqual(
          database
            .prepare(
              `SELECT profile_id
               FROM organizer_event_organizers
               WHERE organizer_event_id = 'legacy-private-draft'
               ORDER BY profile_id`,
            )
            .all()
            .map(({ profile_id }) => profile_id),
          ["profile-valid-co"],
          "a fully eligible active organizer set is copied without partial filtering",
        );
        assert.equal(
          database
            .prepare(
              `SELECT count(*) AS count
               FROM event_organizers
               WHERE id = 'legacy-deleted-invalid-co'
                 AND deleted_at = 2`,
            )
            .get().count,
          1,
          "deleted association history remains in the legacy table and does not block valid active-set adoption",
        );
        assert.deepEqual(
          {
            ...database
              .prepare(
                `SELECT id, deleted_at
                 FROM organizer_events
                 WHERE id = 'legacy-deleted-history'`,
              )
              .get(),
          },
          { id: "legacy-deleted-history", deleted_at: 2 },
          "soft-deleted history is preserved even when its historical updater is suspended",
        );
        assert.equal(
          database
            .prepare(
              `SELECT count(*) AS count
               FROM organizer_event_revisions
               WHERE organizer_event_id = 'legacy-deleted-history'
                 AND actor_profile_id = 'profile-suspended'`,
            )
            .get().count,
          1,
          "the deleted record's immutable historical revision is retained",
        );
        assert.deepEqual(
          {
            ...database
              .prepare(
                `SELECT id, planning_status, publication_status,
                        schedule_shape, content_version, schedule_version
                 FROM organizer_events
                 WHERE id = 'legacy-private-draft'`,
              )
              .get(),
          },
          {
            id: "legacy-private-draft",
            planning_status: "draft",
            publication_status: "private",
            schedule_shape: "timed",
            content_version: 1,
            schedule_version: 7,
          },
          "eligible source-free private legacy drafts are adopted for editing",
        );
        assert.equal(
          database
            .prepare(
              `SELECT count(*) AS count
               FROM organizer_event_revisions
               WHERE organizer_event_id = 'legacy-private-draft'`,
            )
            .get().count,
          1,
        );
      }
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  }
});

test("every partial production-tokenizer prefix converges on retry", () => {
  const fragments = productionFragments(sql(PHASE3_FILE));
  for (let cut = 0; cut <= fragments.length; cut += 1) {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      apply(database, V8_FILES.flatMap((file) => productionFragments(sql(file))));
      seedV8(database);
      apply(database, fragments.slice(0, cut));
      apply(database, fragments);
      assertPhase3Shape(database);
      assert.equal(
        database
          .prepare(
            "SELECT count(*) AS count FROM organizations WHERE id = 'org-main'",
          )
          .get().count,
        1,
      );
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      database.close();
    }
  }
});

test("populated-v8 adoption is all-or-nothing and leaves ineligible legacy organizer sets read-only", async (t) => {
  const database = new SqliteD1TestDatabase(
    V8_FILES.map((file) => sql(file)).join("\n"),
  );
  t.after(() => database.close());
  seedV8(database);
  for (const fragment of productionFragments(sql(PHASE3_FILE))) {
    await database.prepare(fragment).run();
  }
  for (const fragment of productionFragments(
    sql("0013_phase4_conflict_engine.sql"),
  )) {
    await database.prepare(fragment).run();
  }
  for (const fragment of productionFragments(
    sql("0014_phase5_publication.sql"),
  )) {
    await database.prepare(fragment).run();
  }

  await ensureDatabaseInvariantsReady(database);
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
  assert.equal(
    (
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM sqlite_master
           WHERE type = 'trigger'`,
        )
        .first()
    ).count,
    DATABASE_INVARIANT_TRIGGER_NAMES.length,
  );

  const calendar = await listOrganizerCalendarEvents(
    database,
    ownerIdentity,
  );
  const ineligibleIds = [
    "legacy-unassigned-primary",
    "legacy-unassigned-co",
    "legacy-inactive-co",
    "legacy-active-suspended-updater",
    "legacy-scope-missing-row",
    "legacy-scope-extra-row",
    "legacy-scope-duplicate",
    "legacy-scope-nontext",
    "legacy-cross-org-creator",
  ];
  for (const id of ineligibleIds) {
    const event = calendar.events.find((candidate) => candidate.id === id);
    assert.equal(event?.source, "legacy");
    assert.equal(event?.readOnly, true);
    await assert.rejects(
      updateOrganizerEvent(database, ownerIdentity, id, 2, {
        title: "Crafted adoption edit",
        clubId: "club-main",
        primaryOrganizerProfileId: "profile-owner",
        coOrganizerProfileIds: [],
        planningStatus: "draft",
        publicationStatus: "private",
        scheduleShape: "timed",
        timeZone: "America/Vancouver",
        startLocal: "2030-03-15T18:00",
        endLocal: "2030-03-15T19:00",
      }),
      (error) => error?.code === "not_found" && error?.status === 404,
    );
  }

  const adopted = await getOrganizerCalendarEvent(
    database,
    ownerIdentity,
    "legacy-private-draft",
  );
  assert.equal(adopted.source, "manual");
  assert.equal(adopted.readOnly, false);
  assert.deepEqual(
    (
      await database
        .prepare(
          `SELECT event_id, profile_id, deleted_at
           FROM event_organizers
           WHERE event_id IN (
             'legacy-unassigned-co',
             'legacy-inactive-co',
             'legacy-private-draft'
           )
           ORDER BY id`,
        )
        .all()
    ).results.map((row) => ({ ...row })),
    [
      {
        deleted_at: 2,
        event_id: "legacy-private-draft",
        profile_id: "profile-unassigned",
      },
      {
        deleted_at: null,
        event_id: "legacy-inactive-co",
        profile_id: "profile-suspended",
      },
      {
        deleted_at: null,
        event_id: "legacy-unassigned-co",
        profile_id: "profile-unassigned",
      },
      {
        deleted_at: null,
        event_id: "legacy-private-draft",
        profile_id: "profile-valid-co",
      },
      {
        deleted_at: null,
        event_id: "legacy-private-draft",
        profile_id: "profile-owner",
      },
    ],
    "migration preserves every legacy association row while projecting only the fully eligible active set",
  );
});

function assertPhase3Shape(database) {
  assert.deepEqual(
    database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'organizer_events',
             'organizer_event_organizers',
             'organizer_event_revisions',
             'organizer_profile_preferences',
             'organizer_rate_limits',
             'ownership_transfer_locks'
           )
         ORDER BY name`,
      )
      .all()
      .map(({ name }) => name),
    [
      "organizer_event_organizers",
      "organizer_event_revisions",
      "organizer_events",
      "organizer_profile_preferences",
      "organizer_rate_limits",
      "ownership_transfer_locks",
    ],
  );
  assert.equal(
    database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'trigger'`,
      )
      .get().count,
    0,
    "trigger bodies remain runtime-installed",
  );
  const preferenceColumns = new Map(
    database
      .prepare("PRAGMA table_info(organizer_profile_preferences)")
      .all()
      .map((column) => [column.name, column]),
  );
  for (const columnName of [
    "workspace_display_name",
    "public_attribution_consent_draft",
  ]) {
    assert.ok(
      preferenceColumns.has(columnName),
      `the migrated profile sidecar must include ${columnName}`,
    );
  }
  assert.equal(
    preferenceColumns.get("workspace_display_name").notnull,
    0,
    "the staged display name remains nullable for version-8 fallback",
  );
  assert.equal(
    preferenceColumns.get("public_attribution_consent_draft").notnull,
    0,
    "the staged consent remains nullable for version-8 fallback",
  );
  assert.doesNotThrow(() =>
    database
      .prepare(
        `SELECT workspace_display_name,
                public_attribution_consent_draft
         FROM organizer_profile_preferences
         LIMIT 0`,
      )
      .all(),
  );
  assert.match(
    database
      .prepare(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'table'
           AND name = 'organizer_profile_preferences'`,
      )
      .get().sql,
    /organizer_profile_preferences_consent_check/u,
  );
  const organizerIndexes = database
    .prepare(
      `SELECT count(*) AS count
       FROM sqlite_master
       WHERE type = 'index'
         AND name LIKE 'organizer_%'`,
    )
    .get().count;
  assert.equal(organizerIndexes, 13);
  assert.equal(
    database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'index'
           AND name = 'events_org_club_archive_idx'`,
      )
      .get().count,
    1,
    "the legacy-event archive blocker query has a packaged supporting index",
  );
}

function seedV8(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile-owner', 'subject-owner', 'owner@example.test', 'Owner',
        'active', 1, 1
      ),
      (
        'profile-suspended', 'subject-suspended', 'suspended@example.test',
        'Suspended organizer', 'suspended', 1, 1
      ),
      (
        'profile-valid-co', 'subject-valid-co', 'valid-co@example.test',
        'Valid co-organizer', 'active', 1, 1
      ),
      (
        'profile-unassigned', 'subject-unassigned',
        'unassigned@example.test', 'Unassigned organizer', 'active', 1, 1
      ),
      (
        'profile-external', 'subject-external',
        'external@example.test', 'External owner', 'active', 1, 1
      );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-main', 'Main Organization', 'main-organization',
      'America/Vancouver', 1, 'profile-owner', 1, 1
    ), (
      'org-other', 'Other Organization', 'other-organization',
      'America/Vancouver', 1, 'profile-external', 1, 1
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
        'membership-suspended', 'org-main', 'profile-suspended',
        'suspended@example.test', 'organizer', 'suspended',
        'profile-owner', 1, 1
      ),
      (
        'membership-valid-co', 'org-main', 'profile-valid-co',
        'valid-co@example.test', 'organizer', 'active',
        'profile-owner', 1, 1
      ),
      (
        'membership-unassigned', 'org-main', 'profile-unassigned',
        'unassigned@example.test', 'organizer', 'active',
        'profile-owner', 1, 1
      ),
      (
        'membership-external', 'org-other', 'profile-external',
        'external@example.test', 'owner', 'active',
        'profile-external', 1, 1
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
    ) VALUES (
      'club-valid-co', 'org-main', 'club-main', 'membership-valid-co',
      'profile-valid-co', 'organizer', 'active', 'profile-owner', 1, 1
    );
    INSERT INTO sync_sources (
      id, organization_id, club_id, source_type, source_url,
      enabled, refresh_interval_minutes, created_by_profile_id,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'source-existing', 'org-main', 'club-main', 'meetup_ics',
      'https://private.invalid/feed', 1, 15,
      'profile-owner', 'profile-owner', 1, 1
    );

    INSERT INTO events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, status, visibility, time_kind, starts_at_utc, ends_at_utc,
      timezone, buffer_before_minutes, buffer_after_minutes,
      organizer_scope_json, schedule_version, schedule_review_state,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at,
      deleted_at
    ) VALUES
      (
        'legacy-private-draft', 'org-main', 'club-main', 'profile-owner',
        'Legacy private draft', 'legacy-private-draft', 'draft', 'private',
        'timed', 1900000000000, 1900003600000, 'America/Vancouver',
        0, 0, '["profile-owner","profile-valid-co"]', 7, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-active-suspended-updater', 'org-main', 'club-main',
        'profile-owner', 'Active invalid historical updater',
        'legacy-active-suspended-updater', 'draft', 'private',
        'timed', 1900100000000, 1900103600000, 'America/Vancouver',
        0, 0, '["profile-owner"]', 2, 'unreviewed',
        'profile-owner', 'profile-suspended', 1, 1, NULL
      ),
      (
        'legacy-unassigned-primary', 'org-main', 'club-main',
        'profile-unassigned', 'Unassigned primary',
        'legacy-unassigned-primary', 'draft', 'private',
        'timed', 1900110000000, 1900113600000, 'America/Vancouver',
        0, 0, '["profile-unassigned"]', 2, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-unassigned-co', 'org-main', 'club-main',
        'profile-owner', 'Unassigned co-organizer',
        'legacy-unassigned-co', 'draft', 'private',
        'timed', 1900120000000, 1900123600000, 'America/Vancouver',
        0, 0, '["profile-owner","profile-unassigned"]', 2, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-inactive-co', 'org-main', 'club-main',
        'profile-owner', 'Inactive co-organizer',
        'legacy-inactive-co', 'draft', 'private',
        'timed', 1900130000000, 1900133600000, 'America/Vancouver',
        0, 0, '["profile-owner","profile-suspended"]', 2, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-deleted-history', 'org-main', 'club-main', 'profile-owner',
        'Deleted historical idea', 'legacy-deleted-history', 'idea', 'private',
        'timed', 1900200000000, 1900203600000, 'America/Vancouver',
        0, 0, '["profile-owner"]', 3, 'unreviewed',
        'profile-owner', 'profile-suspended', 1, 2, 2
      ),
      (
        'legacy-scope-missing-row', 'org-main', 'club-main', 'profile-owner',
        'Scope has missing row', 'legacy-scope-missing-row', 'draft', 'private',
        'timed', 1900210000000, 1900213600000, 'America/Vancouver',
        0, 0, '["profile-owner","profile-valid-co"]', 1, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-scope-extra-row', 'org-main', 'club-main', 'profile-owner',
        'Rows have extra organizer', 'legacy-scope-extra-row', 'draft', 'private',
        'timed', 1900220000000, 1900223600000, 'America/Vancouver',
        0, 0, '["profile-owner"]', 1, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-scope-duplicate', 'org-main', 'club-main', 'profile-owner',
        'Scope duplicates organizer', 'legacy-scope-duplicate', 'draft', 'private',
        'timed', 1900230000000, 1900233600000, 'America/Vancouver',
        0, 0, '["profile-owner","profile-owner"]', 1, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-scope-nontext', 'org-main', 'club-main', 'profile-owner',
        'Scope contains non-text', 'legacy-scope-nontext', 'draft', 'private',
        'timed', 1900240000000, 1900243600000, 'America/Vancouver',
        0, 0, '["profile-owner",17]', 1, 'unreviewed',
        'profile-owner', 'profile-owner', 1, 1, NULL
      ),
      (
        'legacy-cross-org-creator', 'org-main', 'club-main', 'profile-owner',
        'Cross organization creator', 'legacy-cross-org-creator', 'draft',
        'private', 'timed', 1900250000000, 1900253600000,
        'America/Vancouver', 0, 0, '["profile-owner"]', 1, 'unreviewed',
        'profile-external', 'profile-owner', 1, 1, NULL
      );

    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role,
      is_publicly_listed, created_by_profile_id, created_at,
      deleted_at
    ) VALUES
      (
        'legacy-valid-primary', 'org-main', 'legacy-private-draft',
        'profile-owner', 'primary', 0, 'profile-owner', 1, NULL
      ),
      (
        'legacy-valid-co', 'org-main', 'legacy-private-draft',
        'profile-valid-co', 'co_organizer', 0, 'profile-owner', 1, NULL
      ),
      (
        'legacy-deleted-invalid-co', 'org-main', 'legacy-private-draft',
        'profile-unassigned', 'co_organizer', 0, 'profile-owner', 1, 2
      ),
      (
        'legacy-unassigned-co-row', 'org-main', 'legacy-unassigned-co',
        'profile-unassigned', 'co_organizer', 0, 'profile-owner', 1, NULL
      ),
      (
        'legacy-inactive-co-row', 'org-main', 'legacy-inactive-co',
        'profile-suspended', 'co_organizer', 0, 'profile-owner', 1, NULL
      ),
      (
        'legacy-deleted-history-primary', 'org-main',
        'legacy-deleted-history', 'profile-owner', 'primary', 0,
        'profile-owner', 1, NULL
      ),
      (
        'legacy-scope-missing-primary', 'org-main',
        'legacy-scope-missing-row', 'profile-owner', 'primary', 0,
        'profile-owner', 1, NULL
      ),
      (
        'legacy-scope-extra-primary', 'org-main', 'legacy-scope-extra-row',
        'profile-owner', 'primary', 0, 'profile-owner', 1, NULL
      ),
      (
        'legacy-scope-extra-co', 'org-main', 'legacy-scope-extra-row',
        'profile-valid-co', 'co_organizer', 0, 'profile-owner', 1, NULL
      ),
      (
        'legacy-scope-duplicate-primary', 'org-main',
        'legacy-scope-duplicate', 'profile-owner', 'primary', 0,
        'profile-owner', 1, NULL
      ),
      (
        'legacy-scope-nontext-primary', 'org-main',
        'legacy-scope-nontext', 'profile-owner', 'primary', 0,
        'profile-owner', 1, NULL
      ),
      (
        'legacy-cross-org-creator-primary', 'org-main',
        'legacy-cross-org-creator', 'profile-owner', 'primary', 0,
        'profile-owner', 1, NULL
      );
  `);
}

function sql(file) {
  return readFileSync(join(DRIZZLE, file), "utf8");
}

function productionFragments(value) {
  return value
    .split(";")
    .map((fragment) =>
      fragment.replace(/--> statement-breakpoint/gu, "").trim(),
    )
    .filter(Boolean);
}

function apply(database, fragments) {
  for (const fragment of fragments) database.prepare(fragment).run();
}
