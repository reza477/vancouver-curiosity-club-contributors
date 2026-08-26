import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  configureMeetupCalendarSource,
  ensureMeetupProgramClubs,
  getMeetupConnectionState,
  listPublicMeetupCalendar,
  refreshMeetupCalendarSource,
  refreshMeetupCalendarSourceIfDue,
} from "../../lib/server/meetup/index.ts";
import { ensureDatabaseInvariants } from "../../lib/server/database/invariants.ts";
import {
  listUpcomingPublicEvents,
  queryPublicEvents,
} from "../../lib/server/public/events.ts";
import { normalizeAllDayConflictInterval } from "../../lib/server/organizer/conflict-domain.ts";
import {
  MEETUP_EVENT_ALIASES,
  canonicalMeetupEventUrlForAlias,
} from "../../lib/server/meetup/event-aliases.ts";
import {
  getOrganizerConflictPolicy,
  updateOrganizerConflictPolicy,
} from "../../lib/server/organizer/conflict-policy.ts";
import { listOrganizerConflictCenter } from "../../lib/server/organizer/conflicts.ts";
import { createOrganizerEvent } from "../../lib/server/organizer/events.ts";
import { performOrganizerLifecycleAction } from "../../lib/server/organizer/scheduling.ts";
import {
  OrganizerAccessDeniedError,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";
import { InputValidationError } from "../../lib/validation/index.ts";
import {
  safeErrorResponse,
  writeSafeLog,
} from "../../lib/validation/server-observability.ts";
import { toMeetupUiState } from "../../app/organizer/meetup/model.ts";
import { connectionCopy } from "../../app/organizer/meetup/MeetupControls.tsx";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import { interceptD1Statements } from "../auth/intercept-d1.mjs";

const OWNER_EMAIL = "owner@example.com";
const OWNER_IDENTITY = trustedIdentityFromSites({
  email: OWNER_EMAIL,
  displayName: "Reza",
});
const ORGANIZATION_ID = "org_vcc";
const MEETUP_ORIGIN = "https://www.meetup.com/";
const CATALOG_CLUBS = Object.freeze([
  Object.freeze({
    feedGroupSlug: "vancouver-meetup-group",
    id: "club_a",
    name: "Vancouver Curiosity Club",
    slug: "vancouver-curiosity-club",
  }),
  Object.freeze({
    feedGroupSlug: "vancouver-literature-and-film",
    id: "club_b",
    name: "Vancouver Literature and Film",
    slug: "vancouver-literature-and-film",
  }),
  Object.freeze({
    feedGroupSlug: "vancouver-fantasy-scifi-meetup-group",
    id: "club_c",
    name: "Vancouver Fantasy & Sci-Fi Group",
    slug: "vancouver-fantasy-scifi-group",
  }),
]);
const CLUB_BY_ID = new Map(CATALOG_CLUBS.map((club) => [club.id, club]));
const GROUP_A = CATALOG_CLUBS[0].feedGroupSlug;
const GROUP_B = CATALOG_CLUBS[1].feedGroupSlug;
const GROUP_C = CATALOG_CLUBS[2].feedGroupSlug;
const FEED_A = meetupFeedUrl(GROUP_A);
const FEED_B = meetupFeedUrl(GROUP_B);
const FEED_C = meetupFeedUrl(GROUP_C);
const CATALOG_CONNECTIONS = Object.freeze([
  Object.freeze({ ...CATALOG_CLUBS[0], feedUrl: FEED_A }),
  Object.freeze({ ...CATALOG_CLUBS[1], feedUrl: FEED_B }),
  Object.freeze({ ...CATALOG_CLUBS[2], feedUrl: FEED_C }),
]);
const CONNECTION_ORDERS = Object.freeze([
  Object.freeze([0, 1, 2]),
  Object.freeze([0, 2, 1]),
  Object.freeze([1, 0, 2]),
  Object.freeze([1, 2, 0]),
  Object.freeze([2, 0, 1]),
  Object.freeze([2, 1, 0]),
]);

function meetupFeedUrl(groupSlug) {
  return new URL(`${groupSlug}/events/ical/`, MEETUP_ORIGIN).href;
}

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.ok(migrations.length > 0, "generated migrations must exist");
  return migrations
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");
}

function createDatabase({
  clubs = CATALOG_CLUBS.map((club) => club.id),
} = {}) {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_owner', 'email:${OWNER_EMAIL}', '${OWNER_EMAIL}', 'Reza',
      'active', 1, 1
    );
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      owner_bootstrap_claimed_by_profile_id, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      '${ORGANIZATION_ID}', 'Vancouver Curiosity and Education Society',
      'vancouver-curiosity-and-education-society', 'America/Vancouver', 1,
      'profile_owner', 'profile_owner', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_owner', '${ORGANIZATION_ID}', 'profile_owner',
      '${OWNER_EMAIL}', 'owner', 'active', 'profile_owner', 1, 1
    );
    ${clubs
      .map(
        (clubId) => {
          const club = CLUB_BY_ID.get(clubId);
          assert.ok(club, `unknown catalog club fixture: ${clubId}`);
          return `
          INSERT INTO clubs (
            id, organization_id, name, slug, created_by_profile_id,
            created_at, updated_at
          ) VALUES (
            '${club.id}', '${ORGANIZATION_ID}', '${club.name.replaceAll("'", "''")}',
            '${club.slug}', 'profile_owner', 1, 1
          );
        `;
        },
      )
      .join("\n")}
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'lane_think', '${ORGANIZATION_ID}', 'Think', 'think',
      'A confirmed public fixture lane.', 10,
      'profile_owner', 1, 1
    );
    ${clubs
      .map(
        (clubId) => {
          const club = CLUB_BY_ID.get(clubId);
          assert.ok(club, `unknown catalog club fixture: ${clubId}`);
          return `
          INSERT INTO club_public_profiles (
            club_id, organization_id, primary_event_lane_id,
            publication_status, is_featured, description,
            public_group_url, published_at, created_at, updated_at
          ) VALUES (
            '${club.id}', '${ORGANIZATION_ID}', 'lane_think',
            'published', 1,
            'A confirmed public fixture for ${club.name.replaceAll("'", "''")}.',
            'https://www.meetup.com/${club.feedGroupSlug}/',
            1, 1, 1
          );
        `;
        },
      )
      .join("\n")}
  `);
  return database;
}

function seedMeetupAdministrator(database) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_admin', 'email:admin@example.com', 'admin@example.com',
      'Administrator', 'active', 1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_admin', '${ORGANIZATION_ID}', 'profile_admin',
      'admin@example.com', 'administrator', 'active',
      'profile_owner', 1, 1
    );
  `);
  return trustedIdentityFromSites({
    email: "admin@example.com",
    displayName: "Administrator",
  });
}

test("Meetup connection state denies a member suspended after the source read", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_reader', 'email:reader@example.test',
      'reader@example.test', 'Reader', 'active', 2, 2
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      'membership_reader', '${ORGANIZATION_ID}', 'profile_reader',
      'reader@example.test', 'organizer', 'active',
      'profile_owner', 2, 2
    );
  `);
  await ensureDatabaseInvariantsReady(database);
  const readerIdentity = trustedIdentityFromSites({
    displayName: "Reader",
    email: "reader@example.test",
  });
  const intercepted = interceptD1Statements(database, {
    after: (sql) =>
      sql.includes("FROM sync_sources") &&
      sql.includes("source_type = ?"),
    before: (sql) =>
      sql.includes("SELECT membership.id AS membership_id") &&
      sql.includes("membership.organization_id = ?"),
    hook: async () => {
      database.exec(`
        UPDATE profiles
        SET status = 'suspended', updated_at = updated_at + 1
        WHERE id = 'profile_reader'
      `);
    },
  });

  await assert.rejects(
    getMeetupConnectionState(
      intercepted.database,
      readerIdentity,
    ),
    (error) => error instanceof OrganizerAccessDeniedError,
  );
  assert.equal(intercepted.fired(), true);
});

function meetupEvent({
  description = "PRIVATE_DESCRIPTION_SENTINEL",
  end = "20280311T050000Z",
  eventId = "1001",
  groupSlug = GROUP_A,
  lastModified = "20260724T020000Z",
  location = "PRIVATE_LOCATION_SENTINEL",
  sequence = 1,
  start = "20280311T030000Z",
  status = "CONFIRMED",
  title = "A Curious Evening",
  uid = "shared-event@meetup.com",
} = {}) {
  return `BEGIN:VEVENT
UID:${uid}
DTSTART:${start}
DTEND:${end}
SUMMARY:${title}
DESCRIPTION:${description}
LOCATION:${location}
URL:https://www.meetup.com/${groupSlug}/events/${eventId}/
STATUS:${status}
SEQUENCE:${sequence}
LAST-MODIFIED:${lastModified}
END:VEVENT`;
}

function meetupAllDayEvent({
  endDate = "20320316",
  eventId = "all-day-1",
  groupSlug = GROUP_A,
  lastModified = "20260724T020000Z",
  sequence = 1,
  startDate = "20320314",
  status = "CONFIRMED",
  title = "All-day Meetup event",
  uid = "all-day@meetup.com",
} = {}) {
  return `BEGIN:VEVENT
UID:${uid}
DTSTART;VALUE=DATE:${startDate}
DTEND;VALUE=DATE:${endDate}
SUMMARY:${title}
URL:https://www.meetup.com/${groupSlug}/events/${eventId}/
STATUS:${status}
SEQUENCE:${sequence}
LAST-MODIFIED:${lastModified}
END:VEVENT`;
}

function calendar(...events) {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Meetup//Official calendar export//EN
METHOD:PUBLISH
${events.join("\n")}
END:VCALENDAR`;
}

function calendarResponse(body, { etag = null } = {}) {
  const headers = new Headers({
    "content-type": "text/calendar; charset=utf-8",
  });
  if (etag) headers.set("etag", etag);
  return new Response(body, { status: 200, headers });
}

function meetupGroupPageHtml(groupSlug, events) {
  const groupRef = `Group:${groupSlug === GROUP_A ? "38093975" : "38093976"}`;
  const futureConnectionKey = `events(${JSON.stringify({
    filter: {
      afterDateTime: "2026-08-06T12:00:00.000Z",
      status: ["ACTIVE", "PAST", "CANCELLED"],
    },
    first: 30,
    sort: "ASC",
  })})`;
  const state = {
    ROOT_QUERY: {
      __typename: "Query",
      [`groupByUrlname:{"urlname":"${groupSlug}"}`]: { __ref: groupRef },
    },
    [groupRef]: {
      __typename: "Group",
      id: groupRef.split(":")[1],
      isPrivate: false,
      timezone: "America/Vancouver",
      urlname: groupSlug,
      [futureConnectionKey]: {
        __typename: "GroupEventConnection",
        edges: events.map((event) => ({
          __typename: "EventEdge",
          node: { __ref: `Event:${event.id}` },
        })),
        pageInfo: { __typename: "PageInfo", hasNextPage: false },
        totalCount: events.length,
      },
    },
  };
  for (const [index, event] of events.entries()) {
    const venueId = String(25_956_900 + index);
    const photoId = String(535_545_400 + index);
    state[`Event:${event.id}`] = {
      __typename: "Event",
      dateTime: event.startsAt,
      description:
        "## Why come?\n\nBring **curiosity**. [Buy your VIFF ticket here](https://viff.org/whats-on/princess-mononoke/).\n\n- Meet thoughtful people\n- Leave with a new question",
      endTime: event.endsAt,
      eventUrl: `https://www.meetup.com/${groupSlug}/events/${event.id}/`,
      featuredEventPhoto: { __ref: `PhotoInfo:${photoId}` },
      group: { __ref: groupRef },
      id: event.id,
      status: "ACTIVE",
      title: event.title,
      venue: { __ref: `Venue:${venueId}` },
    };
    state[`Venue:${venueId}`] = {
      __typename: "Venue",
      address: "350 West Georgia Street",
      city: "Vancouver",
      id: venueId,
      name: "Vancouver Central Library",
      state: "BC",
    };
    state[`PhotoInfo:${photoId}`] = {
      __typename: "PhotoInfo",
      highResUrl:
        `https://secure.meetupstatic.com/photos/event/b/1/9/6/highres_${photoId}.jpeg`,
      id: photoId,
    };
  }
  return `<!doctype html><html><head><link rel="canonical" href="https://www.meetup.com/${groupSlug}/"></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    {
      props: { pageProps: { __APOLLO_STATE__: state } },
      query: { slug: groupSlug },
    },
  )}</script></body></html>`;
}

function groupPageResponse(body) {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
    status: 200,
  });
}

function meetupGroupGraphqlResponse(groupSlug, events) {
  const groupId = groupSlug === GROUP_A ? "38093975" : "38093976";
  return new Response(
    JSON.stringify({
      data: {
        groupByUrlname: {
          __typename: "Group",
          events: {
            __typename: "GroupEventConnection",
            edges: events.map((event, index) => {
              const venueId = String(25_956_900 + index);
              const photoId = String(535_545_400 + index);
              const photo = {
                __typename: "PhotoInfo",
                highResUrl:
                  `https://secure.meetupstatic.com/photos/event/b/1/9/6/highres_${photoId}.jpeg`,
                id: photoId,
              };
              return {
                __typename: "EventEdge",
                node: {
                  __typename: "Event",
                  dateTime: event.startsAt,
                  description:
                    "## Why come?\n\nBring **curiosity**. [Buy your VIFF ticket here](https://viff.org/whats-on/princess-mononoke/).\n\n- Meet thoughtful people\n- Leave with a new question",
                  displayPhoto: photo,
                  endTime: event.endsAt,
                  eventType: "PHYSICAL",
                  eventUrl:
                    `https://www.meetup.com/${groupSlug}/events/${event.id}/`,
                  featuredEventPhoto: photo,
                  group: { __typename: "Group", id: groupId },
                  id: event.id,
                  maxTickets: 0,
                  rsvpSettings: { rsvpsClosed: false },
                  rsvpState: "JOIN_OPEN",
                  status: "ACTIVE",
                  title: event.title,
                  venue: {
                    __typename: "Venue",
                    address: "350 West Georgia Street",
                    city: "Vancouver",
                    id: venueId,
                    name: "Vancouver Central Library",
                    state: "BC",
                  },
                  waitlistMode: "AUTO",
                  waitlistRsvps: { totalCount: 0 },
                  yesRsvps: { totalCount: 0 },
                },
              };
            }),
            pageInfo: {
              __typename: "PageInfo",
              endCursor: null,
              hasNextPage: false,
            },
            totalCount: events.length,
          },
          id: groupId,
          name: "Fixture Meetup group",
          timezone: "America/Vancouver",
          urlname: groupSlug,
        },
      },
    }),
    {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    },
  );
}

function sequenceFetcher(responses) {
  let index = 0;
  return async () => {
    const selected = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof selected === "function"
      ? selected()
      : calendarResponse(selected);
  };
}

function feedAwareFetcher(feeds) {
  return async (url) => {
    const body = feeds.get(String(url));
    assert.ok(body, `unexpected feed URL: ${String(url)}`);
    return calendarResponse(body);
  };
}

function countingDatabase(database) {
  let queryCount = 0;
  return {
    prepare(sql) {
      queryCount += 1;
      return database.prepare(sql);
    },
    async batch(statements) {
      return database.batch(statements);
    },
    count() {
      return queryCount;
    },
    reset() {
      queryCount = 0;
    },
  };
}

function exactCountingDatabase(database) {
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

async function configure(database, clubId, feedUrl = FEED_A, now = 1_000) {
  return configureMeetupCalendarSource(
    database,
    OWNER_IDENTITY,
    { clubId, feedUrl },
    now,
  );
}

async function refresh(
  database,
  clubId,
  fetcher,
  nowUtcMs = 2_000,
  extra = {},
) {
  return refreshMeetupCalendarSource(database, OWNER_IDENTITY, {
    clubId,
    fetcher,
    nowUtcMs,
    clock: () => nowUtcMs,
    ...extra,
  });
}

test("Meetup activity lanes persist into the public event projection", async (t) => {
  const database = createDatabase({ clubs: ["club_a"] });
  t.after(() => database.close());
  database.exec(`
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'lane_reset', '${ORGANIZATION_ID}', 'Reset & Make',
        'reset-and-make', 'A reflective fixture lane.', 20,
        'profile_owner', 1, 1
      ),
      (
        'lane_explore', '${ORGANIZATION_ID}', 'Explore', 'explore',
        'An outdoor fixture lane.', 30, 'profile_owner', 1, 1
      ),
      (
        'lane_play', '${ORGANIZATION_ID}', 'Eat & Play', 'eat-and-play',
        'A social fixture lane.', 40, 'profile_owner', 1, 1
      );
  `);
  await configure(database, "club_a", FEED_A, 1_000);
  const refreshed = await refresh(
    database,
    "club_a",
    sequenceFetcher([
      calendar(
        meetupEvent({
          end: "20280813T030000Z",
          eventId: "lane-reset-event",
          start: "20280813T010000Z",
          title: "Contemplative Meditation + Journaling Circle",
          uid: "lane-reset-event@meetup.com",
        }),
        meetupEvent({
          end: "20280814T030000Z",
          eventId: "lane-play-event",
          start: "20280814T010000Z",
          title: "Mangos Latin Dance Night",
          uid: "lane-play-event@meetup.com",
        }),
      ),
    ]),
    2_000,
  );
  assert.equal(refreshed.outcome, "completed");

  const persisted = await database
    .prepare(
      `SELECT event.title, lane.slug AS lane_slug
       FROM events AS event
       JOIN event_lanes AS lane
         ON lane.id = event.event_lane_id
        AND lane.organization_id = event.organization_id
       WHERE event.organization_id = ?
         AND event.title IN (?, ?)
       ORDER BY event.title`,
    )
    .bind(
      ORGANIZATION_ID,
      "Contemplative Meditation + Journaling Circle",
      "Mangos Latin Dance Night",
    )
    .all();
  assert.deepEqual(
    persisted.results.map((row) => [row.title, row.lane_slug]),
    [
      ["Contemplative Meditation + Journaling Circle", "reset-and-make"],
      ["Mangos Latin Dance Night", "eat-and-play"],
    ],
  );

  const publicPage = await queryPublicEvents(database, {
    nowUtcMs: Date.parse("2028-08-01T12:00:00.000Z"),
    organizationId: ORGANIZATION_ID,
    page: 1,
    pageSize: 12,
    todayDate: "2028-08-01",
    view: "upcoming",
  });
  const publicLanes = new Map(
    publicPage.events.map((event) => [event.title, event.lane?.slug]),
  );
  assert.equal(
    publicLanes.get("Contemplative Meditation + Journaling Circle"),
    "reset-and-make",
  );
  assert.equal(
    publicLanes.get("Mangos Latin Dance Night"),
    "eat-and-play",
  );
});

async function runDueMeetupRefresh(
  database,
  refreshOptions,
) {
  return refreshMeetupCalendarSourceIfDue(
    database,
    refreshOptions,
  );
}

test("due refresh drains the canonical group before alias-bearing groups", async (t) => {
  const database = createDatabase({
    clubs: ["club_a", "club_b", "club_c"],
  });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);
  await configure(database, "club_c", FEED_C, 1_002);
  database.exec(`
    UPDATE sync_sources
    SET last_attempt_at = CASE club_id
          WHEN 'club_a' THEN 100
          WHEN 'club_b' THEN 200
          WHEN 'club_c' THEN 300
        END,
        next_refresh_at = NULL
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND source_type = 'meetup_ics'
  `);

  const fetchedFeeds = [];
  const fetcher = async (input) => {
    fetchedFeeds.push(String(input));
    return calendarResponse(calendar());
  };
  for (const nowUtcMs of [2_000, 2_001, 2_002]) {
    const refreshed = await runDueMeetupRefresh(database, {
      clock: () => nowUtcMs,
      fetcher,
      nowUtcMs,
      organizationId: ORGANIZATION_ID,
    });
    assert.equal(refreshed.outcome, "completed");
  }

  assert.deepEqual(
    fetchedFeeds,
    [FEED_B, FEED_A, FEED_C],
    "the canonical source stays ahead of both exact-alias programs",
  );
});

function sourceOverlapDraftInput(title) {
  return {
    title,
    clubId: "club_a",
    primaryOrganizerProfileId: "profile_owner",
    coOrganizerProfileIds: [],
    planningStatus: "draft",
    publicationStatus: "private",
    scheduleShape: "timed",
    timeZone: "America/Vancouver",
    startLocal: "2032-08-14T18:30",
    endLocal: "2032-08-14T20:30",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  };
}

test("complete group pages automatically publish missing events, rich content, and current titles", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_b", FEED_B, 1_000);
  await configure(database, "club_a", FEED_A, 1_001);

  let poetryTitle = "Poetry Night #4";
  const sourceEvents = (groupSlug) =>
    groupSlug === GROUP_B
      ? [
          {
            endsAt: "2026-08-09T15:00:00-07:00",
            id: "315772811",
            startsAt: "2026-08-09T13:00:00-07:00",
            title: poetryTitle,
          },
        ]
      : [
        {
          endsAt: "2026-08-09T15:00:00-07:00",
          id: "315772829",
          startsAt: "2026-08-09T13:00:00-07:00",
          title: poetryTitle,
        },
        {
          endsAt: "2026-08-12T20:00:00-07:00",
          id: "316010049",
          startsAt: "2026-08-12T18:00:00-07:00",
          title: "Wednesday Night Reset",
        },
      ];
  const groupPageFetcher = async (url, init) => {
    if (String(url) === "https://api.meetup.com/gql-ext") {
      const groupSlug = JSON.parse(init.body).variables.urlname;
      assert.ok(groupSlug === GROUP_A || groupSlug === GROUP_B);
      return meetupGroupGraphqlResponse(groupSlug, sourceEvents(groupSlug));
    }
    const groupSlug = new URL(String(url)).pathname.split("/")[1];
    assert.ok(groupSlug === GROUP_A || groupSlug === GROUP_B);
    return groupPageResponse(
      meetupGroupPageHtml(groupSlug, sourceEvents(groupSlug)),
    );
  };

  const legacyLiterature = await refresh(
    database,
    "club_b",
    async () =>
      calendarResponse(
        calendar(
          meetupEvent({
            end: "20260809T220000Z",
            eventId: "315772811",
            groupSlug: GROUP_B,
            sequence: 7,
            start: "20260809T200000Z",
            title: poetryTitle,
            uid: "event_315772811@meetup.com",
          }),
        ),
      ),
    2_000,
  );
  assert.equal(legacyLiterature.outcome, "completed");

  poetryTitle = "Poetry Night #5 - THEME : Summer City";
  const literature = await refreshMeetupCalendarSource(
    database,
    OWNER_IDENTITY,
    {
      clubId: "club_b",
      clock: () => 3_000,
      groupPageFetcher,
      nowUtcMs: 3_000,
    },
  );
  assert.equal(literature.outcome, "completed");
  assert.equal(literature.counts.rejected, 0);
  const main = await refreshMeetupCalendarSource(database, OWNER_IDENTITY, {
    clubId: "club_a",
    clock: () => 4_000,
    groupPageFetcher,
    nowUtcMs: 4_000,
  });
  assert.equal(main.outcome, "completed");
  assert.equal(main.counts.rejected, 0);

  const snapshots = await database
    .prepare(
      `SELECT snapshot.event_url, snapshot.title, content.public_description,
              content.public_description_blocks_json,
              content.public_venue_name, content.public_venue_address,
              content.poster_source_url
       FROM sync_sources AS source
       JOIN meetup_event_snapshots AS snapshot
         ON snapshot.sync_source_id = source.id
        AND snapshot.generation_id = source.active_generation_id
       JOIN meetup_event_snapshot_public_contents AS content
         ON content.snapshot_id = snapshot.id
       WHERE source.organization_id = ?
         AND snapshot.event_url IN (?, ?)
       ORDER BY snapshot.event_url`,
    )
    .bind(
      ORGANIZATION_ID,
      "https://www.meetup.com/vancouver-literature-and-film/events/315772811/",
      "https://www.meetup.com/vancouver-meetup-group/events/316010049/",
    )
    .all();
  assert.equal(snapshots.results.length, 2);
  const rowsByUrl = new Map(
    snapshots.results.map((row) => [row.event_url, { ...row }]),
  );
  const poetry = rowsByUrl.get(
    "https://www.meetup.com/vancouver-literature-and-film/events/315772811/",
  );
  const reset = rowsByUrl.get(
    "https://www.meetup.com/vancouver-meetup-group/events/316010049/",
  );
  assert.equal(poetry.title, poetryTitle);
  assert.equal(reset.title, "Wednesday Night Reset");
  for (const row of [poetry, reset]) {
    assert.equal(row.public_venue_name, "Vancouver Central Library");
    assert.equal(row.public_venue_address, "350 West Georgia Street");
    assert.match(row.poster_source_url, /^https:\/\/secure\.meetupstatic\.com\//u);
    assert.match(row.public_description, /Buy your VIFF ticket here/u);
    const blocks = JSON.parse(row.public_description_blocks_json);
    assert.equal(blocks[0].type, "heading");
    assert.equal(blocks[2].type, "unordered-list");
    assert.deepEqual(
      blocks[1].content.find((inline) => inline.type === "link"),
      {
        href: "https://viff.org/whats-on/princess-mononoke/",
        text: "Buy your VIFF ticket here",
        type: "link",
      },
    );
  }
});

test("isolates the same external UID across two official club feeds", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const fetcher = feedAwareFetcher(
    new Map([
      [
        FEED_A,
        calendar(
          meetupEvent({
            eventId: "1001",
            groupSlug: GROUP_A,
            start: "20280311T030000Z",
            end: "20280311T050000Z",
            title: "Club A Event",
          }),
        ),
      ],
      [
        FEED_B,
        calendar(
          meetupEvent({
            eventId: "2001",
            groupSlug: GROUP_B,
            start: "20280312T030000Z",
            end: "20280312T050000Z",
            title: "Club B Event",
          }),
        ),
      ],
    ]),
  );

  assert.equal(
    (await refresh(database, "club_a", fetcher, 2_000)).outcome,
    "completed",
  );
  assert.equal(
    (await refresh(database, "club_b", fetcher, 3_000)).outcome,
    "completed",
  );

  const events = await database
    .prepare(
      `SELECT title, club_id
       FROM events
       WHERE deleted_at IS NULL
       ORDER BY title`,
    )
    .all();
  assert.deepEqual(events.results.map((row) => ({ ...row })), [
    { title: "Club A Event", club_id: "club_a" },
    { title: "Club B Event", club_id: "club_b" },
  ]);
  const links = await database
    .prepare(
      `SELECT count(*) AS count,
              count(DISTINCT sync_source_id) AS source_count,
              count(DISTINCT entity_id) AS event_count
       FROM external_source_links
       WHERE source_type = 'meetup_ics'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.deepEqual({ ...links }, {
    count: 2,
    source_count: 2,
    event_count: 2,
  });
});

test("Phase 4 permits two distinct simultaneous Meetup events across published sources", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const sharedStart = "20280910T020000Z";
  const sharedEnd = "20280910T040000Z";
  const fetcher = feedAwareFetcher(
    new Map([
      [
        FEED_A,
        calendar(
          meetupEvent({
            uid: "simultaneous-main@meetup.com",
            eventId: "simultaneous-main",
            groupSlug: GROUP_A,
            title: "Main group simultaneous gathering",
            start: sharedStart,
            end: sharedEnd,
          }),
        ),
      ],
      [
        FEED_B,
        calendar(
          meetupEvent({
            uid: "simultaneous-literature@meetup.com",
            eventId: "simultaneous-literature",
            groupSlug: GROUP_B,
            title: "Literature group simultaneous gathering",
            start: sharedStart,
            end: sharedEnd,
          }),
        ),
      ],
    ]),
  );

  const first = await refresh(database, "club_a", fetcher, 2_000);
  const second = await refresh(database, "club_b", fetcher, 3_000);
  assert.equal(first.outcome, "completed");
  assert.equal(second.outcome, "completed");
  assert.deepEqual(second.counts, {
    cancelled: 0,
    created: 1,
    rejected: 0,
    removed: 0,
    updated: 0,
  });

  const active = await database
    .prepare(
      `SELECT source.club_id, generation.state,
              count(DISTINCT interval.event_id) AS event_count
       FROM sync_sources AS source
       JOIN meetup_sync_generations AS generation
         ON generation.id = source.active_generation_id
        AND generation.sync_source_id = source.id
        AND generation.organization_id = source.organization_id
       JOIN organizer_external_reservation_intervals AS interval
         ON interval.sync_source_id = source.id
        AND interval.generation_id = generation.id
        AND interval.organization_id = source.organization_id
       WHERE source.organization_id = ?
         AND source.club_id IN ('club_a', 'club_b')
       GROUP BY source.club_id, generation.state
       ORDER BY source.club_id`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  assert.deepEqual(active.results.map((row) => ({ ...row })), [
    { club_id: "club_a", state: "published", event_count: 1 },
    { club_id: "club_b", state: "published", event_count: 1 },
  ]);
});

test("exact cross-post aliases share canonical events and publish a later unique event without canonical mutation", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_b", FEED_B, 1_000);
  await configure(database, "club_a", FEED_A, 1_001);

  const canonicalUrlOne =
    "https://www.meetup.com/vancouver-literature-and-film/events/315508432/";
  const canonicalUrlTwo =
    "https://www.meetup.com/vancouver-literature-and-film/events/315508537/";
  const aliasUrlOne =
    "https://www.meetup.com/vancouver-meetup-group/events/315511475/";
  const aliasUrlTwo =
    "https://www.meetup.com/vancouver-meetup-group/events/315511480/";
  assert.equal(canonicalMeetupEventUrlForAlias(aliasUrlOne), canonicalUrlOne);
  assert.equal(canonicalMeetupEventUrlForAlias(aliasUrlTwo), canonicalUrlTwo);
  assert.equal(MEETUP_EVENT_ALIASES.length, 17);
  assert.deepEqual(
    [
      "315776403",
      "315511487",
      "315777485",
      "316159366",
      "316050934",
      "316263002",
      "316263346",
      "316248155",
    ].map((aliasId) =>
      canonicalMeetupEventUrlForAlias(
        `https://www.meetup.com/vancouver-meetup-group/events/${aliasId}/`,
      ),
    ),
    [
      "https://www.meetup.com/vancouver-literature-and-film/events/315776148/",
      "https://www.meetup.com/vancouver-literature-and-film/events/315510890/",
      "https://www.meetup.com/vancouver-literature-and-film/events/315777434/",
      "https://www.meetup.com/vancouver-literature-and-film/events/316159440/",
      "https://www.meetup.com/vancouver-literature-and-film/events/316050915/",
      "https://www.meetup.com/vancouver-literature-and-film/events/316263063/",
      "https://www.meetup.com/vancouver-literature-and-film/events/316263362/",
      "https://www.meetup.com/vancouver-literature-and-film/events/316248163/",
    ],
  );
  assert.equal(
    canonicalMeetupEventUrlForAlias(
      "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/events/315776566/",
    ),
    "https://www.meetup.com/vancouver-literature-and-film/events/315776601/",
  );
  assert.equal(
    MEETUP_EVENT_ALIASES.find((entry) => entry.aliasUrl === aliasUrlTwo)
      ?.maxTimedEndDriftMs,
    30 * 60 * 1_000,
  );

  const canonicalBody = calendar(
    meetupEvent({
      uid: "literature-mononoke@meetup.com",
      eventId: "315508432",
      groupSlug: GROUP_B,
      title: "Princess Mononoke — Literature canonical",
      description: "Canonical literature description one.",
      location: "VIFF Centre",
      start: "20260811T010000Z",
      end: "20260811T033000Z",
    }),
    meetupEvent({
      uid: "literature-titanic@meetup.com",
      eventId: "315508537",
      groupSlug: GROUP_B,
      title: "Titanic — Literature canonical",
      description: "Canonical literature description two.",
      location: "VIFF Centre",
      start: "20260812T010000Z",
      end: "20260812T033000Z",
    }),
  );
  const canonicalRefresh = await refresh(
    database,
    "club_b",
    sequenceFetcher([canonicalBody]),
    2_000,
  );
  assert.equal(canonicalRefresh.outcome, "completed");
  assert.equal(canonicalRefresh.counts.created, 2);

  const canonicalRowsBefore = await database
    .prepare(
      `SELECT link.external_url, event.id, event.club_id, event.title,
              event.status, event.visibility, event.time_kind,
              event.starts_at_utc, event.ends_at_utc, event.timezone,
              event.schedule_version, event.published_at, event.updated_at,
              (SELECT count(*) FROM event_revisions AS revision
               WHERE revision.event_id = event.id) AS revision_count
       FROM external_source_links AS link
       JOIN events AS event
         ON event.id = link.entity_id
        AND event.organization_id = link.organization_id
       WHERE link.external_url IN (?, ?)
         AND link.source_type = 'meetup_ics'
         AND link.deleted_at IS NULL
       ORDER BY link.external_url`,
    )
    .bind(canonicalUrlOne, canonicalUrlTwo)
    .all();
  const immutableCanonicalRows = canonicalRowsBefore.results.map((row) => ({
    ...row,
  }));
  assert.equal(immutableCanonicalRows.length, 2);

  const mainBody = calendar(
    meetupEvent({
      uid: "main-mononoke-crosspost@meetup.com",
      eventId: "315511475",
      groupSlug: GROUP_A,
      title: "Main-group Mononoke cross-post",
      description: "Different alias description one.",
      location: "Different alias location one.",
      start: "20260811T010000Z",
      end: "20260811T033000Z",
    }),
    meetupEvent({
      uid: "main-titanic-crosspost@meetup.com",
      eventId: "315511480",
      groupSlug: GROUP_A,
      title: "Main-group Titanic cross-post",
      description: "Different alias description two.",
      location: "Different alias location two.",
      start: "20260812T010000Z",
      end: "20260812T040000Z",
    }),
    meetupEvent({
      uid: "wednesday-night-reset@meetup.com",
      eventId: "316010049",
      groupSlug: GROUP_A,
      title: "Wednesday Night Reset",
      start: "20260813T010000Z",
      end: "20260813T030000Z",
    }),
  );
  const mainFetcher = sequenceFetcher([mainBody]);
  const aliasBudget = exactCountingDatabase(database);
  const firstSlice = await refresh(
    aliasBudget.binding,
    "club_a",
    mainFetcher,
    3_000,
  );
  assert.equal(firstSlice.outcome, "partial");
  assert.deepEqual(firstSlice.counts, {
    cancelled: 0,
    created: 0,
    rejected: 0,
    removed: 0,
    updated: 0,
  });
  assert.deepEqual(aliasBudget.counts(), {
    batchLengths: [2, 7, 7, 4],
    statementCount: 31,
  });
  assert.ok(
    aliasBudget.counts().statementCount < 50,
    `alias refresh used ${aliasBudget.counts().statementCount} D1 statements`,
  );
  const sourceDuringPartial = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id, pending_cursor
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(sourceDuringPartial.active_generation_id, null);
  assert.equal(typeof sourceDuringPartial.pending_generation_id, "string");
  assert.equal(sourceDuringPartial.pending_cursor, 2);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT expected_item_count, processed_item_count,
                  rejected_item_count,
                  (SELECT count(*) FROM meetup_event_snapshots AS snapshot
                   WHERE snapshot.generation_id = generation.id) AS snapshot_count
           FROM meetup_sync_generations AS generation
           WHERE id = ?`,
        )
        .bind(sourceDuringPartial.pending_generation_id)
        .first()),
    },
    {
      expected_item_count: 3,
      processed_item_count: 2,
      rejected_item_count: 0,
      snapshot_count: 2,
    },
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM events
         WHERE title = 'Wednesday Night Reset'
           AND deleted_at IS NULL`,
      )
      .first("count"),
    0,
  );

  const finalSlice = await refresh(
    database,
    "club_a",
    mainFetcher,
    3_100,
  );
  assert.equal(finalSlice.outcome, "completed");
  assert.deepEqual(finalSlice.counts, {
    cancelled: 0,
    created: 1,
    rejected: 0,
    removed: 0,
    updated: 0,
  });
  const sourceAfterCompletion = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id, pending_cursor
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(
    sourceAfterCompletion.active_generation_id,
    sourceDuringPartial.pending_generation_id,
  );
  assert.equal(sourceAfterCompletion.pending_generation_id, null);
  assert.equal(sourceAfterCompletion.pending_cursor, null);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count,
                  (SELECT count(*) FROM meetup_event_snapshots AS snapshot
                   WHERE snapshot.generation_id = generation.id) AS snapshot_count,
                  (SELECT count(*)
                   FROM meetup_snapshot_reservation_normalizations AS normalized
                   WHERE normalized.generation_id = generation.id) AS normalization_count,
                  (SELECT count(*)
                   FROM organizer_external_reservation_intervals AS interval
                   WHERE interval.generation_id = generation.id) AS interval_count
           FROM meetup_sync_generations AS generation
           WHERE id = ?`,
        )
        .bind(sourceAfterCompletion.active_generation_id)
        .first()),
    },
    {
      state: "published",
      expected_item_count: 3,
      processed_item_count: 3,
      rejected_item_count: 0,
      snapshot_count: 3,
      normalization_count: 3,
      interval_count: 3,
    },
  );

  const sharedRows = await database
    .prepare(
      `SELECT alias_link.external_url AS alias_url,
              alias_link.entity_id AS alias_event_id,
              canonical_link.external_url AS canonical_url,
              canonical_link.entity_id AS canonical_event_id
       FROM external_source_links AS alias_link
       JOIN external_source_links AS canonical_link
         ON canonical_link.organization_id = alias_link.organization_id
        AND canonical_link.entity_id = alias_link.entity_id
        AND canonical_link.sync_source_id <> alias_link.sync_source_id
        AND canonical_link.source_type = alias_link.source_type
        AND canonical_link.deleted_at IS NULL
       WHERE alias_link.external_url IN (?, ?)
         AND alias_link.source_type = 'meetup_ics'
         AND alias_link.deleted_at IS NULL
       ORDER BY alias_link.external_url`,
    )
    .bind(aliasUrlOne, aliasUrlTwo)
    .all();
  assert.deepEqual(
    sharedRows.results.map((row) => ({ ...row })),
    [
      {
        alias_url: aliasUrlOne,
        alias_event_id: immutableCanonicalRows[0].id,
        canonical_url: canonicalUrlOne,
        canonical_event_id: immutableCanonicalRows[0].id,
      },
      {
        alias_url: aliasUrlTwo,
        alias_event_id: immutableCanonicalRows[1].id,
        canonical_url: canonicalUrlTwo,
        canonical_event_id: immutableCanonicalRows[1].id,
      },
    ],
  );
  const reservationGroups = await database
    .prepare(
      `SELECT interval.event_id, count(*) AS interval_count,
              count(DISTINCT interval.sync_source_id) AS source_count
       FROM organizer_external_reservation_intervals AS interval
       JOIN sync_sources AS source
         ON source.id = interval.sync_source_id
        AND source.active_generation_id = interval.generation_id
       WHERE interval.event_id IN (?, ?)
       GROUP BY interval.event_id
       ORDER BY interval.event_id`,
    )
    .bind(immutableCanonicalRows[0].id, immutableCanonicalRows[1].id)
    .all();
  assert.deepEqual(
    reservationGroups.results.map((row) => ({ ...row })),
    [
      {
        event_id: immutableCanonicalRows[0].id,
        interval_count: 2,
        source_count: 2,
      },
      {
        event_id: immutableCanonicalRows[1].id,
        interval_count: 2,
        source_count: 2,
      },
    ].sort((left, right) => left.event_id.localeCompare(right.event_id)),
  );
  const canonicalRowsAfter = await database
    .prepare(
      `SELECT link.external_url, event.id, event.club_id, event.title,
              event.status, event.visibility, event.time_kind,
              event.starts_at_utc, event.ends_at_utc, event.timezone,
              event.schedule_version, event.published_at, event.updated_at,
              (SELECT count(*) FROM event_revisions AS revision
               WHERE revision.event_id = event.id) AS revision_count
       FROM external_source_links AS link
       JOIN events AS event
         ON event.id = link.entity_id
        AND event.organization_id = link.organization_id
       WHERE link.external_url IN (?, ?)
         AND link.source_type = 'meetup_ics'
         AND link.deleted_at IS NULL
       ORDER BY link.external_url`,
    )
    .bind(canonicalUrlOne, canonicalUrlTwo)
    .all();
  assert.deepEqual(
    canonicalRowsAfter.results.map((row) => ({ ...row })),
    immutableCanonicalRows,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM events
         WHERE title = 'Wednesday Night Reset'
           AND deleted_at IS NULL`,
      )
      .first("count"),
    1,
  );
  const aliasAudits = await database
    .prepare(
      `SELECT metadata_json
       FROM audit_logs
       WHERE action = 'meetup.source_alias_linked'
       ORDER BY created_at, id`,
    )
    .all();
  assert.equal(aliasAudits.results.length, 2);
  for (const row of aliasAudits.results) {
    assert.deepEqual(JSON.parse(row.metadata_json), {
      aliasModel: "exact_url_v3",
      sourceType: "meetup_ics",
    });
    assert.equal(row.metadata_json.includes("meetup.com"), false);
  }
});

test("an exact alias safely adopts a legacy standalone mapping without exposing the displaced event", async (t) => {
  const database = createDatabase({ clubs: ["club_b", "club_c"] });
  t.after(() => database.close());
  await configure(database, "club_b", FEED_B, 1_000);
  await configure(database, "club_c", FEED_C, 1_001);

  const canonicalUrl =
    "https://www.meetup.com/vancouver-literature-and-film/events/315776601/";
  const aliasUrl =
    "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/events/315776566/";
  const start = "20260811T010000Z";
  const end = "20260811T033000Z";
  assert.equal(
    (
      await refresh(
        database,
        "club_b",
        sequenceFetcher([
          calendar(
            meetupEvent({
              uid: "legacy-adoption-canonical@meetup.com",
              eventId: "315776601",
              groupSlug: GROUP_B,
              title: "Legacy adoption canonical",
              start,
              end,
            }),
          ),
        ]),
        2_000,
      )
    ).outcome,
    "completed",
  );
  const canonicalEventId = await database
    .prepare(
      `SELECT entity_id
       FROM external_source_links
       WHERE organization_id = ?
         AND source_type = 'meetup_ics'
         AND external_url = ?
         AND deleted_at IS NULL`,
    )
    .bind(ORGANIZATION_ID, canonicalUrl)
    .first("entity_id");
  assert.equal(typeof canonicalEventId, "string");

  const legacyUrl =
    "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/events/315700000/";
  assert.equal(
    (
      await refresh(
        database,
        "club_c",
        sequenceFetcher([
          calendar(
            meetupEvent({
              uid: "legacy-standalone-main@meetup.com",
              eventId: "315700000",
              groupSlug: GROUP_C,
              title: "Displaced legacy standalone",
              start,
              end,
            }),
          ),
        ]),
        2_100,
      )
    ).outcome,
    "completed",
  );
  const legacyMapping = await database
    .prepare(
      `SELECT link.id AS link_id, link.entity_id AS event_id,
              link.sync_source_id AS source_id
       FROM external_source_links AS link
       WHERE link.organization_id = ?
         AND link.source_type = 'meetup_ics'
         AND link.external_url = ?
         AND link.deleted_at IS NULL`,
    )
    .bind(ORGANIZATION_ID, legacyUrl)
    .first();
  assert.equal(typeof legacyMapping?.link_id, "string");
  assert.equal(typeof legacyMapping?.event_id, "string");
  assert.equal(typeof legacyMapping?.source_id, "string");
  assert.notEqual(legacyMapping.event_id, canonicalEventId);

  const aliasUid = "legacy-adoption-alias@meetup.com";
  const aliasExternalId = createHash("sha256")
    .update(
      `meetup_ics\u0000${legacyMapping.source_id}\u0000${aliasUid}\u001F`,
    )
    .digest("hex");
  await database
    .prepare(
      `UPDATE external_source_links
       SET external_id = ?, external_url = ?, updated_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND entity_id = ?
         AND deleted_at IS NULL`,
    )
    .bind(
      aliasExternalId,
      aliasUrl,
      2_150,
      legacyMapping.link_id,
      ORGANIZATION_ID,
      legacyMapping.event_id,
    )
    .run();

  const aliasBudget = exactCountingDatabase(database);
  const adopted = await refresh(
    aliasBudget.binding,
    "club_c",
    sequenceFetcher([
      calendar(
        meetupEvent({
          uid: aliasUid,
          eventId: "315776566",
          groupSlug: GROUP_C,
          title: "Legacy adoption alias",
          start,
          end,
        }),
      ),
    ]),
    2_200,
  );
  assert.equal(adopted.outcome, "completed");
  assert.ok(
    aliasBudget.counts().statementCount < 50,
    `legacy alias adoption used ${aliasBudget.counts().statementCount} D1 statements`,
  );

  const links = await database
    .prepare(
      `SELECT entity_id, external_id, deleted_at
       FROM external_source_links
       WHERE organization_id = ?
         AND source_type = 'meetup_ics'
         AND sync_source_id = ?
         AND external_url = ?
       ORDER BY deleted_at IS NULL DESC, id ASC`,
    )
    .bind(ORGANIZATION_ID, legacyMapping.source_id, aliasUrl)
    .all();
  assert.equal(links.results.length, 2);
  assert.deepEqual(
    {
      deleted_at: links.results[0].deleted_at,
      entity_id: links.results[0].entity_id,
      external_id: links.results[0].external_id,
    },
    {
      deleted_at: null,
      entity_id: canonicalEventId,
      external_id: aliasExternalId,
    },
  );
  assert.equal(links.results[1].entity_id, legacyMapping.event_id);
  assert.equal(links.results[1].deleted_at, 2_200);
  assert.match(links.results[1].external_id, /^[a-f0-9]{64}$/u);
  assert.notEqual(links.results[1].external_id, aliasExternalId);

  const publicPage = await queryPublicEvents(database, {
    nowUtcMs: Date.parse("2026-08-01T12:00:00.000Z"),
    organizationId: ORGANIZATION_ID,
    page: 1,
    pageSize: 12,
    todayDate: "2026-08-01",
    view: "upcoming",
  });
  assert.equal(
    publicPage.events.some(
      (event) => event.title === "Displaced legacy standalone",
    ),
    false,
  );
  assert.equal(
    publicPage.events.filter(
      (event) => event.title === "Legacy adoption canonical",
    ).length,
    1,
  );
});

test("an exact cross-post alias with a schedule mismatch preserves both active generations", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_b", FEED_B, 1_000);
  await configure(database, "club_a", FEED_A, 1_001);

  const canonicalUrl =
    "https://www.meetup.com/vancouver-literature-and-film/events/315508432/";
  const aliasUrl =
    "https://www.meetup.com/vancouver-meetup-group/events/315511475/";
  const canonicalBody = calendar(
    meetupEvent({
      uid: "mismatch-canonical@meetup.com",
      eventId: "315508432",
      groupSlug: GROUP_B,
      title: "Schedule-locked canonical",
      start: "20260811T010000Z",
      end: "20260811T033000Z",
    }),
  );
  assert.equal(
    (
      await refresh(
        database,
        "club_b",
        sequenceFetcher([canonicalBody]),
        2_000,
      )
    ).outcome,
    "completed",
  );
  const baselineBody = calendar(
    meetupEvent({
      uid: "main-prior-active@meetup.com",
      eventId: "315294577",
      groupSlug: GROUP_A,
      title: "Main prior active event",
      start: "20260820T010000Z",
      end: "20260820T030000Z",
    }),
  );
  assert.equal(
    (
      await refresh(
        database,
        "club_a",
        sequenceFetcher([baselineBody]),
        2_100,
      )
    ).outcome,
    "completed",
  );
  const sourcesBefore = await database
    .prepare(
      `SELECT club_id, active_generation_id
       FROM sync_sources
       WHERE club_id IN ('club_a', 'club_b')
       ORDER BY club_id`,
    )
    .all();
  const canonicalBefore = await database
    .prepare(
      `SELECT event.*,
              (SELECT count(*) FROM event_revisions AS revision
               WHERE revision.event_id = event.id) AS revision_count
       FROM events AS event
       JOIN external_source_links AS link
         ON link.entity_id = event.id
        AND link.organization_id = event.organization_id
       WHERE link.external_url = ?
         AND link.deleted_at IS NULL`,
    )
    .bind(canonicalUrl)
    .first();

  const mismatchBody = calendar(
    meetupEvent({
      uid: "mismatch-alias@meetup.com",
      eventId: "315511475",
      groupSlug: GROUP_A,
      title: "Shifted alias must not replace canonical",
      start: "20260811T020000Z",
      end: "20260811T043000Z",
    }),
  );
  const failed = await refresh(
    database,
    "club_a",
    sequenceFetcher([mismatchBody]),
    3_000,
  );
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.state.lastErrorCode, "calendar_invalid");
  assert.deepEqual(failed.counts, {
    cancelled: 0,
    created: 0,
    rejected: 0,
    removed: 0,
    updated: 0,
  });
  const sourcesAfter = await database
    .prepare(
      `SELECT club_id, active_generation_id
       FROM sync_sources
       WHERE club_id IN ('club_a', 'club_b')
       ORDER BY club_id`,
    )
    .all();
  assert.deepEqual(
    sourcesAfter.results.map((row) => ({ ...row })),
    sourcesBefore.results.map((row) => ({ ...row })),
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM external_source_links
         WHERE external_url = ?
           AND deleted_at IS NULL`,
      )
      .bind(aliasUrl)
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM meetup_event_snapshots
         WHERE event_url = ?`,
      )
      .bind(aliasUrl)
      .first("count"),
    0,
  );
  const canonicalAfter = await database
    .prepare(
      `SELECT event.*,
              (SELECT count(*) FROM event_revisions AS revision
               WHERE revision.event_id = event.id) AS revision_count
       FROM events AS event
       JOIN external_source_links AS link
         ON link.entity_id = event.id
        AND link.organization_id = event.organization_id
       WHERE link.external_url = ?
         AND link.deleted_at IS NULL`,
    )
    .bind(canonicalUrl)
    .first();
  assert.deepEqual({ ...canonicalAfter }, { ...canonicalBefore });
});

test("the normalized baseline contains the final Meetup generation schema", async (t) => {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  t.after(() => database.close());
  const syncSourceColumns = await database
    .prepare("PRAGMA table_info(sync_sources)")
    .all();
  const columnNames = syncSourceColumns.results.map((row) => row.name);
  for (const requiredColumn of [
    "active_generation_id",
    "pending_generation_id",
    "pending_snapshot_hash",
    "pending_cursor",
  ]) {
    assert.ok(columnNames.includes(requiredColumn), requiredColumn);
  }
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('meetup_sync_generations', 'meetup_event_snapshots')`,
      )
      .first("count"),
    2,
  );
  assert.equal(
    await database
      .prepare("SELECT count(*) AS count FROM sync_sources")
      .first("count"),
    0,
  );
});

test("same-source configuration is idempotent", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());

  const firstState = await configure(database, "club_a", FEED_A, 1_000);
  const first = await database
    .prepare(
      `SELECT id, source_url, created_at, updated_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  const repeatedState = await configure(
    database,
    "club_a",
    FEED_A,
    2_000,
  );
  const repeated = await database
    .prepare(
      `SELECT id, source_url, created_at, updated_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();

  assert.deepEqual(repeated, first);
  assert.deepEqual(repeatedState, firstState);
  assert.equal(JSON.stringify(repeatedState).includes(FEED_A), false);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM sync_sources
         WHERE club_id = 'club_a'
           AND deleted_at IS NULL`,
      )
      .first("count"),
    1,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE action = 'meetup.connection_configured'`,
      )
      .first("count"),
    1,
  );
});

test("connection commit rejects an archived club without persisting a source, feed, or audit", async (t) => {
  const database = createDatabase({ clubs: ["club_a"] });
  t.after(() => database.close());
  let raced = false;
  const racingDatabase = {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!raced) {
        raced = true;
        database.exec(
          "UPDATE clubs SET deleted_at = 1500 WHERE id = 'club_a'",
        );
      }
      return database.batch(statements);
    },
  };

  await assert.rejects(
    configureMeetupCalendarSource(
      racingDatabase,
      OWNER_IDENTITY,
      { clubId: "club_a", feedUrl: FEED_A },
      1_000,
    ),
    (error) => {
      assert.equal(error instanceof OrganizerAccessDeniedError, true);
      assert.equal(String(error).includes(FEED_A), false);
      return true;
    },
  );
  assert.equal(
    await database
      .prepare("SELECT count(*) AS count FROM sync_sources")
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE action = 'meetup.connection_configured'`,
      )
      .first("count"),
    0,
  );
});

test("connection commit revalidates an active Owner or Administrator actor", async (t) => {
  const database = createDatabase({ clubs: ["club_a"] });
  t.after(() => database.close());
  const administrator = seedMeetupAdministrator(database);
  let raced = false;
  const racingDatabase = {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!raced) {
        raced = true;
        database.exec(`
          UPDATE organization_memberships
          SET status = 'suspended'
          WHERE id = 'membership_admin'
        `);
      }
      return database.batch(statements);
    },
  };

  await assert.rejects(
    configureMeetupCalendarSource(
      racingDatabase,
      administrator,
      { clubId: "club_a", feedUrl: FEED_A },
      1_000,
    ),
    (error) => error instanceof OrganizerAccessDeniedError,
  );
  assert.equal(
    await database
      .prepare("SELECT count(*) AS count FROM sync_sources")
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE action = 'meetup.connection_configured'`,
      )
      .first("count"),
    0,
  );
});

test("connection configuration seals the exact allowed role for no-op and commit races", async (t) => {
  await t.test("same-source no-op rejects an allowed-role drift", async (t) => {
    const database = createDatabase({ clubs: ["club_a"] });
    t.after(() => database.close());
    const administrator = seedMeetupAdministrator(database);
    await configure(database, "club_a", FEED_A, 1_000);
    const intercepted = interceptD1Statements(database, {
      after: (sql) =>
        sql.includes("SELECT id, club_id") &&
        sql.includes("FROM sync_sources"),
      before: (sql) =>
        sql.includes("SELECT id, organization_id, club_id") &&
        sql.includes("FROM sync_sources"),
      hook: async () => {
        database.exec(`
          UPDATE organization_memberships
          SET role = 'owner', updated_at = updated_at + 1
          WHERE id = 'membership_admin'
        `);
      },
    });

    await assert.rejects(
      configureMeetupCalendarSource(
        intercepted.database,
        administrator,
        { clubId: "club_a", feedUrl: FEED_A },
        2_000,
      ),
      (error) => error instanceof OrganizerAccessDeniedError,
    );
    assert.equal(intercepted.fired(), true);
    assert.equal(
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'meetup.connection_configured'`,
        )
        .first("count"),
      1,
    );
  });

  await t.test("new-source commit rejects an allowed-role drift", async (t) => {
    const database = createDatabase({ clubs: ["club_a"] });
    t.after(() => database.close());
    const administrator = seedMeetupAdministrator(database);
    let raced = false;
    const racingDatabase = {
      prepare(sql) {
        return database.prepare(sql);
      },
      async batch(statements) {
        if (!raced) {
          raced = true;
          database.exec(`
            UPDATE organization_memberships
            SET role = 'owner', updated_at = updated_at + 1
            WHERE id = 'membership_admin'
          `);
        }
        return database.batch(statements);
      },
    };

    await assert.rejects(
      configureMeetupCalendarSource(
        racingDatabase,
        administrator,
        { clubId: "club_a", feedUrl: FEED_A },
        1_000,
      ),
      (error) => error instanceof OrganizerAccessDeniedError,
    );
    assert.equal(raced, true);
    assert.equal(
      await database
        .prepare("SELECT count(*) AS count FROM sync_sources")
        .first("count"),
      0,
    );
    assert.equal(
      await database
        .prepare(
          `SELECT count(*) AS count
           FROM audit_logs
           WHERE action = 'meetup.connection_configured'`,
        )
        .first("count"),
      0,
    );
  });
});

test("resolves the exact safe Meetup program catalog from an empty organization", async (t) => {
  const database = createDatabase({ clubs: [] });
  t.after(() => database.close());

  const first = await ensureMeetupProgramClubs(
    database,
    OWNER_IDENTITY,
    1_000,
  );
  const repeated = await ensureMeetupProgramClubs(
    database,
    OWNER_IDENTITY,
    2_000,
  );
  assert.deepEqual(repeated, first);
  assert.deepEqual(
    first.map((club) => club.name),
    CATALOG_CLUBS.map((club) => club.name),
  );
  for (const club of first) {
    assert.deepEqual(Object.keys(club).sort(), ["id", "name"]);
  }

  const stored = await database
    .prepare(
      `SELECT id, name, slug
       FROM clubs
       WHERE organization_id = ?
         AND deleted_at IS NULL
       ORDER BY slug`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  const idsByName = new Map(first.map((club) => [club.name, club.id]));
  const storedRows = stored.results.map((row) => ({ ...row }));
  assert.equal(storedRows.length, 5);
  assert.deepEqual(
    storedRows.map(({ name, slug }) => ({ name, slug })),
    [
      {
        name: "Contemplative Meditation + Journaling Circle",
        slug: "contemplative-meditation-journaling-circle",
      },
      { name: "Off-Radar Eats", slug: "off-radar-eats" },
      ...CATALOG_CLUBS.map(({ name, slug }) => ({ name, slug })),
    ].sort((left, right) => left.slug.localeCompare(right.slug)),
  );
  for (const club of CATALOG_CLUBS) {
    assert.equal(
      storedRows.find((row) => row.slug === club.slug)?.id,
      idsByName.get(club.name),
    );
  }
  const serializedOptions = JSON.stringify(first);
  for (const feedUrl of [FEED_A, FEED_B, FEED_C]) {
    assert.equal(serializedOptions.includes(feedUrl), false);
  }
  assert.equal(/feed|source|organization/iu.test(serializedOptions), false);
});

test("preserves the exact source-to-program mapping in all six connection orders", async () => {
  for (const order of CONNECTION_ORDERS) {
    const database = createDatabase();
    try {
      let state = null;
      for (const [position, connectionIndex] of order.entries()) {
        const connection = CATALOG_CONNECTIONS[connectionIndex];
        state = await configure(
          database,
          connection.id,
          connection.feedUrl,
          1_000 + position,
        );
      }

      const sources = await database
        .prepare(
          `SELECT source.club_id, club.name, club.slug, source.source_url
           FROM sync_sources AS source
           JOIN clubs AS club
             ON club.id = source.club_id
            AND club.organization_id = source.organization_id
           WHERE source.organization_id = ?
             AND source.source_type = 'meetup_ics'
             AND source.deleted_at IS NULL
             AND club.deleted_at IS NULL
           ORDER BY source.club_id`,
        )
        .bind(ORGANIZATION_ID)
        .all();
      assert.deepEqual(
        sources.results.map((row) => ({ ...row })),
        CATALOG_CONNECTIONS.map((connection) => ({
          club_id: connection.id,
          name: connection.name,
          slug: connection.slug,
          source_url: connection.feedUrl,
        })),
        `connection order ${order.join(",")} changed the approved mapping`,
      );
      assert.equal(
        await database
          .prepare(
            `SELECT count(*) AS count
             FROM audit_logs
             WHERE action = 'meetup.connection_configured'`,
          )
          .first("count"),
        3,
      );
      const serializedState = JSON.stringify(state);
      for (const feedUrl of [FEED_A, FEED_B, FEED_C]) {
        assert.equal(serializedState.includes(feedUrl), false);
      }
      assert.equal(serializedState.includes("sourceUrl"), false);
      assert.equal(serializedState.includes("source_url"), false);
    } finally {
      database.close();
    }
  }
});

test("rejects mismatched, nonexistent, and cross-organization club selections without residue", async () => {
  const cases = [
    {
      clubId: "club_a",
      feedUrl: FEED_B,
      name: "mismatched program",
      setup() {},
      validate(error) {
        return (
          error instanceof InputValidationError &&
          error.issues.some(
            (issue) =>
              issue.path === "clubId" &&
              issue.code === "meetup_program_mismatch",
          )
        );
      },
    },
    {
      clubId: "club_missing",
      feedUrl: FEED_A,
      name: "nonexistent club",
      setup() {},
      validate(error) {
        return (
          error instanceof OrganizerAccessDeniedError &&
          error.reason === "club_assignment_required"
        );
      },
    },
    {
      clubId: "club_external",
      feedUrl: FEED_A,
      name: "cross-organization club",
      setup(database) {
        database.exec(`
          INSERT INTO organizations (
            id, name, slug, timezone, created_at, updated_at
          ) VALUES (
            'org_external', 'External organization',
            'external-organization', 'America/Vancouver', 1, 1
          );
          INSERT INTO clubs (
            id, organization_id, name, slug, created_by_profile_id,
            created_at, updated_at
          ) VALUES (
            'club_external', 'org_external', 'External club',
            'external-club', 'profile_owner', 1, 1
          );
        `);
      },
      validate(error) {
        return (
          error instanceof OrganizerAccessDeniedError &&
          error.reason === "club_assignment_required"
        );
      },
    },
  ];

  for (const rejectedCase of cases) {
    const database = createDatabase();
    try {
      rejectedCase.setup(database);
      const clubsBefore = await database
        .prepare(`SELECT count(*) AS count FROM clubs`)
        .first("count");

      await assert.rejects(
        configure(
          database,
          rejectedCase.clubId,
          rejectedCase.feedUrl,
          2_000,
        ),
        rejectedCase.validate,
        rejectedCase.name,
      );
      assert.equal(
        await database
          .prepare(`SELECT count(*) AS count FROM sync_sources`)
          .first("count"),
        0,
        `${rejectedCase.name} left a source row`,
      );
      assert.equal(
        await database
          .prepare(
            `SELECT count(*) AS count
             FROM audit_logs
             WHERE action = 'meetup.connection_configured'`,
          )
          .first("count"),
        0,
        `${rejectedCase.name} left a configuration audit`,
      );
      assert.equal(
        await database
          .prepare(`SELECT count(*) AS count FROM clubs`)
          .first("count"),
        clubsBefore,
        `${rejectedCase.name} changed club records`,
      );
    } finally {
      database.close();
    }
  }
});

test("feed URLs and tokens stay out of client DTOs and safe logs", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const privateFeed = FEED_A;
  const privateToken = "MEETUP_PRIVATE_TOKEN_SENTINEL";
  const safeClubOptions = await ensureMeetupProgramClubs(
    database,
    OWNER_IDENTITY,
    999,
  );
  const connection = await configure(
    database,
    "club_a",
    privateFeed,
    1_000,
  );
  const state = await getMeetupConnectionState(
    database,
    OWNER_IDENTITY,
    1_001,
  );
  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 1_001,
  });
  for (const dto of [
    connection,
    state,
    publicCalendar,
    safeClubOptions,
  ]) {
    const serialized = JSON.stringify(dto);
    assert.equal(serialized.includes(privateFeed), false);
    assert.equal(serialized.includes("sourceUrl"), false);
    assert.equal(serialized.includes("source_url"), false);
    assert.equal(serialized.includes(privateToken), false);
  }
  const clientState = toMeetupUiState({
    ...state,
    sourceUrl: `${privateFeed}?token=${privateToken}`,
    source_url: `${privateFeed}?token=${privateToken}`,
  });
  assert.equal(JSON.stringify(clientState).includes(privateFeed), false);
  assert.equal(JSON.stringify(clientState).includes(privateToken), false);

  const lines = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (line) => lines.push(String(line));
  console.error = (line) => lines.push(String(line));
  try {
    writeSafeLog("warn", privateFeed, {
      operation: "meetup_sync",
      route: `/api/organizer/meetup/connect?feed=${encodeURIComponent(
        privateFeed,
      )}&token=${privateToken}`,
      status: 400,
    });
    const response = safeErrorResponse(
      new Error(`${privateFeed}?token=${privateToken}`),
      {
        route: `/api/organizer/meetup/connect?token=${privateToken}`,
      },
    );
    assert.equal(
      (await response.text()).includes(privateToken),
      false,
    );
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  const serializedLogs = lines.join("\n");
  assert.equal(serializedLogs.includes(privateFeed), false);
  assert.equal(serializedLogs.includes(privateToken), false);
});

test("stale replays cannot undo a newer cancellation, which stays out of upcoming", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);

  const fetcher = sequenceFetcher([
    calendar(
      meetupEvent({
        sequence: 5,
        status: "CONFIRMED",
        title: "Monotonic Event",
      }),
    ),
    calendar(
      meetupEvent({
        lastModified: "20260724T030000Z",
        sequence: 4,
        status: "CANCELLED",
        title: "Stale Cancellation",
      }),
    ),
    calendar(
      meetupEvent({
        lastModified: "20260724T040000Z",
        sequence: 6,
        status: "CANCELLED",
        title: "Current Cancellation",
      }),
    ),
    calendar(
      meetupEvent({
        lastModified: "20260724T050000Z",
        sequence: 5,
        status: "CONFIRMED",
        title: "Stale Resurrection",
      }),
    ),
  ]);

  const created = await refresh(database, "club_a", fetcher, 2_000);
  assert.equal(created.counts.created, 1);

  const staleCancellation = await refresh(
    database,
    "club_a",
    fetcher,
    3_000,
  );
  assert.equal(staleCancellation.counts.cancelled, 0);
  assert.deepEqual(
    {
      ...(await database
      .prepare(`SELECT title, status FROM events`)
      .first()),
    },
    { title: "Monotonic Event", status: "draft" },
  );

  const cancelled = await refresh(database, "club_a", fetcher, 4_000);
  assert.equal(cancelled.counts.cancelled, 1);
  assert.deepEqual(
    {
      ...(await database
      .prepare(`SELECT title, status FROM events`)
      .first()),
    },
    { title: "Current Cancellation", status: "draft" },
  );

  await refresh(database, "club_a", fetcher, 5_000);
  assert.deepEqual(
    {
      ...(await database
      .prepare(`SELECT title, status FROM events`)
      .first()),
    },
    { title: "Current Cancellation", status: "draft" },
  );

  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 5_001,
  });
  assert.deepEqual(publicCalendar.events, []);
});

test("imported description and location remain absent from persistence and public DTOs", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);

  const description = "PRIVATE_DESCRIPTION_SENTINEL_93a74";
  const location = "PRIVATE_LOCATION_SENTINEL_29bc1";
  const result = await refresh(
    database,
    "club_a",
    sequenceFetcher([
      calendar(meetupEvent({ description, location })),
    ]),
    2_000,
  );
  assert.equal(result.outcome, "completed");

  const eventRow = await database
    .prepare(
      `SELECT summary, description, venue_id, private_notes,
              private_meeting_details
       FROM events`,
    )
    .first();
  assert.deepEqual({ ...eventRow }, {
    summary: null,
    description: null,
    venue_id: null,
    private_notes: null,
    private_meeting_details: null,
  });

  const durablePayloads = await database
    .prepare(
      `SELECT source_payload_json, normalized_payload_json
       FROM import_rows`,
    )
    .all();
  const serializedRows = JSON.stringify(durablePayloads.results);
  assert.equal(serializedRows.includes(description), false);
  assert.equal(serializedRows.includes(location), false);

  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.equal(publicCalendar.events.length, 1);
  assert.equal(publicCalendar.events[0].description, null);
  assert.equal(publicCalendar.events[0].venue, null);
  const serializedPublic = JSON.stringify(publicCalendar);
  assert.equal(serializedPublic.includes(description), false);
  assert.equal(serializedPublic.includes(location), false);
});

test("manual Meetup refresh seals the exact initiating manager across reads and network latency", async (t) => {
  const body = calendar(
    meetupEvent({
      uid: "manual-race@meetup.com",
      eventId: "manual-race",
      title: "Manual race fixture",
    }),
  );

  await t.test("allowed-role drift before the lease leaves no refresh residue", async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const administrator = seedMeetupAdministrator(database);
    await configure(database, "club_a", FEED_A, 1_000);
    const intercepted = interceptD1Statements(database, {
      after: (sql) =>
        sql.includes("FROM sync_sources") &&
        sql.includes("ORDER BY created_at ASC, id ASC"),
      before: (sql) =>
        sql.includes("UPDATE sync_sources") &&
        sql.includes("SET lease_token = ?"),
      hook: async () => {
        database.exec(`
          UPDATE organization_memberships
          SET role = 'owner', updated_at = updated_at + 1
          WHERE id = 'membership_admin'
        `);
      },
    });

    await assert.rejects(
      refreshMeetupCalendarSource(
        intercepted.database,
        administrator,
        {
          clubId: "club_a",
          fetcher: sequenceFetcher([body]),
          nowUtcMs: 2_000,
          clock: () => 2_000,
        },
      ),
      (error) => error instanceof OrganizerAccessDeniedError,
    );
    assert.equal(intercepted.fired(), true);
    await assertNoManualRefreshResidue(database);
  });

  await t.test("allowed-role drift during fetch rolls back the generation and releases the lease", async (t) => {
    const database = createDatabase();
    t.after(() => database.close());
    const administrator = seedMeetupAdministrator(database);
    await configure(database, "club_a", FEED_A, 1_000);
    let fetched = false;
    const fetcher = async () => {
      fetched = true;
      database.exec(`
        UPDATE organization_memberships
        SET role = 'owner', updated_at = updated_at + 1
        WHERE id = 'membership_admin'
      `);
      return calendarResponse(body);
    };

    await assert.rejects(
      refreshMeetupCalendarSource(database, administrator, {
        clubId: "club_a",
        fetcher,
        nowUtcMs: 2_000,
        clock: () => 2_000,
      }),
      (error) => error instanceof OrganizerAccessDeniedError,
    );
    assert.equal(fetched, true);
    await assertNoManualRefreshResidue(database);
  });
});

test("a three-event manual refresh processes a bounded two-row slice within the D1 query budget", async (t) => {
  const innerDatabase = createDatabase();
  t.after(() => innerDatabase.close());
  await configure(innerDatabase, "club_a", FEED_A, 1_000);
  const counted = exactCountingDatabase(innerDatabase);

  const body = calendar(
    meetupEvent({
      uid: "query-1@meetup.com",
      eventId: "3001",
      title: "Query One",
      start: "20280311T030000Z",
      end: "20280311T040000Z",
    }),
    meetupEvent({
      uid: "query-2@meetup.com",
      eventId: "3002",
      title: "Query Two",
      start: "20280312T030000Z",
      end: "20280312T040000Z",
    }),
    meetupEvent({
      uid: "query-3@meetup.com",
      eventId: "3003",
      title: "Query Three",
      start: "20280313T030000Z",
      end: "20280313T040000Z",
    }),
  );
  const result = await refresh(
    counted.binding,
    "club_a",
    sequenceFetcher([body]),
    2_000,
  );

  assert.equal(result.outcome, "partial");
  assert.equal(result.counts.created, 2);
  const measured = counted.counts();
  assert.equal(measured.statementCount, 35);
  assert.deepEqual(measured.batchLengths, [2, 9, 9, 4]);
  assert.ok(
    measured.statementCount <= 50,
    `refresh executed ${measured.statementCount} D1 statements; expected <= 50`,
  );
});

async function assertNoManualRefreshResidue(database) {
  const residue = await database
    .prepare(
      `SELECT
         (SELECT count(*) FROM import_batches
          WHERE source_type = 'meetup_ics') AS batch_count,
         (SELECT count(*) FROM import_rows) AS row_count,
         (SELECT count(*) FROM meetup_sync_generations) AS generation_count,
         (SELECT count(*) FROM meetup_event_snapshots) AS snapshot_count,
         (SELECT count(*) FROM events) AS event_count,
         (SELECT count(*) FROM external_source_links
          WHERE source_type = 'meetup_ics') AS link_count,
         (SELECT count(*) FROM audit_logs
          WHERE action LIKE 'meetup.%'
            AND action <> 'meetup.connection_configured') AS audit_count,
         (SELECT count(*) FROM sync_sources
          WHERE lease_token IS NOT NULL
             OR lease_expires_at IS NOT NULL) AS lease_count`,
    )
    .first();
  assert.deepEqual({ ...residue }, {
    audit_count: 0,
    batch_count: 0,
    event_count: 0,
    generation_count: 0,
    lease_count: 0,
    link_count: 0,
    row_count: 0,
    snapshot_count: 0,
  });
}

test("explicit due refresh plus a bounded two-row slice stays within the D1 statement cap", async (t) => {
  const innerDatabase = createDatabase();
  t.after(() => innerDatabase.close());
  await ensureDatabaseInvariantsReady(innerDatabase);
  await configure(innerDatabase, "club_a", FEED_A, 1_000);
  const database = exactCountingDatabase(innerDatabase);
  const body = calendar(
    meetupEvent({
      uid: "worker-budget-1@meetup.com",
      eventId: "worker-budget-1",
      title: "Worker Budget One",
      start: "20280311T030000Z",
      end: "20280311T040000Z",
    }),
    meetupEvent({
      uid: "worker-budget-2@meetup.com",
      eventId: "worker-budget-2",
      title: "Worker Budget Two",
      start: "20280312T030000Z",
      end: "20280312T040000Z",
    }),
    meetupEvent({
      uid: "worker-budget-3@meetup.com",
      eventId: "worker-budget-3",
      title: "Worker Budget Three",
      start: "20280313T030000Z",
      end: "20280313T040000Z",
    }),
  );

  assert.equal(await ensureDatabaseInvariants(database.binding), "ready");
  const refreshed = await runDueMeetupRefresh(
    database.binding,
    {
      clock: () => 2_000,
      fetcher: sequenceFetcher([body]),
      nowUtcMs: 2_000,
      organizationId: ORGANIZATION_ID,
    },
  );
  assert.equal(
    refreshed.outcome,
    "partial",
    JSON.stringify(refreshed),
  );
  assert.equal(refreshed.counts.created, 2);
  assert.deepEqual(database.counts(), {
    batchLengths: [2, 9, 9, 4],
    statementCount: 34,
  });
  assert.ok(
    database.counts().statementCount <= 50,
    `Explicit due refresh used ${database.counts().statementCount} D1 statements`,
  );

  const finalSliceRequest = exactCountingDatabase(innerDatabase);
  assert.equal(
    await ensureDatabaseInvariants(finalSliceRequest.binding),
    "ready",
  );
  const completed = await runDueMeetupRefresh(
    finalSliceRequest.binding,
    {
      clock: () => 2_001,
      fetcher: sequenceFetcher([body]),
      nowUtcMs: 2_001,
      organizationId: ORGANIZATION_ID,
    },
  );
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.counts.created, 1);
  assert.deepEqual(finalSliceRequest.counts(), {
    batchLengths: [9, 7],
    statementCount: 25,
  });

  const idleRequest = exactCountingDatabase(innerDatabase);
  assert.equal(await ensureDatabaseInvariants(idleRequest.binding), "ready");
  const notDue = await runDueMeetupRefresh(
    idleRequest.binding,
    {
      fetcher: async () => {
        throw new Error("A not-due refresh must not fetch the feed.");
      },
      nowUtcMs: 2_001,
      organizationId: ORGANIZATION_ID,
    },
  );
  assert.equal(notDue.outcome, "not_due");
  assert.deepEqual(idleRequest.counts(), {
    batchLengths: [],
    statementCount: 3,
  });
});

test("explicit due refresh conflict and failure paths stay within the D1 statement cap", async (t) => {
  await t.test("two rejected conflicts do not block route rendering", async (t) => {
    const innerDatabase = createDatabase();
    t.after(() => innerDatabase.close());
    await ensureDatabaseInvariantsReady(innerDatabase);
    await configure(innerDatabase, "club_a", FEED_A, 1_000);
    innerDatabase.exec(`
      INSERT INTO events (
        id, organization_id, club_id, title, slug, status, visibility,
        time_kind, starts_at_utc, ends_at_utc, timezone,
        organizer_scope_json, schedule_version, schedule_review_state,
        created_by_profile_id, updated_by_profile_id, created_at, updated_at
      ) VALUES (
        'worker_budget_blocker', '${ORGANIZATION_ID}', 'club_a',
        'Worker budget blocker', 'worker-budget-blocker',
        'confirmed', 'private', 'timed',
        1835319600000, 1835326800000, 'America/Vancouver',
        '[]', 1, 'unreviewed',
        'profile_owner', 'profile_owner', 1, 1
      )
    `);
    const database = exactCountingDatabase(innerDatabase);
    const body = calendar(
      ...[1, 2].map((number) =>
        meetupEvent({
          uid: `worker-conflict-${number}@meetup.com`,
          eventId: `worker-conflict-${number}`,
          title: `Worker Conflict ${number}`,
          start: "20280228T030000Z",
          end: "20280228T050000Z",
        }),
      ),
    );

    assert.equal(await ensureDatabaseInvariants(database.binding), "ready");
    const result = await runDueMeetupRefresh(database.binding, {
      clock: () => 2_000,
      fetcher: sequenceFetcher([body]),
      nowUtcMs: 2_000,
      organizationId: ORGANIZATION_ID,
    });
    assert.equal(result.outcome, "completed");
    assert.equal(result.counts.rejected, 2);
    assert.deepEqual(database.counts(), {
      batchLengths: [2, 3, 3, 7],
      statementCount: 25,
    });
    assert.ok(
      database.counts().statementCount < 50,
      `Explicit conflict refresh used ${database.counts().statementCount} D1 statements`,
    );
  });

  await t.test("failed fetch records durable failure without blocking rendering", async (t) => {
    const innerDatabase = createDatabase();
    t.after(() => innerDatabase.close());
    await ensureDatabaseInvariantsReady(innerDatabase);
    await configure(innerDatabase, "club_a", FEED_A, 1_000);
    const database = exactCountingDatabase(innerDatabase);

    assert.equal(await ensureDatabaseInvariants(database.binding), "ready");
    const result = await runDueMeetupRefresh(database.binding, {
      clock: () => 2_000,
      fetcher: async () => new Response("", { status: 503 }),
      nowUtcMs: 2_000,
      organizationId: ORGANIZATION_ID,
    });
    assert.equal(result.outcome, "failed");
    assert.deepEqual(database.counts(), {
      batchLengths: [2],
      statementCount: 7,
    });
    assert.ok(
      database.counts().statementCount < 50,
      `Explicit failed refresh used ${database.counts().statementCount} D1 statements`,
    );
  });
});

test("three conflict rejections resume across bounded requests within the D1 query budget", async (t) => {
  const innerDatabase = createDatabase();
  t.after(() => innerDatabase.close());
  await ensureDatabaseInvariantsReady(innerDatabase);
  await configure(innerDatabase, "club_a", FEED_A, 1_000);
  innerDatabase.exec(`
    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'blocking_event', '${ORGANIZATION_ID}', 'club_a',
      'Blocking event', 'blocking-event', 'confirmed', 'private',
      'timed', 1835319600000, 1835326800000, 'America/Vancouver',
      '[]', 1, 'unreviewed', 'profile_owner', 'profile_owner', 1, 1
    );
  `);
  const database = countingDatabase(innerDatabase);
  database.reset();

  const body = calendar(
    ...[1, 2, 3].map((number) =>
      meetupEvent({
        uid: `conflict-${number}@meetup.com`,
        eventId: `500${number}`,
        title: `Conflict ${number}`,
        start: "20280228T030000Z",
        end: "20280228T050000Z",
      }),
    ),
  );
  const fetcher = sequenceFetcher([body, body]);
  const partial = await refresh(
    database,
    "club_a",
    fetcher,
    2_000,
  );
  const firstRequestCount = database.count();
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.counts.created, 0);
  assert.equal(partial.counts.rejected, 2);
  assert.ok(
    firstRequestCount <= 50,
    `first conflict path prepared ${firstRequestCount} D1 statements; expected <= 50`,
  );
  database.reset();
  const completed = await refresh(
    database,
    "club_a",
    fetcher,
    3_000,
  );
  const secondRequestCount = database.count();
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.counts.created, 0);
  assert.equal(completed.counts.rejected, 1);
  assert.ok(
    secondRequestCount <= 50,
    `resumed conflict path prepared ${secondRequestCount} D1 statements; expected <= 50`,
  );
  assert.equal(
    await innerDatabase
      .prepare(`SELECT count(*) AS count FROM events`)
      .first("count"),
    1,
  );
});

test("completed activation materializes exact timed and Vancouver DST all-day reservation facts", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const body = calendar(
    meetupAllDayEvent(),
    meetupEvent({
      uid: "phase4-timed@meetup.com",
      eventId: "phase4-timed",
      title: "Phase 4 timed source",
      start: "20320313T020000Z",
      end: "20320313T040000Z",
    }),
  );
  const completed = await refresh(
    database,
    "club_a",
    sequenceFetcher([body]),
    2_000,
  );
  assert.equal(completed.outcome, "completed");
  const importedFacts = await database
    .prepare(
      `SELECT title, time_kind, all_day_start_date,
              all_day_end_date_exclusive
       FROM events
       WHERE organization_id = ?
       ORDER BY title`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  assert.equal(
    completed.counts.created,
    2,
    JSON.stringify({
      completed,
      importedFacts: importedFacts.results,
    }),
  );

  const expectedAllDay = normalizeAllDayConflictInterval({
    startDate: "2032-03-14",
    endDateExclusive: "2032-03-16",
    timeZone: "America/Vancouver",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });
  const source = await database
    .prepare(
      `SELECT id, active_generation_id
       FROM sync_sources
       WHERE organization_id = ? AND club_id = ?`,
    )
    .bind(ORGANIZATION_ID, "club_a")
    .first();
  assert.equal(typeof source.active_generation_id, "string");
  const intervals = await database
    .prepare(
      `SELECT interval.title, interval.schedule_shape,
              interval.actual_start_utc, interval.actual_end_utc,
              interval.expanded_start_utc, interval.expanded_end_utc,
              interval.timezone, interval.all_day_start_date,
              interval.all_day_end_date_exclusive,
              interval.generation_id, interval.source_fingerprint,
              interval.normalized_state_fingerprint,
              interval.reservation_semantic_fingerprint,
              normalization.snapshot_id
       FROM organizer_external_reservation_intervals AS interval
       JOIN meetup_snapshot_reservation_normalizations AS normalization
         ON normalization.organization_id = interval.organization_id
        AND normalization.sync_source_id = interval.sync_source_id
        AND normalization.generation_id = interval.generation_id
        AND normalization.snapshot_id = interval.source_record_id
        AND normalization.event_id = interval.event_id
       WHERE interval.organization_id = ?
         AND interval.source_kind = 'meetup'
       ORDER BY interval.schedule_shape`,
    )
    .bind(ORGANIZATION_ID)
    .all();
  assert.equal(intervals.results.length, 2);
  const allDay = intervals.results.find(
    (interval) => interval.schedule_shape === "all_day",
  );
  const timed = intervals.results.find(
    (interval) => interval.schedule_shape === "timed",
  );
  assert.deepEqual(
    {
      actualEndUtc: allDay.actual_end_utc,
      actualStartUtc: allDay.actual_start_utc,
      endDate: allDay.all_day_end_date_exclusive,
      expandedEndUtc: allDay.expanded_end_utc,
      expandedStartUtc: allDay.expanded_start_utc,
      generationId: allDay.generation_id,
      startDate: allDay.all_day_start_date,
      timeZone: allDay.timezone,
    },
    {
      actualEndUtc: expectedAllDay.actualEndUtc,
      actualStartUtc: expectedAllDay.actualStartUtc,
      endDate: "2032-03-16",
      expandedEndUtc: expectedAllDay.expandedEndUtc,
      expandedStartUtc: expectedAllDay.expandedStartUtc,
      generationId: source.active_generation_id,
      startDate: "2032-03-14",
      timeZone: "America/Vancouver",
    },
  );
  assert.deepEqual(
    {
      actualEndUtc: timed.actual_end_utc,
      actualStartUtc: timed.actual_start_utc,
      generationId: timed.generation_id,
      timeZone: timed.timezone,
    },
    {
      actualEndUtc: Date.parse("2032-03-13T04:00:00.000Z"),
      actualStartUtc: Date.parse("2032-03-13T02:00:00.000Z"),
      generationId: source.active_generation_id,
      timeZone: "UTC",
    },
  );
  for (const interval of intervals.results) {
    assert.equal(interval.snapshot_id.length > 0, true);
    assert.match(interval.source_fingerprint, /^[a-f0-9]{64}$/u);
    assert.match(
      interval.normalized_state_fingerprint,
      /^[a-f0-9]{64}$/u,
    );
    assert.match(
      interval.reservation_semantic_fingerprint,
      /^[a-f0-9]{64}$/u,
    );
  }
});

test("a content-only new generation preserves reservation semantics while changing immutable source state", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const firstBody = calendar(
    meetupEvent({
      uid: "semantic-refresh@meetup.com",
      eventId: "semantic-refresh",
      title: "Published title one",
      start: "20320410T020000Z",
      end: "20320410T040000Z",
    }),
  );
  assert.equal(
    (await refresh(database, "club_a", sequenceFetcher([firstBody]), 2_000))
      .outcome,
    "completed",
  );
  const overlapDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    {
      ...sourceOverlapDraftInput("Content-only continuity overlap"),
      startLocal: "2032-04-09T19:30",
      endLocal: "2032-04-09T21:30",
    },
  );
  const warned = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    overlapDraft.id,
    {
      action: "confirm",
      expectedContentVersion: overlapDraft.contentVersion,
      expectedScheduleVersion: overlapDraft.scheduleVersion,
      reason: "The source title changed, not its coordinated schedule.",
    },
  );
  assert.equal(warned.outcome, "applied");
  const originalConflict = await database
    .prepare(
      `SELECT incident.id, incident.state, override.invalidated_at
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
       WHERE override.organizer_event_id = ?
         AND incident.conflicting_candidate_key LIKE 'meetup:%'`,
    )
    .bind(overlapDraft.id)
    .first();
  assert.equal(originalConflict.state, "approved");
  assert.equal(originalConflict.invalidated_at, null);
  const first = await database
    .prepare(
      `SELECT source.active_generation_id,
              interval.source_fingerprint,
              interval.normalized_state_fingerprint,
              interval.reservation_semantic_fingerprint
       FROM sync_sources AS source
       JOIN organizer_external_reservation_intervals AS interval
         ON interval.sync_source_id = source.id
        AND interval.generation_id = source.active_generation_id
       WHERE source.organization_id = ? AND source.club_id = ?`,
    )
    .bind(ORGANIZATION_ID, "club_a")
    .first();
  const secondBody = calendar(
    meetupEvent({
      uid: "semantic-refresh@meetup.com",
      eventId: "semantic-refresh",
      title: "Published title two",
      sequence: 2,
      lastModified: "20260725T020000Z",
      start: "20320410T020000Z",
      end: "20320410T040000Z",
    }),
  );
  const secondRefresh = await refresh(
    database,
    "club_a",
    sequenceFetcher([secondBody]),
    3_000,
  );
  assert.equal(
    secondRefresh.outcome,
    "completed",
    JSON.stringify({
      secondRefresh,
      source: await database
        .prepare(
          `SELECT active_generation_id, pending_generation_id,
                  last_error_code
           FROM sync_sources
           WHERE organization_id = ? AND club_id = ?`,
        )
        .bind(ORGANIZATION_ID, "club_a")
        .first(),
      snapshots: (
        await database
          .prepare(
            `SELECT generation_id, event_id, title, source_fingerprint
             FROM meetup_event_snapshots
             WHERE organization_id = ?
             ORDER BY created_at`,
          )
          .bind(ORGANIZATION_ID)
          .all()
      ).results,
    }),
  );
  const second = await database
    .prepare(
      `SELECT source.active_generation_id,
              interval.title, interval.source_fingerprint,
              interval.normalized_state_fingerprint,
              interval.reservation_semantic_fingerprint
       FROM sync_sources AS source
       JOIN organizer_external_reservation_intervals AS interval
         ON interval.sync_source_id = source.id
        AND interval.generation_id = source.active_generation_id
       WHERE source.organization_id = ? AND source.club_id = ?`,
    )
    .bind(ORGANIZATION_ID, "club_a")
    .first();
  assert.notEqual(second.active_generation_id, first.active_generation_id);
  assert.equal(second.title, "Published title two");
  assert.notEqual(second.source_fingerprint, first.source_fingerprint);
  assert.notEqual(
    second.normalized_state_fingerprint,
    first.normalized_state_fingerprint,
  );
  assert.equal(
    second.reservation_semantic_fingerprint,
    first.reservation_semantic_fingerprint,
    "content-only source changes must not manufacture a new reservation",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT incident.state, override.invalidated_at
           FROM organizer_conflict_incidents AS incident
           JOIN organizer_conflict_overrides AS override
             ON override.incident_id = incident.id
           WHERE incident.id = ?`,
        )
        .bind(originalConflict.id)
        .first()),
    },
    {
      state: "approved",
      invalidated_at: null,
    },
    "an unchanged reservation semantic must retain its exact review",
  );
  const center = await listOrganizerConflictCenter(database, OWNER_IDENTITY);
  const preserved = center.find((item) => item.id === originalConflict.id);
  assert.ok(
    preserved,
    "the preserved incident resolves through the active equivalent generation",
  );
  assert.equal(preserved.state, "approved");
  assert.equal(preserved.eventB.readOnly, true);
  assert.equal(preserved.eventB.title, "Published title two");
  assert.doesNotMatch(
    JSON.stringify(preserved),
    /events\/ical|source_url|feedUrl/iu,
    "the private conflict DTO must not expose the official feed address",
  );
  assert.equal(
    Object.hasOwn(preserved.eventB, "href"),
    false,
    "a read-only source event must not manufacture an organizer-event link",
  );
});

test("a changed source schedule invalidates prior version-bound conflict authorization", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const firstBody = calendar(
    meetupEvent({
      uid: "semantic-move@meetup.com",
      eventId: "semantic-move",
      title: "Source schedule before move",
      start: "20320610T020000Z",
      end: "20320610T040000Z",
    }),
  );
  assert.equal(
    (await refresh(database, "club_a", sequenceFetcher([firstBody]), 2_000))
      .outcome,
    "completed",
  );
  const overlapDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    {
      ...sourceOverlapDraftInput("Version-bound source overlap"),
      startLocal: "2032-06-09T19:30",
      endLocal: "2032-06-09T21:30",
    },
  );
  const warned = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    overlapDraft.id,
    {
      action: "confirm",
      expectedContentVersion: overlapDraft.contentVersion,
      expectedScheduleVersion: overlapDraft.scheduleVersion,
      reason: "Coordinated only for the original source schedule.",
    },
  );
  assert.equal(warned.outcome, "applied");
  const priorConflict = await database
    .prepare(
      `SELECT incident.id, override.id AS override_id
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
       WHERE override.organizer_event_id = ?
         AND override.invalidated_at IS NULL
         AND incident.conflicting_candidate_key LIKE 'meetup:%'`,
    )
    .bind(overlapDraft.id)
    .first();
  assert.ok(priorConflict);

  const movedBody = calendar(
    meetupEvent({
      uid: "semantic-move@meetup.com",
      eventId: "semantic-move",
      title: "Source schedule after move",
      sequence: 2,
      lastModified: "20260725T030000Z",
      start: "20320612T020000Z",
      end: "20320612T040000Z",
    }),
  );
  assert.equal(
    (await refresh(database, "club_a", sequenceFetcher([movedBody]), 3_000))
      .outcome,
    "completed",
  );
  const invalidated = await database
    .prepare(
      `SELECT incident.state, incident.resolved_at,
              override.invalidated_at
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
       WHERE incident.id = ?`,
    )
    .bind(priorConflict.id)
    .first();
  assert.equal(invalidated.state, "invalidated");
  assert.equal(typeof invalidated.resolved_at, "number");
  assert.equal(
    invalidated.invalidated_at,
    invalidated.resolved_at,
    "one D1 activation statement must version-bind the invalidation time",
  );
  const center = await listOrganizerConflictCenter(database, OWNER_IDENTITY);
  const historical = center.find((item) => item.id === priorConflict.id);
  assert.ok(
    historical,
    "the invalidated incident remains safely readable as history",
  );
  assert.equal(historical.state, "invalidated");
  assert.equal(historical.eventB.readOnly, true);
  assert.equal(
    historical.eventB.title,
    "Source schedule before move",
    "changed reservation semantics must not fall forward to the new generation",
  );
  assert.doesNotMatch(
    JSON.stringify(historical),
    /events\/ical|source_url|feedUrl/iu,
  );
});

test("a changed source schedule closes pending reviews bound to the old external facts", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const policy = await getOrganizerConflictPolicy(
    database,
    OWNER_IDENTITY,
  );
  await updateOrganizerConflictPolicy(database, OWNER_IDENTITY, {
    defaultHoldHours: policy.defaultHoldHours,
    expectedPolicyVersion: policy.version,
    mode: "require_admin_approval",
    nearingExpiryHours: policy.nearingExpiryHours,
  });
  const firstBody = calendar(
    meetupEvent({
      uid: "pending-source-move@meetup.com",
      eventId: "pending-source-move",
      title: "Source before pending review invalidation",
      start: "20320710T020000Z",
      end: "20320710T040000Z",
    }),
  );
  assert.equal(
    (await refresh(database, "club_a", sequenceFetcher([firstBody]), 2_000))
      .outcome,
    "completed",
  );
  const overlapDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    {
      ...sourceOverlapDraftInput("Pending review bound to source facts"),
      startLocal: "2032-07-09T19:30",
      endLocal: "2032-07-09T21:30",
    },
  );
  const pending = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    overlapDraft.id,
    {
      action: "confirm",
      expectedContentVersion: overlapDraft.contentVersion,
      expectedScheduleVersion: overlapDraft.scheduleVersion,
      reason: "Reviewing the exact current source schedule.",
    },
  );
  assert.equal(pending.outcome, "pending_approval");
  const beforeMove = await database
    .prepare(
      `SELECT review.state AS review_state,
              incident.id AS incident_id,
              incident.state AS incident_state
       FROM organizer_conflict_review_requests AS review
       JOIN organizer_conflict_incidents AS incident
         ON incident.review_request_id = review.id
       WHERE review.id = ?`,
    )
    .bind(pending.reviewRequestId)
    .first();
  assert.deepEqual(
    {
      review_state: beforeMove.review_state,
      incident_state: beforeMove.incident_state,
    },
    {
      review_state: "pending",
      incident_state: "pending_approval",
    },
  );

  const movedBody = calendar(
    meetupEvent({
      uid: "pending-source-move@meetup.com",
      eventId: "pending-source-move",
      title: "Source after pending review invalidation",
      sequence: 2,
      lastModified: "20260725T033000Z",
      start: "20320712T020000Z",
      end: "20320712T040000Z",
    }),
  );
  assert.equal(
    (await refresh(database, "club_a", sequenceFetcher([movedBody]), 3_000))
      .outcome,
    "completed",
  );
  const afterMove = await database
    .prepare(
      `SELECT review.state AS review_state,
              review.updated_at,
              incident.state AS incident_state,
              incident.resolved_at
       FROM organizer_conflict_review_requests AS review
       JOIN organizer_conflict_incidents AS incident
         ON incident.review_request_id = review.id
       WHERE review.id = ? AND incident.id = ?`,
    )
    .bind(pending.reviewRequestId, beforeMove.incident_id)
    .first();
  assert.equal(afterMove.review_state, "invalidated");
  assert.equal(afterMove.incident_state, "invalidated");
  assert.equal(typeof afterMove.resolved_at, "number");
  assert.equal(
    afterMove.updated_at,
    afterMove.resolved_at,
    "review and incident must close in the same guarded activation statement",
  );
});

test("a conflicting source activation rolls back generation publication and prior invalidation", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const baselineBody = calendar(
    meetupEvent({
      uid: "activation-race@meetup.com",
      eventId: "activation-race",
      title: "Active source before rejected move",
      start: "20320817T010000Z",
      end: "20320817T030000Z",
    }),
  );
  assert.equal(
    (
      await refresh(
        database,
        "club_a",
        sequenceFetcher([baselineBody]),
        2_000,
      )
    ).outcome,
    "completed",
  );
  const sourceBefore = await database
    .prepare(
      `SELECT id, active_generation_id
       FROM sync_sources
       WHERE organization_id = ? AND club_id = ?`,
    )
    .bind(ORGANIZATION_ID, "club_a")
    .first();
  const oldOverlap = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    {
      ...sourceOverlapDraftInput("Old active source overlap"),
      startLocal: "2032-08-16T18:30",
      endLocal: "2032-08-16T20:30",
    },
  );
  const warned = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    oldOverlap.id,
    {
      action: "confirm",
      expectedContentVersion: oldOverlap.contentVersion,
      expectedScheduleVersion: oldOverlap.scheduleVersion,
      reason: "Coordinated against the currently active source schedule.",
    },
  );
  assert.equal(warned.outcome, "applied");
  const oldConflict = await database
    .prepare(
      `SELECT incident.id, override.id AS override_id
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
       WHERE override.organizer_event_id = ?
         AND override.invalidated_at IS NULL
         AND incident.conflicting_candidate_key LIKE 'meetup:%'`,
    )
    .bind(oldOverlap.id)
    .first();
  assert.ok(oldConflict);

  const proposedBody = calendar(
    meetupEvent({
      uid: "activation-race@meetup.com",
      eventId: "activation-race",
      title: "Rejected source move",
      sequence: 2,
      lastModified: "20260725T040000Z",
      start: "20320815T010000Z",
      end: "20320815T030000Z",
    }),
    meetupEvent({
      uid: "activation-filler-1@meetup.com",
      eventId: "activation-filler-1",
      title: "Activation filler one",
      start: "20320901T010000Z",
      end: "20320901T020000Z",
    }),
    meetupEvent({
      uid: "activation-filler-2@meetup.com",
      eventId: "activation-filler-2",
      title: "Activation filler two",
      start: "20320902T010000Z",
      end: "20320902T020000Z",
    }),
    meetupEvent({
      uid: "activation-filler-3@meetup.com",
      eventId: "activation-filler-3",
      title: "Activation filler three",
      start: "20320903T010000Z",
      end: "20320903T020000Z",
    }),
  );
  const proposedFetcher = sequenceFetcher([proposedBody, proposedBody]);
  const partial = await refresh(
    database,
    "club_a",
    proposedFetcher,
    3_000,
  );
  assert.equal(partial.outcome, "partial");
  const sourceDuring = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE id = ?`,
    )
    .bind(sourceBefore.id)
    .first();
  assert.equal(
    sourceDuring.active_generation_id,
    sourceBefore.active_generation_id,
  );
  assert.equal(typeof sourceDuring.pending_generation_id, "string");

  const newCollision = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    sourceOverlapDraftInput("Reservation created during staged source move"),
  );
  const newlyReserved = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    newCollision.id,
    {
      action: "confirm",
      expectedContentVersion: newCollision.contentVersion,
      expectedScheduleVersion: newCollision.scheduleVersion,
    },
  );
  assert.equal(newlyReserved.outcome, "applied");

  const failed = await refresh(
    database,
    "club_a",
    proposedFetcher,
    4_000,
  );
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.state.lastErrorCode, "conflict_rejected");
  const conflictUiState = toMeetupUiState(failed.state);
  assert.equal(conflictUiState.scheduleConflict, true);
  assert.match(
    connectionCopy(conflictUiState).detail,
    /last completed source snapshot remains active[\s\S]*Move or release[\s\S]*refresh again/iu,
  );
  const sourceAfter = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id,
              last_error_code
       FROM sync_sources
       WHERE id = ?`,
    )
    .bind(sourceBefore.id)
    .first();
  assert.equal(
    sourceAfter.active_generation_id,
    sourceBefore.active_generation_id,
  );
  assert.equal(
    sourceAfter.pending_generation_id,
    sourceDuring.pending_generation_id,
  );
  assert.equal(sourceAfter.last_error_code, "conflict_rejected");
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT incident.state, incident.resolved_at,
                  override.invalidated_at
           FROM organizer_conflict_incidents AS incident
           JOIN organizer_conflict_overrides AS override
             ON override.incident_id = incident.id
           WHERE incident.id = ?`,
        )
        .bind(oldConflict.id)
        .first()),
    },
    {
      state: "approved",
      resolved_at: null,
      invalidated_at: null,
    },
    "the failed source activation must roll back its attempted invalidation",
  );
  const activePublic = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 4_001,
  });
  assert.equal(activePublic.events.length, 1);
  assert.equal(
    activePublic.events[0].title,
    "Active source before rejected move",
  );

  const cancelledCollision = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    newlyReserved.event.id,
    {
      action: "cancel",
      expectedContentVersion: newlyReserved.event.contentVersion,
      expectedScheduleVersion: newlyReserved.event.scheduleVersion,
    },
  );
  assert.equal(cancelledCollision.outcome, "applied");
  assert.equal(cancelledCollision.event.planningStatus, "cancelled");

  const retried = await refresh(
    database,
    "club_a",
    proposedFetcher,
    5_000,
  );
  assert.equal(retried.outcome, "completed");
  assert.equal(retried.state.lastErrorCode, null);
  assert.equal(toMeetupUiState(retried.state).scheduleConflict, false);
  const sourceRecovered = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id,
              last_error_code
       FROM sync_sources
       WHERE id = ?`,
    )
    .bind(sourceBefore.id)
    .first();
  assert.equal(
    sourceRecovered.active_generation_id,
    sourceDuring.pending_generation_id,
  );
  assert.equal(sourceRecovered.pending_generation_id, null);
  assert.equal(sourceRecovered.last_error_code, null);
  const recoveredReview = await database
    .prepare(
      `SELECT incident.state, incident.resolved_at,
              override.invalidated_at
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
       WHERE incident.id = ?`,
    )
    .bind(oldConflict.id)
    .first();
  assert.equal(recoveredReview.state, "invalidated");
  assert.equal(typeof recoveredReview.invalidated_at, "number");
  assert.equal(
    recoveredReview.invalidated_at,
    recoveredReview.resolved_at,
    "successful retry must atomically invalidate the old source-bound review",
  );
});

test("resumes a stable feed snapshot in bounded two-row chunks", async (t) => {
  const innerDatabase = createDatabase();
  t.after(() => innerDatabase.close());
  const database = countingDatabase(innerDatabase);
  await configure(database, "club_a", FEED_A, 1_000);

  const body = calendar(
    meetupEvent({
      uid: "chunk-1@meetup.com",
      eventId: "4001",
      title: "Chunk One",
      start: "20280401T030000Z",
      end: "20280401T040000Z",
    }),
    meetupEvent({
      uid: "chunk-2@meetup.com",
      eventId: "4002",
      title: "Chunk Two",
      start: "20280402T030000Z",
      end: "20280402T040000Z",
    }),
    meetupEvent({
      uid: "chunk-3@meetup.com",
      eventId: "4003",
      title: "Chunk Three",
      start: "20280403T030000Z",
      end: "20280403T040000Z",
    }),
    meetupEvent({
      uid: "chunk-4@meetup.com",
      eventId: "4004",
      title: "Chunk Four",
      start: "20280404T030000Z",
      end: "20280404T040000Z",
    }),
  );
  const fetcher = sequenceFetcher([body, body]);

  database.reset();
  const partial = await refresh(
    database,
    "club_a",
    fetcher,
    2_000,
  );
  const firstQueryCount = database.count();
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.state.status, "partial");
  assert.equal(partial.counts.created, 2);
  assert.ok(
    firstQueryCount <= 50,
    `first chunk prepared ${firstQueryCount} D1 statements; expected <= 50`,
  );
  assert.equal(
    await innerDatabase
      .prepare(`SELECT count(*) AS count FROM events`)
      .first("count"),
    2,
  );
  const pending = await innerDatabase
    .prepare(
      `SELECT active_generation_id, pending_generation_id, pending_cursor,
              pending_snapshot_hash, last_success_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(pending.active_generation_id, null);
  assert.equal(typeof pending.pending_generation_id, "string");
  assert.equal(pending.pending_cursor, 2);
  assert.equal(typeof pending.pending_snapshot_hash, "string");
  assert.equal(pending.pending_snapshot_hash.length, 64);
  assert.equal(pending.last_success_at, null);
  assert.deepEqual(
    {
      ...(await innerDatabase
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count, removed_count, published_at,
                  previous_generation_id
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(pending.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      expected_item_count: 4,
      processed_item_count: 2,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: null,
      previous_generation_id: null,
    },
  );

  const duringPartial = await listPublicMeetupCalendar(innerDatabase, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.equal(duringPartial.sync.status, "partial");
  assert.deepEqual(duringPartial.events, []);

  database.reset();
  const completed = await refresh(
    database,
    "club_a",
    fetcher,
    3_000,
  );
  const secondQueryCount = database.count();
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.counts.created, 2);
  assert.ok(
    secondQueryCount <= 50,
    `resume chunk prepared ${secondQueryCount} D1 statements; expected <= 50`,
  );
  assert.equal(
    await innerDatabase
      .prepare(`SELECT count(*) AS count FROM events`)
      .first("count"),
    4,
  );
  const finished = await innerDatabase
    .prepare(
      `SELECT active_generation_id, pending_generation_id, pending_cursor,
              pending_snapshot_hash, last_success_at
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(finished.active_generation_id, pending.pending_generation_id);
  assert.equal(finished.pending_generation_id, null);
  assert.equal(finished.pending_cursor, null);
  assert.equal(finished.pending_snapshot_hash, null);
  assert.equal(finished.last_success_at, 3_000);
  assert.deepEqual(
    {
      ...(await innerDatabase
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count, removed_count, published_at,
                  previous_generation_id
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(finished.active_generation_id)
        .first()),
    },
    {
      state: "published",
      expected_item_count: 4,
      processed_item_count: 4,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: 3_000,
      previous_generation_id: null,
    },
  );

  const publicCalendar = await listPublicMeetupCalendar(innerDatabase, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.equal(publicCalendar.sync.status, "current");
  assert.equal(publicCalendar.events.length, 4);
});

test("resumes one canonical generation when ignored raw calendar bytes change", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);

  const firstDecoration = "RAW_CALENDAR_DECORATION_FIRST_8f7a";
  const secondDecoration = "RAW_CALENDAR_DECORATION_SECOND_2c91";
  const firstDescription = "RAW_DESCRIPTION_FIRST_9d31";
  const secondDescription = "RAW_DESCRIPTION_SECOND_6b42";
  const firstLocation = "RAW_LOCATION_FIRST_4a85";
  const secondLocation = "RAW_LOCATION_SECOND_1e73";
  const eventFacts = [
    {
      end: "20280411T040000Z",
      eventId: "4101",
      start: "20280411T030000Z",
      title: "Canonical Chunk One",
      uid: "canonical-chunk-1@meetup.com",
    },
    {
      end: "20280412T040000Z",
      eventId: "4102",
      start: "20280412T030000Z",
      title: "Canonical Chunk Two",
      uid: "canonical-chunk-2@meetup.com",
    },
    {
      end: "20280413T040000Z",
      eventId: "4103",
      start: "20280413T030000Z",
      title: "Canonical Chunk Three",
      uid: "canonical-chunk-3@meetup.com",
    },
    {
      end: "20280414T040000Z",
      eventId: "4104",
      start: "20280414T030000Z",
      title: "Canonical Chunk Four",
      uid: "canonical-chunk-4@meetup.com",
    },
  ];
  const rawCalendar = (decoration, description, location) =>
    calendar(
      ...eventFacts.map((facts) =>
        meetupEvent({
          ...facts,
          description,
          location,
        }),
      ),
    ).replace(
      "METHOD:PUBLISH",
      `METHOD:PUBLISH
X-WR-CALNAME:${decoration}
X-CALENDAR-COLOR:#123456`,
    );
  const firstBody = rawCalendar(
    firstDecoration,
    firstDescription,
    firstLocation,
  );
  const secondBody = rawCalendar(
    secondDecoration,
    secondDescription,
    secondLocation,
  );
  assert.notEqual(firstBody, secondBody);

  const fetcher = sequenceFetcher([firstBody, secondBody]);
  const partial = await refresh(
    database,
    "club_a",
    fetcher,
    2_000,
  );
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.counts.created, 2);
  const pending = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id,
              pending_snapshot_hash, pending_cursor
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(pending.active_generation_id, null);
  assert.equal(typeof pending.pending_generation_id, "string");
  assert.equal(typeof pending.pending_snapshot_hash, "string");
  assert.equal(pending.pending_cursor, 2);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM meetup_sync_generations`,
      )
      .first("count"),
    1,
  );

  const completed = await refresh(
    database,
    "club_a",
    fetcher,
    3_000,
  );
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.counts.created, 2);
  const finished = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id,
              pending_snapshot_hash, pending_cursor
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(finished.active_generation_id, pending.pending_generation_id);
  assert.equal(finished.pending_generation_id, null);
  assert.equal(finished.pending_snapshot_hash, null);
  assert.equal(finished.pending_cursor, null);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM meetup_sync_generations`,
      )
      .first("count"),
    1,
    "raw-only changes must not abandon and restart the generation",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count, removed_count
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(finished.active_generation_id)
        .first()),
    },
    {
      state: "published",
      expected_item_count: 4,
      processed_item_count: 4,
      rejected_item_count: 0,
      removed_count: 0,
    },
  );

  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.deepEqual(
    publicCalendar.events.map((event) => ({
      description: event.description,
      rsvpUrl: event.rsvpUrl,
      title: event.title,
      venue: event.venue,
    })),
    eventFacts.map((facts) => ({
      description: null,
      rsvpUrl: `https://www.meetup.com/${GROUP_A}/events/${facts.eventId}/`,
      title: facts.title,
      venue: null,
    })),
  );

  const durableFacts = {
    audits: (
      await database
        .prepare(`SELECT metadata_json FROM audit_logs`)
        .all()
    ).results,
    events: (
      await database
        .prepare(
          `SELECT summary, description, private_notes,
                  private_meeting_details
           FROM events`,
        )
        .all()
    ).results,
    imports: (
      await database
        .prepare(
          `SELECT source_payload_json, normalized_payload_json
           FROM import_rows`,
        )
        .all()
    ).results,
    publicCalendar,
  };
  const serializedDurableFacts = JSON.stringify(durableFacts);
  for (const ignoredRawValue of [
    firstDecoration,
    secondDecoration,
    firstDescription,
    secondDescription,
    firstLocation,
    secondLocation,
  ]) {
    assert.equal(
      serializedDurableFacts.includes(ignoredRawValue),
      false,
      `${ignoredRawValue} leaked into durable or public data`,
    );
  }
});

test("disabled sources pause publication as well as refresh", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const published = await refresh(
    database,
    "club_a",
    sequenceFetcher([
      calendar(
        meetupEvent({
          uid: "disabled-source@meetup.com",
          eventId: "7001",
          title: "Paused Source Event",
        }),
      ),
    ]),
    2_000,
  );
  assert.equal(published.outcome, "completed");
  database.exec(`
    UPDATE sync_sources
    SET enabled = 0
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);

  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.equal(publicCalendar.sync.status, "disabled");
  assert.deepEqual(publicCalendar.events, []);
  database.exec(`
    UPDATE sync_sources
    SET enabled = 1
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);
  const reactivated = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_002,
  });
  assert.equal(reactivated.events.length, 1);
  assert.equal(reactivated.events[0].title, "Paused Source Event");
  assert.throws(
    () =>
      database.exec(`
        UPDATE sync_sources
        SET club_id = 'club_b'
        WHERE organization_id = '${ORGANIZATION_ID}'
          AND club_id = 'club_a';
      `),
    /phase4_source_identity_immutable/u,
  );
  assert.throws(
    () =>
      database.exec(`
        UPDATE sync_sources
        SET organization_id = 'other-organization'
        WHERE organization_id = '${ORGANIZATION_ID}'
          AND club_id = 'club_a';
      `),
    /phase4_source_identity_immutable/u,
  );
  database.exec(`
    UPDATE sync_sources
    SET deleted_at = 3_000
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);
  database.exec(`
    UPDATE sync_sources
    SET deleted_at = NULL
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);
  const restored = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.equal(restored.events.length, 1);
});

test("re-enabling an active source reruns the authoritative activation guard", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const sourceBody = calendar(
    meetupEvent({
      uid: "reenable-guard@meetup.com",
      eventId: "7051",
      title: "Paused reservation",
      start: "20320815T010000Z",
      end: "20320815T030000Z",
    }),
  );
  assert.equal(
    (await refresh(database, "club_a", sequenceFetcher([sourceBody]), 2_000))
      .outcome,
    "completed",
  );

  database.exec(`
    UPDATE sync_sources
    SET enabled = 0
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);

  const overlappingDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    sourceOverlapDraftInput("Reservation created while source is paused"),
  );
  const reserved = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    overlappingDraft.id,
    {
      action: "confirm",
      expectedContentVersion: overlappingDraft.contentVersion,
      expectedScheduleVersion: overlappingDraft.scheduleVersion,
    },
  );
  assert.equal(reserved.outcome, "applied");

  assert.throws(
    () =>
      database.exec(`
        UPDATE sync_sources
        SET enabled = 1
        WHERE organization_id = '${ORGANIZATION_ID}'
          AND club_id = 'club_a';
      `),
    /phase4_source_activation_conflict/u,
    "enabled 0→1 must not make an existing generation reserving around the guard",
  );
  assert.equal(
    (
      await database
        .prepare(
          `SELECT enabled
           FROM sync_sources
           WHERE organization_id = ? AND club_id = ?`,
        )
        .bind(ORGANIZATION_ID, "club_a")
        .first()
    ).enabled,
    0,
    "the failed activation must leave the source disabled",
  );

  const cancelled = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    reserved.event.id,
    {
      action: "cancel",
      expectedContentVersion: reserved.event.contentVersion,
      expectedScheduleVersion: reserved.event.scheduleVersion,
    },
  );
  assert.equal(cancelled.outcome, "applied");
  database.exec(`
    UPDATE sync_sources
    SET enabled = 1
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);
  assert.equal(
    (
      await database
        .prepare(
          `SELECT enabled
           FROM sync_sources
           WHERE organization_id = ? AND club_id = ?`,
        )
        .bind(ORGANIZATION_ID, "club_a")
        .first()
    ).enabled,
    1,
  );
});

test("source deactivation invalidates active overrides, incidents, and pending reviews", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await ensureDatabaseInvariantsReady(database);
  await configure(database, "club_a", FEED_A, 1_000);
  const sourceBody = calendar(
    meetupEvent({
      uid: "deactivation-conflict@meetup.com",
      eventId: "7101",
      title: "Source reservation",
      start: "20320815T010000Z",
      end: "20320815T030000Z",
    }),
  );
  assert.equal(
    (await refresh(database, "club_a", sequenceFetcher([sourceBody]), 2_000))
      .outcome,
    "completed",
  );
  const warnDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    sourceOverlapDraftInput("Warn overlap before deactivation"),
  );
  const warned = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    warnDraft.id,
    {
      action: "confirm",
      expectedContentVersion: warnDraft.contentVersion,
      expectedScheduleVersion: warnDraft.scheduleVersion,
      reason: "Coordinated overlap before source pause.",
    },
  );
  assert.equal(warned.outcome, "applied");
  const activeOverride = await database
    .prepare(
      `SELECT override.id, override.incident_id
       FROM organizer_conflict_overrides AS override
       JOIN organizer_conflict_incidents AS incident
         ON incident.id = override.incident_id
       WHERE override.organizer_event_id = ?
         AND override.invalidated_at IS NULL
         AND incident.conflicting_candidate_key LIKE 'meetup:%'`,
    )
    .bind(warnDraft.id)
    .first();
  assert.ok(activeOverride);

  database.exec(`
    UPDATE sync_sources
    SET enabled = 0
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);
  const invalidated = await database
    .prepare(
      `SELECT incident.state, incident.resolved_at,
              override.invalidated_at
       FROM organizer_conflict_incidents AS incident
       JOIN organizer_conflict_overrides AS override
         ON override.incident_id = incident.id
       WHERE incident.id = ?`,
    )
    .bind(activeOverride.incident_id)
    .first();
  assert.equal(invalidated.state, "invalidated");
  assert.equal(typeof invalidated.resolved_at, "number");
  assert.equal(typeof invalidated.invalidated_at, "number");
  await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    warned.event.id,
    {
      action: "cancel",
      expectedContentVersion: warned.event.contentVersion,
      expectedScheduleVersion: warned.event.scheduleVersion,
    },
  );

  const policy = await getOrganizerConflictPolicy(
    database,
    OWNER_IDENTITY,
  );
  await updateOrganizerConflictPolicy(database, OWNER_IDENTITY, {
    defaultHoldHours: policy.defaultHoldHours,
    expectedPolicyVersion: policy.version,
    mode: "require_admin_approval",
    nearingExpiryHours: policy.nearingExpiryHours,
  });
  database.exec(`
    UPDATE sync_sources
    SET enabled = 1
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);
  const approvalDraft = await createOrganizerEvent(
    database,
    OWNER_IDENTITY,
    sourceOverlapDraftInput("Pending overlap before deactivation"),
  );
  const pending = await performOrganizerLifecycleAction(
    database,
    OWNER_IDENTITY,
    approvalDraft.id,
    {
      action: "confirm",
      expectedContentVersion: approvalDraft.contentVersion,
      expectedScheduleVersion: approvalDraft.scheduleVersion,
      reason: "Requesting review before source pause.",
    },
  );
  assert.equal(pending.outcome, "pending_approval");
  assert.equal(typeof pending.reviewRequestId, "string");
  database.exec(`
    UPDATE sync_sources
    SET enabled = 0
    WHERE organization_id = '${ORGANIZATION_ID}'
      AND club_id = 'club_a';
  `);
  assert.equal(
    (
      await database
        .prepare(
          `SELECT state
           FROM organizer_conflict_review_requests
           WHERE id = ?`,
        )
        .bind(pending.reviewRequestId)
        .first()
    ).state,
    "invalidated",
  );
});

test("keeps the last completed generation public when a later chunk fails", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);

  const publishedFeed = calendar(
    meetupEvent({
      uid: "generation-baseline@meetup.com",
      eventId: "8101",
      title: "Published Baseline",
      start: "20280501T030000Z",
      end: "20280501T040000Z",
    }),
    meetupEvent({
      uid: "generation-cancel-baseline@meetup.com",
      eventId: "8100",
      title: "Published Until Finalized",
      start: "20280430T030000Z",
      end: "20280430T040000Z",
    }),
  );
  const published = await refresh(
    database,
    "club_a",
    sequenceFetcher([publishedFeed]),
    2_000,
  );
  assert.equal(published.outcome, "completed");

  database.exec(`
    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'manual_projection_sentinel', '${ORGANIZATION_ID}', 'club_a',
      'Manual Projection Sentinel', 'manual-projection-sentinel',
      'confirmed', 'public', 'timed',
      ${Date.parse("2028-05-10T03:00:00Z")},
      ${Date.parse("2028-05-10T04:00:00Z")}, 'America/Vancouver',
      '[]', 1, 'unreviewed', 2050, 'profile_owner', 'profile_owner',
      2050, 2050
    );

    UPDATE events
    SET summary = 'OWNER SUMMARY SENTINEL',
        description = 'OWNER DESCRIPTION SENTINEL',
        schedule_version = schedule_version + 1
    WHERE title = 'Published Baseline';

    UPDATE events
    SET visibility = 'private',
        published_at = NULL,
        schedule_version = schedule_version + 1
    WHERE title = 'Published Until Finalized';
  `);

  const sourceAfterPublished = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceAfterPublished.active_generation_id, "string");
  assert.equal(sourceAfterPublished.pending_generation_id, null);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, rejected_item_count, removed_count,
                  published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAfterPublished.active_generation_id)
        .first()),
    },
    {
      state: "published",
      previous_generation_id: null,
      expected_item_count: 2,
      processed_item_count: 2,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: 2_000,
    },
  );

  const publicBefore = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 2_001,
  });
  assert.deepEqual(
    publicBefore.events.map((event) => event.title),
    ["Published Baseline"],
  );
  assert.equal(publicBefore.events[0]?.summary, "OWNER SUMMARY SENTINEL");
  assert.equal(
    publicBefore.events[0]?.description,
    "OWNER DESCRIPTION SENTINEL",
  );
  const serializedPublishedEvents = JSON.stringify(publicBefore.events);
  const generalBefore = await listUpcomingPublicEvents(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
  });
  assert.deepEqual(
    generalBefore.map((event) => event.title),
    ["Manual Projection Sentinel"],
    "the general/manual projection must exclude every Meetup-source-linked event",
  );
  const serializedGeneralEvents = JSON.stringify(generalBefore);

  const changedFourRowFeed = calendar(
    meetupEvent({
      uid: "generation-baseline@meetup.com",
      eventId: "8101",
      lastModified: "20260724T030000Z",
      sequence: 2,
      title: "UNCOMMITTED UPDATE SENTINEL",
      start: "20280501T030000Z",
      end: "20280501T040000Z",
    }),
    meetupEvent({
      uid: "generation-cancel-baseline@meetup.com",
      eventId: "8100",
      lastModified: "20260724T030000Z",
      sequence: 2,
      status: "CANCELLED",
      title: "Published Until Finalized",
      start: "20280430T030000Z",
      end: "20280430T040000Z",
    }),
    meetupEvent({
      uid: "generation-new-2@meetup.com",
      eventId: "8102",
      title: "UNCOMMITTED NEW TWO",
      start: "20280502T030000Z",
      end: "20280502T040000Z",
    }),
    meetupEvent({
      uid: "generation-new-3@meetup.com",
      eventId: "8103",
      title: "UNCOMMITTED NEW THREE",
      start: "20280503T030000Z",
      end: "20280503T040000Z",
    }),
  );
  const interruptedFetcher = sequenceFetcher([
    changedFourRowFeed,
    () => {
      throw new Error("later chunk fetch failed");
    },
  ]);

  const partial = await refresh(
    database,
    "club_a",
    interruptedFetcher,
    3_000,
  );
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.counts.cancelled, 1);
  assert.equal(partial.counts.created, 0);
  assert.equal(partial.counts.updated, 2);

  const sourceDuringPartial = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(
    sourceDuringPartial.active_generation_id,
    sourceAfterPublished.active_generation_id,
  );
  assert.equal(typeof sourceDuringPartial.pending_generation_id, "string");
  assert.notEqual(
    sourceDuringPartial.pending_generation_id,
    sourceDuringPartial.active_generation_id,
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, rejected_item_count, removed_count,
                  published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceDuringPartial.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      previous_generation_id: sourceAfterPublished.active_generation_id,
      expected_item_count: 4,
      processed_item_count: 2,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: null,
    },
  );

  const publicDuringPartial = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.equal(
    JSON.stringify(publicDuringPartial.events),
    serializedPublishedEvents,
    "a partial generation must not change the last completed public snapshot",
  );
  const generalDuringPartial = await listUpcomingPublicEvents(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
  });
  assert.equal(
    JSON.stringify(generalDuringPartial),
    serializedGeneralEvents,
    "the general/manual projection must not expose source-backed staged rows",
  );
  assert.equal(
    JSON.stringify(generalDuringPartial).includes("UNCOMMITTED"),
    false,
  );
  const baseRowsDuringPartial = await database
    .prepare(
      `SELECT title, summary, description, visibility, published_at
       FROM events
       WHERE title IN (
         'UNCOMMITTED UPDATE SENTINEL',
         'Published Until Finalized'
       )
       ORDER BY title`,
    )
    .all();
  assert.deepEqual(
    baseRowsDuringPartial.results.map((row) => ({ ...row })),
    [
      {
        title: "Published Until Finalized",
        summary: null,
        description: null,
        visibility: "private",
        published_at: null,
      },
      {
        title: "UNCOMMITTED UPDATE SENTINEL",
        summary: "OWNER SUMMARY SENTINEL",
        description: "OWNER DESCRIPTION SENTINEL",
        visibility: "public",
        published_at: 2_000,
      },
    ],
    "pending writes must preserve owner-managed enrichment and publication state",
  );

  const failed = await refresh(
    database,
    "club_a",
    interruptedFetcher,
    4_000,
  );
  assert.equal(failed.outcome, "failed");

  const sourceAfterFailure = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id, last_error_code
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(
    sourceAfterFailure.active_generation_id,
    sourceAfterPublished.active_generation_id,
  );
  assert.equal(
    sourceAfterFailure.pending_generation_id,
    sourceDuringPartial.pending_generation_id,
  );
  assert.equal(typeof sourceAfterFailure.last_error_code, "string");
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, rejected_item_count, removed_count,
                  published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAfterFailure.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      previous_generation_id: sourceAfterPublished.active_generation_id,
      expected_item_count: 4,
      processed_item_count: 2,
      rejected_item_count: 0,
      removed_count: 0,
      published_at: null,
    },
    "a failed continuation must not publish or advance the pending generation",
  );

  const publicAfterFailure = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 4_001,
  });
  assert.equal(
    JSON.stringify(publicAfterFailure.events),
    serializedPublishedEvents,
    "a failed generation must leave the prior public snapshot byte-for-byte intact",
  );
  const generalAfterFailure = await listUpcomingPublicEvents(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
  });
  assert.equal(
    JSON.stringify(generalAfterFailure),
    serializedGeneralEvents,
    "a failed generation must not leak through the general/manual projection",
  );
  const baseRowsAfterFailure = await database
    .prepare(
      `SELECT title, summary, description, visibility, published_at
       FROM events
       WHERE title IN (
         'UNCOMMITTED UPDATE SENTINEL',
         'Published Until Finalized'
       )
       ORDER BY title`,
    )
    .all();
  assert.deepEqual(
    baseRowsAfterFailure.results.map((row) => ({ ...row })),
    baseRowsDuringPartial.results.map((row) => ({ ...row })),
    "a failed continuation must not mutate owner-managed base fields",
  );
});

test("an unscoped refresh finishes a pending generation before rotating to an untouched source", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const sourceBFeed = calendar(
    ...[1, 2, 3].map((number) =>
      meetupEvent({
        uid: `pending-priority-${number}@meetup.com`,
        eventId: `pending-priority-${number}`,
        groupSlug: GROUP_B,
        title: `Pending priority ${number}`,
        start: `2028050${number}T030000Z`,
        end: `2028050${number}T040000Z`,
      }),
    ),
  );
  const first = await refresh(
    database,
    "club_b",
    sequenceFetcher([sourceBFeed]),
    2_000,
  );
  assert.equal(first.outcome, "partial");

  const fetchedUrls = [];
  const continued = await refreshMeetupCalendarSource(
    database,
    OWNER_IDENTITY,
    {
      clock: () => 3_000,
      fetcher: async (url) => {
        fetchedUrls.push(String(url));
        const body = String(url) === FEED_B
          ? sourceBFeed
          : calendar(
              meetupEvent({
                uid: "untouched-source@meetup.com",
                eventId: "untouched-source",
                title: "Untouched source",
              }),
            );
        return calendarResponse(body);
      },
      nowUtcMs: 3_000,
    },
  );
  assert.equal(continued.outcome, "completed");
  assert.deepEqual(fetchedUrls, [FEED_B]);

  const sources = await database
    .prepare(
      `SELECT club_id, active_generation_id, pending_generation_id,
              last_attempt_at
       FROM sync_sources
       WHERE club_id IN ('club_a', 'club_b')
       ORDER BY club_id`,
    )
    .all();
  assert.equal(sources.results.length, 2);
  assert.deepEqual({ ...sources.results[0] }, {
    club_id: "club_a",
    active_generation_id: null,
    pending_generation_id: null,
    last_attempt_at: null,
  });
  assert.equal(sources.results[1].club_id, "club_b");
  assert.equal(typeof sources.results[1].active_generation_id, "string");
  assert.equal(sources.results[1].pending_generation_id, null);
  assert.equal(sources.results[1].last_attempt_at, 3_000);
});

test("an unsolicited 304 cannot finalize a pending generation", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await refresh(
    database,
    "club_a",
    sequenceFetcher([
      calendar(
        meetupEvent({
          uid: "not-modified-baseline@meetup.com",
          eventId: "8150",
          title: "Stable Before 304",
        }),
      ),
    ]),
    2_000,
  );
  const sourceBefore = await database
    .prepare(
      `SELECT active_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  const changedFeed = calendar(
    ...[1, 2, 3, 4].map((number) =>
      meetupEvent({
        uid: `not-modified-${number}@meetup.com`,
        eventId: `815${number}`,
        title: `Pending 304 ${number}`,
        start: `2028050${number}T030000Z`,
        end: `2028050${number}T040000Z`,
      }),
    ),
  );
  let fetchCount = 0;
  const fetcher = async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? calendarResponse(changedFeed)
      : new Response(null, { status: 304 });
  };
  assert.equal(
    (await refresh(database, "club_a", fetcher, 3_000)).outcome,
    "partial",
  );
  assert.equal(
    (await refresh(database, "club_a", fetcher, 4_000)).outcome,
    "failed",
  );
  const sourceAfter = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(sourceAfter.active_generation_id, sourceBefore.active_generation_id);
  assert.equal(typeof sourceAfter.pending_generation_id, "string");
  const publicCalendar = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 4_001,
  });
  assert.deepEqual(
    publicCalendar.events.map((event) => event.title),
    ["Stable Before 304"],
  );
});

test("reconciles disappeared future events only after source-scoped finalization and supports reappearance", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const keepEvent = meetupEvent({
    uid: "reconcile-keep@meetup.com",
    eventId: "8201",
    title: "Keep Future Event",
    start: "20280601T030000Z",
    end: "20280601T040000Z",
  });
  const missingEvent = meetupEvent({
    uid: "reconcile-missing@meetup.com",
    eventId: "8202",
    title: "Missing Future Event",
    start: "20280602T030000Z",
    end: "20280602T040000Z",
  });
  const secondMissingEvent = meetupEvent({
    uid: "reconcile-missing-2@meetup.com",
    eventId: "8206",
    title: "Second Missing Future Event",
    start: "20280606T030000Z",
    end: "20280606T040000Z",
  });
  const initialAFetcher = sequenceFetcher([
    calendar(keepEvent, missingEvent, secondMissingEvent),
    calendar(keepEvent, missingEvent, secondMissingEvent),
  ]);
  const initialAPartial = await refresh(
    database,
    "club_a",
    initialAFetcher,
    2_000,
  );
  assert.equal(initialAPartial.outcome, "partial");
  assert.equal(initialAPartial.counts.created, 2);
  const initialA = await refresh(
    database,
    "club_a",
    initialAFetcher,
    2_001,
  );
  assert.equal(initialA.outcome, "completed");
  assert.equal(initialA.counts.created, 1);

  const sourceBEvent = meetupEvent({
    uid: "other-source@meetup.com",
    eventId: "9201",
    groupSlug: GROUP_B,
    title: "Other Source Event",
    start: "20280610T030000Z",
    end: "20280610T040000Z",
  });
  const initialB = await refresh(
    database,
    "club_b",
    sequenceFetcher([calendar(sourceBEvent)]),
    2_100,
  );
  assert.equal(initialB.outcome, "completed");
  assert.equal(initialB.counts.created, 1);

  database.exec(`
    INSERT INTO events (
      id, organization_id, club_id, title, slug, status, visibility,
      time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'manual_event', '${ORGANIZATION_ID}', 'club_b',
      'Manual Event', 'manual-event', 'confirmed', 'public',
      'timed', ${Date.parse("2028-06-11T03:00:00Z")},
      ${Date.parse("2028-06-11T04:00:00Z")}, 'America/Vancouver',
      '[]', 1, 'unreviewed', 2200, 'profile_owner', 'profile_owner',
      2200, 2200
    );
  `);

  const missingBefore = await database
    .prepare(
      `SELECT id, status, visibility, published_at, deleted_at
       FROM events
       WHERE title = 'Missing Future Event'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.ok(missingBefore);
  const secondMissingBefore = await database
    .prepare(
      `SELECT id, status, visibility, published_at, deleted_at
       FROM events
       WHERE title = 'Second Missing Future Event'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.ok(secondMissingBefore);

  const protectedColumns = `
    id, organization_id, club_id, title, slug, status, visibility,
    time_kind, starts_at_utc, ends_at_utc, timezone, published_at,
    schedule_version, updated_at, deleted_at
  `;
  const otherSourceBefore = await database
    .prepare(
      `SELECT ${protectedColumns}
       FROM events
       WHERE title = 'Other Source Event'
         AND deleted_at IS NULL`,
    )
    .first();
  const manualBefore = await database
    .prepare(
      `SELECT ${protectedColumns}
       FROM events
       WHERE id = 'manual_event'`,
    )
    .first();
  assert.ok(otherSourceBefore);
  assert.ok(manualBefore);

  const newEventOne = meetupEvent({
    uid: "reconcile-new-1@meetup.com",
    eventId: "8203",
    title: "New Future Event One",
    start: "20280603T030000Z",
    end: "20280603T040000Z",
  });
  const newEventTwo = meetupEvent({
    uid: "reconcile-new-2@meetup.com",
    eventId: "8204",
    title: "New Future Event Two",
    start: "20280604T030000Z",
    end: "20280604T040000Z",
  });
  const newEventThree = meetupEvent({
    uid: "reconcile-new-3@meetup.com",
    eventId: "8205",
    title: "New Future Event Three",
    start: "20280605T030000Z",
    end: "20280605T040000Z",
  });
  const completedSnapshotWithoutMissing = calendar(
    keepEvent,
    newEventOne,
    newEventTwo,
    newEventThree,
  );
  const disappearanceFetcher = sequenceFetcher([
    completedSnapshotWithoutMissing,
    completedSnapshotWithoutMissing,
  ]);
  const sourceBeforeDisappearance = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceBeforeDisappearance.active_generation_id, "string");
  assert.equal(sourceBeforeDisappearance.pending_generation_id, null);

  const disappearancePartial = await refresh(
    database,
    "club_a",
    disappearanceFetcher,
    3_000,
  );
  assert.equal(disappearancePartial.outcome, "partial");
  assert.equal(disappearancePartial.counts.removed, 0);
  const sourceDuringDisappearance = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(
    sourceDuringDisappearance.active_generation_id,
    sourceBeforeDisappearance.active_generation_id,
  );
  assert.equal(typeof sourceDuringDisappearance.pending_generation_id, "string");
  assert.notEqual(
    sourceDuringDisappearance.pending_generation_id,
    sourceDuringDisappearance.active_generation_id,
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, previous_generation_id, expected_item_count,
                  processed_item_count, removed_count
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceDuringDisappearance.pending_generation_id)
        .first()),
    },
    {
      state: "staging",
      previous_generation_id: sourceBeforeDisappearance.active_generation_id,
      expected_item_count: 4,
      processed_item_count: 2,
      removed_count: 0,
    },
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT status, visibility, published_at, deleted_at
           FROM events
           WHERE id = ?`,
        )
        .bind(missingBefore.id)
        .first()),
    },
    {
      status: "draft",
      visibility: "public",
      published_at: 2_000,
      deleted_at: null,
    },
    "an incomplete cursor must not reconcile a missing UID",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT status, visibility, published_at, deleted_at
           FROM events
           WHERE id = ?`,
        )
        .bind(secondMissingBefore.id)
        .first()),
    },
    {
      status: "draft",
      visibility: "public",
      published_at: 2_001,
      deleted_at: null,
    },
    "an incomplete cursor must not reconcile any missing UID",
  );
  const publicDuringPartial = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 3_001,
  });
  assert.equal(
    publicDuringPartial.events.some(
      (event) => event.title === "Missing Future Event",
    ),
    true,
  );

  const disappearanceCompleted = await refresh(
    database,
    "club_a",
    disappearanceFetcher,
    4_000,
  );
  assert.equal(disappearanceCompleted.outcome, "completed");
  assert.equal(disappearanceCompleted.counts.removed, 2);

  const sourceAfterDisappearance = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceAfterDisappearance.active_generation_id, "string");
  assert.equal(
    sourceAfterDisappearance.active_generation_id,
    sourceDuringDisappearance.pending_generation_id,
  );
  assert.notEqual(
    sourceAfterDisappearance.active_generation_id,
    sourceBeforeDisappearance.active_generation_id,
  );
  assert.equal(sourceAfterDisappearance.pending_generation_id, null);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, expected_item_count, processed_item_count,
                  rejected_item_count, removed_count, published_at
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAfterDisappearance.active_generation_id)
        .first()),
    },
    {
      state: "published",
      expected_item_count: 4,
      processed_item_count: 4,
      rejected_item_count: 0,
      removed_count: 2,
      published_at: 4_000,
    },
    "the published generation must durably record the exact reconciliation count",
  );

  const retiredMissing = await database
    .prepare(
      `SELECT status, visibility, published_at, deleted_at
       FROM events
       WHERE id = ?`,
    )
    .bind(missingBefore.id)
    .first();
  assert.deepEqual(
    {
      status: retiredMissing.status,
      visibility: retiredMissing.visibility,
      published_at: retiredMissing.published_at,
    },
    {
      status: "draft",
      visibility: "private",
      published_at: null,
    },
  );
  assert.equal(typeof retiredMissing.deleted_at, "number");
  const retiredSecondMissing = await database
    .prepare(
      `SELECT status, visibility, published_at, deleted_at
       FROM events
       WHERE id = ?`,
    )
    .bind(secondMissingBefore.id)
    .first();
  assert.deepEqual(
    {
      status: retiredSecondMissing.status,
      visibility: retiredSecondMissing.visibility,
      published_at: retiredSecondMissing.published_at,
    },
    {
      status: "draft",
      visibility: "private",
      published_at: null,
    },
  );
  assert.equal(typeof retiredSecondMissing.deleted_at, "number");

  const publicAfterDisappearance = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 4_001,
  });
  const titlesAfterDisappearance = publicAfterDisappearance.events.map(
    (event) => event.title,
  );
  assert.equal(titlesAfterDisappearance.includes("Missing Future Event"), false);
  assert.equal(
    titlesAfterDisappearance.includes("Second Missing Future Event"),
    false,
  );
  assert.equal(titlesAfterDisappearance.includes("Keep Future Event"), true);
  assert.equal(titlesAfterDisappearance.includes("Other Source Event"), true);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT ${protectedColumns}
           FROM events
           WHERE title = 'Other Source Event'
             AND deleted_at IS NULL`,
        )
        .first()),
    },
    { ...otherSourceBefore },
    "reconciliation must not touch another Meetup source",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT ${protectedColumns}
           FROM events
           WHERE id = 'manual_event'`,
        )
        .first()),
    },
    { ...manualBefore },
    "reconciliation must not touch a manually managed event",
  );

  const reappearedEvent = meetupEvent({
    uid: "reconcile-missing@meetup.com",
    eventId: "8202",
    lastModified: "20260724T040000Z",
    sequence: 2,
    title: "Missing Future Event",
    start: "20280602T030000Z",
    end: "20280602T040000Z",
  });
  const completedSnapshotWithReappearance = calendar(
    keepEvent,
    newEventOne,
    newEventTwo,
    reappearedEvent,
    newEventThree,
  );
  const reappearanceFetcher = sequenceFetcher([
    completedSnapshotWithReappearance,
    completedSnapshotWithReappearance,
    completedSnapshotWithReappearance,
  ]);

  const reappearancePartial = await refresh(
    database,
    "club_a",
    reappearanceFetcher,
    5_000,
  );
  assert.equal(reappearancePartial.outcome, "partial");
  assert.equal(reappearancePartial.counts.removed, 0);
  const publicBeforeReappearanceFinalizes =
    await listPublicMeetupCalendar(database, {
      organizationId: ORGANIZATION_ID,
      fromUtcMs: 0,
      todayDate: "2026-01-01",
      nowUtcMs: 5_001,
    });
  assert.equal(
    publicBeforeReappearanceFinalizes.events.some(
      (event) => event.title === "Missing Future Event",
    ),
    false,
  );

  const reappearanceStillPartial = await refresh(
    database,
    "club_a",
    reappearanceFetcher,
    6_000,
  );
  assert.equal(reappearanceStillPartial.outcome, "partial");
  assert.equal(reappearanceStillPartial.counts.removed, 0);

  const reappearanceCompleted = await refresh(
    database,
    "club_a",
    reappearanceFetcher,
    7_000,
  );
  assert.equal(reappearanceCompleted.outcome, "completed");
  assert.equal(reappearanceCompleted.counts.removed, 0);

  const publicAfterReappearance = await listPublicMeetupCalendar(database, {
    organizationId: ORGANIZATION_ID,
    fromUtcMs: 0,
    todayDate: "2026-01-01",
    nowUtcMs: 7_001,
  });
  assert.equal(
    publicAfterReappearance.events.some(
      (event) => event.title === "Missing Future Event",
    ),
    true,
  );
  const activeReappearance = await database
    .prepare(
      `SELECT id, status, visibility, published_at, deleted_at
       FROM events
       WHERE title = 'Missing Future Event'
         AND deleted_at IS NULL`,
    )
    .first();
  assert.ok(activeReappearance);
  assert.equal(activeReappearance.status, "draft");
  assert.equal(activeReappearance.visibility, "public");
  assert.equal(typeof activeReappearance.published_at, "number");
  assert.equal(activeReappearance.deleted_at, null);
});

test("keeps a shared canonical event while another active source still reserves it as tentative", async (t) => {
  const database = createDatabase({ clubs: ["club_a", "club_b"] });
  t.after(() => database.close());
  await configure(database, "club_a", FEED_A, 1_000);
  await configure(database, "club_b", FEED_B, 1_001);

  const sharedEvent = meetupEvent({
    uid: "shared-source-a@meetup.com",
    eventId: "8301",
    title: "Shared Canonical Event",
    start: "20280701T030000Z",
    end: "20280701T040000Z",
  });
  const keepEvent = meetupEvent({
    uid: "shared-keep-a@meetup.com",
    eventId: "8302",
    title: "Source A Keep Event",
    start: "20280702T030000Z",
    end: "20280702T040000Z",
  });
  assert.equal(
    (
      await refresh(
        database,
        "club_a",
        sequenceFetcher([calendar(sharedEvent, keepEvent)]),
        2_000,
      )
    ).outcome,
    "completed",
  );

  const tentativeReservation = meetupEvent({
    uid: "shared-source-b@meetup.com",
    eventId: "9301",
    groupSlug: GROUP_B,
    status: "TENTATIVE",
    title: "Tentative Source B Reservation",
    start: "20280703T030000Z",
    end: "20280703T040000Z",
  });
  assert.equal(
    (
      await refresh(
        database,
        "club_b",
        sequenceFetcher([calendar(tentativeReservation)]),
        2_100,
      )
    ).outcome,
    "completed",
  );

  const sharedCanonical = await database
    .prepare(
      `SELECT id, slug
       FROM events
       WHERE title = 'Shared Canonical Event'
         AND deleted_at IS NULL`,
    )
    .first();
  const sourceB = await database
    .prepare(
      `SELECT id, active_generation_id
       FROM sync_sources
       WHERE club_id = 'club_b'`,
    )
    .first();
  assert.ok(sharedCanonical);
  assert.equal(typeof sourceB.active_generation_id, "string");

  await database
    .prepare(
      `UPDATE meetup_event_snapshots
       SET event_id = ?,
           event_slug = ?
       WHERE sync_source_id = ?
         AND generation_id = ?
         AND status = 'tentative'`,
    )
    .bind(
      sharedCanonical.id,
      sharedCanonical.slug,
      sourceB.id,
      sourceB.active_generation_id,
    )
    .run();
  await database
    .prepare(
      `UPDATE external_source_links
       SET entity_id = ?
       WHERE sync_source_id = ?
         AND source_type = 'meetup_ics'
         AND entity_type = 'event'
         AND deleted_at IS NULL`,
    )
    .bind(sharedCanonical.id, sourceB.id)
    .run();

  const activeTentativeSnapshot = await database
    .prepare(
      `SELECT snapshot.status, snapshot.event_id
       FROM meetup_event_snapshots AS snapshot
       JOIN sync_sources AS source
         ON source.id = snapshot.sync_source_id
        AND source.active_generation_id = snapshot.generation_id
       WHERE snapshot.sync_source_id = ?`,
    )
    .bind(sourceB.id)
    .first();
  assert.deepEqual(
    { ...activeTentativeSnapshot },
    {
      status: "tentative",
      event_id: sharedCanonical.id,
    },
  );

  const completedWithoutShared = await refresh(
    database,
    "club_a",
    sequenceFetcher([calendar(keepEvent)]),
    3_000,
  );
  assert.equal(completedWithoutShared.outcome, "completed");
  assert.equal(
    completedWithoutShared.counts.removed,
    0,
    "another active tentative snapshot must protect the shared canonical event",
  );
  const sourceAAfterCompletion = await database
    .prepare(
      `SELECT active_generation_id, pending_generation_id
       FROM sync_sources
       WHERE club_id = 'club_a'`,
    )
    .first();
  assert.equal(typeof sourceAAfterCompletion.active_generation_id, "string");
  assert.equal(sourceAAfterCompletion.pending_generation_id, null);
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT state, removed_count
           FROM meetup_sync_generations
           WHERE id = ?`,
        )
        .bind(sourceAAfterCompletion.active_generation_id)
        .first()),
    },
    {
      state: "published",
      removed_count: 0,
    },
    "the completed generation must persist that no shared event was removed",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT status, visibility, published_at, deleted_at
           FROM events
           WHERE id = ?`,
        )
        .bind(sharedCanonical.id)
        .first()),
    },
    {
      status: "draft",
      visibility: "public",
      published_at: 2_000,
      deleted_at: null,
    },
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM event_revisions
         WHERE event_id = ?
           AND reason =
               'Meetup event absent from completed source snapshot'`,
      )
      .bind(sharedCanonical.id)
      .first("count"),
    0,
  );
});
