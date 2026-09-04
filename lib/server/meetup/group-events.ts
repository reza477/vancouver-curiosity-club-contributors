import { parseIanaTimeZone } from "../../time";
import { isRecord } from "../../validation";
import { extractMeetupPublicEventFacts } from "../../meetup-public-event-facts.js";
import {
  applyApprovedMeetupEventEditorialOverride,
  removeOrphanMeetupTicketAndRsvpCallToActions,
  splitTrailingMeetupTicketOrRsvpCallToAction,
} from "../../meetup-publication-policy.js";
import { MeetupSyncError } from "./errors";
import type {
  ParsedMeetupCalendar,
  ParsedMeetupDescriptionBlock,
  ParsedMeetupDescriptionInline,
  ParsedMeetupEvent,
  ParsedMeetupEventStatus,
  ParsedMeetupPublicContent,
} from "./ics";

export const MAX_MEETUP_GROUP_EVENTS_HTML_BYTES = 1_000_000;
export const MAX_MEETUP_GROUP_EVENTS = 100;

const FETCH_TIMEOUT_MS = 12_000;
const MEETUP_GRAPHQL_URL = "https://api.meetup.com/gql-ext";
// Meetup currently drops an edge at some 30-item cursor boundaries even while
// reporting the full totalCount. Twenty-five keeps the traversal complete for
// those boundaries while retaining the same exact-count and cursor checks.
const MEETUP_GRAPHQL_PAGE_SIZE = 25;
const MAX_MEETUP_GRAPHQL_PAGES = Math.ceil(
  MAX_MEETUP_GROUP_EVENTS / MEETUP_GRAPHQL_PAGE_SIZE,
);
const MAX_MEETUP_GRAPHQL_RESPONSE_BYTES = 1_000_000;
const MAX_APOLLO_ENTITIES = 10_000;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_DESCRIPTION_BLOCKS = 400;
const MAX_DESCRIPTION_BLOCKS_JSON_LENGTH = 120_000;
const MAX_DESCRIPTION_INLINE_NODES = 4_000;
const MAX_DESCRIPTION_LIST_ITEMS = 300;
const MAX_DESCRIPTION_LINK_LENGTH = 2_048;
const MAX_EVENT_DURATION_MS = 31 * 24 * 60 * 60_000;
const GROUP_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ENTITY_ID_PATTERN = /^[0-9]{1,32}$/u;
const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const RAW_HTML_PATTERN = /<\/?[a-z][^>]*>/iu;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/u;
const FORBIDDEN_PUBLIC_TEXT_PATTERN =
  /(?:https?:\/\/|\bwww\.|\b(?:mailto|tel|sms|javascript|data):|\b(?:zoom\.us|meet\.google|teams\.microsoft\.com|webex\.com|discord\.gg)\b|\b(?:passcode|password|access\s+code)\b|\b(?:token|key|pwd)=)/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const POSTER_PATH_PATTERN =
  /^\/photos\/event\/[0-9a-f/]+\/highres_([0-9]+)\.jpe?g$/iu;
const SOURCE_AVAILABILITY_FIELDS = Object.freeze([
  "maxTickets",
  "rsvpSettings",
  "rsvpState",
  "waitlistMode",
  "waitlistRsvps",
  "yesRsvps",
] as const);

const UPCOMING_GROUP_EVENTS_QUERY = String.raw`
query getUpcomingGroupEvents($urlname: String!, $after: String, $afterDateTime: DateTime) {
  groupByUrlname(urlname: $urlname) {
    __typename
    id
    name
    urlname
    timezone
    events(
      filter: {status: [ACTIVE, PAST, CANCELLED], afterDateTime: $afterDateTime}
      sort: ASC
      first: 25
      after: $after
    ) {
      __typename
      totalCount
      pageInfo { __typename endCursor hasNextPage }
      edges {
        __typename
        node {
          __typename
          id
          title
          eventUrl
          description
          dateTime
          endTime
          status
          eventType
          maxTickets
          rsvpState
          waitlistMode
          yesRsvps: rsvps(filter: {rsvpStatus: [YES]}) { totalCount }
          waitlistRsvps: rsvps(filter: {rsvpStatus: [WAITLIST]}) { totalCount }
          rsvpSettings { rsvpsClosed }
          group { __typename id }
          venue { __typename id name address city state }
          featuredEventPhoto { __typename id highResUrl }
          displayPhoto { __typename id highResUrl }
        }
      }
    }
  }
}`;

const ALLOWED_PUBLIC_DESCRIPTION_LINK_HOSTS = Object.freeze(
  new Set([
    "docs.google.com",
    "cambridgecognition.com",
    "deepcovekayak.com",
    "drive.google.com",
    "esp.mit.edu",
    "forms.gle",
    "m.youtube.com",
    "maps.app.goo.gl",
    "reifelsanctuary.calendarspots.com",
    "summercinema.ca",
    "thecinematheque.ca",
    "tickets.thecinematheque.ca",
    "vancouver.ca",
    "viff.org",
    "www.focusfeatures.com",
    "www.gutenberg.org",
    "www.marxists.org",
    "www.navneuro.com",
    "www.paramountpictures.com",
    "www.pbs.org",
    "www.penguinrandomhouse.com",
    "www.pewresearch.org",
    "www.reifelbirdsanctuary.com",
    "www.ted.com",
    "www.therecroom.com",
    "www.vatican.va",
    "www.vogue.com",
    "www.youtube.com",
    "youtu.be",
  ]),
);
const PUBLIC_DESCRIPTION_LINK_QUERY_KEYS: Readonly<
  Record<string, ReadonlySet<string>>
> = Object.freeze({
  "m.youtube.com": Object.freeze(new Set(["index", "list", "start", "t", "v"])),
  "www.youtube.com": Object.freeze(
    new Set(["index", "list", "start", "t", "v"]),
  ),
  "tickets.thecinematheque.ca": Object.freeze(new Set(["evtinfo"])),
  "youtu.be": Object.freeze(new Set(["list", "start", "t"])),
});

type GroupEventsPageSource = Readonly<{
  groupSlug: string;
  url: string;
}>;

type FutureConnectionArguments = Readonly<{
  afterDateTimeUtcMs: number;
  first: number;
  kind: "active" | "combined" | "past-cancelled";
}>;

type FutureConnectionCandidate = Readonly<{
  arguments: FutureConnectionArguments;
  value: unknown;
}>;

type PublicVenue = Readonly<{
  address: string | null;
  city: string | null;
  name: string;
  state: string | null;
}>;

type ParsedGroupEventsPageSnapshot = Readonly<{
  afterDateTimeUtcMs: number;
  calendar: ParsedMeetupCalendar;
  expectedTotalCount: number | null;
  groupId: string;
  timeZone: string;
}>;

type ParsedGraphqlPage = Readonly<{
  endCursor: string | null;
  events: readonly ParsedMeetupEvent[];
  hasNextPage: boolean;
  totalCount: number;
}>;

type SourceAvailabilityFacts = Readonly<{
  availabilityState: "open" | "full" | "waitlist" | null;
  capacity: number | null;
  waitlistAvailable: boolean | null;
}>;

export async function fetchMeetupGroupEvents(
  groupSlug: unknown,
  options: Readonly<{
    fetcher?: typeof fetch;
    maxBytes?: number;
    maxEvents?: number;
  }> = {},
): Promise<ParsedMeetupCalendar> {
  const source = parseGroupEventsPageSource(groupSlug);
  const fetcher = options.fetcher ?? fetch;
  const maxBytes = boundedLimit(
    options.maxBytes,
    MAX_MEETUP_GROUP_EVENTS_HTML_BYTES,
    MAX_MEETUP_GROUP_EVENTS_HTML_BYTES,
  );
  const maxEvents = boundedLimit(
    options.maxEvents,
    MAX_MEETUP_GROUP_EVENTS,
    MAX_MEETUP_GROUP_EVENTS,
  );
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetcher(source.url, {
        cache: "no-store",
        headers: new Headers({
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Vancouver-Curiosity-Club-Calendar-Sync/1.0",
        }),
        redirect: "manual",
        signal: abortController.signal,
      });
    } catch {
      throw new MeetupSyncError("network_error");
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      throw new MeetupSyncError("redirect_rejected");
    }
    if (response.status !== 200) {
      throw new MeetupSyncError("upstream_rejected");
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "text/html") {
      throw new MeetupSyncError("upstream_rejected");
    }
    if (response.url && response.url !== source.url) {
      throw new MeetupSyncError("redirect_rejected");
    }

    const html = await readBoundedUtf8Body(response, maxBytes);
    const pageSnapshot = parseMeetupGroupEventsPageSnapshot(
      html,
      source.groupSlug,
      {
        maxBytes,
        maxEvents,
      },
    );
    return await fetchCompleteMeetupGroupEvents({
      afterDateTimeUtcMs: pageSnapshot.afterDateTimeUtcMs,
      expectedTotalCount: pageSnapshot.expectedTotalCount,
      fetcher,
      groupId: pageSnapshot.groupId,
      groupSlug: source.groupSlug,
      maxEvents,
      signal: abortController.signal,
      timeZone: pageSnapshot.timeZone,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseMeetupGroupEventsPage(
  input: unknown,
  expectedGroupSlug: unknown,
  options: Readonly<{
    maxBytes?: number;
    maxEvents?: number;
  }> = {},
): ParsedMeetupCalendar {
  return parseMeetupGroupEventsPageSnapshot(
    input,
    expectedGroupSlug,
    options,
  ).calendar;
}

function parseMeetupGroupEventsPageSnapshot(
  input: unknown,
  expectedGroupSlug: unknown,
  options: Readonly<{
    maxBytes?: number;
    maxEvents?: number;
  }> = {},
): ParsedGroupEventsPageSnapshot {
  try {
    const source = parseGroupEventsPageSource(expectedGroupSlug);
    const maxBytes = boundedLimit(
      options.maxBytes,
      MAX_MEETUP_GROUP_EVENTS_HTML_BYTES,
      MAX_MEETUP_GROUP_EVENTS_HTML_BYTES,
    );
    const maxEvents = boundedLimit(
      options.maxEvents,
      MAX_MEETUP_GROUP_EVENTS,
      MAX_MEETUP_GROUP_EVENTS,
    );
    if (typeof input !== "string" || input.length < 100) invalidCalendar();
    if (new TextEncoder().encode(input).byteLength > maxBytes) {
      throw new MeetupSyncError("response_too_large");
    }

    assertCanonicalGroupDocument(input, source.groupSlug);
    const nextDataMatches = [
      ...input.matchAll(
        /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/giu,
      ),
    ];
    if (nextDataMatches.length !== 1) invalidCalendar();

    let nextData: unknown;
    try {
      nextData = JSON.parse(nextDataMatches[0][1]);
    } catch {
      invalidCalendar();
    }
    const document = requiredRecord(nextData);
    const query = requiredRecord(document.query);
    if (query.slug !== source.groupSlug) invalidCalendar();
    const props = requiredRecord(document.props);
    const pageProps = requiredRecord(props.pageProps);
    const apolloState = requiredRecord(pageProps.__APOLLO_STATE__);
    if (Object.keys(apolloState).length > MAX_APOLLO_ENTITIES) {
      invalidCalendar();
    }

    const rootQuery = requiredRecord(apolloState.ROOT_QUERY);
    const groupLookupKey =
      `groupByUrlname:{"urlname":"${source.groupSlug}"}`;
    const groupRef = readReference(rootQuery[groupLookupKey], "Group");
    const group = readEntity(apolloState, groupRef, "Group");
    const groupId = readEntityId(group, groupRef, "Group");
    if (
      group.urlname !== source.groupSlug ||
      group.isPrivate !== false ||
      groupId.length < 1
    ) {
      invalidCalendar();
    }
    const timeZone = parseIanaTimeZone(group.timezone, "group.timezone");

    const connectionCandidates = Object.entries(group)
      .map(([key, value]) => ({
        arguments: readFutureConnectionArguments(key),
        value,
      }))
      .filter(
        (candidate): candidate is FutureConnectionCandidate =>
          candidate.arguments !== null,
      );
    const selectedConnections = selectFutureConnections(connectionCandidates);

    const events: ParsedMeetupEvent[] = [];
    const totalCounts: number[] = [];
    const seenEventRefs = new Set<string>();
    for (const candidate of selectedConnections) {
      const connection = requiredRecord(candidate.value);
      if (connection.__typename !== "GroupEventConnection") invalidCalendar();
      if (!Array.isArray(connection.edges)) invalidCalendar();
      if (
        connection.edges.length > candidate.arguments.first ||
        events.length + connection.edges.length > maxEvents
      ) {
        invalidCalendar();
      }
      if (
        !Number.isSafeInteger(connection.totalCount) ||
        (connection.totalCount as number) < connection.edges.length ||
        (connection.totalCount as number) > maxEvents
      ) {
        invalidCalendar();
      }
      totalCounts.push(connection.totalCount as number);
      const pageInfo = requiredRecord(connection.pageInfo);
      if (typeof pageInfo.hasNextPage !== "boolean") invalidCalendar();

      for (const rawEdge of connection.edges) {
        const edge = requiredRecord(rawEdge);
        if (edge.__typename !== "EventEdge") invalidCalendar();
        const eventRef = readReference(edge.node, "Event");
        if (seenEventRefs.has(eventRef)) invalidCalendar();
        seenEventRefs.add(eventRef);
        assertEventMatchesConnectionStatus(
          apolloState,
          eventRef,
          candidate.arguments.kind,
        );
        events.push(
          parseApolloEvent({
            apolloState,
            componentIndex: events.length,
            eventRef,
            groupRef,
            groupSlug: source.groupSlug,
            timeZone,
          }),
        );
      }
    }

    const orderedEvents =
      selectedConnections.length === 1
        ? events
        : events
            .sort(compareFutureEvents)
            .map((event, componentIndex) =>
              event.componentIndex === componentIndex
                ? event
                : Object.freeze({ ...event, componentIndex }),
            );

    return Object.freeze({
      afterDateTimeUtcMs: selectedConnections[0].arguments.afterDateTimeUtcMs,
      calendar: Object.freeze({
        events: Object.freeze(orderedEvents),
        method: "PUBLISH" as const,
        rejectedEvents: Object.freeze([]),
      }),
      expectedTotalCount:
        selectedConnections.length === 1 ? totalCounts[0] : null,
      groupId,
      timeZone,
    });
  } catch (error) {
    if (error instanceof MeetupSyncError) throw error;
    throw new MeetupSyncError("calendar_invalid");
  }
}

async function fetchCompleteMeetupGroupEvents(input: Readonly<{
  afterDateTimeUtcMs: number;
  expectedTotalCount: number | null;
  fetcher: typeof fetch;
  groupId: string;
  groupSlug: string;
  maxEvents: number;
  signal: AbortSignal;
  timeZone: string;
}>): Promise<ParsedMeetupCalendar> {
  const afterDateTime = new Date(input.afterDateTimeUtcMs).toISOString();
  const events: ParsedMeetupEvent[] = [];
  const seenEventUrls = new Set<string>();
  const seenCursors = new Set<string>();
  let after: string | null = null;
  let expectedTotalCount = input.expectedTotalCount;
  let completed = false;

  for (let pageIndex = 0; pageIndex < MAX_MEETUP_GRAPHQL_PAGES; pageIndex += 1) {
    const page = await fetchMeetupGraphqlPage({
      after,
      afterDateTime,
      componentOffset: events.length,
      fetcher: input.fetcher,
      groupId: input.groupId,
      groupSlug: input.groupSlug,
      maxEvents: input.maxEvents,
      signal: input.signal,
      timeZone: input.timeZone,
    });
    if (expectedTotalCount === null) expectedTotalCount = page.totalCount;
    if (
      page.totalCount !== expectedTotalCount ||
      events.length + page.events.length > input.maxEvents
    ) {
      invalidCalendar();
    }
    for (const event of page.events) {
      if (seenEventUrls.has(event.eventUrl)) invalidCalendar();
      const previous = events.at(-1);
      // Meetup's ASC contract is chronological by start time. Co-timed
      // events are not ordered by their end time, so a longer event may
      // legitimately precede a shorter one without making the page unsafe.
      if (previous && compareFutureEventStarts(previous, event) > 0) {
        invalidCalendar();
      }
      seenEventUrls.add(event.eventUrl);
      events.push(event);
    }

    if (!page.hasNextPage) {
      if (events.length !== page.totalCount) invalidCalendar();
      completed = true;
      break;
    }
    if (
      page.events.length === 0 ||
      page.endCursor === null ||
      seenCursors.has(page.endCursor)
    ) {
      invalidCalendar();
    }
    seenCursors.add(page.endCursor);
    after = page.endCursor;
  }

  if (!completed) invalidCalendar();
  const orderedEvents = events
    .sort(compareFutureEvents)
    .map((event, componentIndex) =>
      event.componentIndex === componentIndex
        ? event
        : Object.freeze({ ...event, componentIndex }),
    );
  return Object.freeze({
    events: Object.freeze(orderedEvents),
    method: "PUBLISH" as const,
    rejectedEvents: Object.freeze([]),
  });
}

async function fetchMeetupGraphqlPage(input: Readonly<{
  after: string | null;
  afterDateTime: string;
  componentOffset: number;
  fetcher: typeof fetch;
  groupId: string;
  groupSlug: string;
  maxEvents: number;
  signal: AbortSignal;
  timeZone: string;
}>): Promise<ParsedGraphqlPage> {
  let response: Response;
  try {
    response = await input.fetcher(MEETUP_GRAPHQL_URL, {
      body: JSON.stringify({
        operationName: "getUpcomingGroupEvents",
        query: UPCOMING_GROUP_EVENTS_QUERY,
        variables: {
          after: input.after,
          afterDateTime: input.afterDateTime,
          urlname: input.groupSlug,
        },
      }),
      cache: "no-store",
      headers: new Headers({
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Vancouver-Curiosity-Club-Calendar-Sync/1.0",
      }),
      method: "POST",
      redirect: "manual",
      signal: input.signal,
    });
  } catch {
    throw new MeetupSyncError("network_error");
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new MeetupSyncError("redirect_rejected");
  }
  if (response.status !== 200) {
    throw new MeetupSyncError("upstream_rejected");
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new MeetupSyncError("upstream_rejected");
  }
  if (response.url && response.url !== MEETUP_GRAPHQL_URL) {
    throw new MeetupSyncError("redirect_rejected");
  }
  const body = await readBoundedUtf8Body(
    response,
    MAX_MEETUP_GRAPHQL_RESPONSE_BYTES,
  );
  return parseMeetupGraphqlPage(body, input);
}

function parseMeetupGraphqlPage(
  input: unknown,
  expected: Readonly<{
    componentOffset: number;
    groupId: string;
    groupSlug: string;
    maxEvents: number;
    timeZone: string;
  }>,
): ParsedGraphqlPage {
  try {
    if (typeof input !== "string" || input.length < 20) invalidCalendar();
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      invalidCalendar();
    }
    const envelope = requiredRecord(parsed);
    if (Object.prototype.hasOwnProperty.call(envelope, "errors")) {
      if (!Array.isArray(envelope.errors) || envelope.errors.length > 0) {
        invalidCalendar();
      }
    }
    const data = requiredRecord(envelope.data);
    const group = requiredRecord(data.groupByUrlname);
    if (
      group.__typename !== "Group" ||
      group.id !== expected.groupId ||
      group.urlname !== expected.groupSlug ||
      parseIanaTimeZone(group.timezone, "group.timezone") !== expected.timeZone
    ) {
      invalidCalendar();
    }
    normalizePublicSafeSingleLine(group.name, 200, 1, false);
    const connection = requiredRecord(group.events);
    if (connection.__typename !== "GroupEventConnection") invalidCalendar();
    if (
      !Number.isSafeInteger(connection.totalCount) ||
      (connection.totalCount as number) < 0 ||
      (connection.totalCount as number) > expected.maxEvents ||
      !Array.isArray(connection.edges) ||
      connection.edges.length > MEETUP_GRAPHQL_PAGE_SIZE
    ) {
      invalidCalendar();
    }
    const pageInfo = requiredRecord(connection.pageInfo);
    if (
      pageInfo.__typename !== "PageInfo" ||
      typeof pageInfo.hasNextPage !== "boolean"
    ) {
      invalidCalendar();
    }
    const endCursor = readOptionalCursor(pageInfo.endCursor);
    if (pageInfo.hasNextPage && endCursor === null) invalidCalendar();

    const events = connection.edges.map((rawEdge, index) => {
      const edge = requiredRecord(rawEdge);
      if (edge.__typename !== "EventEdge") invalidCalendar();
      return parseGraphqlEventNode(edge.node, {
        componentIndex: expected.componentOffset + index,
        groupId: expected.groupId,
        groupSlug: expected.groupSlug,
        timeZone: expected.timeZone,
      });
    });
    return Object.freeze({
      endCursor,
      events: Object.freeze(events),
      hasNextPage: pageInfo.hasNextPage,
      totalCount: connection.totalCount as number,
    });
  } catch (error) {
    if (error instanceof MeetupSyncError) throw error;
    throw new MeetupSyncError("calendar_invalid");
  }
}

function parseGraphqlEventNode(
  input: unknown,
  expected: Readonly<{
    componentIndex: number;
    groupId: string;
    groupSlug: string;
    timeZone: string;
  }>,
): ParsedMeetupEvent {
  const event = requiredRecord(input);
  if (event.__typename !== "Event") invalidCalendar();
  if (event.eventType !== "PHYSICAL" && event.eventType !== "ONLINE") {
    invalidCalendar();
  }
  if (typeof event.id !== "string" || !EVENT_ID_PATTERN.test(event.id)) {
    invalidCalendar();
  }
  if (
    !SOURCE_AVAILABILITY_FIELDS.every((field) =>
      Object.prototype.hasOwnProperty.call(event, field),
    )
  ) {
    invalidCalendar();
  }
  const sourceGroup = requiredRecord(event.group);
  if (
    sourceGroup.__typename !== "Group" ||
    sourceGroup.id !== expected.groupId
  ) {
    invalidCalendar();
  }

  const groupRef = `Group:${expected.groupId}`;
  const eventRef = `Event:${event.id}`;
  const apolloState: Record<string, unknown> = {
    [groupRef]: {
      __typename: "Group",
      id: expected.groupId,
      timezone: expected.timeZone,
      urlname: expected.groupSlug,
    },
  };
  const venueRef = registerGraphqlVenue(apolloState, event.venue);
  const featuredPhotoRef = registerGraphqlPhoto(
    apolloState,
    event.featuredEventPhoto,
  );
  const displayPhotoRef = registerGraphqlPhoto(apolloState, event.displayPhoto);
  apolloState[eventRef] = {
    ...event,
    featuredEventPhoto:
      featuredPhotoRef === null && displayPhotoRef === null
        ? null
        : { __ref: featuredPhotoRef ?? displayPhotoRef },
    group: { __ref: groupRef },
    venue: venueRef === null ? null : { __ref: venueRef },
  };
  return parseApolloEvent({
    apolloState,
    componentIndex: expected.componentIndex,
    eventRef,
    groupRef,
    groupSlug: expected.groupSlug,
    timeZone: expected.timeZone,
  });
}

function registerGraphqlVenue(
  apolloState: Record<string, unknown>,
  input: unknown,
): string | null {
  if (input === null || input === undefined) return null;
  const venue = requiredRecord(input);
  if (
    venue.__typename !== "Venue" ||
    typeof venue.id !== "string" ||
    !ENTITY_ID_PATTERN.test(venue.id)
  ) {
    invalidCalendar();
  }
  const reference = `Venue:${venue.id}`;
  apolloState[reference] = venue;
  return reference;
}

function registerGraphqlPhoto(
  apolloState: Record<string, unknown>,
  input: unknown,
): string | null {
  if (input === null || input === undefined) return null;
  const photo = requiredRecord(input);
  if (
    photo.__typename !== "PhotoInfo" ||
    typeof photo.id !== "string" ||
    !ENTITY_ID_PATTERN.test(photo.id)
  ) {
    invalidCalendar();
  }
  const reference = `PhotoInfo:${photo.id}`;
  const previous = apolloState[reference];
  if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(photo)) {
    invalidCalendar();
  }
  apolloState[reference] = photo;
  return reference;
}

function readOptionalCursor(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (
    typeof input !== "string" ||
    input.length < 1 ||
    input.length > 2_048 ||
    UNSAFE_CONTROL_PATTERN.test(input) ||
    /\s/u.test(input)
  ) {
    invalidCalendar();
  }
  return input;
}

function parseApolloEvent(input: Readonly<{
  apolloState: Record<string, unknown>;
  componentIndex: number;
  eventRef: string;
  groupRef: string;
  groupSlug: string;
  timeZone: string;
}>): ParsedMeetupEvent {
  const event = readEntity(input.apolloState, input.eventRef, "Event");
  const eventId = readEntityId(event, input.eventRef, "Event");
  if (!EVENT_ID_PATTERN.test(eventId)) invalidCalendar();
  if (readReference(event.group, "Group") !== input.groupRef) {
    invalidCalendar();
  }

  const eventUrl = readExactEventUrl(event.eventUrl, input.groupSlug, eventId);
  const title = normalizePublicSafeSingleLine(
    event.title,
    200,
    1,
    false,
  );
  const startsAtUtcMs = readInstant(event.dateTime);
  const endsAtUtcMs = readInstant(event.endTime);
  if (
    endsAtUtcMs <= startsAtUtcMs ||
    endsAtUtcMs - startsAtUtcMs > MAX_EVENT_DURATION_MS
  ) {
    invalidCalendar();
  }
  const status = readEventStatus(event.status);
  const sourcePublicDescription = normalizePublicDescription(event.description);
  const venue = readVenue(input.apolloState, event.venue);
  const poster = readPoster(input.apolloState, event.featuredEventPhoto, title);
  const editorialProjection = applyApprovedMeetupEventEditorialOverride({
    description: sourcePublicDescription.plainText,
    descriptionBlocks: sourcePublicDescription.blocks,
    eventId,
    groupSlug: input.groupSlug,
  });
  const publicDescription = Object.freeze({
    blocks: editorialProjection.descriptionBlocks,
    plainText: descriptionBlocksToPlainText(
      editorialProjection.descriptionBlocks,
    ),
  });
  if (publicDescription.plainText !== editorialProjection.description) {
    invalidCalendar();
  }
  const extractedPublicEventFacts = extractMeetupPublicEventFacts(
    publicDescription.plainText,
    { hasPublicVenue: venue !== null },
  );
  const sourceAvailabilityFacts = readSourceAvailabilityFacts(event);
  const publicEventFacts = Object.freeze({
    ...extractedPublicEventFacts,
    availabilityState:
      sourceAvailabilityFacts === null
        ? extractedPublicEventFacts.availabilityState
        : sourceAvailabilityFacts.availabilityState,
    capacity:
      sourceAvailabilityFacts === null
        ? extractedPublicEventFacts.capacity
        : sourceAvailabilityFacts.capacity,
    publicFloor:
      editorialProjection.approvedPublicFloor ??
      extractedPublicEventFacts.publicFloor,
    waitlistAvailable:
      sourceAvailabilityFacts === null
        ? extractedPublicEventFacts.waitlistAvailable
        : sourceAvailabilityFacts.waitlistAvailable,
  });
  const publicContent: ParsedMeetupPublicContent = Object.freeze({
    ...publicEventFacts,
    description: publicDescription.plainText,
    descriptionBlocks: publicDescription.blocks,
    poster,
    summary: normalizePublicSafeSingleLine(
      deriveSummary(publicDescription.plainText),
      500,
      10,
    ),
    venue:
      venue === null
        ? null
        : Object.freeze({ address: venue.address, name: venue.name }),
  });
  const uid = `event_${eventId}@meetup.com`;

  return Object.freeze({
    componentIndex: input.componentIndex,
    description: publicContent.description,
    eventUrl,
    lastModifiedUtcMs: null,
    location: venueToLocation(venue),
    publicContent,
    recurrenceId: null,
    schedule: Object.freeze({
      endsAtUtcMs,
      kind: "timed" as const,
      startsAtUtcMs,
      timeZone: input.timeZone,
    }),
    sequence: 1,
    sourceKey: `${uid}\u001F`,
    status,
    title,
    uid,
  });
}

function readSourceAvailabilityFacts(
  event: Record<string, unknown>,
): SourceAvailabilityFacts | null {
  if (
    !SOURCE_AVAILABILITY_FIELDS.every((field) =>
      Object.prototype.hasOwnProperty.call(event, field),
    )
  ) return null;
  if (
    !Number.isSafeInteger(event.maxTickets) ||
    (event.maxTickets as number) < 0 ||
    (event.maxTickets as number) > 100_000 ||
    typeof event.rsvpState !== "string" ||
    !/^[A-Z][A-Z_]{0,39}$/u.test(event.rsvpState) ||
    typeof event.waitlistMode !== "string" ||
    !/^[A-Z][A-Z_]{0,39}$/u.test(event.waitlistMode)
  ) {
    invalidCalendar();
  }
  const yesCount = readGraphqlTotalCount(event.yesRsvps);
  const waitlistCount = readGraphqlTotalCount(event.waitlistRsvps);
  const rsvpSettings = requiredRecord(event.rsvpSettings);
  if (typeof rsvpSettings.rsvpsClosed !== "boolean") invalidCalendar();
  const capacity = (event.maxTickets as number) || null;
  const rsvpOpen =
    event.rsvpState === "JOIN_OPEN" && !rsvpSettings.rsvpsClosed;
  const waitlistAvailable =
    rsvpOpen &&
    (waitlistCount > 0 ||
      (capacity !== null && event.waitlistMode === "AUTO"))
      ? true
      : null;
  const availabilityState =
    !rsvpOpen
      ? null
      : waitlistCount > 0
      ? "waitlist"
      : capacity !== null && yesCount >= capacity
        ? "full"
        : "open";
  return Object.freeze({
    availabilityState,
    capacity,
    waitlistAvailable,
  });
}

function readGraphqlTotalCount(input: unknown): number {
  const value = requiredRecord(input).totalCount;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 1_000_000
  ) {
    invalidCalendar();
  }
  return value as number;
}

function readFutureConnectionArguments(
  key: string,
): FutureConnectionArguments | null {
  if (!key.startsWith("events(") || !key.endsWith(")")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(key.slice("events(".length, -1));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!hasExactlyKeys(parsed, ["filter", "first", "sort"])) return null;
  if (parsed.sort !== "ASC") return null;
  if (
    !Number.isSafeInteger(parsed.first) ||
    (parsed.first as number) < 1 ||
    (parsed.first as number) > MAX_MEETUP_GROUP_EVENTS
  ) {
    return null;
  }
  if (!isRecord(parsed.filter)) return null;
  if (!hasExactlyKeys(parsed.filter, ["afterDateTime", "status"])) return null;
  const afterDateTimeUtcMs = readInstant(parsed.filter.afterDateTime);
  if (!Array.isArray(parsed.filter.status)) return null;
  const statuses = [...parsed.filter.status].sort();
  const kind =
    statuses.length === 3 &&
    statuses[0] === "ACTIVE" &&
    statuses[1] === "CANCELLED" &&
    statuses[2] === "PAST"
      ? "combined"
      : statuses.length === 1 && statuses[0] === "ACTIVE"
        ? "active"
        : statuses.length === 2 &&
            statuses[0] === "CANCELLED" &&
            statuses[1] === "PAST"
          ? "past-cancelled"
          : null;
  if (kind === null) return null;
  return Object.freeze({
    afterDateTimeUtcMs,
    first: parsed.first as number,
    kind,
  });
}

function selectFutureConnections(
  candidates: readonly FutureConnectionCandidate[],
): readonly FutureConnectionCandidate[] {
  const combined = candidates.filter(
    (candidate) => candidate.arguments.kind === "combined",
  );
  if (combined.length === 1 && candidates.length === 1) {
    return Object.freeze(combined);
  }

  const active = candidates.filter(
    (candidate) => candidate.arguments.kind === "active",
  );
  const pastCancelled = candidates.filter(
    (candidate) => candidate.arguments.kind === "past-cancelled",
  );
  if (
    candidates.length !== 2 ||
    active.length !== 1 ||
    pastCancelled.length !== 1 ||
    active[0].arguments.afterDateTimeUtcMs !==
      pastCancelled[0].arguments.afterDateTimeUtcMs
  ) {
    invalidCalendar();
  }
  return Object.freeze([...candidates]);
}

function compareFutureEvents(
  left: ParsedMeetupEvent,
  right: ParsedMeetupEvent,
): number {
  if (left.schedule.kind !== "timed" || right.schedule.kind !== "timed") {
    invalidCalendar();
  }
  return (
    left.schedule.startsAtUtcMs - right.schedule.startsAtUtcMs ||
    left.schedule.endsAtUtcMs - right.schedule.endsAtUtcMs ||
    left.componentIndex - right.componentIndex
  );
}

function compareFutureEventStarts(
  left: ParsedMeetupEvent,
  right: ParsedMeetupEvent,
): number {
  if (left.schedule.kind !== "timed" || right.schedule.kind !== "timed") {
    invalidCalendar();
  }
  return left.schedule.startsAtUtcMs - right.schedule.startsAtUtcMs;
}

function readEventStatus(value: unknown): ParsedMeetupEventStatus {
  if (value === "CANCELLED") return "cancelled";
  if (value === "ACTIVE" || value === "PAST") return "confirmed";
  invalidCalendar();
}

function assertEventMatchesConnectionStatus(
  apolloState: Record<string, unknown>,
  eventRef: string,
  kind: FutureConnectionArguments["kind"],
): void {
  if (kind === "combined") return;
  const event = readEntity(apolloState, eventRef, "Event");
  if (
    (kind === "active" && event.status !== "ACTIVE") ||
    (kind === "past-cancelled" &&
      event.status !== "PAST" &&
      event.status !== "CANCELLED")
  ) {
    invalidCalendar();
  }
}

function readVenue(
  apolloState: Record<string, unknown>,
  input: unknown,
): PublicVenue | null {
  if (input === null || input === undefined) return null;
  const venueRef = readReference(input, "Venue");
  const venue = readEntity(apolloState, venueRef, "Venue");
  readEntityId(venue, venueRef, "Venue");
  const name = normalizeOptionalPublicSafeSingleLine(venue.name, 200);
  if (name === null) return null;
  return Object.freeze({
    address: normalizeOptionalPublicSafeSingleLine(venue.address, 300),
    city: normalizeOptionalPublicSafeSingleLine(venue.city, 120),
    name,
    state: normalizeOptionalPublicSafeSingleLine(venue.state, 120),
  });
}

function readPoster(
  apolloState: Record<string, unknown>,
  input: unknown,
  title: string,
): ParsedMeetupPublicContent["poster"] {
  if (input === null || input === undefined) return null;
  const photoRef = readReference(input, "PhotoInfo");
  const photo = readEntity(apolloState, photoRef, "PhotoInfo");
  const photoId = readEntityId(photo, photoRef, "PhotoInfo");
  const sourceUrl = normalizePosterUrl(photo.highResUrl, photoId);
  return Object.freeze({
    altText: normalizePublicSafeSingleLine(
      `${title} event poster.`,
      500,
      1,
      false,
    ),
    credit: "Vancouver Curiosity Club event poster via Meetup",
    sourceUrl,
  });
}

function normalizePosterUrl(input: unknown, expectedPhotoId: string): string {
  if (typeof input !== "string" || input.length > 1_000) invalidCalendar();
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    invalidCalendar();
  }
  const match = POSTER_PATH_PATTERN.exec(parsed.pathname);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "secure.meetupstatic.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    match?.[1] !== expectedPhotoId
  ) {
    invalidCalendar();
  }
  return parsed.href;
}

function normalizePublicDescription(input: unknown): Readonly<{
  blocks: readonly ParsedMeetupDescriptionBlock[];
  plainText: string;
}> {
  if (typeof input !== "string") invalidCalendar();
  const source = input
    .normalize("NFKC")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (
    source.length < 10 ||
    source.length > MAX_DESCRIPTION_LENGTH ||
    UNSAFE_CONTROL_PATTERN.test(source) ||
    EMAIL_PATTERN.test(source) ||
    RAW_HTML_PATTERN.test(source) ||
    MARKDOWN_IMAGE_PATTERN.test(source) ||
    /\b(?:passcode|password|access\s+code)\b|\b(?:token|key|pwd)=/iu.test(
      source,
    )
  ) {
    invalidCalendar();
  }

  const blocks = parsePublicDescriptionBlocks(source);
  const plainText = descriptionBlocksToPlainText(blocks);
  if (
    blocks.length < 1 ||
    blocks.length > MAX_DESCRIPTION_BLOCKS ||
    JSON.stringify(blocks).length > MAX_DESCRIPTION_BLOCKS_JSON_LENGTH ||
    plainText.length < 10 ||
    plainText.length > MAX_DESCRIPTION_LENGTH ||
    UNSAFE_CONTROL_PATTERN.test(plainText) ||
    EMAIL_PATTERN.test(plainText) ||
    FORBIDDEN_PUBLIC_TEXT_PATTERN.test(plainText)
  ) {
    invalidCalendar();
  }
  return Object.freeze({ blocks: Object.freeze(blocks), plainText });
}

function parsePublicDescriptionBlocks(
  source: string,
): readonly ParsedMeetupDescriptionBlock[] {
  const blocks: ParsedMeetupDescriptionBlock[] = [];
  let inlineNodeCount = 0;
  let paragraphLines: string[] = [];
  let list: {
    items: ParsedMeetupDescriptionInline[][];
    type: "ordered-list" | "unordered-list";
  } | null = null;

  const parseInlines = (value: string): readonly ParsedMeetupDescriptionInline[] => {
    const inlines = parsePublicDescriptionInlines(value);
    inlineNodeCount += inlines.length;
    if (inlineNodeCount > MAX_DESCRIPTION_INLINE_NODES) invalidCalendar();
    return Object.freeze(inlines);
  };
  const pushBlock = (block: ParsedMeetupDescriptionBlock): void => {
    blocks.push(Object.freeze(block));
    if (blocks.length > MAX_DESCRIPTION_BLOCKS) invalidCalendar();
  };
  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").replace(/\s+/gu, " ").trim();
    paragraphLines = [];
    if (text) {
      pushBlock(Object.freeze({ content: parseInlines(text), type: "paragraph" }));
    }
  };
  const flushList = (): void => {
    if (list === null) return;
    pushBlock(
      Object.freeze({
        items: Object.freeze(
          list.items.map((item) => Object.freeze(item)),
        ),
        type: list.type,
      }),
    );
    list = null;
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const strongHeading = /^\*\*([^*].*?)\*\*$/u.exec(line);
    const malformedStrongHeading = /^\*\*([^*].*?:)\*$/u.exec(line);
    const markdownHeading = /^(#{1,6})\s+(.+)$/u.exec(line);
    const approvedPlainHeading = /^Important note about being late:?$/iu.test(
      line,
    );
    if (
      strongHeading ||
      malformedStrongHeading ||
      markdownHeading ||
      approvedPlainHeading
    ) {
      flushParagraph();
      flushList();
      const headingText = normalizeDescriptionHeadingText(
        strongHeading?.[1] ??
          malformedStrongHeading?.[1] ??
          markdownHeading?.[2] ??
          (approvedPlainHeading ? line.replace(/:$/u, "") : ""),
      );
      const sourceLevel = markdownHeading?.[1]?.length ?? 2;
      pushBlock(
        Object.freeze({
          content: parseInlines(headingText),
          level: sourceLevel <= 2 ? 3 : 4,
          type: "heading",
        }),
      );
      continue;
    }

    const unorderedItem = /^\\?(?:[*+-]|\u2022)\s+(.+)$/u.exec(line);
    const orderedItem = /^\d+[.)]\s+(.+)$/u.exec(line);
    if (unorderedItem || orderedItem) {
      flushParagraph();
      const type = unorderedItem ? "unordered-list" : "ordered-list";
      if (list !== null && list.type !== type) flushList();
      list ??= { items: [], type };
      list.items.push([
        ...parseInlines(unorderedItem?.[1] ?? orderedItem?.[1] ?? ""),
      ]);
      if (list.items.length > MAX_DESCRIPTION_LIST_ITEMS) invalidCalendar();
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushList();
  return removeOrphanMeetupTicketAndRsvpCallToActions(
    mergeStandaloneDescriptionCallToActionBlocks(blocks),
  );
}

function parsePublicDescriptionInlines(
  value: string,
): ParsedMeetupDescriptionInline[] {
  const inlines: ParsedMeetupDescriptionInline[] = [];
  const pattern =
    /\[([^\]\n]{1,500})\]\((https?:\/\/[^)\s]{1,2048})\)|\*\*([^*\n]+)\*\*|(?<![\[(])https?:\/\/[^\s<>()]+/gu;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    pushPublicTextInline(inlines, value.slice(cursor, index));
    if (match[1] !== undefined && match[2] !== undefined) {
      pushPublicLinkInline(inlines, match[1], match[2]);
    } else if (match[3] !== undefined) {
      const text = normalizeDescriptionInlineText(match[3]);
      if (text) inlines.push(Object.freeze({ text, type: "strong" }));
    } else {
      pushPublicLinkInline(inlines, match[0], match[0]);
    }
    cursor = index + match[0].length;
  }
  pushPublicTextInline(inlines, value.slice(cursor));
  if (inlines.length === 0) invalidCalendar();
  return inlines;
}

function pushPublicTextInline(
  inlines: ParsedMeetupDescriptionInline[],
  input: string,
): void {
  const text = normalizeDescriptionInlineText(input);
  if (!text) return;
  const previous = inlines.at(-1);
  if (text.trim().length === 0) {
    if (!previous) return;
    inlines[inlines.length - 1] = Object.freeze({
      ...previous,
      text: normalizeDescriptionInlineText(`${previous.text}${text}`),
    });
    return;
  }
  if (previous?.type === "text") {
    inlines[inlines.length - 1] = Object.freeze({
      text: `${previous.text}${text}`,
      type: "text",
    });
  } else {
    inlines.push(Object.freeze({ text, type: "text" }));
  }
}

function pushPublicLinkInline(
  inlines: ParsedMeetupDescriptionInline[],
  rawLabel: string,
  rawHref: string,
): void {
  const href = normalizePublicDescriptionLink(rawHref);
  const label = normalizeDescriptionInlineText(rawLabel);
  if (href === null) {
    const previous = inlines.at(-1);
    const precedingCallToAction =
      previous?.type === "text"
        ? splitTrailingMeetupTicketOrRsvpCallToAction(previous.text)
        : null;
    if (
      precedingCallToAction !== null &&
      FORBIDDEN_PUBLIC_TEXT_PATTERN.test(label)
    ) {
      inlines.pop();
      if (precedingCallToAction.prefix) {
        pushPublicTextInline(inlines, precedingCallToAction.prefix);
      }
      return;
    }
    const labelCallToAction =
      splitTrailingMeetupTicketOrRsvpCallToAction(label);
    if (labelCallToAction !== null) {
      if (labelCallToAction.prefix) {
        pushPublicTextInline(inlines, labelCallToAction.prefix);
      }
      return;
    }
    const safeLabel = FORBIDDEN_PUBLIC_TEXT_PATTERN.test(label)
      ? "External resource"
      : label;
    pushPublicTextInline(inlines, safeLabel);
    return;
  }
  const host = new URL(href).hostname;
  const displayHost = host.replace(/^(?:m\.|www\.)/u, "");
  const usesGenericLabel = FORBIDDEN_PUBLIC_TEXT_PATTERN.test(label);
  const previous = inlines.at(-1);
  const callToAction = usesGenericLabel
    ? descriptionCallToAction(
        previous?.type === "text" ? previous.text : "",
      )
    : null;
  if (callToAction !== null) {
    inlines.pop();
    if (callToAction.prefix) {
      pushPublicTextInline(inlines, callToAction.prefix);
    }
  }
  const text =
    callToAction?.label ?? (usesGenericLabel ? `Open ${displayHost}` : label);
  inlines.push(Object.freeze({ href, text, type: "link" }));
}

function mergeStandaloneDescriptionCallToActionBlocks(
  blocks: ParsedMeetupDescriptionBlock[],
): ParsedMeetupDescriptionBlock[] {
  const merged: ParsedMeetupDescriptionBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    const callToAction = standaloneDescriptionCallToAction(block);
    const link = standaloneGenericDescriptionLink(next);
    if (callToAction !== null && link !== null) {
      const content = Object.freeze([
        ...(callToAction.prefix
          ? [
              Object.freeze({
                text: callToAction.prefix,
                type: "text" as const,
              }),
            ]
          : []),
        Object.freeze({
          ...link,
          text: callToAction.label,
          type: "link" as const,
        }),
      ]);
      merged.push(
        block.type === "heading"
          ? Object.freeze({ content, level: block.level, type: block.type })
          : Object.freeze({ content, type: "paragraph" as const }),
      );
      index += 1;
      continue;
    }
    merged.push(block);
  }
  return merged;
}

function standaloneDescriptionCallToAction(
  block: ParsedMeetupDescriptionBlock | undefined,
): DescriptionCallToAction | null {
  if (block === undefined || "items" in block || block.content.length !== 1) {
    return null;
  }
  const inline = block.content[0];
  return inline.type === "text"
    ? descriptionCallToAction(inline.text)
    : null;
}

function standaloneGenericDescriptionLink(
  block: ParsedMeetupDescriptionBlock | undefined,
): Extract<ParsedMeetupDescriptionInline, { type: "link" }> | null {
  if (
    block === undefined ||
    block.type !== "paragraph" ||
    block.content.length !== 1
  ) {
    return null;
  }
  const inline = block.content[0];
  return inline.type === "link" && isGenericDescriptionLinkText(inline.text)
    ? inline
    : null;
}

type DescriptionCallToAction = Readonly<{ label: string; prefix: string }>;

function descriptionCallToAction(input: string): DescriptionCallToAction | null {
  const normalized = input.trimEnd();
  if (!normalized.endsWith(":")) return null;
  const candidate = normalized.slice(0, -1);
  const suffix = /(Buy\b[^:]{0,80}\bhere|Google Maps|(?:Official|Public|Reservation|Planning|Ticket|Tickets|YouTube|Video|Event|Film|Source) [^.!?:]{1,60}|(?:\d+-minute )?written summary)$/iu.exec(
    candidate,
  );
  const suffixIndex = suffix?.index ?? null;
  const wholeLabel = candidate.trim();
  const start =
    suffixIndex ??
    (wholeLabel.length <= 80 &&
    !/[.!?]/u.test(wholeLabel) &&
    !/^[,;:]/u.test(wholeLabel)
      ? candidate.indexOf(wholeLabel)
      : null);
  if (start === null) return null;
  const label = candidate.slice(start).trim();
  if (label.length < 3 || label.length > 80) return null;
  const rawPrefix = candidate.slice(0, start);
  const prefixIsOnlySpacing = rawPrefix.trim().length === 0;
  return Object.freeze({
    label: `${prefixIsOnlySpacing ? rawPrefix : ""}${label}`,
    prefix: prefixIsOnlySpacing ? "" : rawPrefix,
  });
}

function isGenericDescriptionLinkText(input: string): boolean {
  return /^Open [a-z0-9.-]+$/iu.test(input);
}

function normalizeDescriptionInlineText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\\([!-/:-@\[-`{-~])/gu, "$1")
    .replace(/\s+/gu, " ");
}

function normalizeDescriptionHeadingText(input: string): string {
  const text = normalizeDescriptionInlineText(input).trim();
  const redundantStrong = /^\*\*\s*([^*].*?)\s*\*\*$/u.exec(text);
  return redundantStrong?.[1]?.trim() ?? text;
}

function normalizePublicDescriptionLink(input: string): string | null {
  if (input.length > MAX_DESCRIPTION_LINK_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      input.normalize("NFKC").replace(/\\([!-/:-@\[-`{-~])/gu, "$1"),
    );
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    !ALLOWED_PUBLIC_DESCRIPTION_LINK_HOSTS.has(host)
  ) {
    return null;
  }
  parsed.hostname = host;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|g_st|ouid|rtpof|sd|usp)$/iu.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  const allowedQueryKeys = PUBLIC_DESCRIPTION_LINK_QUERY_KEYS[host];
  for (const key of parsed.searchParams.keys()) {
    if (!allowedQueryKeys?.has(key)) return null;
  }
  const normalized = parsed.toString();
  return normalized.length <= MAX_DESCRIPTION_LINK_LENGTH ? normalized : null;
}

function descriptionBlocksToPlainText(
  blocks: readonly ParsedMeetupDescriptionBlock[],
): string {
  return blocks
    .map((block) => {
      if ("items" in block) {
        return block.items
          .map((item, index) => {
            const marker =
              block.type === "ordered-list" ? `${index + 1}.` : "\u2022";
            return `${marker} ${descriptionInlinesToText(item)}`;
          })
          .join("\n");
      }
      return descriptionInlinesToText(block.content);
    })
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function descriptionInlinesToText(
  inlines: readonly ParsedMeetupDescriptionInline[],
): string {
  return inlines.map((inline) => inline.text).join("").trim();
}

function deriveSummary(description: string): string {
  const lower = description.toLocaleLowerCase("en-CA");
  const marker = "short summary";
  const markerIndex = lower.indexOf(marker);
  let body =
    markerIndex >= 0
      ? description.slice(markerIndex + marker.length)
      : description;
  const stopIndex = body.search(
    /\n(?:A few questions|Questions|How the evening|How the event|How it will|The plan|Reading for|What to bring|Tickets|Location|When and where|A note)/iu,
  );
  if (stopIndex > 0) body = body.slice(0, stopIndex);
  const collapsed = body.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= 360) return collapsed;
  const candidate = collapsed.slice(0, 360);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf("! "),
  );
  return sentenceEnd >= 180
    ? candidate.slice(0, sentenceEnd + 1)
    : `${candidate.slice(0, 357).trimEnd()}...`;
}

function venueToLocation(venue: PublicVenue | null): string | null {
  if (venue === null) return null;
  return [venue.name, venue.address, venue.city, venue.state]
    .filter((part): part is string => part !== null)
    .join(", ");
}

function normalizeOptionalPublicSafeSingleLine(
  input: unknown,
  maximum: number,
): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string" && input.trim() === "") return null;
  return normalizePublicSafeSingleLine(input, maximum);
}

function normalizePublicSafeSingleLine(
  input: unknown,
  maximum: number,
  minimum = 1,
  enforcePublicTextAllowlist = true,
): string {
  if (typeof input !== "string") invalidCalendar();
  const value = input.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    value.length < minimum ||
    value.length > maximum ||
    UNSAFE_CONTROL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    (enforcePublicTextAllowlist && FORBIDDEN_PUBLIC_TEXT_PATTERN.test(value))
  ) {
    invalidCalendar();
  }
  return value;
}

function readExactEventUrl(
  input: unknown,
  groupSlug: string,
  eventId: string,
): string {
  const expected = `https://www.meetup.com/${groupSlug}/events/${eventId}/`;
  if (input !== expected) invalidCalendar();
  return expected;
}

function readInstant(input: unknown): number {
  if (
    typeof input !== "string" ||
    input.length > 40 ||
    !ISO_INSTANT_PATTERN.test(input)
  ) {
    invalidCalendar();
  }
  const utcMs = Date.parse(input);
  if (!Number.isFinite(utcMs)) invalidCalendar();
  return utcMs;
}

function readReference(input: unknown, expectedType: string): string {
  const reference = requiredRecord(input).__ref;
  const entityIdPattern =
    expectedType === "Event" ? EVENT_ID_PATTERN : ENTITY_ID_PATTERN;
  if (
    typeof reference !== "string" ||
    !reference.startsWith(`${expectedType}:`) ||
    !entityIdPattern.test(reference.slice(expectedType.length + 1))
  ) {
    invalidCalendar();
  }
  return reference;
}

function readEntity(
  apolloState: Record<string, unknown>,
  reference: string,
  expectedType: string,
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(apolloState, reference)) {
    invalidCalendar();
  }
  const entity = requiredRecord(apolloState[reference]);
  if (entity.__typename !== expectedType) invalidCalendar();
  return entity;
}

function readEntityId(
  entity: Record<string, unknown>,
  reference: string,
  expectedType: string,
): string {
  const expectedId = reference.slice(expectedType.length + 1);
  if (entity.id !== expectedId) invalidCalendar();
  return expectedId;
}

function requiredRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) invalidCalendar();
  return input;
}

function hasExactlyKeys(
  input: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(input).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function assertCanonicalGroupDocument(html: string, groupSlug: string): void {
  const canonicalTags = (html.match(/<link\b[^>]*>/giu) ?? []).filter((tag) =>
    /\brel=["']canonical["']/iu.test(tag),
  );
  const canonicalUrl =
    canonicalTags.length === 1
      ? /\bhref=["']([^"']+)["']/iu.exec(canonicalTags[0])?.[1]
      : null;
  if (canonicalUrl !== `https://www.meetup.com/${groupSlug}/`) {
    invalidCalendar();
  }
}

function parseGroupEventsPageSource(groupSlug: unknown): GroupEventsPageSource {
  if (typeof groupSlug !== "string") invalidCalendar();
  const normalized = groupSlug.trim().toLowerCase();
  if (!GROUP_SLUG_PATTERN.test(normalized)) invalidCalendar();
  return Object.freeze({
    groupSlug: normalized,
    url: `https://www.meetup.com/${normalized}/events/`,
  });
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    invalidCalendar();
  }
  return limit;
}

async function readBoundedUtf8Body(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    throw new MeetupSyncError("response_too_large");
  }
  if (!response.body) throw new MeetupSyncError("upstream_rejected");

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new MeetupSyncError("response_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof MeetupSyncError) throw error;
    throw new MeetupSyncError("network_error");
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MeetupSyncError("calendar_invalid");
  }
}

function invalidCalendar(): never {
  throw new MeetupSyncError("calendar_invalid");
}
