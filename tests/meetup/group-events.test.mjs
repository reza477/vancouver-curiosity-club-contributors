import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchMeetupGroupEvents,
  MeetupSyncError,
  parseMeetupGroupEventsPage,
} from "../../lib/server/meetup/index.ts";
import { validateMeetupDescriptionBlocks } from "../../lib/meetup-event-enrichment.ts";

const GROUP_SLUG = "vancouver-meetup-group";
const GROUP_REF = "Group:38093975";
const EVENT_ID = "316010049";
const EVENT_REF = `Event:${EVENT_ID}`;
const EVENT_URL =
  `https://www.meetup.com/${GROUP_SLUG}/events/${EVENT_ID}/`;
const FUTURE_AFTER = "2026-08-07T04:04:02.863Z";
const CANCELLED_EVENT_ID = "316010050";
const CANCELLED_EVENT_REF = `Event:${CANCELLED_EVENT_ID}`;
const OPAQUE_EVENT_ID = "hmmsztyjclbjc";
const OPAQUE_EVENT_REF = `Event:${OPAQUE_EVENT_ID}`;
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

test("merges the exact ACTIVE and PAST/CANCELLED future connections in schedule order", () => {
  const state = createApolloState({
    futureConnections: [
      { eventRefs: [EVENT_REF], statuses: ["ACTIVE"] },
      {
        eventRefs: [CANCELLED_EVENT_REF],
        statuses: ["PAST", "CANCELLED"],
      },
    ],
  });
  addEvent(state, {
    dateTime: "2026-08-10T18:00:00-07:00",
    endTime: "2026-08-10T20:00:00-07:00",
    eventId: CANCELLED_EVENT_ID,
    status: "CANCELLED",
    title: "Cancelled source event",
  });

  const parsed = parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG);

  assert.deepEqual(
    parsed.events.map((event) => ({
      componentIndex: event.componentIndex,
      eventUrl: event.eventUrl,
      status: event.status,
      title: event.title,
    })),
    [
      {
        componentIndex: 0,
        eventUrl:
          `https://www.meetup.com/${GROUP_SLUG}/events/${CANCELLED_EVENT_ID}/`,
        status: "cancelled",
        title: "Cancelled source event",
      },
      {
        componentIndex: 1,
        eventUrl: EVENT_URL,
        status: "confirmed",
        title: state[EVENT_REF].title,
      },
    ],
  );
});

test("rejects incomplete, ambiguous, mismatched, duplicate, and over-bound split connections", () => {
  const incomplete = createApolloState({
    futureConnections: [{ eventRefs: [EVENT_REF], statuses: ["ACTIVE"] }],
  });
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(incomplete), GROUP_SLUG),
    "calendar_invalid",
  );

  const ambiguous = createApolloState({
    futureConnections: [
      {
        eventRefs: [EVENT_REF],
        statuses: ["ACTIVE", "PAST", "CANCELLED"],
      },
      { eventRefs: [EVENT_REF], statuses: ["ACTIVE"] },
      {
        eventRefs: [CANCELLED_EVENT_REF],
        statuses: ["PAST", "CANCELLED"],
      },
    ],
  });
  addEvent(ambiguous, {
    eventId: CANCELLED_EVENT_ID,
    status: "CANCELLED",
  });
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(ambiguous), GROUP_SLUG),
    "calendar_invalid",
  );

  const mismatchedCutoffs = createApolloState({
    futureConnections: [
      { eventRefs: [EVENT_REF], statuses: ["ACTIVE"] },
      {
        afterDateTime: "2026-08-07T05:04:02.863Z",
        eventRefs: [CANCELLED_EVENT_REF],
        statuses: ["PAST", "CANCELLED"],
      },
    ],
  });
  addEvent(mismatchedCutoffs, {
    eventId: CANCELLED_EVENT_ID,
    status: "CANCELLED",
  });
  assertSyncError(
    () =>
      parseMeetupGroupEventsPage(createHtml(mismatchedCutoffs), GROUP_SLUG),
    "calendar_invalid",
  );

  const duplicate = createApolloState({
    futureConnections: [
      { eventRefs: [EVENT_REF], statuses: ["ACTIVE"] },
      { eventRefs: [EVENT_REF], statuses: ["PAST", "CANCELLED"] },
    ],
  });
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(duplicate), GROUP_SLUG),
    "calendar_invalid",
  );

  const wrongStatus = createApolloState({
    futureConnections: [
      { eventRefs: [EVENT_REF], statuses: ["ACTIVE"] },
      {
        eventRefs: [CANCELLED_EVENT_REF],
        statuses: ["PAST", "CANCELLED"],
      },
    ],
  });
  addEvent(wrongStatus, {
    eventId: CANCELLED_EVENT_ID,
    status: "ACTIVE",
  });
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(wrongStatus), GROUP_SLUG),
    "calendar_invalid",
  );

  const overBound = createApolloState({
    futureConnections: [
      { eventRefs: [EVENT_REF], statuses: ["ACTIVE"] },
      {
        eventRefs: [CANCELLED_EVENT_REF],
        statuses: ["PAST", "CANCELLED"],
      },
    ],
  });
  addEvent(overBound, {
    eventId: CANCELLED_EVENT_ID,
    status: "CANCELLED",
  });
  assertSyncError(
    () =>
      parseMeetupGroupEventsPage(createHtml(overBound), GROUP_SLUG, {
        maxEvents: 1,
      }),
    "calendar_invalid",
  );
});

test("accepts only bounded URL-safe opaque recurring Meetup event ids", () => {
  const state = createApolloState({ eventRefs: [OPAQUE_EVENT_REF] });
  addEvent(state, {
    eventId: OPAQUE_EVENT_ID,
    status: "ACTIVE",
    title: "Meditation and journaling circle",
  });

  const parsed = parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG);
  assert.equal(parsed.events[0].uid, `event_${OPAQUE_EVENT_ID}@meetup.com`);
  assert.equal(
    parsed.events[0].eventUrl,
    `https://www.meetup.com/${GROUP_SLUG}/events/${OPAQUE_EVENT_ID}/`,
  );

  state[OPAQUE_EVENT_REF].eventUrl = EVENT_URL;
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG),
    "calendar_invalid",
  );

  for (const unsafeId of ["../escape", "contains.dot", "x".repeat(129)]) {
    const unsafeRef = `Event:${unsafeId}`;
    const unsafeState = createApolloState({ eventRefs: [unsafeRef] });
    addEvent(unsafeState, { eventId: unsafeId, status: "ACTIVE" });
    assertSyncError(
      () => parseMeetupGroupEventsPage(createHtml(unsafeState), GROUP_SLUG),
      "calendar_invalid",
    );
  }
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

test("applies the approved Level 8 Chekhov correction to canonical and alias imports", () => {
  for (const { eventId, groupSlug } of [
    {
      eventId: "315823022",
      groupSlug: "vancouver-literature-and-film",
    },
    { eventId: "315823081", groupSlug: "vancouver-meetup-group" },
  ]) {
    const state = createApolloState();
    const eventRef = relabelPrimaryMeetupEvent(state, { eventId, groupSlug });
    state[eventRef].description =
      "A sufficiently detailed public event description. Location: Vancouver Central Library, 9th floor, left of the elevators.";
    const rawDescription = state[eventRef].description;

    const event = parseMeetupGroupEventsPage(
      createHtml(state, { canonicalSlug: groupSlug, querySlug: groupSlug }),
      groupSlug,
    ).events[0];
    assert.equal(state[eventRef].description, rawDescription, eventId);
    assert.equal(event.publicContent.publicFloor, "Level 8", eventId);
    assert.match(event.publicContent.description, /\bLevel 8\b/u, eventId);
    assert.doesNotMatch(
      JSON.stringify(event.publicContent.descriptionBlocks),
      /\b(?:9th[ -]+floor|ninth[ -]+floor|(?:Level|Floor)\s*:?\s*9)\b/iu,
      eventId,
    );
  }
});

test("rejects unknown conflicting live floor claims", () => {
  const state = createApolloState();
  state[EVENT_REF].description =
    "A sufficiently detailed public event description. Location: Level 7 in one source line and Level 8 in another.";
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG),
    "calendar_invalid",
  );
});

test("removes or rejects orphan ticket and RSVP calls to action", () => {
  const removable = createApolloState();
  removable[EVENT_REF].description = `Short summary
A useful public event note. [Buy your ticket here](https://tickets.example.invalid/buy)

RSVP here:`;
  const publicContent = parseMeetupGroupEventsPage(
    createHtml(removable),
    GROUP_SLUG,
  ).events[0].publicContent;
  assert.match(publicContent.description, /A useful public event note\./u);
  assert.doesNotMatch(
    JSON.stringify(publicContent),
    /buy your ticket|rsvp here|tickets\.example\.invalid/iu,
  );

  const rejected = createApolloState();
  rejected[EVENT_REF].description = `A sufficiently detailed public event note.

[Buy your ticket here](https://tickets.example.invalid/buy)`;
  assertSyncError(
    () => parseMeetupGroupEventsPage(createHtml(rejected), GROUP_SLUG),
    "calendar_invalid",
  );
});

test("normalizes the exact Banking Markdown residue in automatic group-page imports", () => {
  const state = createApolloState();
  state[EVENT_REF].description = `Short Summary
This is designed for those with little to no knowledge of Canadian banking and investing.

**\\*\\* IMPORTANT \\*\\***

This is not a product or service and does not involve any sales, cost, or subscription.

The session is designed to take \\~30 minutes, but I encourage questions during the presentation.`;

  const parsed = parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG);
  const publicContent = parsed.events[0].publicContent;
  assert.deepEqual(publicContent.descriptionBlocks[1], {
    content: [{ text: "IMPORTANT", type: "text" }],
    level: 3,
    type: "heading",
  });
  assert.match(publicContent.description, /The session is designed to take ~30 minutes/u);
  assert.doesNotMatch(
    publicContent.description,
    /\*\*\s*IMPORTANT\s*\*\*|\\~30 minutes/u,
  );
});

test("preserves the approved late-arrival line as a semantic heading", () => {
  const state = createApolloState();
  state[EVENT_REF].description = `A welcoming meditation and journaling session for the public.
Please arrive a few minutes before the listed start time.
Important note about being late
Because the room settles together, late arrivals may not be admitted.`;

  const publicContent = parseMeetupGroupEventsPage(
    createHtml(state),
    GROUP_SLUG,
  ).events[0].publicContent;
  assert.deepEqual(publicContent.descriptionBlocks[1], {
    content: [{ text: "Important note about being late", type: "text" }],
    level: 3,
    type: "heading",
  });
  assert.deepEqual(publicContent.descriptionBlocks[2], {
    content: [
      {
        text: "Because the room settles together, late arrivals may not be admitted.",
        type: "text",
      },
    ],
    type: "paragraph",
  });
});

test("retains the exact paddleboarding lesson link in automatic group-page imports", () => {
  const state = createApolloState();
  state[EVENT_REF].description = `Finding Your People: Last-Minute Paddleboarding at Deep Cove 🏄
A little last minute! A friend and I are heading to Deep Cove for a beginner paddleboarding lesson.

If SUP has been on your summer list, come learn with us! If you’re interested in the BOGO offer, post here and coordinate with others.

https://deepcovekayak.com/lesson/intro-to-sup/

Already know how to paddleboard? Rent a board and join us on the water.`;

  const parsed = parseMeetupGroupEventsPage(createHtml(state), GROUP_SLUG);
  const publicContent = parsed.events[0].publicContent;
  assert.deepEqual(publicContent.descriptionBlocks[2], {
    content: [
      {
        href: "https://deepcovekayak.com/lesson/intro-to-sup/",
        text: "Open deepcovekayak.com",
        type: "link",
      },
    ],
    type: "paragraph",
  });
  assert.match(publicContent.description, /Open deepcovekayak\.com/u);
  assert.doesNotMatch(publicContent.description, /External resource/u);
});

test("normalizes the remaining live escaped punctuation and vetted source links", () => {
  const autismState = createApolloState();
  autismState[EVENT_REF].description = `Summary:
Welcome to the general introduction study series: Autism!

\\- https://cambridgecognition\\.com/autism\\-spectrum\\-disorder/

**Please ensure to listen to the two lectures below prior to the meetup:*

**90\\| Autism: The Big Picture – A Conversation With Sir Simon Baron\\-Cohen**`;
  const autism = parseMeetupGroupEventsPage(
    createHtml(autismState),
    GROUP_SLUG,
  ).events[0].publicContent;
  const autismSourceBlock = autism.descriptionBlocks.find(
    (block) => "items" in block,
  );
  assert.deepEqual(autismSourceBlock, {
    items: [
      [
        {
          href: "https://cambridgecognition.com/autism-spectrum-disorder/",
          text: "Open cambridgecognition.com",
          type: "link",
        },
      ],
    ],
    type: "unordered-list",
  });
  assert.match(
    autism.description,
    /Please ensure to listen to the two lectures below prior to the meetup:/u,
  );
  assert.match(autism.description, /90\| Autism:.*Simon Baron-Cohen/u);
  assert.doesNotMatch(autism.description, /External resource|\\[-.|]|\*\*Please/u);

  const cinemaState = createApolloState();
  cinemaState[EVENT_REF].description = `The Notebook under the stars is an outdoor cultural outing.

Official Evo Summer Cinema details:
https://summercinema.ca/

Free general admission — first come, first served.`;
  const cinema = parseMeetupGroupEventsPage(
    createHtml(cinemaState),
    GROUP_SLUG,
  ).events[0].publicContent;
  assert.deepEqual(cinema.descriptionBlocks[1], {
    content: [
      {
        href: "https://summercinema.ca/",
        text: "Official Evo Summer Cinema details",
        type: "link",
      },
    ],
    type: "paragraph",
  });
  assert.doesNotMatch(cinema.description, /External resource/u);
});

test("retains the exact September documentary and magazine source links", () => {
  for (const sourceUrl of [
    "https://www.pbs.org/pov/films/mindingthegap/",
    "https://www.vogue.com/article/on-the-podcast-behind-chloe-malles-first-september-issue",
  ]) {
    const state = createApolloState();
    state[EVENT_REF].description = `Discussion material to review before the event.

Official source page:
[${sourceUrl}](${sourceUrl})

Review the source beforehand and come ready to discuss it.`;
    const publicContent = parseMeetupGroupEventsPage(
      createHtml(state),
      GROUP_SLUG,
    ).events[0].publicContent;
    const links = publicContent.descriptionBlocks
      .flatMap((block) =>
        "content" in block ? block.content : "items" in block ? block.items.flat() : [],
      )
      .filter((inline) => inline.type === "link");
    assert.deepEqual(links, [
      {
        href: sourceUrl,
        text: "Official source page",
        type: "link",
      },
    ]);
    assert.doesNotMatch(publicContent.description, /External resource/u);
  }
});

test("keeps source spacing without emitting whitespace-only description inlines", () => {
  const state = createApolloState();
  state[EVENT_REF].description = `Quarry Rock sunset hike and dinner.

- **What** **to bring**: water, sturdy shoes, and a light layer.`;

  const publicContent = parseMeetupGroupEventsPage(
    createHtml(state),
    GROUP_SLUG,
  ).events[0].publicContent;
  const list = publicContent.descriptionBlocks.find(
    (block) => block.type === "unordered-list",
  );
  assert.deepEqual(list.items[0], [
    { text: "What ", type: "strong" },
    { text: "to bring", type: "strong" },
    { text: ": water, sturdy shoes, and a light layer.", type: "text" },
  ]);
  assert.equal(
    list.items[0].some((inline) => inline.text.trim().length === 0),
    false,
  );
  assert.doesNotThrow(() =>
    validateMeetupDescriptionBlocks(publicContent.descriptionBlocks),
  );
  assert.match(publicContent.description, /What to bring: water/u);
});

test("new public-description hosts remain exact and fail closed", () => {
  for (const unsafeUrl of [
    "http://deepcovekayak.com/lesson/intro-to-sup/",
    "https://user@deepcovekayak.com/lesson/intro-to-sup/",
    "https://deepcovekayak.com:444/lesson/intro-to-sup/",
    "https://deepcovekayak.com.attacker.invalid/lesson/intro-to-sup/",
    "https://deepcovekayak.com/lesson/intro-to-sup/?offer=private",
    "https://www.pbs.org.attacker.invalid/pov/films/mindingthegap/",
    "https://www.vogue.com/article/on-the-podcast-behind-chloe-malles-first-september-issue?private=1",
  ]) {
    const state = createApolloState();
    state[EVENT_REF].description =
      `A public paddleboarding description with enough detail.\n\n${unsafeUrl}`;
    try {
      const content = parseMeetupGroupEventsPage(
        createHtml(state),
        GROUP_SLUG,
      ).events[0].publicContent;
      assert.doesNotMatch(
        JSON.stringify(content.descriptionBlocks),
        /"type":"link"/u,
        unsafeUrl,
      );
    } catch (error) {
      assert.equal(error instanceof MeetupSyncError, true, unsafeUrl);
      assert.equal(error.code, "calendar_invalid", unsafeUrl);
    }
  }
});

test("fetches the canonical group page then the complete public GraphQL inventory", async () => {
  const state = createApolloState();
  setPrimaryConnectionPagination(state, {
    endCursor: null,
    hasNextPage: false,
    totalCount: 1,
  });
  const html = createHtml(state);
  const observed = [];
  const parsed = await fetchMeetupGroupEvents(GROUP_SLUG, {
    fetcher: async (url, init) => {
      observed.push({ init, url });
      return observed.length === 1
        ? new Response(html, {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          })
        : graphqlResponse({ events: [createGraphqlEventNode()] });
    },
  });

  assert.equal(
    observed[0].url,
    `https://www.meetup.com/${GROUP_SLUG}/events/`,
  );
  assert.equal(observed[0].init.cache, "no-store");
  assert.equal(observed[0].init.redirect, "manual");
  assert.equal(
    observed[0].init.headers.get("accept"),
    "text/html,application/xhtml+xml",
  );
  assert.equal(observed[1].url, "https://api.meetup.com/gql-ext");
  assert.equal(observed[1].init.method, "POST");
  assert.equal(observed[1].init.redirect, "manual");
  assert.equal(observed[1].init.headers.get("accept"), "application/json");
  assert.equal(observed[1].init.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(observed[1].init.body).variables, {
    after: null,
    afterDateTime: FUTURE_AFTER,
    urlname: GROUP_SLUG,
  });
  assert.equal(parsed.events[0].eventUrl, EVENT_URL);
  assert.equal(parsed.events[0].publicContent.capacity, 8);
  assert.equal(parsed.events[0].publicContent.availabilityState, "waitlist");
  assert.equal(parsed.events[0].publicContent.waitlistAvailable, true);
});

test("follows every GraphQL cursor with one fixed cutoff and stable totals", async () => {
  const state = createApolloState();
  setPrimaryConnectionPagination(state, {
    endCursor: "html-cursor",
    hasNextPage: true,
    totalCount: 3,
  });
  const requests = [];
  const parsed = await fetchMeetupGroupEvents(GROUP_SLUG, {
    fetcher: async (url, init) => {
      if (url !== "https://api.meetup.com/gql-ext") {
        return new Response(createHtml(state), {
          headers: { "content-type": "text/html" },
          status: 200,
        });
      }
      const variables = JSON.parse(init.body).variables;
      requests.push(variables);
      return variables.after === null
        ? graphqlResponse({
            endCursor: "cursor-one",
            events: [
              createGraphqlEventNode(),
              createGraphqlEventNode({
                dateTime: "2026-08-13T18:00:00-07:00",
                endTime: "2026-08-13T20:00:00-07:00",
                eventId: "316010051",
              }),
            ],
            hasNextPage: true,
            totalCount: 3,
          })
        : graphqlResponse({
            events: [
              createGraphqlEventNode({
                dateTime: "2026-08-14T18:00:00-07:00",
                endTime: "2026-08-14T20:00:00-07:00",
                eventId: "316010052",
              }),
            ],
            totalCount: 3,
          });
    },
  });

  assert.deepEqual(requests, [
    { after: null, afterDateTime: FUTURE_AFTER, urlname: GROUP_SLUG },
    { after: "cursor-one", afterDateTime: FUTURE_AFTER, urlname: GROUP_SLUG },
  ]);
  assert.deepEqual(
    parsed.events.map((event) => event.uid),
    [
      `event_${EVENT_ID}@meetup.com`,
      "event_316010051@meetup.com",
      "event_316010052@meetup.com",
    ],
  );
});

test("does not advertise waitlists before RSVP opens or after RSVP closes", async () => {
  const state = createApolloState();
  setPrimaryConnectionPagination(state, {
    endCursor: null,
    hasNextPage: false,
    totalCount: 3,
  });
  const parsed = await fetchMeetupGroupEvents(GROUP_SLUG, {
    fetcher: async (url) =>
      url === "https://api.meetup.com/gql-ext"
        ? graphqlResponse({
            events: [
              createGraphqlEventNode({
                description: "Public event description. Waitlist: available.",
                rsvpState: "CLOSED",
                waitlistCount: 4,
              }),
              createGraphqlEventNode({
                dateTime: "2026-08-13T18:00:00-07:00",
                endTime: "2026-08-13T20:00:00-07:00",
                eventId: "316010051",
                rsvpState: "NOT_OPEN_YET",
              }),
              createGraphqlEventNode({
                dateTime: "2026-08-14T18:00:00-07:00",
                description: "Public event description. Cap: 8.",
                endTime: "2026-08-14T20:00:00-07:00",
                eventId: "316010052",
                maxTickets: 0,
                waitlistCount: 0,
              }),
            ],
          })
        : new Response(createHtml(state), {
            headers: { "content-type": "text/html" },
            status: 200,
          }),
  });

  for (const event of parsed.events.slice(0, 2)) {
    assert.equal(event.publicContent.capacity, 8);
    assert.equal(event.publicContent.availabilityState, null);
    assert.equal(event.publicContent.waitlistAvailable, null);
  }
  assert.equal(parsed.events[2].publicContent.capacity, null);
  assert.equal(parsed.events[2].publicContent.availabilityState, "open");
  assert.equal(parsed.events[2].publicContent.waitlistAvailable, null);
});

test("rejects partial or drifting GraphQL pagination without returning a calendar", async () => {
  const state = createApolloState();
  setPrimaryConnectionPagination(state, {
    endCursor: "html-cursor",
    hasNextPage: true,
    totalCount: 2,
  });
  for (const secondPage of [
    graphqlResponse({ events: [], totalCount: 2 }),
    graphqlResponse({
      events: [createGraphqlEventNode({ eventId: "316010051" })],
      totalCount: 3,
    }),
    new Response(JSON.stringify({ errors: [{ message: "source failure" }] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  ]) {
    let page = 0;
    await assert.rejects(
      fetchMeetupGroupEvents(GROUP_SLUG, {
        fetcher: async (url) => {
          if (url !== "https://api.meetup.com/gql-ext") {
            return new Response(createHtml(state), {
              headers: { "content-type": "text/html" },
              status: 200,
            });
          }
          page += 1;
          return page === 1
            ? graphqlResponse({
                endCursor: "cursor-one",
                events: [createGraphqlEventNode()],
                hasNextPage: true,
                totalCount: 2,
              })
            : secondPage;
        },
      }),
      (error) =>
        error instanceof MeetupSyncError && error.code === "calendar_invalid",
    );
  }
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

function createApolloState({
  eventRefs = [EVENT_REF],
  futureConnections,
} = {}) {
  const resolvedFutureConnections = futureConnections ?? [
    {
      eventRefs,
      statuses: ["ACTIVE", "PAST", "CANCELLED"],
    },
  ];
  const futureConnectionState = Object.fromEntries(
    resolvedFutureConnections.map(
      ({ afterDateTime = FUTURE_AFTER, eventRefs: refs, statuses }) => [
        `events(${JSON.stringify({
          filter: { afterDateTime, status: statuses },
          first: 30,
          sort: "ASC",
        })})`,
        {
          __typename: "GroupEventConnection",
          edges: refs.map((eventRef) => ({
            __typename: "EventEdge",
            node: { __ref: eventRef },
          })),
          pageInfo: { __typename: "PageInfo", hasNextPage: true },
          totalCount: Math.max(68, refs.length),
        },
      ],
    ),
  );
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
      ...futureConnectionState,
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

function addEvent(
  state,
  {
    dateTime = "2026-08-12T18:00:00-07:00",
    endTime = "2026-08-12T20:00:00-07:00",
    eventId,
    status,
    title = "Additional source event",
  },
) {
  state[`Event:${eventId}`] = {
    ...state[EVENT_REF],
    dateTime,
    endTime,
    eventUrl: `https://www.meetup.com/${GROUP_SLUG}/events/${eventId}/`,
    id: eventId,
    status,
    title,
  };
}

function setPrimaryConnectionPagination(
  state,
  { endCursor, hasNextPage, totalCount },
) {
  const connectionKey = Object.keys(state[GROUP_REF]).find((key) =>
    key.startsWith("events("),
  );
  assert.ok(connectionKey);
  state[GROUP_REF][connectionKey].pageInfo = {
    __typename: "PageInfo",
    endCursor,
    hasNextPage,
  };
  state[GROUP_REF][connectionKey].totalCount = totalCount;
}

function createGraphqlEventNode({
  dateTime = "2026-08-12T18:00:00-07:00",
  description = "## Why come?\n\nBring **curiosity** and join the public discussion.",
  endTime = "2026-08-12T20:00:00-07:00",
  eventId = EVENT_ID,
  maxTickets = 8,
  rsvpState = "JOIN_OPEN",
  waitlistCount = 2,
} = {}) {
  return {
    __typename: "Event",
    dateTime,
    description,
    displayPhoto: {
      __typename: "PhotoInfo",
      highResUrl: POSTER_URL,
      id: POSTER_ID,
    },
    endTime,
    eventType: "PHYSICAL",
    eventUrl: `https://www.meetup.com/${GROUP_SLUG}/events/${eventId}/`,
    featuredEventPhoto: {
      __typename: "PhotoInfo",
      highResUrl: POSTER_URL,
      id: POSTER_ID,
    },
    group: { __typename: "Group", id: GROUP_REF.split(":")[1] },
    id: eventId,
    maxTickets,
    rsvpSettings: { rsvpsClosed: false },
    rsvpState,
    status: "ACTIVE",
    title: "GraphQL source event",
    venue: {
      __typename: "Venue",
      address: "350 West Georgia Street",
      city: "Vancouver",
      id: "25956902",
      name: "Vancouver Central Library",
      state: "BC",
    },
    waitlistMode: "AUTO",
    waitlistRsvps: { totalCount: waitlistCount },
    yesRsvps: { totalCount: 8 },
  };
}

function graphqlResponse({
  endCursor = null,
  events,
  hasNextPage = false,
  totalCount = events.length,
}) {
  return new Response(
    JSON.stringify({
      data: {
        groupByUrlname: {
          __typename: "Group",
          events: {
            __typename: "GroupEventConnection",
            edges: events.map((event) => ({
              __typename: "EventEdge",
              node: event,
            })),
            pageInfo: {
              __typename: "PageInfo",
              endCursor,
              hasNextPage,
            },
            totalCount,
          },
          id: GROUP_REF.split(":")[1],
          name: "Vancouver Curiosity Club",
          timezone: "America/Vancouver",
          urlname: GROUP_SLUG,
        },
      },
    }),
    {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    },
  );
}

function relabelPrimaryMeetupEvent(state, { eventId, groupSlug }) {
  const eventRef = `Event:${eventId}`;
  state[eventRef] = {
    ...state[EVENT_REF],
    eventUrl: `https://www.meetup.com/${groupSlug}/events/${eventId}/`,
    id: eventId,
  };
  delete state[EVENT_REF];

  for (const connection of Object.values(state[GROUP_REF])) {
    if (!connection || typeof connection !== "object" || !Array.isArray(connection.edges)) {
      continue;
    }
    for (const edge of connection.edges) {
      if (edge?.node?.__ref === EVENT_REF) edge.node.__ref = eventRef;
    }
  }
  state[GROUP_REF].urlname = groupSlug;
  delete state.ROOT_QUERY[`groupByUrlname:{"urlname":"${GROUP_SLUG}"}`];
  state.ROOT_QUERY[`groupByUrlname:{"urlname":"${groupSlug}"}`] = {
    __ref: GROUP_REF,
  };
  return eventRef;
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
