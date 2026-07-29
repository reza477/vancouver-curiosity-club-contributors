import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeOrganizerAccess,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  DATABASE_INVARIANT_MARKER_KEY,
  DATABASE_INVARIANT_STATEMENT_LIMIT,
  DATABASE_INVARIANT_TRIGGER_STATEMENTS,
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
  getExpectedDatabaseInvariantFingerprint,
} from "../../lib/server/database/invariants.ts";
import {
  runRequestMaintenance,
} from "../../lib/server/database/request-maintenance.ts";
import {
  ensureCmsAdoption,
} from "../../lib/server/organizer/cms-adoption.ts";
import {
  createOwnCalendarSubscription,
  listOwnCalendarSubscriptions,
  readPrivateCalendarSubscription,
  revokeOwnCalendarSubscription,
} from "../../lib/server/phase7/calendar-subscriptions.ts";
import {
  createOwnerMediaManifest,
  createOperationalEventCsv,
  getOwnerMediaOriginal,
  MEDIA_MANIFEST_USAGE_LIMIT,
} from "../../lib/server/phase7/private-exports.ts";
import {
  createOwnerJsonBackup,
  OWNER_BACKUP_SECTION_LIMITS,
} from "../../lib/server/phase7/owner-backup.ts";
import {
  createFilteredPublicCsvDownload,
  createFilteredPublicIcsDownload,
  createOneEventIcsDownload,
} from "../../lib/server/phase7/public-exports.ts";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";
import {
  SqliteD1TestDatabase,
  startSqliteD1StatementRecording,
} from "../auth/sqlite-d1.mjs";
import {
  assertRecordedD1ShapesCompile,
} from "../database/d1-recorded-shapes.mjs";
import { interceptD1Statements } from "../auth/intercept-d1.mjs";

const OWNER = trustedIdentityFromSites({
  displayName: "Calendar Owner",
  email: "calendar-owner@example.invalid",
});
const ADMIN = trustedIdentityFromSites({
  displayName: "Calendar Administrator",
  email: "calendar-admin@example.invalid",
});
const ORGANIZER = trustedIdentityFromSites({
  displayName: "Calendar Organizer",
  email: "calendar-organizer@example.invalid",
});
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const ARBITRARY_PRIVATE_URL_SENTINEL =
  "https://whereby.com/private-planning-room/WHEREBY-PRIVATE-SENTINEL";
const SOURCE_REVISION = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: process.cwd(),
  encoding: "utf8",
})
  .trim()
  .toLowerCase();
const NESTED_BACKUP_SENTINELS = Object.freeze([
  "NESTED-TOKEN-SENTINEL",
  "NESTED-QUERY-URL-SENTINEL",
  "nested-owner@example.invalid",
  "NESTED-PROFILE-SENTINEL",
  "NESTED-PROVIDER-SENTINEL",
  "NESTED-API-KEY-SENTINEL",
  "NESTED-AUTH-HEADER-SENTINEL",
  "NESTED-R2-KEY-SENTINEL",
  "NESTED-FEED-SENTINEL",
  "NESTED-MEETING-SENTINEL",
]);

test("private calendar subscription list and revoke return paths seal live membership within bounded budgets", async (t) => {
  await t.test("list", async () => {
    const database = fixture();
    try {
      seedCalendarAdministrator(database);
      const counter = countedBinding(database);
      assert.deepEqual(
        await listOwnCalendarSubscriptions(counter.binding, ADMIN),
        [],
      );
      assert.deepEqual(counter.counts(), {
        batchLengths: [],
        statementCount: 3,
      });

      const intercepted = interceptD1Statements(database, {
        after: (sql) =>
          sql.includes("FROM ics_subscription_tokens AS token") &&
          sql.includes("ORDER BY"),
        before: (sql) => sql.includes("SELECT membership.id"),
        hook: async () => suspendCalendarAdministrator(database),
      });
      await assert.rejects(
        listOwnCalendarSubscriptions(intercepted.database, ADMIN),
        (error) => error?.code === "authorization_denied",
      );
      assert.equal(intercepted.fired(), true);
    } finally {
      database.close();
    }
  });

  await t.test("successful revoke", async () => {
    const database = fixture();
    try {
      seedCalendarAdministrator(database);
      const created = await createOwnCalendarSubscription(
        database,
        ADMIN,
        "Successful revoke",
        NOW,
      );
      const counter = countedBinding(database);
      assert.equal(
        (
          await revokeOwnCalendarSubscription(
            counter.binding,
            ADMIN,
            created.subscription.id,
            NOW + 1,
          )
        ).revokedAt,
        NOW + 1,
      );
      assert.deepEqual(counter.counts(), {
        batchLengths: [2],
        statementCount: 5,
      });
    } finally {
      database.close();
    }

    const racedDatabase = fixture();
    try {
      seedCalendarAdministrator(racedDatabase);
      const created = await createOwnCalendarSubscription(
        racedDatabase,
        ADMIN,
        "Successful revoke race",
        NOW,
      );
      await assert.rejects(
        revokeOwnCalendarSubscription(
          afterNextD1Batch(racedDatabase, async () =>
            suspendCalendarAdministrator(racedDatabase),
          ),
          ADMIN,
          created.subscription.id,
          NOW + 1,
        ),
        (error) => error?.code === "authorization_denied",
      );
    } finally {
      racedDatabase.close();
    }
  });

  await t.test("already-revoked no-op", async () => {
    const database = fixture();
    try {
      seedCalendarAdministrator(database);
      const created = await createOwnCalendarSubscription(
        database,
        ADMIN,
        "No-op revoke",
        NOW,
      );
      await revokeOwnCalendarSubscription(
        database,
        ADMIN,
        created.subscription.id,
        NOW + 1,
      );
      const counter = countedBinding(database);
      assert.equal(
        (
          await revokeOwnCalendarSubscription(
            counter.binding,
            ADMIN,
            created.subscription.id,
            NOW + 2,
          )
        ).revokedAt,
        NOW + 1,
      );
      assert.deepEqual(counter.counts(), {
        batchLengths: [],
        statementCount: 3,
      });

      const intercepted = interceptD1Statements(database, {
        after: (sql) =>
          sql.includes("FROM ics_subscription_tokens") &&
          sql.includes("WHERE id = ?"),
        before: (sql) => sql.includes("SELECT membership.id"),
        hook: async () => suspendCalendarAdministrator(database),
      });
      await assert.rejects(
        revokeOwnCalendarSubscription(
          intercepted.database,
          ADMIN,
          created.subscription.id,
          NOW + 3,
        ),
        (error) => error?.code === "authorization_denied",
      );
      assert.equal(intercepted.fired(), true);
    } finally {
      database.close();
    }
  });

  await t.test("lost-response retry", async () => {
    const database = fixture();
    try {
      seedCalendarAdministrator(database);
      const created = await createOwnCalendarSubscription(
        database,
        ADMIN,
        "Concurrent revoke retry",
        NOW,
      );
      const raced = revokeRetryRaceDatabase(
        database,
        created.subscription.id,
      );
      await assert.rejects(
        revokeOwnCalendarSubscription(
          raced.database,
          ADMIN,
          created.subscription.id,
          NOW + 2,
        ),
        (error) => error?.code === "authorization_denied",
      );
      assert.equal(raced.firedWinner(), true);
      assert.equal(raced.firedSealDrift(), true);
      assert.deepEqual(raced.counts(), {
        batchLengths: [2],
        statementCount: 6,
      });
    } finally {
      database.close();
    }
  });
});

test("simultaneous first private-feed reads converge to one daily touch", async () => {
  const database = fixture();
  try {
    const created = await createOwnCalendarSubscription(
      database,
      OWNER,
      "Personal calendar",
      NOW,
    );
    const [first, second] = await Promise.all([
      readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 1_000,
        origin: "https://example.invalid",
      }),
      readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 1_000,
        origin: "https://example.invalid",
      }),
    ]);
    assert.equal(first, second);
    assert.match(first, /BEGIN:VCALENDAR\r\n/u);
    const row = database.sqlite
      .prepare(
        `SELECT last_used_at
         FROM ics_subscription_tokens
         WHERE id = ?`,
      )
      .get(created.subscription.id);
    assert.equal(row.last_used_at, NOW + 1_000);
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM ics_subscription_tokens
           WHERE last_used_at IS NOT NULL`,
        )
        .get().count,
      1,
    );
    const stored = database.sqlite
      .prepare(
        `SELECT token_hash
         FROM ics_subscription_tokens
         WHERE id = ?`,
      )
      .get(created.subscription.id);
    assert.match(stored.token_hash, /^[0-9a-f]{64}$/u);
    assert.notEqual(stored.token_hash, created.token);
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE instr(metadata_json, ?) > 0`,
        )
        .get(created.token).count,
      0,
    );
    await createOwnCalendarSubscription(database, OWNER, "Second", NOW + 2);
    await createOwnCalendarSubscription(database, OWNER, "Third", NOW + 3);
    await assert.rejects(
      createOwnCalendarSubscription(database, OWNER, "Fourth", NOW + 4),
      (error) => error?.code === "conflict",
    );
  } finally {
    database.close();
  }
});

test("private feed revalidates revocation and suspension after component reconciliation", async (t) => {
  await t.test("revocation after reconciliation denies the feed", async () => {
    const database = fixture();
    try {
      seedEvents(database);
      const created = await createOwnCalendarSubscription(
        database,
        OWNER,
        "Revocation race",
        NOW,
      );
      let raced = false;
      const racedDatabase = afterCalendarRevisionRead(
        database,
        () => {
          database.sqlite
            .prepare(
              `UPDATE ics_subscription_tokens
               SET revoked_at = ?
               WHERE id = ?`,
            )
            .run(
              NOW + 1_001,
              created.subscription.id,
            );
          raced = true;
        },
      );
      await assertPrivateCalendarNotFound(
        racedDatabase,
        created.token,
        NOW + 1_000,
      );
      assert.equal(raced, true);
    } finally {
      database.close();
    }
  });

  await t.test("suspension after reconciliation denies the feed", async () => {
    const database = fixture();
    try {
      seedEvents(database);
      const created = await createOwnCalendarSubscription(
        database,
        OWNER,
        "Suspension race",
        NOW,
      );
      let raced = false;
      const racedDatabase = afterCalendarRevisionRead(
        database,
        () => {
          database.sqlite
            .prepare(
              `UPDATE organization_memberships
               SET status = 'suspended', updated_at = ?
               WHERE id = 'membership-owner'`,
            )
            .run(NOW + 1_001);
          raced = true;
        },
      );
      await assertPrivateCalendarNotFound(
        racedDatabase,
        created.token,
        NOW + 1_000,
      );
      assert.equal(raced, true);
    } finally {
      database.close();
    }
  });
});

test("private feed includes only an approved public venue label and eligible planning states", async () => {
  const database = fixture();
  try {
    seedEvents(database);
    const created = await createOwnCalendarSubscription(
      database,
      OWNER,
      null,
      NOW,
    );
    const calendar = await readPrivateCalendarSubscription(
      database,
      created.token,
      {
        generatedAt: NOW + 1_000,
        origin: "https://example.invalid",
      },
    );
    assert.match(calendar, /SUMMARY:Visible private plan\r\n/u);
    assert.match(calendar, /LOCATION:Public room\r\n/u);
    assert.doesNotMatch(calendar, /Secret loading-door instructions/u);
    assert.doesNotMatch(calendar, /Completed private plan/u);

    await revokeOwnCalendarSubscription(
      database,
      OWNER,
      created.subscription.id,
      NOW + 2_000,
    );
    await assert.rejects(
      readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 3_000,
        origin: "https://example.invalid",
      }),
      (error) => error?.code === "not_found",
    );
  } finally {
    database.close();
  }
});

test("private feed immediately hides suspended, removed, and cross-organization tokens behind generic not-found", async () => {
  const database = fixture();
  try {
    seedEvents(database);
    const created = await createOwnCalendarSubscription(
      database,
      OWNER,
      "Authorization boundary",
      NOW,
    );
    const assertUntouched = () => {
      const row = database.sqlite
        .prepare(
          `SELECT last_used_at
           FROM ics_subscription_tokens
           WHERE id = ?`,
        )
        .get(created.subscription.id);
      assert.equal(row.last_used_at, null);
      assert.equal(
        database.sqlite
          .prepare(
            `SELECT count(*) AS count
             FROM event_calendar_component_revisions
             WHERE scope = 'private'`,
          )
          .get().count,
        0,
      );
    };

    database.sqlite
      .prepare(
        `UPDATE organization_memberships
         SET status = 'suspended', updated_at = ?
         WHERE id = 'membership-owner'`,
      )
      .run(NOW + 1);
    await assertPrivateCalendarNotFound(
      database,
      created.token,
      NOW + 1_000,
    );
    assertUntouched();

    database.sqlite
      .prepare(
        `UPDATE organization_memberships
         SET status = 'active', deleted_at = ?, updated_at = ?
         WHERE id = 'membership-owner'`,
      )
      .run(NOW + 2, NOW + 2);
    await assertPrivateCalendarNotFound(
      database,
      created.token,
      NOW + 2_000,
    );
    assertUntouched();

    database.exec(`
      UPDATE organization_memberships
      SET deleted_at = NULL, updated_at = ${NOW + 3}
      WHERE id = 'membership-owner';
      INSERT INTO organizations (
        id, name, slug, timezone, owner_bootstrap_closed_at,
        created_by_profile_id, created_at, updated_at, deleted_at
      ) VALUES (
        'org-other', 'Other organization', 'other-organization',
        'America/Vancouver', ${NOW}, 'profile-owner',
        ${NOW}, ${NOW}, NULL
      );
      UPDATE ics_subscription_tokens
      SET organization_id = 'org-other'
      WHERE id = '${created.subscription.id}';
    `);
    await assertPrivateCalendarNotFound(
      database,
      created.token,
      NOW + 3_000,
    );
    assertUntouched();
  } finally {
    database.close();
  }
});

test("private feed advances revision metadata for visible content, venue, and cancellation changes", async () => {
  const database = fixture();
  try {
    seedEvents(database);
    const created = await createOwnCalendarSubscription(
      database,
      OWNER,
      "Revision calendar",
      NOW,
    );
    const initial = calendarEventBlock(
      await readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 1_000,
        origin: "https://example.invalid",
      }),
      "Visible private plan",
    );

    database.sqlite
      .prepare(
        `UPDATE organizer_events
         SET title = 'Visible private plan revised',
             content_version = content_version + 1,
             updated_at = ?
         WHERE id = 'event-visible'`,
      )
      .run(NOW + 2_000);
    const contentUpdated = calendarEventBlock(
      await readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 3_000,
        origin: "https://example.invalid",
      }),
      "Visible private plan revised",
    );
    assertRevisionAdvanced(initial, contentUpdated);

    database.sqlite
      .prepare(
        `UPDATE venues
         SET public_location_name = 'Revised public room',
             updated_at = ?
         WHERE id = 'venue-public'`,
      )
      .run(NOW + 4_000);
    const venueUpdated = calendarEventBlock(
      await readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 5_000,
        origin: "https://example.invalid",
      }),
      "Visible private plan revised",
    );
    assert.match(venueUpdated, /LOCATION:Revised public room\r\n/u);
    assertRevisionAdvanced(contentUpdated, venueUpdated);

    database.sqlite
      .prepare(
        `UPDATE organizer_events
         SET planning_status = 'cancelled',
             content_version = content_version + 1,
             updated_at = ?
         WHERE id = 'event-visible'`,
      )
      .run(NOW + 6_000);
    const cancelled = calendarEventBlock(
      await readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 7_000,
        origin: "https://example.invalid",
      }),
      "Visible private plan revised",
    );
    assert.match(cancelled, /STATUS:CANCELLED\r\n/u);
    assertRevisionAdvanced(venueUpdated, cancelled);
  } finally {
    database.close();
  }
});

test("private feed legacy-source content revisions advance sequence and last-modified", async () => {
  const database = fixture();
  try {
    seedEvents(database);
    seedLegacyPrivateFeedEvent(database);
    const created = await createOwnCalendarSubscription(
      database,
      OWNER,
      "Legacy revision calendar",
      NOW,
    );
    const initial = calendarEventBlock(
      await readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 1_000,
        origin: "https://example.invalid",
      }),
      "Legacy private plan",
    );
    database.sqlite
      .prepare(
        `UPDATE events
         SET title = 'Legacy private plan revised', updated_at = ?
         WHERE id = 'legacy-private-event'`,
      )
      .run(NOW + 2_000);
    const revised = calendarEventBlock(
      await readPrivateCalendarSubscription(database, created.token, {
        generatedAt: NOW + 3_000,
        origin: "https://example.invalid",
      }),
      "Legacy private plan revised",
    );
    assertRevisionAdvanced(initial, revised);
  } finally {
    database.close();
  }
});

test("operational CSV executes the three-source SQL with exact bindings", async () => {
  const database = fixture();
  try {
    seedEvents(database);
    const download = await createOperationalEventCsv(database, OWNER, NOW);
    assert.equal(download.contentType, "text/csv; charset=utf-8");
    assert.match(download.body, /Visible private plan/u);
    assert.match(download.body, /Completed private plan/u);
    assert.doesNotMatch(download.body, /calendar-owner@example\.invalid/u);
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'event_export.operational_csv'`,
        )
        .get().count,
      1,
    );
  } finally {
    database.close();
  }
});

test("Owner backup uses explicit pseudonyms and excludes identity and token data", async () => {
  const database = fixture();
  try {
    seedEvents(database);
    seedSensitiveEventRevision(database);
    const download = await createOwnerJsonBackup(database, OWNER, {
      confirmation: "GENERATE SENSITIVE OWNER BACKUP",
      generatedAt: NOW,
      sourceRevision: SOURCE_REVISION,
    });
    const backup = JSON.parse(download.body);
    assert.equal(backup.schemaVersion, "vcc-owner-backup-v1");
    assert.equal(backup.sourceRevision, SOURCE_REVISION);
    assert.equal(backup.sections.memberships[0].reference, "member-1");
    const visibleEvent = backup.sections.events.find(
      (event) => event.id === "event-visible",
    );
    assert.equal(visibleEvent.primaryOrganizer, "member-1");
    assert.match(
      visibleEvent.privateNotes,
      /\[redacted-email\]/u,
    );
    assert.match(
      visibleEvent.privateNotes,
      /\[redacted-private-url\]/u,
    );
    const revision = backup.sections.eventRevisions.find(
      (candidate) => candidate.id === "revision-sensitive",
    );
    assert.equal(revision.actor, "member-1");
    assert.equal(revision.snapshot.primaryOrganizer, "member-1");
    assert.deepEqual(revision.snapshot.coOrganizers, ["member-1"]);
    assert.equal(revision.snapshot.createdBy, "member-1");
    assert.equal(revision.snapshot.updatedBy, "member-1");
    assert.equal(
      revision.snapshot.meetupEventUrl,
      "https://www.meetup.com/vancouver-curiosity/events/123456789/",
    );
    assert.equal(
      revision.snapshot.schedule.timeZone,
      "America/Vancouver",
    );
    assert.doesNotMatch(download.body, /calendar-owner@example\.invalid/u);
    assert.doesNotMatch(download.body, /profile-owner/u);
    assert.doesNotMatch(download.body, /provider-subject-sentinel/u);
    assert.doesNotMatch(download.body, /ZOOM-CREDENTIAL-SENTINEL/u);
    assert.doesNotMatch(download.body, /QUERY-TOKEN-SENTINEL/u);
    assert.doesNotMatch(download.body, /PRIVATE-FEED-SENTINEL/u);
    assert.doesNotMatch(download.body, /NESTED-SECRET-SENTINEL/u);
    assert.doesNotMatch(download.body, /WHEREBY-PRIVATE-SENTINEL/u);
    assert.doesNotMatch(download.body, /private_meeting_details/iu);
    assert.doesNotMatch(download.body, /"(?:tokenHash|objectKey)"\s*:/u);
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'owner_backup.generated'`,
        )
        .get().count,
      1,
    );
  } finally {
    database.close();
  }
});

test("Owner backup seals its audit only after final live Owner revalidation", async () => {
  const database = fixture();
  try {
    seedEvents(database);
    const originalBatch = database.batch.bind(database);
    let demoted = false;
    database.batch = async (statements) => {
      const results = await originalBatch(statements);
      database.sqlite
        .prepare(
          `UPDATE organization_memberships
           SET role = 'administrator', updated_at = ?
           WHERE id = 'membership-owner'`,
        )
        .run(NOW + 1);
      demoted = true;
      return results;
    };

    await assert.rejects(
      createOwnerJsonBackup(database, OWNER, {
        confirmation: "GENERATE SENSITIVE OWNER BACKUP",
        generatedAt: NOW,
        sourceRevision: SOURCE_REVISION,
      }),
      (error) => error?.code === "authorization_denied",
    );
    assert.equal(demoted, true);
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'owner_backup.generated'`,
        )
        .get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("Owner backup projects nested CMS and settings JSON through contextual allowlists", async () => {
  const database = fixture();
  try {
    seedNestedBackupSentinels(database);
    const download = await createOwnerJsonBackup(database, OWNER, {
      confirmation: "GENERATE SENSITIVE OWNER BACKUP",
      generatedAt: NOW,
      sourceRevision: SOURCE_REVISION,
    });
    const backup = JSON.parse(download.body);
    const section = backup.sections.pageSections.find(
      (candidate) => candidate.id === "section-backup-safety",
    );
    assert.deepEqual(section.content, {
      heading: "Retained allowlisted heading",
      paragraphs: ["Retained allowlisted paragraph."],
    });
    const revision = backup.sections.cmsRevisions.find(
      (candidate) => candidate.id === "cms-revision-backup-safety",
    );
    assert.deepEqual(revision.snapshot, { unavailable: true });
    assert.deepEqual(backup.sections.publicSettings, []);
    for (const sentinel of NESTED_BACKUP_SENTINELS) {
      assert.equal(download.body.includes(sentinel), false, sentinel);
    }
    assert.doesNotMatch(
      download.body,
      /"(?:apiKey|authHeader|providerIdentity|profileId|r2ObjectKey|sourceFeedUrl|meetingUrl|token)"\s*:/u,
    );
  } finally {
    database.close();
  }
});

test("Owner backup rejects an invalid source revision before reading or auditing", async () => {
  const database = fixture();
  try {
    await assert.rejects(
      createOwnerJsonBackup(database, OWNER, {
        confirmation: "GENERATE SENSITIVE OWNER BACKUP",
        generatedAt: NOW,
        sourceRevision: "unavailable",
      }),
      (error) =>
        error?.code === "validation_failed" &&
        /exact source revision/iu.test(error?.safeMessage ?? error?.message),
    );
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'owner_backup.generated'`,
        )
        .get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("Owner backup rejects max-plus-one section rows without audit or truncation", async () => {
  const database = fixture();
  try {
    seedBackupLaneOverflow(
      database,
      OWNER_BACKUP_SECTION_LIMITS.lanes + 1,
    );
    await assert.rejects(
      createOwnerJsonBackup(database, OWNER, {
        confirmation: "GENERATE SENSITIVE OWNER BACKUP",
        generatedAt: NOW,
        sourceRevision: SOURCE_REVISION,
      }),
      (error) =>
        error?.code === "validation_failed" &&
        /too large/iu.test(error?.safeMessage ?? error?.message),
    );
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'owner_backup.generated'`,
        )
        .get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("Owner backup SQL is bounded and compiles with exact bindings on real D1", async () => {
  const recording = startSqliteD1StatementRecording({
    sourceIncludes: "lib/server/phase7/owner-backup.ts",
  });
  const database = fixture();
  const originalBatch = database.batch.bind(database);
  const batchSizes = [];
  database.batch = async (statements) => {
    batchSizes.push(statements.length);
    return originalBatch(statements);
  };
  let shapes;
  try {
    await createOwnerJsonBackup(database, OWNER, {
      confirmation: "GENERATE SENSITIVE OWNER BACKUP",
      generatedAt: NOW,
      sourceRevision: SOURCE_REVISION,
    });
    shapes = recording.stop();
  } finally {
    recording.stop();
    database.close();
  }
  const boundedSectionShapes = shapes.filter(
    ({ sql }) =>
      sql.includes("LIMIT ?") &&
      Object.keys(OWNER_BACKUP_SECTION_LIMITS).some((section) =>
        backupSectionSqlMarker(section, sql),
      ),
  );
  assert.equal(
    boundedSectionShapes.length,
    Object.keys(OWNER_BACKUP_SECTION_LIMITS).length,
  );
  assert.deepEqual(
    boundedSectionShapes.map(({ bindings }) => bindings.length),
    Array(boundedSectionShapes.length).fill(2),
  );
  assert.deepEqual(
    boundedSectionShapes.map(({ bindings }) => bindings[1]),
    Object.values(OWNER_BACKUP_SECTION_LIMITS).map(
      (maximum) => maximum + 1,
    ),
  );
  assert.deepEqual(batchSizes, [
    Object.keys(OWNER_BACKUP_SECTION_LIMITS).length + 1,
  ]);
  await assertRecordedD1ShapesCompile(shapes, {
    expectedCount: 20,
    label: "Owner backup service",
  });
});

test("whole Worker export and calendar routes retain exact D1 statement headroom", async () => {
  const database = fixture();
  try {
    const routeNow = Date.now();
    seedEvents(database);
    seedMedia(database);
    seedPublicRouteBudgetEvent(database, routeNow);
    const adoptionActor = await authorizeOrganizerAccess(database, OWNER);
    assert.equal(
      await ensureCmsAdoption(database, adoptionActor, routeNow + 1),
      "adopted",
    );
    await installInvariantFastPath(database);
    const counter = countedBinding(database);
    const fromDate = new Date(routeNow).toISOString().slice(0, 10);
    const toDate = new Date(routeNow + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const publicInput = {
      generatedAt: routeNow,
      origin: "https://example.invalid",
      searchParams: new URLSearchParams(
        `from=${fromDate}&to=${toDate}`,
      ),
    };
    const runRoute = async ({
      expected,
      method,
      pathname,
      work,
    }) => {
      counter.resetCounts();
      assert.equal(
        await ensureDatabaseInvariants(counter.binding),
        "ready",
        `${pathname} must enter through the invariant fast path`,
      );
      const invariantStatements = counter.counts().statementCount;
      const maintenance = await runRequestMaintenance(counter.binding, {
        method,
        pathname,
      });
      assert.deepEqual(maintenance, { kind: "continue" });
      const maintenanceStatements =
        counter.counts().statementCount - invariantStatements;
      const value = await work(counter.binding);
      const counts = counter.counts();
      const routeStatements =
        counts.statementCount -
        invariantStatements -
        maintenanceStatements;
      assert.deepEqual(
        {
          invariantStatements,
          maintenanceStatements,
          routeStatements,
          totalStatements: counts.statementCount,
        },
        expected,
        pathname,
      );
      assert.ok(
        counts.statementCount <= DATABASE_INVARIANT_STATEMENT_LIMIT - 10,
        `${pathname} used ${counts.statementCount} statements without ten-statement headroom`,
      );
      assert.ok(
        counts.batchLengths.every(
          (length) => length <= DATABASE_INVARIANT_STATEMENT_LIMIT - 10,
        ),
        `${pathname} batch lengths ${counts.batchLengths.join(", ")} lacked headroom`,
      );
      return value;
    };
    const organizerRoute = async (binding, allowedRoles, work) => {
      const membership = await authorizeOrganizerAccess(
        binding,
        OWNER,
      );
      assert.ok(allowedRoles.includes(membership.role));
      return work();
    };

    const calendar = await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 2,
        routeStatements: 6,
        totalStatements: 10,
      },
      method: "GET",
      pathname: "/events/calendar.ics",
      work: (binding) =>
        createFilteredPublicIcsDownload(binding, publicInput),
    });
    assert.match(calendar.body, /Budget public event/u);

    const oneEventCalendar = await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 2,
        routeStatements: 6,
        totalStatements: 10,
      },
      method: "GET",
      pathname: "/events/budget-public-event/calendar.ics",
      work: (binding) =>
        createOneEventIcsDownload(binding, {
          generatedAt: routeNow,
          origin: "https://example.invalid",
          slug: "budget-public-event",
        }),
    });
    assert.match(oneEventCalendar?.body ?? "", /Budget public event/u);

    const publicCsv = await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 2,
        routeStatements: 3,
        totalStatements: 7,
      },
      method: "GET",
      pathname: "/events/events.csv",
      work: (binding) =>
        createFilteredPublicCsvDownload(binding, publicInput),
    });
    assert.match(publicCsv.body, /Budget public event/u);

    await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 0,
        routeStatements: 4,
        totalStatements: 6,
      },
      method: "GET",
      pathname: "/api/organizer/exports/events.csv",
      work: (binding) =>
        organizerRoute(binding, ["owner", "administrator"], () =>
          createOperationalEventCsv(binding, OWNER, routeNow),
        ),
    });

    await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 0,
        routeStatements: 21,
        totalStatements: 23,
      },
      method: "POST",
      pathname: "/api/organizer/exports/backup.json",
      work: (binding) =>
        organizerRoute(binding, ["owner"], () =>
          createOwnerJsonBackup(binding, OWNER, {
            confirmation: "GENERATE SENSITIVE OWNER BACKUP",
            generatedAt: routeNow,
            sourceRevision: SOURCE_REVISION,
          }),
        ),
    });

    await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 0,
        routeStatements: 4,
        totalStatements: 6,
      },
      method: "GET",
      pathname: "/api/organizer/exports/media-manifest.json",
      work: (binding) =>
        organizerRoute(binding, ["owner"], () =>
          createOwnerMediaManifest(binding, OWNER, routeNow),
        ),
    });

    const bucket = {
      async delete() {},
      async get() {
        return {
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3, 4]).buffer;
          },
          body: null,
          size: 4,
        };
      },
      async put() {},
    };
    await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 0,
        routeStatements: 4,
        totalStatements: 6,
      },
      method: "GET",
      pathname: "/api/organizer/exports/media/asset-owner/original",
      work: (binding) =>
        organizerRoute(binding, ["owner"], () =>
          getOwnerMediaOriginal(
            binding,
            bucket,
            OWNER,
            "asset-owner",
            routeNow,
          ),
        ),
    });

    const created = await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 0,
        routeStatements: 5,
        totalStatements: 7,
      },
      method: "POST",
      pathname: "/api/organizer/calendar-tokens",
      work: (binding) =>
        organizerRoute(
          binding,
          ["owner", "administrator", "organizer"],
          () =>
            createOwnCalendarSubscription(
              binding,
              OWNER,
              "Worker budget",
              routeNow,
            ),
        ),
    });

    await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 0,
        routeStatements: 6,
        totalStatements: 8,
      },
      method: "GET",
      pathname: "/api/calendar/private/[token]",
      work: (binding) =>
        readPrivateCalendarSubscription(binding, created.token, {
          generatedAt: routeNow + 1_000,
          origin: "https://example.invalid",
        }),
    });

    await runRoute({
      expected: {
        invariantStatements: 2,
        maintenanceStatements: 0,
        routeStatements: 6,
        totalStatements: 8,
      },
      method: "POST",
      pathname:
        "/api/organizer/calendar-tokens/[id]/revoke",
      work: (binding) =>
        organizerRoute(
          binding,
          ["owner", "administrator", "organizer"],
          () =>
            revokeOwnCalendarSubscription(
              binding,
              OWNER,
              created.subscription.id,
              routeNow + 2_000,
            ),
        ),
    });
  } finally {
    database.close();
  }
});

test("private export and calendar authorization follows the role matrix", async () => {
  const database = fixture();
  try {
    seedMember(database, {
      email: ADMIN.email,
      id: "admin",
      role: "administrator",
    });
    seedMember(database, {
      email: ORGANIZER.email,
      id: "organizer",
      role: "organizer",
    });
    assert.match(
      (await createOperationalEventCsv(database, ADMIN, NOW)).body,
      /^event_reference,/u,
    );
    await assert.rejects(
      createOperationalEventCsv(database, ORGANIZER, NOW),
      (error) => error?.code === "authorization_denied",
    );
    await assert.rejects(
      createOwnerJsonBackup(database, ADMIN, {
        confirmation: "GENERATE SENSITIVE OWNER BACKUP",
        generatedAt: NOW,
        sourceRevision: "abcdef1234567890",
      }),
      (error) => error?.code === "authorization_denied",
    );
    const ownToken = await createOwnCalendarSubscription(
      database,
      ORGANIZER,
      "Organizer calendar",
      NOW,
    );
    assert.equal(ownToken.token.length, 43);
  } finally {
    database.close();
  }
});

test("Owner media manifest and download resolve R2 keys server-side only", async () => {
  const database = fixture();
  try {
    seedMedia(database);
    const manifest = await createOwnerMediaManifest(database, OWNER, NOW);
    assert.match(manifest.body, /"id": "asset-owner"/u);
    assert.match(manifest.body, /"sha256": "d{64}"/u);
    assert.doesNotMatch(manifest.body, /PRIVATE-R2-KEY-SENTINEL/u);

    let requestedKey = null;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const bucket = {
      async delete() {},
      async get(key) {
        requestedKey = key;
        return {
          async arrayBuffer() {
            return bytes.buffer;
          },
          body: null,
          size: bytes.byteLength,
        };
      },
      async put() {},
    };
    const media = await getOwnerMediaOriginal(
      database,
      bucket,
      OWNER,
      "asset-owner",
      NOW,
    );
    assert.equal(requestedKey, "PRIVATE-R2-KEY-SENTINEL");
    assert.equal(media.fileName, "owner-image.png");
    assert.equal(media.byteSize, 4);
    await assert.rejects(
      getOwnerMediaOriginal(
        database,
        bucket,
        OWNER,
        "asset-guessed",
        NOW,
      ),
      (error) => error?.code === "not_found",
    );
  } finally {
    database.close();
  }
});

test("Owner manifest and backup reject max-plus-one media usages without truncation or audit", async () => {
  const database = fixture();
  try {
    seedMedia(database);
    seedDenseMediaUsages(database, MEDIA_MANIFEST_USAGE_LIMIT + 1);

    await assert.rejects(
      createOwnerMediaManifest(database, OWNER, NOW),
      (error) =>
        error?.code === "validation_failed" &&
        /too many active usages/iu.test(
          error?.safeMessage ?? error?.message,
        ),
    );
    await assert.rejects(
      createOwnerJsonBackup(database, OWNER, {
        confirmation: "GENERATE SENSITIVE OWNER BACKUP",
        generatedAt: NOW,
        sourceRevision: SOURCE_REVISION,
      }),
      (error) =>
        error?.code === "validation_failed" &&
        /too many active usages/iu.test(
          error?.safeMessage ?? error?.message,
        ),
    );
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action IN (
             'media_export.manifest',
             'owner_backup.generated'
           )`,
        )
        .get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("Owner media manifest denies a response when Owner authority changes after its read", async () => {
  const database = fixture();
  try {
    seedMedia(database);
    const originalPrepare = database.prepare.bind(database);
    let demoted = false;
    database.prepare = (sql) => {
      const statement = originalPrepare(sql);
      if (
        !sql.includes("FROM media_assets AS asset") ||
        !sql.includes("media_usage_references AS usage")
      ) {
        return statement;
      }
      const originalBind = statement.bind.bind(statement);
      statement.bind = (...bindings) => {
        const bound = originalBind(...bindings);
        const originalAll = bound.all.bind(bound);
        bound.all = async () => {
          const result = await originalAll();
          database.sqlite
            .prepare(
              `UPDATE organization_memberships
               SET role = 'administrator', updated_at = ?
               WHERE id = 'membership-owner'`,
            )
            .run(NOW + 1);
          demoted = true;
          return result;
        };
        return bound;
      };
      return statement;
    };

    await assert.rejects(
      createOwnerMediaManifest(database, OWNER, NOW),
      (error) => error?.code === "authorization_denied",
    );
    assert.equal(demoted, true);
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'media_export.manifest'`,
        )
        .get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("Owner media original denies bytes when Owner authority changes during R2 retrieval", async () => {
  const database = fixture();
  try {
    seedMedia(database);
    let requestedKey = null;
    const bucket = {
      async delete() {},
      async get(key) {
        requestedKey = key;
        database.sqlite
          .prepare(
            `UPDATE organization_memberships
             SET role = 'administrator', updated_at = ?
             WHERE id = 'membership-owner'`,
          )
          .run(NOW + 1);
        return {
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3, 4]).buffer;
          },
          body: null,
          size: 4,
        };
      },
      async put() {},
    };

    await assert.rejects(
      getOwnerMediaOriginal(
        database,
        bucket,
        OWNER,
        "asset-owner",
        NOW,
      ),
      (error) => error?.code === "authorization_denied",
    );
    assert.equal(requestedKey, "PRIVATE-R2-KEY-SENTINEL");
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'media_export.original_downloaded'`,
        )
        .get().count,
      0,
    );
  } finally {
    database.close();
  }
});

function seedNestedBackupSentinels(database) {
  const sectionJson = JSON.stringify({
    heading: "Retained allowlisted heading",
    paragraphs: ["Retained allowlisted paragraph."],
    integration: {
      apiKey: "NESTED-API-KEY-SENTINEL",
      authHeader: "NESTED-AUTH-HEADER-SENTINEL",
      meetingUrl:
        "https://zoom.us/j/NESTED-MEETING-SENTINEL",
      profileId: "NESTED-PROFILE-SENTINEL",
      providerIdentity: "NESTED-PROVIDER-SENTINEL",
      r2ObjectKey: "NESTED-R2-KEY-SENTINEL",
      sourceFeedUrl:
        "https://example.invalid/calendar/private/NESTED-FEED-SENTINEL",
      token: "NESTED-TOKEN-SENTINEL",
      url:
        "https://example.invalid/resource?token=NESTED-QUERY-URL-SENTINEL",
      visitorEmail: "nested-owner@example.invalid",
    },
  });
  const cmsSnapshot = JSON.stringify({
    title: "Backup safety page",
    slug: "backup-safety",
    seoTitle: "Backup safety",
    metaDescription:
      "A substantive synthetic description used only for backup safety testing.",
    openGraphAssetId: null,
    blocks: [
      {
        id: "block-backup-safety",
        type: "intro",
        config: {
          heading: "Safe heading",
          text: "Substantive safe body copy for the backup fixture.",
        },
      },
    ],
    providerIdentity: "NESTED-PROVIDER-SENTINEL",
    apiKey: "NESTED-API-KEY-SENTINEL",
    authHeader: "NESTED-AUTH-HEADER-SENTINEL",
    token: "NESTED-TOKEN-SENTINEL",
  });
  const settingJson = JSON.stringify({
    brandName: "Vancouver Curiosity Club",
    footerMission: "Existing public mission.",
    locationLabel: "Vancouver, British Columbia",
    logoAssetId: null,
    metaDescription: "Thoughtful events in good company.",
    mission: "A community organization for curious people.",
    openGraphAssetId: null,
    palette: {
      accent: "#2156D8",
      background: "#F5F0E6",
      foreground: "#142C30",
      secondary: "#0C665E",
    },
    seoTitle: "Vancouver Curiosity Club",
    tagline: "A social calendar with a brain.",
    typography: "editorial",
    private: {
      apiKey: "NESTED-API-KEY-SENTINEL",
      authHeader: "NESTED-AUTH-HEADER-SENTINEL",
      r2ObjectKey: "NESTED-R2-KEY-SENTINEL",
      sourceFeedUrl:
        "https://example.invalid/calendar/private/NESTED-FEED-SENTINEL",
      meetingUrl:
        "https://meet.google.com/NESTED-MEETING-SENTINEL",
      visitorEmail: "nested-owner@example.invalid",
      url:
        "https://example.invalid/resource?token=NESTED-QUERY-URL-SENTINEL",
    },
  });
  database
    .prepare(
      `INSERT INTO pages (
         id, organization_id, title, slug, status, visibility,
         current_revision, published_at, created_by_profile_id,
         updated_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (?, 'org-vcc', ?, ?, 'draft', 'private', 1, NULL,
                 'profile-owner', 'profile-owner', ?, ?, NULL)`,
    )
    .bind(
      "page-backup-safety",
      "Backup safety page",
      "backup-safety",
      NOW,
      NOW,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO page_sections (
         id, organization_id, page_id, section_key, section_type,
         content_json, sort_order, created_at, updated_at, deleted_at
       ) VALUES (?, 'org-vcc', ?, 'intro', 'intro', ?, 0, ?, ?, NULL)`,
    )
    .bind(
      "section-backup-safety",
      "page-backup-safety",
      sectionJson,
      NOW,
      NOW,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_entity_publication_states (
         id, organization_id, entity_type, entity_key, workflow_status,
         content_version, current_draft_revision_id, published_revision_id,
         last_editor_profile_id, draft_updated_at, published_at,
         unpublished_at, adopted_at, created_at, updated_at
       ) VALUES (?, 'org-vcc', 'page', ?, 'archived', 1, NULL, NULL,
                 'profile-owner', NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(
      "cms-state-backup-safety",
      "page-backup-safety",
      NOW,
      NOW,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO cms_entity_revisions (
         id, organization_id, publication_state_id, entity_type, entity_key,
         revision_number, snapshot_json, content_hash, canonical_byte_size,
         restored_from_revision_id, legacy_page_revision_id,
         actor_profile_id, created_at
       ) VALUES (?, 'org-vcc', ?, 'page', ?, 1, ?, ?, ?, NULL, NULL,
                 'profile-owner', ?)`,
    )
    .bind(
      "cms-revision-backup-safety",
      "cms-state-backup-safety",
      "page-backup-safety",
      cmsSnapshot,
      "c".repeat(64),
      Buffer.byteLength(cmsSnapshot),
      NOW,
    )
    .runSynchronously();
  database
    .prepare(
      `INSERT INTO site_settings (
         id, organization_id, key, value_json, is_public,
         updated_by_profile_id, created_at, updated_at
       ) VALUES (?, 'org-vcc', 'public_identity', ?, 1,
                 'profile-owner', ?, ?)`,
    )
    .bind("setting-backup-safety", settingJson, NOW, NOW)
    .runSynchronously();
}

function seedBackupLaneOverflow(database, count) {
  const statement = database.sqlite.prepare(
    `INSERT INTO event_lanes (
       id, organization_id, name, slug, description, sort_order,
       created_by_profile_id, created_at, updated_at, deleted_at
     ) VALUES (?, 'org-vcc', ?, ?, 'Backup bound fixture', ?,
               'profile-owner', ?, ?, NULL)`,
  );
  database.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < count; index += 1) {
      const suffix = String(index + 1).padStart(3, "0");
      statement.run(
        `lane-backup-${suffix}`,
        `Backup lane ${suffix}`,
        `backup-lane-${suffix}`,
        index,
        NOW,
        NOW,
      );
    }
    database.sqlite.exec("COMMIT");
  } catch (error) {
    database.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function backupSectionSqlMarker(section, sql) {
  const markers = {
    organization: "SELECT name, slug, timezone, created_at, updated_at",
    memberships:
      "SELECT profile_id, role, status, created_at, updated_at, deleted_at",
    clubs:
      "SELECT id, name, slug, description, created_at, updated_at, deleted_at",
    programs: "SELECT id, club_id, name, slug, description",
    lanes: "SELECT id, name, slug, description, sort_order",
    categories:
      "SELECT category.id, category.name, category.slug, category.description",
    venues: "SELECT id, name, slug, timezone, public_location_name",
    events: "SELECT id, club_id, program_id, event_lane_id",
    eventOrganizers:
      "SELECT organizer_event_id, profile_id, created_at, deleted_at",
    eventRevisions:
      "SELECT id, organizer_event_id, action, content_version",
    conflictPolicy:
      "SELECT policy_version, mode, default_hold_hours",
    pages: "SELECT id, title, slug, status, visibility",
    pageSections: "SELECT id, page_id, section_key, section_type",
    cmsRevisions:
      "SELECT id, entity_type, entity_key, revision_number",
    communityLinks:
      "SELECT id, label, url, link_type, is_published",
    navigation:
      "SELECT id, label, placement, page_id, external_url",
    publicSettings: "SELECT key, value_json, created_at, updated_at",
  };
  return sql.includes(markers[section]);
}

function afterCalendarRevisionRead(database, afterRead) {
  let fired = false;
  const wrap = (statement, sql) => ({
    inner: statement,
    bind(...values) {
      return wrap(statement.bind(...values), sql);
    },
    first(...args) {
      return statement.first(...args);
    },
    run(...args) {
      return statement.run(...args);
    },
    async all(...args) {
      const result = await statement.all(...args);
      if (
        !fired &&
        sql.includes(
          "JOIN event_calendar_component_revisions AS revision",
        ) &&
        sql.includes("ORDER BY requested.ordinal ASC")
      ) {
        fired = true;
        await afterRead();
      }
      return result;
    },
  });
  return {
    batch(statements) {
      return database.batch(
        statements.map((statement) => statement.inner ?? statement),
      );
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };
}

async function assertPrivateCalendarNotFound(
  database,
  rawToken,
  generatedAt,
) {
  let rejected;
  try {
    await readPrivateCalendarSubscription(database, rawToken, {
      generatedAt,
      origin: "https://example.invalid",
    });
  } catch (error) {
    rejected = error;
  }
  assert.ok(rejected, "the private feed must reject");
  assert.equal(rejected.code, "not_found");
  assert.equal(rejected.status, 404);
  assert.equal(
    rejected.publicMessage,
    "The calendar subscription could not be found.",
  );
  assert.equal(
    [
      rejected.message,
      rejected.publicMessage,
      JSON.stringify(rejected),
    ].join("\n").includes(rawToken),
    false,
    "the raw calendar token must not appear in the error",
  );
}

function countedBinding(database) {
  let statementCount = 0;
  const batchLengths = [];

  function wrap(statement) {
    return {
      inner: statement,
      bind(...values) {
        return wrap(statement.bind(...values));
      },
      async first(...arguments_) {
        statementCount += 1;
        return statement.first(...arguments_);
      },
      async all(...arguments_) {
        statementCount += 1;
        return statement.all(...arguments_);
      },
      async run(...arguments_) {
        statementCount += 1;
        return statement.run(...arguments_);
      },
    };
  }

  return {
    binding: {
      async batch(statements) {
        statementCount += statements.length;
        batchLengths.push(statements.length);
        return database.batch(
          statements.map((statement) => statement.inner),
        );
      },
      prepare(sql) {
        return wrap(database.prepare(sql));
      },
    },
    counts() {
      return {
        batchLengths: [...batchLengths],
        statementCount,
      };
    },
    resetCounts() {
      statementCount = 0;
      batchLengths.length = 0;
    },
  };
}

function afterNextD1Batch(database, hook) {
  let fired = false;
  return {
    async batch(statements) {
      const results = await database.batch(statements);
      if (!fired) {
        fired = true;
        await hook();
      }
      return results;
    },
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return database.prepare(sql);
    },
  };
}

function revokeRetryRaceDatabase(database, tokenId) {
  let batchLengths = [];
  let firedSealDrift = false;
  let firedWinner = false;
  let ownSubscriptionReads = 0;
  let statementCount = 0;

  const racedDatabase = {
    async batch(statements) {
      statementCount += statements.length;
      batchLengths.push(statements.length);
      return database.batch(
        statements.map((statement) => statement.inner ?? statement),
      );
    },
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };
  return Object.freeze({
    counts: () => ({
      batchLengths: [...batchLengths],
      statementCount,
    }),
    database: racedDatabase,
    firedSealDrift: () => firedSealDrift,
    firedWinner: () => firedWinner,
  });

  function wrap(statement, sql) {
    return {
      inner: statement,
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      async all(...arguments_) {
        statementCount += 1;
        return statement.all(...arguments_);
      },
      async first(...arguments_) {
        statementCount += 1;
        const result = await statement.first(...arguments_);
        if (
          sql.includes(
            "SELECT id, label, created_at, last_used_at, revoked_at",
          ) &&
          sql.includes("FROM ics_subscription_tokens")
        ) {
          ownSubscriptionReads += 1;
          if (ownSubscriptionReads === 1) {
            await revokeOwnCalendarSubscription(
              database,
              ADMIN,
              tokenId,
              NOW + 1,
            );
            firedWinner = true;
          } else if (ownSubscriptionReads === 2) {
            await suspendCalendarAdministrator(database);
            firedSealDrift = true;
          }
        }
        return result;
      },
      async run(...arguments_) {
        statementCount += 1;
        return statement.run(...arguments_);
      },
    };
  }
}

async function installInvariantFastPath(database) {
  for (const statement of DATABASE_INVARIANT_TRIGGER_STATEMENTS) {
    database.exec(statement);
  }
  database.sqlite
    .prepare(
      `INSERT INTO database_invariant_state (
         singleton_key, version, trigger_fingerprint, verified_at
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(
      DATABASE_INVARIANT_MARKER_KEY,
      DATABASE_INVARIANT_VERSION,
      await getExpectedDatabaseInvariantFingerprint(),
      Date.now(),
    );
}

function seedCalendarAdministrator(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at, deleted_at
    ) VALUES (
      'profile-admin', 'email:calendar-admin@example.invalid',
      'calendar-admin@example.invalid', 'Calendar Administrator',
      'active', ${NOW}, ${NOW}, NULL
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'membership-admin', 'org-vcc', 'profile-admin',
      'calendar-admin@example.invalid', 'administrator', 'active',
      'profile-owner', ${NOW}, ${NOW}, NULL
    );
  `);
}

function suspendCalendarAdministrator(database) {
  return database
    .prepare(
      `UPDATE profiles
       SET status = 'suspended', updated_at = updated_at + 1
       WHERE id = 'profile-admin'`,
    )
    .run();
}

function fixture() {
  const database = new SqliteD1TestDatabase(fullSchemaSql());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at, deleted_at
    ) VALUES (
      'profile-owner', 'email:calendar-owner@example.invalid',
      'calendar-owner@example.invalid', 'Calendar Owner', 'active',
      ${NOW}, ${NOW}, NULL
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'org-vcc', 'Vancouver Curiosity Club', 'vancouver-curiosity-club',
      'America/Vancouver', ${NOW}, 'profile-owner',
      ${NOW}, ${NOW}, NULL
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'membership-owner', 'org-vcc', 'profile-owner',
      'calendar-owner@example.invalid', 'owner', 'active',
      'profile-owner', ${NOW}, ${NOW}, NULL
    );
  `);
  return database;
}

function seedEvents(database) {
  database.exec(`
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'lane-think', 'org-vcc', 'Think', 'think', 'Thoughtful events', 1,
      'profile-owner', ${NOW}, ${NOW}, NULL
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, description,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'club-vcc', 'org-vcc', 'Vancouver Curiosity Club', 'vcc',
      'Public route budget fixture.',
      'profile-owner', ${NOW}, ${NOW}, NULL
    );
    INSERT INTO venues (
      id, organization_id, name, slug, timezone,
      public_location_name, public_address, private_address,
      private_directions, accessibility_notes, is_public,
      created_by_profile_id, updated_by_profile_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      'venue-public', 'org-vcc', 'Private database name', 'public-room',
      'America/Vancouver', 'Public room', NULL, 'Private address',
      'Secret loading-door instructions', NULL, 1,
      'profile-owner', 'profile-owner', ${NOW}, ${NOW}, NULL
    );
    INSERT INTO organizer_events (
      id, organization_id, club_id, program_id, event_lane_id,
      category_id, venue_id, primary_organizer_profile_id,
      title, slug, summary, description, private_notes,
      private_meeting_details, meetup_event_url,
      planning_status, publication_status, schedule_shape,
      starts_at_utc, ends_at_utc, timezone,
      all_day_start_date, all_day_end_date_exclusive,
      buffer_before_minutes, buffer_after_minutes,
      content_version, schedule_version,
      created_by_profile_id, updated_by_profile_id,
      created_at, updated_at, deleted_at
    ) VALUES
    (
      'event-visible', 'org-vcc', 'club-vcc', NULL, 'lane-think',
      NULL, 'venue-public', 'profile-owner',
      'Visible private plan', 'visible-private-plan', NULL, NULL,
      'Contact calendar-owner@example.invalid at ${ARBITRARY_PRIVATE_URL_SENTINEL}',
      'Private meeting sentinel', NULL, 'draft', 'private', 'timed',
      ${NOW + 86_400_000}, ${NOW + 90_000_000}, 'America/Vancouver',
      NULL, NULL, 0, 0, 1, 1,
      'profile-owner', 'profile-owner', ${NOW}, ${NOW}, NULL
    ),
    (
      'event-completed', 'org-vcc', 'club-vcc', NULL, 'lane-think',
      NULL, 'venue-public', 'profile-owner',
      'Completed private plan', 'completed-private-plan', NULL, NULL, NULL,
      NULL, NULL, 'completed', 'private', 'timed',
      ${NOW - 90_000_000}, ${NOW - 86_400_000}, 'America/Vancouver',
      NULL, NULL, 0, 0, 1, 1,
      'profile-owner', 'profile-owner', ${NOW}, ${NOW}, NULL
    );
  `);
}

function seedPublicRouteBudgetEvent(database, now) {
  database.exec(`
    UPDATE organizations
    SET slug = 'vancouver-curiosity-and-education-society'
    WHERE id = 'org-vcc';
    INSERT INTO club_public_profiles (
      club_id, organization_id, primary_event_lane_id,
      publication_status, is_featured, description, public_group_url,
      published_at, created_at, updated_at, deleted_at
    ) VALUES (
      'club-vcc', 'org-vcc', 'lane-think', 'published', 1,
      'Public route budget fixture.', NULL, ${now}, ${now}, ${now}, NULL
    );
    INSERT INTO club_public_profile_details (
      club_id, organization_id, public_display_name, short_summary,
      full_description, program_type, theme_color, seo_title,
      meta_description, confirmed_social_links_json, related_resources_json,
      updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'club-vcc', 'org-vcc', 'Vancouver Curiosity Club',
      'Public route budget fixture.', 'Public route budget fixture.',
      'club', '#0C665E', 'Vancouver Curiosity Club',
      'Public route budget fixture.', '[]', '[]', 'profile-owner',
      ${now}, ${now}
    );
    INSERT INTO events (
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
      'event-budget-public', 'org-vcc', 'club-vcc', 'lane-think', NULL,
      'venue-public', 'profile-owner', 'Budget public event',
      'budget-public-event', 'A bounded public route fixture.',
      'A bounded public route fixture.', 'confirmed', 'public', 'timed',
      ${now + 86_400_000}, ${now + 90_000_000}, 'America/Vancouver',
      NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL, NULL, NULL, ${now},
      'profile-owner', 'profile-owner', ${now}, ${now}, NULL
    );
  `);
}

function seedLegacyPrivateFeedEvent(database) {
  database.exec(`
    INSERT INTO events (
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
      'legacy-private-event', 'org-vcc', 'club-vcc', 'lane-think', NULL,
      'venue-public', NULL, 'Legacy private plan', 'legacy-private-plan',
      NULL, NULL, 'draft', 'private', 'timed',
      ${NOW + 172_800_000}, ${NOW + 176_400_000}, 'America/Vancouver',
      NULL, NULL, 0, 0, '[]', 1, 'unreviewed', NULL, NULL, NULL, NULL,
      'profile-owner', 'profile-owner', ${NOW}, ${NOW}, NULL
    );
  `);
}

function calendarEventBlock(calendar, summary) {
  const block = calendar
    .split("BEGIN:VEVENT\r\n")
    .slice(1)
    .map((value) => value.split("END:VEVENT\r\n", 1)[0])
    .find((value) => value.includes(`SUMMARY:${summary}\r\n`));
  assert.ok(block, `Expected calendar event ${summary}`);
  return `${block}END:VEVENT\r\n`;
}

function assertRevisionAdvanced(previous, current) {
  const previousSequence = Number(
    previous.match(/(?:^|\r\n)SEQUENCE:(\d+)\r\n/u)?.[1],
  );
  const currentSequence = Number(
    current.match(/(?:^|\r\n)SEQUENCE:(\d+)\r\n/u)?.[1],
  );
  const previousModified = previous.match(
    /(?:^|\r\n)LAST-MODIFIED:(\d{8}T\d{6}Z)\r\n/u,
  )?.[1];
  const currentModified = current.match(
    /(?:^|\r\n)LAST-MODIFIED:(\d{8}T\d{6}Z)\r\n/u,
  )?.[1];
  assert.equal(Number.isSafeInteger(previousSequence), true);
  assert.equal(Number.isSafeInteger(currentSequence), true);
  assert.ok(currentSequence > previousSequence);
  assert.ok(currentSequence <= 2_147_483_647);
  assert.ok(previousModified);
  assert.ok(currentModified);
  assert.ok(currentModified > previousModified);
}

function seedSensitiveEventRevision(database) {
  database.sqlite
    .prepare(
      `INSERT INTO organizer_event_revisions (
         id, organization_id, organizer_event_id, content_version,
         schedule_version, action, snapshot_json,
         actor_profile_id, created_at
       ) VALUES (
         'revision-sensitive', 'org-vcc', 'event-visible', 1, 1,
         'created', ?, 'profile-owner', ?
       )`,
    )
    .run(
      JSON.stringify({
        id: "event-visible",
        organizationId: "org-vcc",
        clubId: "club-vcc",
        programId: null,
        eventLaneId: "lane-think",
        categoryId: null,
        venueId: "venue-public",
        primaryOrganizerProfileId: "profile-owner",
        coOrganizerProfileIds: [
          "profile-owner",
          "profile-not-in-organization",
        ],
        title: "Visible private plan",
        slug: "visible-private-plan",
        summary: null,
        description: "Safe revision description",
        privateNotes:
          "Contact calendar-owner@example.invalid about the draft.",
        privateMeetingDetails:
          "https://zoom.us/j/123?pwd=ZOOM-CREDENTIAL-SENTINEL",
        meetupEventUrl:
          "https://www.meetup.com/vancouver-curiosity/events/123456789/?token=QUERY-TOKEN-SENTINEL",
        planningStatus: "draft",
        publicationStatus: "private",
        schedule: {
          shape: "timed",
          startsAtUtc: NOW + 86_400_000,
          endsAtUtc: NOW + 90_000_000,
          timeZone: "America/Vancouver",
          nestedCredential:
            "https://meet.google.com/abc-defg-hij?auth=NESTED-SECRET-SENTINEL",
        },
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        contentVersion: 1,
        scheduleVersion: 1,
        createdByProfileId: "profile-owner",
        updatedByProfileId: "profile-owner",
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        providerIdentity: "provider-subject-sentinel",
        privateFeedUrl:
          "https://example.invalid/api/calendar/private/PRIVATE-FEED-SENTINEL",
      }),
      NOW,
    );
}

function seedMember(database, { email, id, role }) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at, deleted_at
    ) VALUES (
      'profile-${id}', 'email:${email}', '${email}', '${id}',
      'active', ${NOW}, ${NOW}, NULL
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'membership-${id}', 'org-vcc', 'profile-${id}', '${email}',
      '${role}', 'active', 'profile-owner', ${NOW}, ${NOW}, NULL
    );
  `);
}

function seedMedia(database) {
  database.exec(`
    INSERT INTO media_assets (
      id, organization_id, object_key, file_name, mime_type, byte_size,
      alt_text, credit, rights_status, participant_consent_status,
      is_public, uploaded_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'asset-owner', 'org-vcc', 'PRIVATE-R2-KEY-SENTINEL',
      'owner-image.png', 'image/png', 4, 'Abstract safe art',
      'Vancouver Curiosity Club', 'approved', 'not_applicable',
      0, 'profile-owner', ${NOW}, ${NOW}, NULL
    );
    INSERT INTO media_asset_details (
      asset_id, organization_id, upload_state, caption,
      private_rights_source_note, private_participant_consent_note,
      focal_point_x, focal_point_y, informative, content_version,
      original_sha256, width, height, pixel_count, failure_code,
      finalized_at, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'asset-owner', 'org-vcc', 'ready', NULL, 'Owner provenance',
      NULL, 5000, 5000, 1, 1, '${"d".repeat(64)}',
      2, 2, 4, NULL, ${NOW}, 'profile-owner', ${NOW}, ${NOW}
    );
    INSERT INTO media_asset_variants (
      id, organization_id, asset_id, variant_kind, object_key,
      mime_type, byte_size, width, height, pixel_count, sha256,
      state, failure_code, created_at, finalized_at
    ) VALUES (
      'variant-owner-original', 'org-vcc', 'asset-owner', 'original',
      'PRIVATE-R2-KEY-SENTINEL', 'image/png', 4, 2, 2, 4,
      '${"d".repeat(64)}', 'ready', NULL, ${NOW}, ${NOW}
    );
  `);
}

function seedDenseMediaUsages(database, count) {
  const statement = database.sqlite.prepare(
    `INSERT INTO media_usage_references (
       id, organization_id, asset_id, entity_type, entity_id,
       revision_id, usage_kind, publication_scope,
       created_by_profile_id, created_at, deleted_at
     ) VALUES (
       ?, 'org-vcc', 'asset-owner', 'page', ?, ?, ?, 'draft',
       'profile-owner', ?, NULL
     )`,
  );
  database.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < count; index += 1) {
      const suffix = String(index + 1).padStart(3, "0");
      statement.run(
        `usage-manifest-${suffix}`,
        `entity-${"e".repeat(148)}-${suffix}`,
        `revision-${"r".repeat(147)}-${suffix}`,
        `usage-${"u".repeat(53)}-${suffix}`,
        NOW,
      );
    }
    database.sqlite.exec("COMMIT");
  } catch (error) {
    database.sqlite.exec("ROLLBACK");
    throw error;
  }
}

let cachedSchemaSql;
function fullSchemaSql() {
  if (cachedSchemaSql) return cachedSchemaSql;
  const statements = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) =>
      productionMigrationFragments(
        readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
      ),
    );
  cachedSchemaSql = `${statements.join(";\n")};`;
  return cachedSchemaSql;
}
