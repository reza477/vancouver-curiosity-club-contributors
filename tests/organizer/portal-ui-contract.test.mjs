import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  OrganizerRequestError,
  organizerConflictDetails,
  parseOrganizerConflictDetails,
} from "../../app/_organizer/client.ts";
import {
  organizerScheduleIsCurrent,
  organizerScheduleOverlapsUtcRange,
} from "../../lib/server/organizer/schedule-state.ts";

const ROOT = process.cwd();

function source(...segments) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

test("required private organizer routes share server membership revalidation and omit future controls", () => {
  const pages = [
    "page.tsx",
    "calendar/page.tsx",
    "conflicts/page.tsx",
    "events/page.tsx",
    "events/new/page.tsx",
    "events/[id]/page.tsx",
    "team/page.tsx",
    "clubs/page.tsx",
    "notifications/page.tsx",
    "profile/page.tsx",
    "settings/page.tsx",
    "meetup/page.tsx",
  ];
  for (const page of pages) {
    const body = source("app", "organizer", ...page.split("/"));
    assert.match(
      body,
      /loadOrganizerPageContext\(/u,
      `${page} must revalidate the trusted server-side membership`,
    );
    assert.doesNotMatch(
      body,
      /href=["'`]\/organizer\/(?:exports|publishing)\b|>\s*(?:Publish|Unpublish|Export|QR download)\s*</u,
      `${page} must not expose later-phase actions`,
    );
  }

  const shell = source("app", "_organizer", "WorkspaceShell.tsx");
  assert.match(shell, /Calendar/u);
  assert.match(shell, /Add event/u);
  assert.match(shell, /href="\/organizer\/conflicts"|href:\s*"\/organizer\/conflicts"/u);
  assert.match(shell, /Conflicts/u);
  assert.match(shell, /Team/u);
  assert.match(shell, /More/u);
});

test("multi-read private pages seal authorization at their composition boundary", () => {
  const calendar = source("app", "organizer", "calendar", "page.tsx");
  const settings = source("app", "organizer", "settings", "page.tsx");
  const revision = source(
    "app",
    "organizer",
    "content",
    "revisions",
    "[id]",
    "page.tsx",
  );
  const event = source(
    "app",
    "organizer",
    "events",
    "[id]",
    "page.tsx",
  );
  const cmsPages = [
    ["content", "page.tsx"],
    ["content", "clubs", "[id]", "page.tsx"],
    ["content", "pages", "[id]", "page.tsx"],
    ["content", "programs", "[id]", "page.tsx"],
  ];

  assert.match(
    calendar,
    /const currentData = await loadCalendarWorkspaceData[\s\S]*?const currentSubscriptions = await listOwnCalendarSubscriptions[\s\S]*?await revalidateAuthorizedMembership[\s\S]*?data = currentData;[\s\S]*?subscriptions = currentSubscriptions;/u,
  );
  assert.match(
    settings,
    /await revalidateAuthorizedMembership\([\s\S]*?loaded\.context\.membership,[\s\S]*?\);[\s\S]*?return \(/u,
  );
  assert.match(
    revision,
    /await revalidateAuthorizedMembership\([\s\S]*?allowedRoles: \["owner", "administrator"\][\s\S]*?previewData = Object\.freeze/u,
  );
  assert.match(
    event,
    /if \(!isEditableManualRecord\(record\)\) \{[\s\S]*?await revalidateAuthorizedMembership[\s\S]*?return Object\.freeze/u,
  );
  assert.match(
    event,
    /await assertCurrentOrganizerEventReadAccess\([\s\S]*?\[record\.id\],[\s\S]*?true,[\s\S]*?\);[\s\S]*?return Object\.freeze/u,
  );
  for (const segments of cmsPages) {
    const cmsPage = source("app", "organizer", ...segments);
    assert.match(
      cmsPage,
      /await revalidateAuthorizedMembership\([\s\S]*?allowedRoles: \["owner", "administrator"\]/u,
      `${segments.join("/")} must seal the complete private CMS composition`,
    );
  }
  const dashboard = source("app", "organizer", "content", "page.tsx");
  assert.match(
    dashboard,
    /const currentEntities = await listCmsEntities[\s\S]*?await revalidateAuthorizedMembership[\s\S]*?entities = currentEntities;/u,
  );
});

test("private shell has no public chrome, canonical, Open Graph, or structured data", () => {
  const rootLayout = source("app", "layout.tsx");
  const organizerLayout = source("app", "organizer", "layout.tsx");
  assert.match(rootLayout, /isPrivateApplicationPath/u);
  assert.match(
    rootLayout,
    /import \{ isPrivateOrIdentityPath \} from "@\/lib\/request-pathname"/u,
  );
  assert.match(
    rootLayout,
    /pathname !== null && isPrivateOrIdentityPath\(pathname\)/u,
  );
  assert.match(rootLayout, /"\/accept-invitation"/u);
  assert.match(rootLayout, /"\/organizer"/u);
  assert.match(rootLayout, /isPrivatePath \? null : \(\s*<SiteHeader/u);
  assert.match(rootLayout, /isPrivatePath \? null : \(\s*<SiteFooter/u);
  assert.match(organizerLayout, /openGraph:\s*null/u);
  assert.match(organizerLayout, /twitter:\s*null/u);
  assert.match(organizerLayout, /index:\s*false/u);
  assert.match(organizerLayout, /referrer:\s*"no-referrer"/u);
  assert.doesNotMatch(organizerLayout, /loadPublicCatalog/u);
  assert.doesNotMatch(organizerLayout, /application\/ld\+json/u);
});

test("denied organizer identities use the real vinext 403 boundary", () => {
  const layout = source("app", "organizer", "layout.tsx");
  const access = source("app", "_organizer", "access.ts");
  const forbiddenPage = source("app", "organizer", "forbidden.tsx");
  const notFoundPage = source("app", "organizer", "not-found.tsx");
  const errorPage = source("app", "organizer", "error.tsx");
  assert.match(
    layout,
    /loaded\.kind === "denied"[\s\S]{0,180}return <>\{children\}<\/>/u,
  );
  assert.match(
    access,
    /load\.kind === "denied"[\s\S]{0,40}forbidden\(\)/u,
  );
  for (const page of [
    "page.tsx",
    "calendar/page.tsx",
    "conflicts/page.tsx",
    "events/page.tsx",
    "events/new/page.tsx",
    "events/[id]/page.tsx",
    "team/page.tsx",
    "clubs/page.tsx",
    "notifications/page.tsx",
    "profile/page.tsx",
    "settings/page.tsx",
    "meetup/page.tsx",
  ]) {
    assert.match(
      source("app", "organizer", ...page.split("/")),
      /enforceOrganizerPageAccess\(loaded\)/u,
      page,
    );
  }
  assert.match(forbiddenPage, /Organizer access unavailable/u);
  assert.match(forbiddenPage, /no active organizer membership/u);
  assert.match(notFoundPage, /No cross-organization detail is disclosed/u);
  assert.match(errorPage, /No private record state is being guessed/u);
  assert.doesNotMatch(notFoundPage, /<main|id="organizer-main"/u);
  assert.doesNotMatch(errorPage, /<main|id="organizer-main"/u);
});

test("event editor emits exactly one canonical schedule shape", () => {
  const editor = source("app", "_organizer", "EventEditorForm.tsx");
  const payload = source(
    "app",
    "_organizer",
    "event-editor-state.ts",
  );
  const commonMatch = /const common = \{([\s\S]*?)\n  \};/u.exec(payload);
  assert.ok(commonMatch, "the shared event payload must be explicit");
  assert.doesNotMatch(
    commonMatch[1],
    /startLocal|endLocal|allDayStartDate|allDayEndDateExclusive|timeZone/u,
  );
  assert.match(commonMatch[1], /title:\s*value\.title/u);
  assert.match(
    payload,
    /if \(value\.scheduleShape === "unscheduled"\) return common;/u,
  );
  assert.match(
    payload,
    /scheduleShape === "timed"[\s\S]*endLocal[\s\S]*startLocal[\s\S]*timeZone/u,
  );
  assert.match(
    payload,
    /allDayEndDateExclusive[\s\S]*allDayStartDate[\s\S]*timeZone/u,
  );
  assert.match(payload, /publicationStatus:\s*"private"/u);
  assert.match(
    editor,
    /clubScopedOrganizers = options\.organizers\.filter\([\s\S]*organizer\.organizationWide[\s\S]*organizer\.clubs\.some\(\(clubId\) => clubId === selectedClub\)/u,
  );
  assert.match(
    editor,
    /canManageOrganizationWide\s*\?\s*clubScopedOrganizers/u,
  );
  assert.match(editor, /coOrganizerProfileIds\.length >= 12/u);
  assert.match(editor, /no more than 12 co-organizers/u);
  assert.match(
    editor,
    /primaryOrganizerLocked \|\|[\s\S]*coOrganizerProfileIds\.length >= 12/u,
  );
  assert.match(
    editor,
    /cannot change[\s\S]*primary organizer or co-organizer team/u,
  );
});

test("calendar preferences are validated and range math respects calendar semantics", () => {
  const calendar = source("app", "_organizer", "CalendarWorkspace.tsx");
  const data = source("app", "_organizer", "data.ts");
  const access = source("app", "_organizer", "access.ts");
  const types = source("app", "_organizer", "types.ts");
  const newEvent = source(
    "app",
    "organizer",
    "events",
    "new",
    "page.tsx",
  );
  assert.match(calendar, /FILTER_STORAGE_KEY/u);
  assert.match(calendar, /parseStoredFilters/u);
  assert.match(calendar, /SOURCE_VALUES = \["manual", "meetup", "legacy"\]/u);
  assert.match(calendar, /shiftMonth\(current, direction\)/u);
  assert.doesNotMatch(calendar, /view === "month"\) return 28/u);
  assert.match(calendar, /Existing event · read-only/u);
  assert.match(calendar, /Meetup · read-only/u);
  assert.match(calendar, /Manual · private/u);
  assert.match(
    data,
    /dateKeyInZone\(schedule\.endsAtUtc - 1, schedule\.timeZone\)/u,
  );
  assert.match(types, /defaultTimezone:\s*string/u);
  assert.match(access, /defaultTimezone:\s*settings\.defaultTimezone/u);
  assert.match(
    data,
    /dateKeyInZone\(Date\.now\(\), context\.defaultTimezone\)/u,
  );
  assert.match(data, /defaultTimezone:\s*context\.defaultTimezone/u);
  assert.match(calendar, /todayInZone\(defaultTimezone\)/u);
  assert.match(calendar, /entry\.organizerIds\.includes\(filters\.organizer\)/u);
  assert.match(newEvent, /loaded\.context\.defaultTimezone/u);
});

test("calendar and event indexes disclose truncation and expose server load paths", () => {
  const calendar = source("app", "_organizer", "CalendarWorkspace.tsx");
  const data = source("app", "_organizer", "data.ts");
  const eventIndex = source("app", "_organizer", "EventIndex.tsx");
  const calendarPage = source(
    "app",
    "organizer",
    "calendar",
    "page.tsx",
  );
  const eventsPage = source(
    "app",
    "organizer",
    "events",
    "page.tsx",
  );
  const eventService = source(
    "lib",
    "server",
    "organizer",
    "events.ts",
  );

  assert.match(data, /resultCount:\s*result\.resultCount/u);
  assert.match(data, /loadedCount:\s*result\.loadedCount/u);
  assert.match(data, /nextTake:\s*result\.nextLimit/u);
  assert.match(calendar, /Showing[\s\S]*loaded of[\s\S]*total/u);
  assert.match(calendar, /Load more records/u);
  assert.match(calendarPage, /raw\.take === undefined \? 500 : raw\.take/u);

  assert.doesNotMatch(eventIndex, /useState/u);
  assert.match(eventIndex, /method="get"/u);
  assert.match(eventIndex, /Showing[\s\S]*firstResult[\s\S]*lastResult/u);
  assert.match(eventIndex, /Previous 200/u);
  assert.match(eventIndex, /Next 200/u);
  assert.match(eventsPage, /page:\s*raw\.page/u);
  assert.match(eventsPage, /search:\s*raw\.search/u);
  assert.match(eventsPage, /status:\s*raw\.status/u);
  assert.match(eventService, /SELECT COUNT\(\*\) AS result_count/u);
  assert.match(eventService, /LIMIT \? OFFSET \?/u);
  assert.match(
    eventService,
    /search_club\.organization_id = event\.organization_id/u,
  );
});

test("calendar boundaries use the event timezone across Vancouver DST", () => {
  const springAllDay = Object.freeze({
    allDayEndDateExclusive: "2026-03-09",
    allDayStartDate: "2026-03-08",
    endsAtUtc: null,
    shape: "all_day",
    startsAtUtc: null,
    timeZone: "America/Vancouver",
  });
  assert.equal(
    organizerScheduleIsCurrent(
      springAllDay,
      Date.parse("2026-03-09T06:59:59.999Z"),
    ),
    true,
    "the all-day record remains current until Vancouver midnight after the spring DST change",
  );
  assert.equal(
    organizerScheduleIsCurrent(
      springAllDay,
      Date.parse("2026-03-09T07:00:00.000Z"),
    ),
    false,
  );
  assert.equal(
    organizerScheduleOverlapsUtcRange(
      springAllDay,
      Date.parse("2026-03-09T06:30:00.000Z"),
      Date.parse("2026-03-09T06:45:00.000Z"),
    ),
    true,
  );
  assert.equal(
    organizerScheduleOverlapsUtcRange(
      springAllDay,
      Date.parse("2026-03-09T07:00:00.000Z"),
      Date.parse("2026-03-09T08:00:00.000Z"),
    ),
    false,
    "the exclusive local-date boundary does not overlap a range beginning at that instant",
  );
});

test("organization-wide roles receive truthful club scope copy", () => {
  const dashboard = source("app", "_organizer", "Dashboard.tsx");
  const profile = source("app", "_organizer", "ProfileForm.tsx");
  assert.match(
    dashboard,
    /canManageTeam[\s\S]{0,120}Organization-wide access across active clubs/u,
  );
  assert.match(
    profile,
    /profile\.role === "owner" \|\| profile\.role === "administrator"[\s\S]{0,120}Organization-wide access across active clubs/u,
  );
});

test("invitation acceptance never exposes the one-time token to client props or JSON", () => {
  const page = source("app", "accept-invitation", "page.tsx");
  const flow = source("app", "accept-invitation", "AcceptInvitationFlow.tsx");
  const consume = source(
    "app",
    "accept-invitation",
    "consume",
    "route.ts",
  );
  assert.doesNotMatch(page, /searchParams|token=/u);
  assert.doesNotMatch(flow, /token|searchParams/u);
  assert.match(consume, /readInvitationTokenCookie/u);
  assert.match(consume, /clearInvitationTokenCookie/u);
  assert.doesNotMatch(
    consume,
    /privateOrganizerJson\([^)]*(?:token|hash)/u,
  );
});

test("409 blocker details are bounded, allowlisted, and actionable in management UI", () => {
  const allowed = new OrganizerRequestError(
    "conflict",
    "Reassign the listed events.",
    409,
    {
      eventCount: 1,
      invitationCount: null,
      memberCount: 2,
      programCount: null,
      records: [
        {
          eventId: "organizer-event:abc",
          source: "manual",
          title: "Private Draft",
        },
      ],
      sourceCount: null,
    },
  );
  assert.deepEqual(organizerConflictDetails(allowed), {
    eventCount: 1,
    invitationCount: null,
    memberCount: 2,
    programCount: null,
    records: [
      {
        eventId: "organizer-event:abc",
        source: "manual",
        title: "Private Draft",
      },
    ],
    sourceCount: null,
  });
  assert.equal(
    organizerConflictDetails(
      new OrganizerRequestError("internal_error", "Unavailable.", 500),
    ),
    null,
  );
  const parsed = parseOrganizerConflictDetails(
    {
      blockers: [
        ...Array.from({ length: 30 }, (_, index) => ({
          eventId: `event-${index}`,
          privateNotes: "must never survive",
          source: "manual",
          title: `Draft ${index}`,
        })),
        {
          eventId: "../unsafe",
          source: "invented",
          title: "Unsafe",
        },
      ],
      eventCount: 30,
      invitationCount: 1,
      memberCount: 4,
      programCount: 2,
      sourceCount: 3,
      sourceUrl: "private-source-sentinel",
    },
    "conflict",
    409,
  );
  assert.equal(parsed.records.length, 25);
  assert.equal(parsed.eventCount, 30);
  assert.equal(parsed.invitationCount, 1);
  assert.equal(parsed.memberCount, 4);
  assert.equal(parsed.programCount, 2);
  assert.equal(parsed.sourceCount, 3);
  assert.ok(parsed.records.every((record) => !("privateNotes" in record)));
  assert.equal(JSON.stringify(parsed).includes("private-source-sentinel"), false);

  const team = source("app", "_organizer", "TeamWorkspace.tsx");
  const clubs = source("app", "_organizer", "ClubsWorkspace.tsx");
  assert.match(team, /Reassign these records first/u);
  assert.match(team, /\/organizer\/events\//u);
  assert.match(
    team,
    /currentRole === "owner" \|\| member\.role === "organizer"/u,
  );
  assert.match(team, /const formElement = event\.currentTarget/u);
  assert.match(team, /setInvitations\(\(current\) => \[/u);
  assert.match(team, /formElement\.reset\(\)/u);
  assert.doesNotMatch(team, /event\.currentTarget\.reset\(\)/u);
  assert.match(clubs, /Move these assignments first/u);
  assert.match(clubs, /Open Team/u);
  assert.match(clubs, /Open Meetup connection/u);
  assert.match(clubs, /Open private events/u);
});
