import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeOrganizerAccess,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import { ensureDatabaseInvariants } from "../../lib/server/database/invariants.ts";
import { runRequestMaintenance } from "../../lib/server/database/request-maintenance.ts";
import {
  configureMeetupCalendarSource,
  getMeetupConnectionState,
} from "../../lib/server/meetup/sync.ts";
import { ensureMeetupProgramClubs } from "../../lib/server/meetup/clubs.ts";
import { getUnreadNotificationCount } from "../../lib/server/organizer/notifications.ts";
import { getOrganizerProfile } from "../../lib/server/organizer/profiles.ts";
import { getWorkspaceSettings } from "../../lib/server/organizer/settings.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";

const OWNER_EMAIL = "owner@example.com";
const OWNER_IDENTITY = trustedIdentityFromSites({
  displayName: "Owner",
  email: OWNER_EMAIL,
});
const FEED_URL =
  "https://www.meetup.com/vancouver-meetup-group/events/ical/";
const D1_STATEMENT_LIMIT = 50;

test("Meetup organizer GET stays bounded for healthy, fresh-catalog, and first-owner requests", async (t) => {
  await t.test("healthy catalog", async (t) => {
    const database = await existingOwnerDatabase(t);
    await prepareHealthyCatalog(database);

    const counter = countedBinding(database);
    await simulateMeetupPageRequest(counter.binding);

    assertInvocationCount(counter, 23, "healthy Meetup GET");
  });

  await t.test("fresh catalog for an existing owner", async (t) => {
    const database = await existingOwnerDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupPageRequest(counter.binding);

    assertInvocationCount(counter, 37, "fresh-catalog Meetup GET");
  });

  await t.test("first owner and fresh catalog", async (t) => {
    const database = await emptyReadyDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupPageRequest(counter.binding, OWNER_EMAIL);

    assertInvocationCount(counter, 43, "first-owner Meetup GET");
  });
});

test("Meetup connect POST stays bounded for fresh, healthy, and idempotent requests", async (t) => {
  await t.test("healthy catalog with a new source", async (t) => {
    const database = await existingOwnerDatabase(t);
    await prepareHealthyCatalog(database);
    const counter = countedBinding(database);

    await simulateMeetupConnectRequest(counter.binding);

    assertInvocationCount(counter, 14, "healthy new-source connect");
  });

  await t.test("fresh catalog with a new source", async (t) => {
    const database = await existingOwnerDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupConnectRequest(counter.binding);

    assertInvocationCount(counter, 28, "fresh-catalog new-source connect");
  });

  await t.test("first owner, fresh catalog, and a new source", async (t) => {
    const database = await emptyReadyDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupConnectRequest(counter.binding, OWNER_EMAIL);

    assertInvocationCount(counter, 34, "first-owner new-source connect");
  });

  await t.test("healthy exact-source retry", async (t) => {
    const database = await existingOwnerDatabase(t);
    const clubs = await prepareHealthyCatalog(database);
    await configureMeetupCalendarSource(
      database,
      OWNER_IDENTITY,
      {
        clubId: clubs[0].id,
        feedUrl: FEED_URL,
      },
      1_000,
    );
    await ensureDatabaseInvariantsReady(database);
    const counter = countedBinding(database);

    await simulateMeetupConnectRequest(counter.binding);

    assertInvocationCount(counter, 11, "healthy exact-source retry");
  });
});

async function simulateMeetupPageRequest(
  database,
  initialOwnerEmail = null,
) {
  assert.equal(await ensureDatabaseInvariants(database), "ready");
  assert.deepEqual(
    await runRequestMaintenance(database, {
      method: "GET",
      pathname: "/organizer/meetup",
    }),
    { kind: "continue" },
  );
  const firstContext = await loadOrganizerContext(
    database,
    initialOwnerEmail,
  );
  const secondContext = await loadOrganizerContext(
    database,
    initialOwnerEmail,
  );
  assert.equal(firstContext.organizationId, secondContext.organizationId);

  await getMeetupConnectionState(database, OWNER_IDENTITY, 2_000);
  await ensureMeetupProgramClubs(database, OWNER_IDENTITY, 2_000);
}

async function simulateMeetupConnectRequest(
  database,
  initialOwnerEmail = null,
) {
  assert.equal(await ensureDatabaseInvariants(database), "ready");
  assert.deepEqual(
    await runRequestMaintenance(database, {
      method: "POST",
      pathname: "/api/organizer/meetup/connect",
    }),
    { kind: "continue" },
  );
  await authorizeOrganizerAccess(database, OWNER_IDENTITY, {
    initialOwnerEmail,
  });
  const clubs = await ensureMeetupProgramClubs(
    database,
    OWNER_IDENTITY,
    2_000,
  );
  await configureMeetupCalendarSource(
    database,
    OWNER_IDENTITY,
    {
      clubId: clubs[0].id,
      feedUrl: FEED_URL,
    },
    2_000,
  );
}

async function loadOrganizerContext(database, initialOwnerEmail) {
  const membership = await authorizeOrganizerAccess(
    database,
    OWNER_IDENTITY,
    { initialOwnerEmail },
  );
  await Promise.all([
    getWorkspaceSettings(database, OWNER_IDENTITY),
    getOrganizerProfile(database, OWNER_IDENTITY),
    getUnreadNotificationCount(database, membership),
  ]);
  return membership;
}

async function existingOwnerDatabase(t) {
  const database = new SqliteD1TestDatabase(migrationSql());
  t.after(() => database.close());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_owner', 'email:${OWNER_EMAIL}', '${OWNER_EMAIL}', 'Owner',
      'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'org_vcc', 'Vancouver Curiosity and Education Society',
      'vancouver-curiosity-and-education-society', 'America/Vancouver', 1,
      'profile_owner', 'profile_owner', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_owner', 'org_vcc', 'profile_owner', '${OWNER_EMAIL}',
      'owner', 'active', 'profile_owner', 1, 1
    );
  `);
  await ensureDatabaseInvariantsReady(database);
  return database;
}

async function emptyReadyDatabase(t) {
  const database = new SqliteD1TestDatabase(migrationSql());
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  return database;
}

async function prepareHealthyCatalog(database) {
  const clubs = await ensureMeetupProgramClubs(
    database,
    OWNER_IDENTITY,
    1_000,
  );
  // Initial taxonomy materialization deliberately invalidates the durable
  // guard marker. A real Worker dispatches the next application request only
  // after a separate fail-closed repair request and a later ready check.
  await ensureDatabaseInvariantsReady(database);
  return clubs;
}

function migrationSql() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(migrationDirectory, name), "utf8"),
    )
    .join("\n");
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
  };
}

function assertInvocationCount(counter, expected, label) {
  const counts = counter.counts();
  assert.equal(
    counts.statementCount,
    expected,
    `${label} statement composition drifted`,
  );
  assert.ok(
    counts.statementCount <= D1_STATEMENT_LIMIT,
    `${label} used ${counts.statementCount} D1 statements`,
  );
  assert.ok(
    counts.batchLengths.every(
      (length) => length <= D1_STATEMENT_LIMIT,
    ),
    `${label} contained an oversized D1 batch`,
  );
}
