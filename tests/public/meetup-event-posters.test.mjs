import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CURATED_MEETUP_EVENT_POSTERS,
  curatedMeetupPosterForEventUrl,
} from "../../lib/meetup-event-posters.ts";
import { toPublicEventCardDto } from "../../lib/server/public/events.ts";

test("the current published Meetup events use bundled poster copies", async () => {
  const posters = Object.values(CURATED_MEETUP_EVENT_POSTERS);
  assert.equal(posters.length, 11);

  for (const poster of posters) {
    const bytes = await readFile(
      new URL(`../../public${poster.localPath}`, import.meta.url),
    );
    assert.equal(bytes[0], 0xff, poster.eventId);
    assert.equal(bytes[1], 0xd8, poster.eventId);
    assert.equal(bytes[bytes.length - 2], 0xff, poster.eventId);
    assert.equal(bytes[bytes.length - 1], 0xd9, poster.eventId);
    assert.ok(bytes.byteLength > 20_000, poster.eventId);
    assert.match(
      poster.sourceUrl,
      /^https:\/\/secure\.meetupstatic\.com\/photos\/event\//u,
      poster.eventId,
    );
    assert.equal(
      curatedMeetupPosterForEventUrl(
        `https://www.meetup.com/owner-controlled-group/events/${poster.eventId}/`,
      ),
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
      height: 337,
      localPath: "/event-posters/meetup-315772533.jpeg",
      width: 600,
    },
  );
  assert.match(poster.altText, /Cicero on Friendship/u);
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
  assert.match(card.artwork?.altText ?? "", /Cicero on Friendship/u);
});
