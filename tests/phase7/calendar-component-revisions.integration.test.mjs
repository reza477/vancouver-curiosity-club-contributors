import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  PHASE7_INVARIANT_COUNT_SQL,
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import {
  CALENDAR_COMPONENT_REVISION_LIMIT,
  reconcileCalendarComponentRevisions,
} from "../../lib/server/phase7/calendar-component-revisions.ts";
import {
  ICS_SEQUENCE_MAX,
} from "../../lib/server/phase7/export-format.ts";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";
import {
  SqliteD1TestDatabase,
} from "../auth/sqlite-d1.mjs";

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const POST_2038 = Date.UTC(2042, 0, 2, 3, 4, 5);

test("calendar component revisions are content-derived, monotonic, and scope-separated", async () => {
  const database = fixture();
  try {
    const original = facts();
    const [first] = await reconcile(database, "public", original);
    const [identical] = await reconcile(
      database,
      "public",
      original,
    );
    assert.deepEqual(
      revision(identical),
      revision(first),
      "request time alone must not advance a component revision",
    );

    const sameMillisecond = facts({ summary: "Changed title" });
    const [titleChange] = await reconcile(
      database,
      "public",
      sameMillisecond,
    );
    assert.equal(titleChange.sequence, first.sequence + 1);
    assert.equal(titleChange.lastModifiedAt, first.lastModifiedAt + 1_000);

    const [statusChange] = await reconcile(
      database,
      "public",
      facts({ status: "tentative", summary: "Changed title" }),
    );
    assert.equal(statusChange.sequence, titleChange.sequence + 1);

    const [clubChange] = await reconcile(
      database,
      "public",
      facts({
        description: "Club: Changed club",
        status: "tentative",
        summary: "Changed title",
      }),
    );
    assert.equal(clubChange.sequence, statusChange.sequence + 1);

    const [venueChange] = await reconcile(
      database,
      "public",
      facts({
        description: "Club: Changed club",
        location: "Changed venue",
        status: "tentative",
        summary: "Changed title",
      }),
    );
    assert.equal(venueChange.sequence, clubChange.sequence + 1);

    const [reverted] = await reconcile(
      database,
      "public",
      original,
    );
    assert.equal(reverted.sequence, venueChange.sequence + 1);
    assert.ok(reverted.lastModifiedAt > venueChange.lastModifiedAt);

    const [privateFirst] = await reconcile(
      database,
      "private",
      facts({ description: "Private planning status: draft" }),
    );
    assert.equal(privateFirst.sequence, 0);
    const [privateChanged] = await reconcile(
      database,
      "private",
      facts({ description: "Private planning status: confirmed" }),
    );
    assert.equal(privateChanged.sequence, 1);
    const [publicStillStable] = await reconcile(
      database,
      "public",
      original,
    );
    assert.deepEqual(revision(publicStillStable), revision(reverted));
  } finally {
    database.close();
  }
});

test("calendar revisions remain valid after 2038 and concurrent identical changes increment once", async () => {
  const database = fixture(POST_2038);
  try {
    const [initial] = await reconcile(
      database,
      "public",
      facts(),
    );
    assert.equal(initial.sequence, 0);
    assert.equal(initial.lastModifiedAt, POST_2038);

    const changed = facts({ summary: "Concurrent change" });
    const [left, right] = await Promise.all([
      reconcile(database, "public", changed),
      reconcile(database, "public", changed),
    ]);
    assert.equal(left[0].sequence, 1);
    assert.equal(right[0].sequence, 1);
    assert.equal(left[0].lastModifiedAt, POST_2038 + 1_000);
    assert.equal(right[0].lastModifiedAt, POST_2038 + 1_000);
    assert.equal(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count
           FROM event_calendar_component_revisions`,
        )
        .get().count,
      1,
    );
  } finally {
    database.close();
  }
});

test("calendar revision overflow and forged transitions fail closed without residue", async () => {
  const database = fixture();
  try {
    await reconcile(database, "public", facts());
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `INSERT INTO event_calendar_component_revisions (
               organization_id, scope, event_key, canonical_fingerprint,
               sequence, last_modified_at, created_at, updated_at
             ) VALUES (
               'org-calendar', 'public', 'forged:timestamp',
               ?, 0, 8640000000000000, 8640000000000000,
               8640000000000000
             )`,
          )
          .run("e".repeat(64)),
      /phase7_calendar_component_revision_initial_state_invalid/iu,
    );
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `INSERT INTO event_calendar_component_revisions (
               organization_id, scope, event_key, canonical_fingerprint,
               sequence, last_modified_at, created_at, updated_at
             ) VALUES (
               'org-calendar', 'public', 'forged:max',
               ?, ?, ?, ?, ?
             )`,
          )
          .run(
            "f".repeat(64),
            ICS_SEQUENCE_MAX,
            NOW + ICS_SEQUENCE_MAX * 1_000,
            NOW,
            NOW,
          ),
      /phase7_calendar_component_revision_initial_state_invalid/iu,
    );
    database.exec(
      `DROP TRIGGER event_calendar_component_revisions_phase7_before_update`,
    );
    database.sqlite
      .prepare(
        `UPDATE event_calendar_component_revisions
         SET sequence = ?,
             last_modified_at = created_at + (? * 1000)
         WHERE organization_id = 'org-calendar'
           AND scope = 'public'
           AND event_key = 'organizer:event-calendar'`,
      )
      .run(ICS_SEQUENCE_MAX, ICS_SEQUENCE_MAX);
    database.exec(
      PHASE7_INVARIANT_TRIGGER_STATEMENTS.find((sql) =>
        sql.includes(
          "event_calendar_component_revisions_phase7_before_update",
        ),
      ),
    );

    await assert.rejects(
      reconcile(
        database,
        "public",
        facts({ summary: "Overflow attempt" }),
      ),
      (error) => error?.code === "service_unavailable",
    );
    const retained = database.sqlite
      .prepare(
        `SELECT sequence, last_modified_at
         FROM event_calendar_component_revisions
         WHERE organization_id = 'org-calendar'
           AND scope = 'public'
           AND event_key = 'organizer:event-calendar'`,
      )
      .get();
    assert.equal(retained.sequence, ICS_SEQUENCE_MAX);
    assert.equal(
      retained.last_modified_at,
      NOW + ICS_SEQUENCE_MAX * 1_000,
    );
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `DELETE FROM event_calendar_component_revisions
             WHERE organization_id = 'org-calendar'
               AND scope = 'public'
               AND event_key = 'organizer:event-calendar'`,
          )
          .run(),
      /phase7_calendar_component_revision_delete_denied/iu,
    );
    assert.throws(
      () =>
        database.sqlite
          .prepare(
            `UPDATE event_calendar_component_revisions
             SET sequence = sequence - 1
             WHERE organization_id = 'org-calendar'
               AND scope = 'public'
               AND event_key = 'organizer:event-calendar'`,
          )
          .run(),
      /phase7_calendar_component_revision_transition_invalid/iu,
    );
  } finally {
    database.close();
  }
});

test("calendar reconciliation is bounded and its Phase 7 integrity probe stays zero", async () => {
  const database = fixture();
  try {
    const candidates = Array.from(
      { length: CALENDAR_COMPONENT_REVISION_LIMIT + 1 },
      (_, index) => ({
        event: facts({ summary: `Event ${index}` }),
        eventKey: `organizer:event-${index}`,
      }),
    );
    await assert.rejects(
      reconcileCalendarComponentRevisions(database, {
        candidates,
        organizationId: "org-calendar",
        scope: "public",
      }),
      (error) => error?.issues?.[0]?.code === "invalid_length",
    );
    assert.equal(
      database.sqlite
        .prepare(
          PHASE7_INVARIANT_COUNT_SQL[
            PHASE7_INVARIANT_COUNT_SQL.length - 1
          ],
        )
        .get().violation_count,
      0,
    );
  } finally {
    database.close();
  }
});

function reconcile(database, scope, event) {
  return reconcileCalendarComponentRevisions(database, {
    candidates: [
      {
        event,
        eventKey: "organizer:event-calendar",
      },
    ],
    organizationId: "org-calendar",
    scope,
  });
}

function facts(overrides = {}) {
  return Object.freeze({
    description: "Club: Original club",
    location: "Original venue",
    schedule: Object.freeze({
      endsAtUtc: "2026-08-01T20:00:00.000Z",
      kind: "timed",
      startsAtUtc: "2026-08-01T18:00:00.000Z",
    }),
    status: "confirmed",
    summary: "Original title",
    timeZone: "America/Vancouver",
    uid: "7c4d789781287d982efb04c0bde44a1018e4ad66@calendar.invalid",
    url: "https://example.invalid/events/original",
    ...overrides,
  });
}

function revision(event) {
  return {
    lastModifiedAt: event.lastModifiedAt,
    sequence: event.sequence,
  };
}

function fixture(clock = NOW) {
  const migrations = readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) =>
      productionMigrationFragments(
        readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
      ),
    )
    .join(";\n");
  const database = new SqliteD1TestDatabase(migrations);
  database.sqlite.function(
    "unixepoch",
    () => Math.floor(clock / 1_000),
  );
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile-calendar', 'subject-calendar',
      'calendar@example.invalid', 'Calendar Owner', 'active',
      ${NOW}, ${NOW}
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'org-calendar', 'Calendar organization', 'calendar-organization',
      'America/Vancouver', ${NOW}, 'profile-calendar', ${NOW}, ${NOW}
    );
  `);
  installCalendarTriggers(database);
  return database;
}

function installCalendarTriggers(database) {
  for (const statement of PHASE7_INVARIANT_TRIGGER_STATEMENTS.filter(
    (sql) => sql.includes("event_calendar_component_revisions_phase7_"),
  )) {
    database.exec(statement);
  }
}
