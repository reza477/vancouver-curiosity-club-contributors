import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import {
  CURATED_MEETUP_EVENT_ENRICHMENTS,
  curatedMeetupEventForEventUrl,
  validateCuratedMeetupEventCandidate,
} from "../../lib/meetup-event-enrichment.ts";
import {
  CURATED_MEETUP_EVENT_POSTERS,
  curatedMeetupPosterForEventUrl,
} from "../../lib/meetup-event-posters.ts";
import {
  toPublicEventCardDto,
  toPublicEventDetailDto,
} from "../../lib/server/public/events.ts";

test("the current published Meetup events use bundled poster copies", async () => {
  const posters = Object.values(CURATED_MEETUP_EVENT_POSTERS);
  assert.equal(posters.length, 13);

  for (const poster of posters) {
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
    assert.ok(poster.width >= 1_536, poster.eventId);
    assert.equal(poster.smallWidth, 480, poster.eventId);
    assert.equal(poster.mediumWidth, 960, poster.eventId);
    assert.match(
      poster.sourceUrl,
      /^https:\/\/secure\.meetupstatic\.com\/photos\/event\/.+\/highres_/u,
      poster.eventId,
    );
    const enrichment = CURATED_MEETUP_EVENT_ENRICHMENTS[poster.eventId];
    assert.ok(enrichment, poster.eventId);
    assert.equal(
      curatedMeetupPosterForEventUrl(enrichment.eventUrl),
      poster,
      poster.eventId,
    );
  }

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
    name: "Vancouver Central Library",
  });
  assert.doesNotMatch(
    JSON.stringify(card),
    /sourceUrl|secure\.meetupstatic\.com/iu,
  );
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

  const ownerAuthored = toPublicEventDetailDto({
    ...base,
    description: "Owner-authored public description.",
    summary: "Owner-authored public summary.",
    venue_public_address: "Owner-authored public address",
    venue_public_name: "Owner-authored public venue",
  });
  assert.equal(ownerAuthored.description, "Owner-authored public description.");
  assert.equal(ownerAuthored.summary, "Owner-authored public summary.");
  assert.deepEqual(ownerAuthored.venue, {
    address: "Owner-authored public address",
    name: "Owner-authored public venue",
  });
});

test("the generated enrichment manifest is bounded and public safe", () => {
  const events = Object.values(CURATED_MEETUP_EVENT_ENRICHMENTS);
  assert.equal(events.length, 13);
  for (const event of events) {
    assert.equal(curatedMeetupEventForEventUrl(event.eventUrl), event);
    assert.ok(event.summary.length >= 10 && event.summary.length <= 500);
    assert.ok(
      event.description.length >= 10 && event.description.length <= 20_000,
    );
    for (const value of [
      event.summary,
      event.description,
      event.poster.altText,
      event.poster.credit,
      event.venue?.name,
      event.venue?.address,
      event.venue?.city,
      event.venue?.state,
    ].filter(Boolean)) {
      assert.doesNotMatch(
        value,
        /https?:\/\/|\bwww\.|@|passcode|password|access\s+code|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/iu,
      );
    }
    assert.ok(event.venue?.name);
    assert.ok(event.venue?.address);
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

test("hidden or absent Meetup venues remain null while a public name may stand alone", () => {
  const baseline = CURATED_MEETUP_EVENT_ENRICHMENTS["315772533"];
  assert.ok(baseline);
  assert.equal(
    validateCuratedMeetupEventCandidate({ ...baseline, venue: null }).venue,
    null,
  );
  assert.equal(
    validateCuratedMeetupEventCandidate({
      ...baseline,
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
