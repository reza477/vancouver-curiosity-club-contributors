import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchMeetupGroupEvents,
  MeetupSyncError,
  parseMeetupGroupEventsPage,
} from "../../lib/server/meetup/index.ts";

const GROUP_SLUG = "vancouver-meetup-group";
const GROUP_REF = "Group:38093975";
const EVENT_ID = "316010049";
const EVENT_REF = `Event:${EVENT_ID}`;
const EVENT_URL =
  `https://www.meetup.com/${GROUP_SLUG}/events/${EVENT_ID}/`;
const POSTER_ID = "535545462";
const POSTER_URL =
  `https://secure.meetupstatic.com/photos/event/b/1/9/6/highres_${POSTER_ID}.jpeg`;

test("parses only the exact future connection and preserves structured public content", () => {
  const state = createApolloState();
  state["Event:999999999"] = {
    __typename: "Event",
    id: "999999999",
    title: "Cached past event that must not be scanned",
  };
  const parsed = parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG);

  assert.equal(parsed.method, "PUBLISH");
  assert.deepEqual(parsed.rejectedEvents, []);
  assert.equal(parsed.events.length, 1);
  const event = parsed.events[0];
  assert.equal(event.componentIndex, 0);
  assert.equal(event.uid, `event_${EVENT_ID}@meetup.com`);
  assert.equal(event.sourceKey, `event_${EVENT_ID}@meetup.com\u001f`);
  assert.equal(event.eventUrl, EVENT_URL);
  assert.equal(event.status, "confirmed");
  assert.equal(event.sequence, 1);
  assert.equal(event.lastModifiedUtcMs, null);
  assert.deepEqual(event.schedule, {
    endsAtUtcMs: Date.parse("2026-08-12T20:00:00-07:00"),
    kind: "timed",
    startsAtUtcMs: Date.parse("2026-08-12T18:00:00-07:00"),
    timeZone: "America/Vancouver",
  });
  assert.equal(
    event.location,
    "Vancouver Central Library, 350 West Georgia Street, Vancouver, BC",
  );
  assert.ok(event.publicContent);
  assert.deepEqual(event.publicContent.venue, {
    address: "350 West Georgia Street",
    name: "Vancouver Central Library",
  });
  assert.deepEqual(event.publicContent.poster, {
    altText: `${event.title} event poster.`,
    credit: "Vancouver Curiosity Club event poster via Meetup",
    sourceUrl: POSTER_URL,
  });
  assert.deepEqual(
    event.publicContent.descriptionBlocks.map((block) => block.type),
    ["heading", "paragraph", "unordered-list", "ordered-list"],
  );
  assert.deepEqual(event.publicContent.descriptionBlocks[0], {
    content: [{ text: "Why come?", type: "text" }],
    level: 3,
    type: "heading",
  });
  assert.deepEqual(event.publicContent.descriptionBlocks[1], {
    content: [
      { text: "Bring ", type: "text" },
      { text: "curiosity", type: "strong" },
      { text: ". ", type: "text" },
      {
        href: "https://viff.org/whats-on/princess-mononoke/",
        text: "Buy your VIFF ticket here",
        type: "link",
      },
      { text: ".", type: "text" },
    ],
    type: "paragraph",
  });
  assert.match(event.publicContent.description, /• Read together/u);
  assert.match(event.publicContent.description, /1\. Arrive on time/u);
  assert.match(event.publicContent.summary, /Why come\?/u);
  assert.ok(Object.isFrozen(event.publicContent.descriptionBlocks));
});

test("rejects cross-group events, mismatched ids, and non-allowlisted poster hosts", () => {
  for (const mutate of [
    (state) => {
      state[EVENT_REF].group = { __ref: "Group:99999999" };
    },
    (state) => {
      state[EVENT_REF].eventUrl =
        `https://www.meetup.com/${GROUP_SLUG}/events/999999999/`;
    },
    (state) => {
      state[`PhotoInfo:${POSTER_ID}`].highResUrl =
        `https://images.example/highres_${POSTER_ID}.jpeg`;
    },
    (state) => {
      state[`PhotoInfo:${POSTER_ID}`].highResUrl =
        "https://secure.meetupstatic.com/photos/event/b/1/9/6/highres_123.jpeg";
    },
  ]) {
    const state = createApolloState();
    mutate(state);
    assertSyncError(
      () => parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG),
      "calendar_invalid",
    );
  }
});

test("rejects document identity drift, duplicate edges, and over-bound connections", () => {
  assertSyncError(
    () =>
      parseMeetupGroupEventsPage(
        createHtml(createApolloState(), { querySlug: "other-group" }),
        GROUP_SLUG,
      ),
    "calendar_invalid",
  );
  assertSyncError(
    () =>
      parseMeetupGroupEventsPage(
        createHtml(createApolloState(), { canonicalSlug: "other-group" }),
        GROUP_SLUG,
      ),
    "calendar_invalid",
  );

  const duplicateState = createApolloState({ eventRefs: [EVENT_REF, EVENT_REF] });
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(duplicateState), GROUP_SLUG),
    "calendar_invalid",
  );
  assertSyncError(
    () =>
      parseMeetupGroupEventsPage(createHtml(createApolloState()), GROUP_SLUG, {
        maxEvents: 0,
      }),
    "calendar_invalid",
  );
});

test("rejects source drift that exceeds downstream public projection bounds", () => {
  const longTitleState = createApolloState();
  longTitleState[EVENT_REF].title = "T".repeat(201);
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(longTitleState), GROUP_SLUG),
    "calendar_invalid",
  );

  const fragmentedDescriptionState = createApolloState();
  fragmentedDescriptionState[EVENT_REF].description = Array.from(
    { length: 14 },
    (_, sectionIndex) =>
      Array.from(
        { length: sectionIndex < 13 ? 300 : 100 },
        () => '- "',
      ).join("\n"),
  ).join("\n\n");
  assertSyncError(
    () =>
      parseMeetupGroupEventsPage(
        createHtml(fragmentedDescriptionState),
        GROUP_SLUG,
      ),
    "calendar_invalid",
  );
});

test("keeps unsafe description markup and links out of public content", () => {
  const rawHtmlState = createApolloState();
  rawHtmlState[EVENT_REF].description =
    "A public introduction with enough detail.\n\n<script>alert(1)</script>";
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(rawHtmlState), GROUP_SLUG),
    "calendar_invalid",
  );

  const disallowedLinkState = createApolloState();
  disallowedLinkState[EVENT_REF].description =
    "## Details\n\nRead [the private handout](https://evil.example/secret) before joining us.";
  const parsed = parseMeetupGroupEventsPage(
    createHtml(disallowedLinkState),
    GROUP_SLUG,
  );
  const inlines = parsed.events[0].publicContent.descriptionBlocks[1].content;
  assert.deepEqual(inlines, [
    { text: "Read the private handout before joining us.", type: "text" },
  ]);
});

test("fetches the one canonical group page with bounded no-store semantics", async () => {
  const html = createHtml(createApolloState());
  let observedUrl = null;
  let observedInit = null;
  const parsed = await fetchMeetupGroupEvents(GROUP_SLUG, {
    fetcher: async (url, init) => {
      observedUrl = url;
      observedInit = init;
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 200,
      });
    },
  });

  assert.equal(
    observedUrl,
    `https://www.meetup.com/${GROUP_SLUG}/events/`,
  );
  assert.equal(observedInit.cache, "no-store");
  assert.equal(observedInit.redirect, "manual");
  assert.equal(observedInit.headers.get("accept"), "text/html,application/xhtml+xml");
  assert.equal(parsed.events[0].eventUrl, EVENT_URL);
});

test("fetch rejects redirects, non-HTML responses, and oversized bodies", async () => {
  await assert.rejects(
    fetchMeetupGroupEvents(GROUP_SLUG, {
      fetcher: async () =>
        new Response(null, {
          headers: { location: "https://www.meetup.com/other/events/" },
          status: 302,
        }),
    }),
    (error) => error instanceof MeetupSyncError && error.code === "redirect_rejected",
  );
  await assert.rejects(
    fetchMeetupGroupEvents(GROUP_SLUG, {
      fetcher: async () =>
        new Response("not html", {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    }),
    (error) => error instanceof MeetupSyncError && error.code === "upstream_rejected",
  );
  await assert.rejects(
    fetchMeetupGroupEvents(GROUP_SLUG, {
      fetcher: async () =>
        new Response(createHtml(createApolloState()), {
          headers: { "content-type": "text/html" },
          status: 200,
        }),
      maxBytes: 100,
    }),
    (error) => error instanceof MeetupSyncError && error.code === "response_too_large",
  );
});

function createApolloState({ eventRefs = [EVENT_REF] } = {}) {
  const futureConnectionKey = `events(${JSON.stringify({
    filter: {
      afterDateTime: "2026-08-07T04:04:02.863Z",
      status: ["ACTIVE", "PAST", "CANCELLED"],
    },
    first: 30,
    sort: "ASC",
  })})`;
  const state = {
    ROOT_QUERY: {
      __typename: "Query",
      [`groupByUrlname:{"urlname":"${GROUP_SLUG}"}`]: { __ref: GROUP_REF },
    },
    [GROUP_REF]: {
      __typename: "Group",
      id: GROUP_REF.split(":")[1],
      isPrivate: false,
      timezone: "America/Vancouver",
      urlname: GROUP_SLUG,
      [futureConnectionKey]: {
        __typename: "GroupEventConnection",
        edges: eventRefs.map((eventRef) => ({
          __typename: "EventEdge",
          node: { __ref: eventRef },
        })),
        pageInfo: { __typename: "PageInfo", hasNextPage: true },
        totalCount: 68,
      },
      'events({"filter":{"beforeDateTime":"2026-08-07T04:04:02.863Z","status":["ACTIVE","PAST","CANCELLED"]},"first":10,"sort":"DESC"})': {
        __typename: "GroupEventConnection",
        edges: [{ __typename: "EventEdge", node: { __ref: "Event:999999999" } }],
        pageInfo: { __typename: "PageInfo", hasNextPage: true },
        totalCount: 200,
      },
    },
    [EVENT_REF]: {
      __typename: "Event",
      dateTime: "2026-08-12T18:00:00-07:00",
      description:
        "## Why come?\n\nBring **curiosity**. [Buy your VIFF ticket here](https://viff.org/whats-on/princess-mononoke/).\n\n- Read together\n- Talk together\n\n1. Arrive on time\n2. Settle in gently",
      endTime: "2026-08-12T20:00:00-07:00",
      eventUrl: EVENT_URL,
      featuredEventPhoto: { __ref: `PhotoInfo:${POSTER_ID}` },
      group: { __ref: GROUP_REF },
      id: EVENT_ID,
      status: "ACTIVE",
      title: "🧘🌙 Wednesday Night Reset",
      venue: { __ref: "Venue:25956902" },
    },
    "Venue:25956902": {
      __typename: "Venue",
      address: "350 West Georgia Street",
      city: "Vancouver",
      id: "25956902",
      name: "Vancouver Central Library",
      state: "BC",
    },
    [`PhotoInfo:${POSTER_ID}`]: {
      __typename: "PhotoInfo",
      highResUrl: POSTER_URL,
      id: POSTER_ID,
    },
  };
  return structuredClone(state);
}

function createHtml(
  apolloState,
  { canonicalSlug = GROUP_SLUG, querySlug = GROUP_SLUG } = {},
) {
  return `<!doctype html><html><head><link rel="canonical" href="https://www.meetup.com/${canonicalSlug}/"></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    {
      props: { pageProps: { __APOLLO_STATE__: apolloState } },
      query: { slug: querySlug },
    },
  )}</script></body></html>`;
}

function assertSyncError(callback, expectedCode) {
  assert.throws(
    callback,
    (error) => error instanceof MeetupSyncError && error.code === expectedCode,
  );
}
