import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import {
  CURATED_MEETUP_EVENT_ENRICHMENTS,
  curatedMeetupEventForEventUrl,
  validateCuratedMeetupEventCandidate,
} from "../../lib/meetup-event-enrichment.ts";
import {
  CURATED_MEETUP_EVENT_POSTERS,
  CURATED_MEETUP_POSTER_SOURCE_OVERRIDES,
  curatedMeetupPosterForEventUrl,
  curatedMeetupPosterForSourceUrl,
} from "../../lib/meetup-event-posters.ts";
import {
  toPublicEventCardDto,
  toPublicEventDetailDto,
} from "../../lib/server/public/events.ts";
import { canonicalMeetupEventUrlForAlias } from "../../lib/server/meetup/event-aliases.ts";

function descriptionInlines(blocks) {
  return blocks.flatMap((block) =>
    block.type === "ordered-list" || block.type === "unordered-list"
      ? block.items.flat()
      : block.content,
  );
}

const EXPECTED_ENRICHMENT_EVENT_IDS = Object.freeze([
  "315294572",
  "315294577",
  "315294587",
  "315508432",
  "315508537",
  "315510842",
  "315511475",
  "315511480",
  "315511485",
  "315560589",
  "315561268",
  "315592402",
  "315675534",
  "315675704",
  "315723559",
  "315772444",
  "315772533",
  "315772658",
  "315772775",
  "315772811",
  "315772829",
  "315772917",
  "315777434",
  "315793227",
  "315823022",
  "315823081",
  "315823229",
  "315823623",
  "315837612",
  "315837649",
  "315851485",
  "315851495",
  "315886330",
  "315892763",
  "315936856",
  "315961874",
  "315962265",
  "315963468",
  "315969091",
  "315976207",
  "315993304",
  "316010049",
]);

const EXPECTED_CATEGORY_FALLBACK_EVENT_IDS = Object.freeze([]);

test("the current published Meetup events use bundled poster copies", async () => {
  const posters = Object.values(CURATED_MEETUP_EVENT_POSTERS);
  const expectedPosterEventIds = EXPECTED_ENRICHMENT_EVENT_IDS.filter(
    (eventId) => !EXPECTED_CATEGORY_FALLBACK_EVENT_IDS.includes(eventId),
  );
  assert.deepEqual(
    posters.map((poster) => poster.eventId).sort(),
    expectedPosterEventIds,
  );

  for (const poster of posters) {
    const enrichment = CURATED_MEETUP_EVENT_ENRICHMENTS[poster.eventId];
    assert.ok(enrichment, poster.eventId);
    assert.ok(enrichment.poster, poster.eventId);
    for (const [localPath, expectedWidth, expectedHeight] of [
      [poster.smallPath, poster.smallWidth, poster.smallHeight],
      [poster.mediumPath, poster.mediumWidth, poster.mediumHeight],
      [poster.localPath, poster.width, poster.height],
    ]) {
      const bytes = await readFile(
        new URL(`../../public${localPath}`, import.meta.url),
      );
      assert.equal(bytes[0], 0xff, `${poster.eventId}:${localPath}`);
      assert.equal(bytes[1], 0xd8, `${poster.eventId}:${localPath}`);
      assert.equal(
        bytes[bytes.length - 2],
        0xff,
        `${poster.eventId}:${localPath}`,
      );
      assert.equal(
        bytes[bytes.length - 1],
        0xd9,
        `${poster.eventId}:${localPath}`,
      );
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.width, expectedWidth, localPath);
      assert.equal(metadata.height, expectedHeight, localPath);
    }
    assert.equal(poster.width, Math.min(1_600, enrichment.poster.sourceWidth));
    assert.equal(
      poster.smallWidth,
      Math.min(480, enrichment.poster.sourceWidth),
      poster.eventId,
    );
    assert.equal(
      poster.mediumWidth,
      Math.min(960, enrichment.poster.sourceWidth),
      poster.eventId,
    );
    assert.match(
      poster.sourceUrl,
      /^https:\/\/secure\.meetupstatic\.com\/photos\/event\/.+\/highres_/u,
      poster.eventId,
    );
    assert.equal(
      curatedMeetupPosterForEventUrl(enrichment.eventUrl),
      poster,
      poster.eventId,
    );
  }

  const managedPosterFiles = (await readdir(
    new URL("../../public/event-posters/", import.meta.url),
  )).filter((filename) =>
    /^meetup-[0-9]+(?:-(?:480|960))?\.jpeg$/u.test(filename),
  ).sort();
  const expectedManagedPosterFiles = posters.flatMap((poster) => [
    poster.localPath.split("/").at(-1),
    poster.mediumPath.split("/").at(-1),
    poster.smallPath.split("/").at(-1),
  ]).sort();
  assert.deepEqual(managedPosterFiles, expectedManagedPosterFiles);

  assert.equal(
    curatedMeetupPosterForEventUrl(
      "https://www.meetup.com/owner-controlled-group/events/999999999/",
    ),
    null,
  );
  assert.equal(
    curatedMeetupPosterForEventUrl(
      "https://attacker.invalid/group/events/315772533/",
    ),
    null,
  );
  assert.equal(
    curatedMeetupPosterForEventUrl(
      "https://www.meetup.com/wrong-group/events/315772533/",
    ),
    null,
  );
});

test("event details do not enlarge a copied poster beyond its verified source width", async () => {
  const renderer = await readFile(
    new URL(
      "../../app/_components/PublicEventDetailRenderer.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    renderer,
    /maxWidth:\s*`\$\{event\.artwork\.dimensions\.large\.width\}px`/u,
  );
  assert.match(renderer, /marginInline:\s*"auto"/u);
});

test("the Cicero listing resolves to its real local poster", () => {
  const poster = curatedMeetupPosterForEventUrl(
    "https://www.meetup.com/vancouver-literature-and-film/events/315772533/",
  );
  assert.ok(poster);
  assert.deepEqual(
    {
      height: poster.height,
      localPath: poster.localPath,
      width: poster.width,
    },
    {
      height: 900,
      localPath: "/event-posters/meetup-315772533.jpeg",
      width: 1600,
    },
  );
  assert.match(poster.altText, /Cicero/u);
});

test("a public Meetup event card uses its curated poster before category fallback art", () => {
  const card = toPublicEventCardDto({
    all_day_end_date_exclusive: null,
    all_day_start_date: null,
    artwork_usage_count: 0,
    attendance_mode: "location_undecided",
    category_color_token: null,
    category_name: null,
    category_slug: null,
    club_name: "Vancouver Literature and Film",
    club_slug: "vancouver-literature-and-film",
    ends_at_utc: Date.parse("2026-08-02T20:00:00.000Z"),
    event_status: "confirmed",
    lane_name: "Think",
    lane_slug: "think",
    program_name: null,
    program_slug: null,
    public_slug_count: 1,
    rsvp_mode: "meetup",
    rsvp_url:
      "https://www.meetup.com/vancouver-literature-and-film/events/315772533/",
    slug: "cicero-on-friendship",
    starts_at_utc: Date.parse("2026-08-02T18:00:00.000Z"),
    summary: null,
    time_kind: "timed",
    timezone: "America/Vancouver",
    title: "Cicero on Friendship",
    venue_public_address: null,
    venue_public_name: null,
  });

  assert.equal(
    card.artwork?.url,
    "/event-posters/meetup-315772533.jpeg",
  );
  assert.match(card.artwork?.altText ?? "", /Cicero.+On Friendship/u);
  assert.equal(card.attendanceMode, "in-person");
  assert.equal(card.venue?.name, "Vancouver Central Library");
  assert.deepEqual(card.artwork?.dimensions.small, {
    height: 270,
    width: 480,
  });
  assert.deepEqual(card.artwork?.dimensions.medium, {
    height: 540,
    width: 960,
  });
  assert.match(card.summary ?? "", /Friendship is one of those words/u);
  assert.deepEqual(card.venue, {
    address: "350 West Georgia Street, Vancouver, BC",
    floor: "8th floor",
    name: "Vancouver Central Library",
    room: null,
  });
  assert.doesNotMatch(
    JSON.stringify(card),
    /sourceUrl|secure\.meetupstatic\.com/iu,
  );
});

test("a curated Meetup event prefers its bundled poster over a synchronized poster route", () => {
  const card = toPublicEventCardDto({
    all_day_end_date_exclusive: null,
    all_day_start_date: null,
    artwork_usage_count: 0,
    attendance_mode: "in_person",
    category_color_token: null,
    category_name: null,
    category_slug: null,
    club_name: "Vancouver Literature and Film",
    club_slug: "vancouver-literature-and-film",
    ends_at_utc: Date.parse("2026-08-08T06:15:00.000Z"),
    event_status: "confirmed",
    lane_name: "Think",
    lane_slug: "think",
    meetup_poster_alt_text: "Synchronized Meetup poster alt text",
    meetup_poster_credit: "Synchronized Meetup poster credit",
    meetup_poster_source_url:
      "https://secure.meetupstatic.com/photos/event/e/3/d/9/highres_535018329.jpeg",
    program_name: null,
    program_slug: null,
    public_slug_count: 1,
    rsvp_mode: "meetup",
    rsvp_url:
      "https://www.meetup.com/vancouver-literature-and-film/events/315508432/",
    slug: "princess-mononoke",
    starts_at_utc: Date.parse("2026-08-08T03:45:00.000Z"),
    summary: null,
    time_kind: "timed",
    timezone: "America/Vancouver",
    title: "Princess Mononoke",
    venue_public_address: null,
    venue_public_name: null,
  });

  assert.deepEqual(card.artwork?.srcSet, {
    large: "/event-posters/meetup-315508432.jpeg",
    medium: "/event-posters/meetup-315508432-960.jpeg",
    small: "/event-posters/meetup-315508432-480.jpeg",
  });
  assert.equal(card.artwork?.url, "/event-posters/meetup-315508432.jpeg");
  assert.match(card.artwork?.altText ?? "", /Princess Mononoke/u);
  assert.doesNotMatch(
    JSON.stringify(card.artwork),
    /meetup-posters|Synchronized Meetup poster/iu,
  );
});

test("reported recurring mobile cards reuse verified first-party poster copies", async () => {
  const reportedEvents = [
    {
      eventId: "315081514",
      photoId: "533159115",
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/e/6/e/b/highres_533159115.jpeg",
      title: "Meditation + Journaling Circle",
    },
    {
      eventId: "315081515",
      photoId: "533159115",
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/e/6/e/b/highres_533159115.jpeg",
      title: "Meditation + Journaling Circle",
    },
    {
      eventId: "315785787",
      photoId: "535044448",
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/5/f/8/0/highres_535044448.jpeg",
      title: "Sketching and socializing at Riley Park",
    },
    {
      eventId: "315913931",
      photoId: "535044448",
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/5/f/8/0/highres_535044448.jpeg",
      title: "Sketching and socializing at Riley Park",
    },
    {
      eventId: "316023162",
      photoId: "535553384",
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/d/0/8/8/highres_535553384.jpeg",
      title: "Mangos Latin Dance Night",
    },
  ];

  assert.equal(
    Object.keys(CURATED_MEETUP_POSTER_SOURCE_OVERRIDES).length,
    5,
  );
  for (const event of reportedEvents) {
    const card = toPublicEventCardDto({
      all_day_end_date_exclusive: null,
      all_day_start_date: null,
      artwork_usage_count: 0,
      attendance_mode: "in_person",
      category_color_token: null,
      category_name: null,
      category_slug: null,
      club_name: "Vancouver Curiosity Club",
      club_slug: "vancouver-curiosity-club",
      ends_at_utc: Date.parse("2026-08-16T07:30:00.000Z"),
      event_status: "confirmed",
      lane_name: "Think",
      lane_slug: "think",
      meetup_poster_alt_text: `${event.title} event poster.`,
      meetup_poster_credit: "Vancouver Curiosity Club event poster via Meetup",
      meetup_poster_source_url: event.sourceUrl,
      program_name: null,
      program_slug: null,
      public_slug_count: 1,
      rsvp_mode: "meetup",
      rsvp_url: `https://www.meetup.com/vancouver-meetup-group/events/${event.eventId}/`,
      slug: `reported-${event.eventId}`,
      starts_at_utc: Date.parse("2026-08-16T04:30:00.000Z"),
      summary: "A current Vancouver Curiosity Club gathering.",
      time_kind: "timed",
      timezone: "America/Vancouver",
      title: event.title,
      venue_public_address: "Vancouver, BC",
      venue_public_name: "Public venue",
    });
    const expectedSrcSet = {
      large: `/event-posters/meetup-photo-${event.photoId}.jpeg`,
      medium: `/event-posters/meetup-photo-${event.photoId}-960.jpeg`,
      small: `/event-posters/meetup-photo-${event.photoId}-480.jpeg`,
    };

    assert.deepEqual(card.artwork?.srcSet, expectedSrcSet, event.title);
    assert.equal(card.artwork?.url, expectedSrcSet.large, event.title);
    assert.equal(
      curatedMeetupPosterForSourceUrl(event.sourceUrl),
      CURATED_MEETUP_POSTER_SOURCE_OVERRIDES[event.sourceUrl],
    );
    assert.doesNotMatch(
      JSON.stringify(card.artwork),
      /\/meetup-posters\//u,
      event.title,
    );

    for (const localPath of Object.values(expectedSrcSet)) {
      const bytes = await readFile(
        new URL(`../../public${localPath}`, import.meta.url),
      );
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, "jpeg", `${event.title}:${localPath}`);
      assert.ok(metadata.width >= 480, `${event.title}:${localPath}`);
      assert.ok(metadata.height >= 270, `${event.title}:${localPath}`);
    }
  }

  assert.equal(
    curatedMeetupPosterForSourceUrl(
      "https://secure.meetupstatic.com/photos/event/e/6/e/b/highres_533159115.jpeg?attacker=1",
    ),
    null,
  );
});

test("canonical cross-post cards use bundled poster copies after alias resolution", async () => {
  const canonicalEvents = [
    {
      aliasId: "315776403",
      canonicalId: "315776148",
      photoId: "535306516",
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/b/5/b/4/highres_535306516.jpeg",
      title:
        "Princess Mononoke - can humans build without destroying something sacred?",
    },
    {
      aliasId: "315511487",
      canonicalId: "315510890",
      photoId: "535020979",
      sourceUrl:
        "https://secure.meetupstatic.com/photos/event/3/d/3/highres_535020979.jpeg",
      title:
        "Eyes Wide Shut - marriage, desire, and rich-people nightmare rituals",
    },
  ];

  for (const event of canonicalEvents) {
    const canonicalUrl =
      `https://www.meetup.com/vancouver-literature-and-film/events/${event.canonicalId}/`;
    assert.equal(
      canonicalMeetupEventUrlForAlias(
        `https://www.meetup.com/vancouver-meetup-group/events/${event.aliasId}/`,
      ),
      canonicalUrl,
    );
    const card = toPublicEventCardDto({
      all_day_end_date_exclusive: null,
      all_day_start_date: null,
      artwork_usage_count: 0,
      attendance_mode: "in_person",
      category_color_token: null,
      category_name: null,
      category_slug: null,
      club_name: "Vancouver Literature and Film",
      club_slug: "vancouver-literature-and-film",
      ends_at_utc: Date.parse("2026-08-24T02:00:00.000Z"),
      event_status: "confirmed",
      lane_name: "Think",
      lane_slug: "think",
      meetup_poster_alt_text: `${event.title} event poster.`,
      meetup_poster_credit: "Vancouver Curiosity Club event poster via Meetup",
      meetup_poster_source_url: event.sourceUrl,
      program_name: null,
      program_slug: null,
      public_slug_count: 1,
      rsvp_mode: "meetup",
      rsvp_url: canonicalUrl,
      slug: `canonical-${event.canonicalId}`,
      starts_at_utc: Date.parse("2026-08-23T20:00:00.000Z"),
      summary: "A canonical Vancouver Literature and Film gathering.",
      time_kind: "timed",
      timezone: "America/Vancouver",
      title: event.title,
      venue_public_address: "Vancouver, BC",
      venue_public_name: "Public venue",
    });
    const expectedSrcSet = {
      large: `/event-posters/meetup-photo-${event.photoId}.jpeg`,
      medium: `/event-posters/meetup-photo-${event.photoId}-960.jpeg`,
      small: `/event-posters/meetup-photo-${event.photoId}-480.jpeg`,
    };

    assert.deepEqual(card.artwork?.srcSet, expectedSrcSet, event.title);
    assert.equal(card.artwork?.url, expectedSrcSet.large, event.title);
    assert.doesNotMatch(
      JSON.stringify(card.artwork),
      /\/meetup-posters\//u,
      event.title,
    );
    for (const [localPath, expectedWidth, expectedHeight] of [
      [expectedSrcSet.small, 480, 270],
      [expectedSrcSet.medium, 960, 540],
      [expectedSrcSet.large, 1_600, 900],
    ]) {
      const bytes = await readFile(
        new URL(`../../public${localPath}`, import.meta.url),
      );
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, "jpeg", `${event.title}:${localPath}`);
      assert.equal(metadata.width, expectedWidth, `${event.title}:${localPath}`);
      assert.equal(metadata.height, expectedHeight, `${event.title}:${localPath}`);
    }
  }
});

test("verified Meetup content fills only missing public fields", () => {
  const base = {
    all_day_end_date_exclusive: null,
    all_day_start_date: null,
    artwork_usage_count: 0,
    attendance_mode: "in_person",
    category_color_token: null,
    category_name: null,
    category_slug: null,
    club_name: "Vancouver Literature and Film",
    club_slug: "vancouver-literature-and-film",
    ends_at_utc: Date.parse("2026-08-02T20:00:00.000Z"),
    event_status: "confirmed",
    lane_name: "Think",
    lane_slug: "think",
    organizer_names_json: "[]",
    program_name: null,
    program_slug: null,
    public_slug_count: 1,
    rsvp_mode: "meetup",
    rsvp_url:
      "https://www.meetup.com/vancouver-literature-and-film/events/315772533/",
    slug: "cicero-on-friendship",
    starts_at_utc: Date.parse("2026-08-02T18:00:00.000Z"),
    summary: null,
    description: null,
    time_kind: "timed",
    timezone: "America/Vancouver",
    title: "Cicero on Friendship",
    venue_public_address: null,
    venue_public_name: null,
  };
  const detail = toPublicEventDetailDto(base);
  assert.match(detail.description ?? "", /Do we love our friends/u);
  assert.doesNotMatch(detail.description ?? "", /https?:\/\/|@/u);
  assert.ok(detail.descriptionBlocks?.length);

  const ownerAuthored = toPublicEventDetailDto({
    ...base,
    description: "Owner-authored public description.",
    summary: "Owner-authored public summary.",
    venue_public_address: "Owner-authored public address",
    venue_public_name: "Owner-authored public venue",
  });
  assert.equal(ownerAuthored.description, "Owner-authored public description.");
  assert.equal(ownerAuthored.descriptionBlocks, null);
  assert.equal(ownerAuthored.summary, "Owner-authored public summary.");
  assert.deepEqual(ownerAuthored.venue, {
    address: "Owner-authored public address",
    floor: null,
    name: "Owner-authored public venue",
    room: null,
  });
});

function wednesdayResetProjectionRow() {
  return {
    all_day_end_date_exclusive: null,
    all_day_start_date: null,
    arrival_instructions: null,
    artwork_usage_count: 0,
    attendance_mode: "in_person",
    availability_state: null,
    capacity: null,
    category_color_token: null,
    category_name: null,
    category_slug: null,
    club_name: "Vancouver Curiosity Club",
    club_slug: "vancouver-curiosity-club",
    description: null,
    ends_at_utc: Date.parse("2026-08-13T03:00:00.000Z"),
    event_status: "confirmed",
    lane_name: "Reset & Make",
    lane_slug: "reset-and-make",
    organizer_names_json: "[]",
    program_name: null,
    program_slug: null,
    public_slug_count: 1,
    rsvp_mode: "meetup",
    rsvp_url:
      "https://www.meetup.com/vancouver-meetup-group/events/316010049/",
    slug: "wednesday-night-reset",
    starts_at_utc: Date.parse("2026-08-13T01:00:00.000Z"),
    summary: null,
    time_kind: "timed",
    timezone: "America/Vancouver",
    title: "Wednesday Night Reset",
    venue_public_address: null,
    venue_public_name: null,
  };
}

test("Wednesday Night Reset enrichment stores its verified room and waitlist capacity", () => {
  const eventUrl =
    "https://www.meetup.com/vancouver-meetup-group/events/316010049/";
  const enrichment = curatedMeetupEventForEventUrl(eventUrl);
  assert.ok(enrichment);
  assert.deepEqual(
    {
      arrivalInstructions: enrichment.arrivalInstructions,
      availabilityState: enrichment.availabilityState,
      capacity: enrichment.capacity,
      floor: enrichment.publicFloor,
      room: enrichment.publicRoom,
      waitlistAvailable: enrichment.waitlistAvailable,
    },
    {
      arrivalInstructions: "Please arrive on time so we can begin together.",
      availabilityState: null,
      capacity: 12,
      floor: "Level 4",
      room: "Room 492 South",
      waitlistAvailable: true,
    },
  );
});

test("Wednesday Night Reset structured facts survive card and detail projections", () => {
  const row = wednesdayResetProjectionRow();
  const card = toPublicEventCardDto(row);
  const detail = toPublicEventDetailDto(row);

  for (const [surface, event] of [
    ["card", card],
    ["detail", detail],
  ]) {
    assert.deepEqual(
      {
        availabilityState: event.availabilityState,
        capacity: event.capacity,
        floor: event.venue?.floor,
        room: event.venue?.room,
        waitlistAvailable: event.waitlistAvailable,
      },
      {
        availabilityState: null,
        capacity: 12,
        floor: "Level 4",
        room: "Room 492 South",
        waitlistAvailable: true,
      },
      `${surface} projection lost the verified Meetup arrival facts`,
    );
  }
  assert.equal(
    detail.arrivalInstructions,
    "Please arrive on time so we can begin together.",
  );
});

test("the generated enrichment manifest is bounded and public safe", () => {
  const events = Object.values(CURATED_MEETUP_EVENT_ENRICHMENTS);
  assert.deepEqual(
    events.map((event) => event.eventId).sort(),
    EXPECTED_ENRICHMENT_EVENT_IDS,
  );
  for (const event of events) {
    assert.equal(curatedMeetupEventForEventUrl(event.eventUrl), event);
    assert.ok(event.summary.length >= 10 && event.summary.length <= 500);
    assert.ok(
      event.description.length >= 10 && event.description.length <= 20_000,
    );
    assert.ok(event.descriptionBlocks.length >= 1);
    for (const value of [
      event.summary,
      event.description,
      event.arrivalInstructions,
      event.poster?.altText,
      event.poster?.credit,
      event.venue?.name,
      event.venue?.address,
      event.venue?.city,
      event.venue?.floor,
      event.venue?.room,
      event.venue?.state,
    ].filter(Boolean)) {
      assert.doesNotMatch(
        value,
        /https?:\/\/|\bwww\.|@|passcode|password|access\s+code|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/iu,
      );
    }
    assert.ok(event.venue?.name);
    assert.ok(event.venue?.address);
    for (const inline of descriptionInlines(event.descriptionBlocks)) {
      assert.doesNotMatch(
        inline.text,
        /https?:\/\/|\bwww\.|@|passcode|password|access\s+code/iu,
      );
      if (inline.type === "link") {
        const parsed = new URL(inline.href);
        assert.equal(parsed.protocol, "https:");
        assert.equal(parsed.username, "");
        assert.equal(parsed.password, "");
        assert.doesNotMatch(
          parsed.hostname,
          /(?:zoom\.us|meet\.google|teams\.microsoft\.com|webex\.com|discord\.gg)$/iu,
        );
      }
    }
  }
  assert.deepEqual(
    events
      .filter((event) => event.poster === null)
      .map((event) => event.eventId)
      .sort(),
    EXPECTED_CATEGORY_FALLBACK_EVENT_IDS,
  );
});

test("every exact enrichment survives the public card and detail projections", () => {
  for (const event of Object.values(CURATED_MEETUP_EVENT_ENRICHMENTS)) {
    const row = {
      all_day_end_date_exclusive: null,
      all_day_start_date: null,
      artwork_usage_count: 0,
      attendance_mode: "in_person",
      category_color_token: null,
      category_name: null,
      category_slug: null,
      club_name: event.groupSlug,
      club_slug: event.groupSlug,
      ends_at_utc: Date.parse("2026-08-07T20:00:00.000Z"),
      event_status:
        event.eventId === "315823623" ? "cancelled" : "confirmed",
      lane_name: "Think",
      lane_slug: "think",
      organizer_names_json: "[]",
      program_name: null,
      program_slug: null,
      public_slug_count: 1,
      rsvp_mode: "meetup",
      rsvp_url: event.eventUrl,
      slug: `meetup-${event.eventId}`,
      starts_at_utc: Date.parse("2026-08-07T18:00:00.000Z"),
      summary: null,
      description: null,
      time_kind: "timed",
      timezone: "America/Vancouver",
      title: `Verified Meetup event ${event.eventId}`,
      venue_public_address: null,
      venue_public_name: null,
    };
    const card = toPublicEventCardDto(row);
    const detail = toPublicEventDetailDto(row);
    assert.equal(card.rsvpUrl, event.eventUrl, event.eventId);
    assert.equal(card.summary, event.summary, event.eventId);
    assert.equal(detail.description, event.description, event.eventId);
    assert.deepEqual(
      detail.descriptionBlocks,
      event.descriptionBlocks,
      event.eventId,
    );
    assert.equal(
      card.isCancelled,
      event.eventId === "315823623",
      event.eventId,
    );
    assert.deepEqual(
      card.venue,
      event.venue === null
        ? null
          : {
            address: [
              event.venue.address,
              event.venue.city,
              event.venue.state,
            ].filter(Boolean).join(", ") || null,
            floor: event.publicFloor,
            name: event.venue.name,
            room: event.publicRoom,
          },
      event.eventId,
    );
    if (event.poster === null) {
      assert.equal(card.artwork, null, event.eventId);
    } else {
      assert.equal(
        card.artwork?.url,
        event.poster.variants.large.localPath,
        event.eventId,
      );
    }
    assert.doesNotMatch(
      JSON.stringify({ card, detail }),
      /sourceUrl|secure\.meetupstatic\.com/iu,
      event.eventId,
    );
  }
});

test("unsafe curated summary and venue text is rejected at the runtime boundary", () => {
  const baseline = CURATED_MEETUP_EVENT_ENRICHMENTS["315772533"];
  assert.ok(baseline?.venue);
  for (const unsafe of [
    "https://private.invalid/meeting",
    "person@example.invalid",
    "Meeting access code 1234",
    "www.private.invalid/location",
    "Hidden\u0000room",
  ]) {
    assert.throws(
      () =>
        validateCuratedMeetupEventCandidate({
          ...baseline,
          venue: { ...baseline.venue, address: unsafe },
        }),
      /Invalid curated Meetup venue address/u,
    );
  }
  assert.throws(
    () =>
      validateCuratedMeetupEventCandidate({
        ...baseline,
        summary: "Join at https://private.invalid/meeting for this event.",
      }),
    /Invalid curated Meetup event summary/u,
  );
});

test("curated description links fail closed at the runtime boundary", () => {
  const baseline = CURATED_MEETUP_EVENT_ENRICHMENTS["315508432"];
  assert.ok(baseline);
  const descriptionBlocks = structuredClone(baseline.descriptionBlocks);
  const link = descriptionInlines(descriptionBlocks).find(
    (inline) => inline.type === "link",
  );
  assert.ok(link && link.type === "link");
  link.href = "https://zoom.us/j/123456?pwd=private";
  assert.throws(
    () =>
      validateCuratedMeetupEventCandidate({
        ...baseline,
        descriptionBlocks,
      }),
    /Invalid curated Meetup event description link/u,
  );
});

test("hidden or absent Meetup venues remain null while a public name may stand alone", () => {
  const baseline = CURATED_MEETUP_EVENT_ENRICHMENTS["315508432"];
  assert.ok(baseline);
  assert.equal(
    validateCuratedMeetupEventCandidate({
      ...baseline,
      publicFloor: null,
      publicRoom: null,
      venue: null,
    }).venue,
    null,
  );
  assert.equal(
    validateCuratedMeetupEventCandidate({
      ...baseline,
      publicFloor: null,
      publicRoom: null,
      venue: {
        address: "https://must-not-be-read.invalid/hidden",
        city: null,
        name: "",
        state: null,
      },
    }).venue,
    null,
  );
  assert.deepEqual(
    validateCuratedMeetupEventCandidate({
      ...baseline,
      publicFloor: null,
      publicRoom: null,
      venue: {
        address: null,
        city: null,
        name: "Public meeting point",
        state: null,
      },
    }).venue,
    {
      address: null,
      city: null,
      name: "Public meeting point",
      state: null,
    },
  );
});
