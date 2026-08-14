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
  refreshMeetupCalendarSource,
} from "../../lib/server/meetup/sync.ts";
import { ensureMeetupProgramClubs } from "../../lib/server/meetup/clubs.ts";
import { listOrganizerCalendarEvents } from "../../lib/server/organizer/calendar.ts";
import { listOrganizerClubs } from "../../lib/server/organizer/clubs.ts";
import { createOrganizerEvent } from "../../lib/server/organizer/events.ts";
import { getUnreadNotificationCount } from "../../lib/server/organizer/notifications.ts";
import { getOrganizerProfile } from "../../lib/server/organizer/profiles.ts";
import { performOrganizerLifecycleAction } from "../../lib/server/organizer/scheduling.ts";
import { getWorkspaceSettings } from "../../lib/server/organizer/settings.ts";
import { listTeamMembers } from "../../lib/server/organizer/team.ts";
import { listOwnCalendarSubscriptions } from "../../lib/server/phase7/calendar-subscriptions.ts";
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

    assertInvocationCount(counter, 26, "healthy Meetup GET");
  });

  await t.test("fresh catalog for an existing owner", async (t) => {
    const database = await existingOwnerDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupPageRequest(counter.binding);

    assertInvocationCount(counter, 40, "fresh-catalog Meetup GET");
  });

  await t.test("first owner and fresh catalog", async (t) => {
    const database = await emptyReadyDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupPageRequest(counter.binding, OWNER_EMAIL);

    assertInvocationCount(counter, 46, "first-owner Meetup GET");
  });
});

test("Meetup connect POST stays bounded for fresh, healthy, and idempotent requests", async (t) => {
  await t.test("healthy catalog with a new source", async (t) => {
    const database = await existingOwnerDatabase(t);
    await prepareHealthyCatalog(database);
    const counter = countedBinding(database);

    await simulateMeetupConnectRequest(counter.binding);

    assertInvocationCount(counter, 15, "healthy new-source connect");
  });

  await t.test("fresh catalog with a new source", async (t) => {
    const database = await existingOwnerDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupConnectRequest(counter.binding);

    assertInvocationCount(counter, 29, "fresh-catalog new-source connect");
  });

  await t.test("first owner, fresh catalog, and a new source", async (t) => {
    const database = await emptyReadyDatabase(t);
    const counter = countedBinding(database);

    await simulateMeetupConnectRequest(counter.binding, OWNER_EMAIL);

    assertInvocationCount(counter, 35, "first-owner new-source connect");
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

    assertInvocationCount(counter, 12, "healthy exact-source retry");
  });
});

test("Meetup manual refresh POST stays bounded for its maximum two-row slice", async (t) => {
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

  const result = await simulateMeetupRefreshRequest(
    counter.binding,
    clubs[0].id,
  );

  assert.equal(result.outcome, "partial");
  assert.equal(result.counts.created, 2);
  assert.deepEqual(counter.counts().batchLengths, [2, 9, 9, 4]);
  assertInvocationCount(counter, 38, "maximum-slice manual refresh POST");
});

test("organizer calendar GET stays bounded for healthy and maximum candidate/hold-notice requests", async (t) => {
  assertCalendarRouteComposition();

  await t.test("healthy calendar", async (t) => {
    const database = await existingOwnerDatabase(t);
    await prepareHealthyCatalog(database);
    const counter = countedBinding(database);

    const result = await simulateOrganizerCalendarPageRequest(
      counter.binding,
      null,
      500,
      () => counter.counts().statementCount,
    );

    assert.equal(result.calendar.resultCount, 0);
    assert.equal(result.subscriptions.length, 0);
    assert.deepEqual(result.trace, {
      afterInvariant: 2,
      afterLayoutContext: 11,
      afterMaintenance: 2,
      afterPageContext: 20,
      afterSubscriptions: 42,
      afterWorkspace: 39,
    });
    assert.deepEqual(counter.counts().batchLengths, []);
    assertInvocationCount(counter, 42, "healthy organizer calendar GET");
  });

  await t.test("5,000 candidates and one due hold notice", async (t) => {
    const database = await existingOwnerDatabase(t);
    const clubs = await prepareHealthyCatalog(database);
    await seedDueHold(database, clubs[0].id);
    seedMaximumCalendarCandidates(database, clubs[0].id, 4_999);
    await ensureDatabaseInvariantsReady(database);
    const counter = countedBinding(database);

    const result = await simulateOrganizerCalendarPageRequest(
      counter.binding,
      null,
      5_000,
      () => counter.counts().statementCount,
    );

    assert.equal(result.calendar.resultCount, 5_000);
    assert.equal(result.calendar.events.length, 5_000);
    assert.equal(result.subscriptions.length, 0);
    assert.deepEqual(result.trace, {
      afterInvariant: 2,
      afterLayoutContext: 11,
      afterMaintenance: 2,
      afterPageContext: 20,
      afterSubscriptions: 46,
      afterWorkspace: 43,
    });
    assert.deepEqual(counter.counts().batchLengths, [2]);
    assert.equal(
      await tableCount(database, "organizer_hold_notice_receipts"),
      1,
    );
    assert.equal(
      await tableCount(
        database,
        "notifications",
        "type IN ('hold_nearing_expiry', 'hold_expired')",
      ),
      1,
    );
    assertInvocationCount(
      counter,
      46,
      "maximum-candidate organizer calendar GET with a due hold notice",
    );
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
  assert.equal(
    firstContext.membership.organizationId,
    secondContext.membership.organizationId,
  );

  await getMeetupConnectionState(database, OWNER_IDENTITY, 2_000);
  await ensureMeetupProgramClubs(database, OWNER_IDENTITY, 2_000);
}

async function simulateOrganizerCalendarPageRequest(
  database,
  initialOwnerEmail = null,
  take = 500,
  readStatementCount = null,
) {
  const trace = {};
  assert.equal(await ensureDatabaseInvariants(database), "ready");
  trace.afterInvariant = readStatementCount?.() ?? null;
  const maintenance = await runRequestMaintenance(database, {
    method: "GET",
    pathname: "/organizer/calendar",
  });
  trace.afterMaintenance = readStatementCount?.() ?? null;
  if (maintenance.kind !== "continue") {
    return Object.freeze({
      maintenance,
      trace: Object.freeze(trace),
    });
  }
  const layoutContext = await loadOrganizerContext(
    database,
    initialOwnerEmail,
  );
  trace.afterLayoutContext = readStatementCount?.() ?? null;
  const pageContext = await loadOrganizerContext(
    database,
    initialOwnerEmail,
  );
  trace.afterPageContext = readStatementCount?.() ?? null;
  assert.equal(
    layoutContext.membership.organizationId,
    pageContext.membership.organizationId,
  );
  const calendar = await simulateLoadCalendarWorkspaceData(
    pageContext,
    take,
  );
  trace.afterWorkspace = readStatementCount?.() ?? null;
  const subscriptions = await listOwnCalendarSubscriptions(
    database,
    OWNER_IDENTITY,
  );
  trace.afterSubscriptions = readStatementCount?.() ?? null;
  return Object.freeze({
    calendar,
    maintenance,
    subscriptions,
    trace: Object.freeze(trace),
  });
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

async function simulateMeetupRefreshRequest(database, clubId) {
  assert.equal(await ensureDatabaseInvariants(database), "ready");
  assert.deepEqual(
    await runRequestMaintenance(database, {
      method: "POST",
      pathname: "/api/organizer/meetup/refresh",
    }),
    { kind: "continue" },
  );
  await authorizeOrganizerAccess(database, OWNER_IDENTITY);
  return refreshMeetupCalendarSource(database, OWNER_IDENTITY, {
    clubId,
    clock: () => 2_000,
    fetcher: async () =>
      new Response(meetupBudgetCalendar(), {
        headers: { "content-type": "text/calendar; charset=utf-8" },
        status: 200,
      }),
    nowUtcMs: 2_000,
  });
}

function meetupBudgetCalendar() {
  const events = [1, 2, 3]
    .map(
      (index) => `BEGIN:VEVENT
UID:route-budget-${index}@meetup.com
DTSTART:2032081${index}T030000Z
DTEND:2032081${index}T040000Z
SUMMARY:Route budget ${index}
URL:https://www.meetup.com/vancouver-meetup-group/events/route-budget-${index}/
STATUS:CONFIRMED
SEQUENCE:1
LAST-MODIFIED:20260724T020000Z
END:VEVENT`,
    )
    .join("\n");
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Meetup//Official calendar export//EN
METHOD:PUBLISH
${events}
END:VCALENDAR`;
}

async function loadOrganizerContext(database, initialOwnerEmail) {
  const membership = await authorizeOrganizerAccess(
    database,
    OWNER_IDENTITY,
    { initialOwnerEmail },
  );
  const [settings, profile, unreadNotificationCount] = await Promise.all([
    getWorkspaceSettings(database, OWNER_IDENTITY),
    getOrganizerProfile(database, OWNER_IDENTITY),
    getUnreadNotificationCount(database, membership),
  ]);
  return Object.freeze({
    database,
    defaultTimezone: settings.defaultTimezone,
    identity: OWNER_IDENTITY,
    membership,
    organizerDisplayName: profile.displayName,
    organizerInitials: profile.initials,
    unreadNotificationCount,
    workspaceName: settings.workspaceName,
  });
}

async function simulateLoadCalendarWorkspaceData(context, take) {
  const [calendar, clubs, team, taxonomy] = await Promise.all([
    listOrganizerCalendarEvents(context.database, context.identity, {
      limit: take,
    }),
    listOrganizerClubs(context.database, context.identity),
    listTeamMembers(context.database, context.identity),
    loadCalendarTaxonomyOptions(context),
  ]);
  assert.ok(Array.isArray(clubs));
  assert.ok(Array.isArray(team));
  assert.ok(Array.isArray(taxonomy.categories));
  assert.ok(Array.isArray(taxonomy.lanes));
  return calendar;
}

function assertCalendarRouteComposition() {
  const dataSource = readFileSync(
    join(process.cwd(), "app", "_organizer", "data.ts"),
    "utf8",
  );
  const pageSource = readFileSync(
    join(process.cwd(), "app", "organizer", "calendar", "page.tsx"),
    "utf8",
  );
  const workerSource = readFileSync(
    join(process.cwd(), "worker", "index.ts"),
    "utf8",
  );
  assert.match(
    dataSource,
    /loadCalendarWorkspaceData[\s\S]*?Promise\.all\(\[\s*listOrganizerCalendarEvents[\s\S]*?listOrganizerClubs[\s\S]*?listTeamMembers[\s\S]*?loadTaxonomyOptions/u,
  );
  assert.match(
    pageSource,
    /loadOrganizerPageContext\("\/organizer\/calendar"\)[\s\S]*?loadCalendarWorkspaceData\([\s\S]*?listOwnCalendarSubscriptions\(/u,
  );
  const invariantInitialization = workerSource.indexOf(
    "await ensureDatabaseInvariantsForRequest(env.DB, {",
  );
  const synchronousGate = workerSource.indexOf(
    "shouldRunSynchronousRequestMaintenance(",
    invariantInitialization,
  );
  const synchronousMaintenance = workerSource.indexOf(
    "const maintenance = await runRequestMaintenance(",
    synchronousGate,
  );
  const applicationDispatch = workerSource.indexOf(
    "const response = await handler.fetch(",
    synchronousMaintenance,
  );
  const publicMaintenance = workerSource.indexOf(
    "schedulePublicRequestMaintenance(ctx, env.DB, {",
    applicationDispatch,
  );
  assert.ok(invariantInitialization >= 0);
  assert.ok(synchronousGate > invariantInitialization);
  assert.ok(synchronousMaintenance > synchronousGate);
  assert.ok(applicationDispatch > synchronousMaintenance);
  assert.ok(publicMaintenance > applicationDispatch);

  const synchronousSection = workerSource.slice(
    synchronousGate,
    applicationDispatch,
  );
  assert.match(synchronousSection, /maintenanceUnavailableResponse\(\)/u);
  assert.match(synchronousSection, /maintenanceRedirect\(canonicalUrl\)/u);

  const publicSchedulerStart = workerSource.indexOf(
    "function schedulePublicRequestMaintenance(",
  );
  const publicSchedulerEnd = workerSource.indexOf(
    "function contentSecurityPolicy(",
    publicSchedulerStart,
  );
  assert.ok(publicSchedulerStart >= 0);
  assert.ok(publicSchedulerEnd > publicSchedulerStart);
  const publicScheduler = workerSource.slice(
    publicSchedulerStart,
    publicSchedulerEnd,
  );
  assert.match(publicScheduler, /runRequestMaintenance\(database, request\)/u);
  assert.match(publicScheduler, /publicRequestMaintenanceInFlight/u);
  assert.match(
    publicScheduler,
    /nowUtcMs < publicRequestMaintenanceNextEligibleAtUtcMs/u,
  );
  assert.match(publicScheduler, /context\.waitUntil\(maintenance\)/u);
  assert.doesNotMatch(
    publicScheduler,
    /maintenanceRedirect|maintenanceUnavailableResponse|secureResponse/u,
    "public background maintenance must never replace a visitor response",
  );
  assert.match(
    workerSource,
    /\(request\.method === "GET" \|\| request\.method === "HEAD"\)[\s\S]*?!isPrivateOrIdentityPath\(requestPathname\)[\s\S]*?schedulePublicRequestMaintenance\(ctx, env\.DB/u,
  );
  assert.match(
    workerSource,
    /\(method !== "GET" && method !== "HEAD"\)[\s\S]*?isPrivateOrIdentityPath\(pathname\)/u,
    "private and mutating requests must keep synchronous maintenance",
  );
  assert.doesNotMatch(
    workerSource,
    /schedulePublicMeetupRefresh|public_meetup_refresh_/u,
    "ordinary public rendering must never schedule Meetup refresh work",
  );
}

async function loadCalendarTaxonomyOptions(context) {
  const [lanes, categories] = await Promise.all([
    context.database
      .prepare(
        `SELECT id, name, deleted_at
         FROM event_lanes
         WHERE organization_id = ?
         ORDER BY (deleted_at IS NOT NULL) ASC,
                  sort_order ASC,
                  name COLLATE NOCASE ASC
         LIMIT 100`,
      )
      .bind(context.membership.organizationId)
      .all(),
    context.database
      .prepare(
        `SELECT category.id, category.name, category.deleted_at
         FROM categories AS category
         LEFT JOIN category_taxonomy_states AS state
           ON state.category_id = category.id
          AND state.organization_id = category.organization_id
         WHERE category.organization_id = ?
         ORDER BY (category.deleted_at IS NOT NULL) ASC,
                  COALESCE(state.sort_order, 100000) ASC,
                  category.name COLLATE NOCASE ASC,
                  category.id ASC
         LIMIT 250`,
      )
      .bind(context.membership.organizationId)
      .all(),
  ]);
  return Object.freeze({
    categories: Object.freeze([...(categories.results ?? [])]),
    lanes: Object.freeze([...(lanes.results ?? [])]),
  });
}

async function seedDueHold(database, clubId) {
  const draft = await createOrganizerEvent(database, OWNER_IDENTITY, {
    bufferAfterMinutes: 0,
    bufferBeforeMinutes: 0,
    clubId,
    coOrganizerProfileIds: [],
    endLocal: "2032-08-15T20:30",
    planningStatus: "draft",
    primaryOrganizerProfileId: "profile_owner",
    publicationStatus: "private",
    scheduleShape: "timed",
    startLocal: "2032-08-15T18:30",
    timeZone: "America/Vancouver",
    title: "Budgeted due hold",
    venueId: null,
  });
  const held = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    draft.id,
    {
      action: "place_hold",
      expectedContentVersion: draft.contentVersion,
      expectedScheduleVersion: draft.scheduleVersion,
      holdDurationHours: 1,
    },
  );
  assert.equal(held.outcome, "applied");
  assert.equal(held.event.planningStatus, "tentative_hold");
}

function seedMaximumCalendarCandidates(database, clubId, count) {
  const chunkSize = 250;
  for (let start = 0; start < count; start += chunkSize) {
    const values = Array.from(
      { length: Math.min(chunkSize, count - start) },
      (_, chunkIndex) => {
        const index = start + chunkIndex;
        const suffix = String(index).padStart(4, "0");
        return `(
          'calendar-budget-${suffix}', 'org_vcc', '${clubId}', 'profile_owner',
          'Calendar budget candidate ${suffix}', 'calendar-budget-${suffix}',
          'idea', 'private', 'unscheduled', 'America/Vancouver',
          1, 1, 'profile_owner', 'profile_owner', ${index + 10}, ${index + 10}
        )`;
      },
    ).join(",\n");
    database.exec(`
      INSERT INTO organizer_events (
        id, organization_id, club_id, primary_organizer_profile_id,
        title, slug, planning_status, publication_status, schedule_shape,
        timezone, content_version, schedule_version,
        created_by_profile_id, updated_by_profile_id, created_at, updated_at
      ) VALUES ${values};
    `);
  }
}

async function tableCount(database, table, predicate = "1 = 1") {
  const row = await database
    .prepare(`SELECT count(*) AS total FROM ${table} WHERE ${predicate}`)
    .first();
  return row?.total ?? 0;
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
    counts.statementCount < D1_STATEMENT_LIMIT,
    `${label} used ${counts.statementCount} D1 statements`,
  );
  assert.ok(
    counts.batchLengths.every(
      (length) => length < D1_STATEMENT_LIMIT,
    ),
    `${label} contained an oversized D1 batch`,
  );
}
