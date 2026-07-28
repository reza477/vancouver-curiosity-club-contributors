import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PUBLIC_ORGANIZERS_JSON_BYTES,
  toPublicEventDto,
} from "../../lib/server/public/events.ts";

function publicEventRow(organizerNamesJson) {
  return {
    all_day_end_date_exclusive: null,
    all_day_start_date: null,
    category_color_token: null,
    category_name: null,
    category_slug: null,
    description: null,
    ends_at_utc: 2_000,
    event_status: "confirmed",
    organizer_names_json: organizerNamesJson,
    rsvp_url: null,
    slug: "bounded-organizer-event",
    starts_at_utc: 1_000,
    summary: null,
    time_kind: "timed",
    timezone: "America/Vancouver",
    title: "Bounded organizer event",
    venue_public_address: null,
    venue_public_name: null,
  };
}

test("the calculated public-organizer aggregate accepts 24 maximum rich hosts", () => {
  const organizers = Array.from({ length: 24 }, (_, index) => ({
    biography: "b".repeat(800),
    displayName: String.fromCharCode(65 + (index % 26)).repeat(120),
    photoAltText: "a".repeat(300),
    photoAssetId: "p".repeat(128),
    photoCredit: "c".repeat(300),
    photoHeight: 8_000,
    photoWidth: 8_000,
  }));
  const organizerNamesJson = JSON.stringify(organizers);
  const byteLength = new TextEncoder().encode(organizerNamesJson).byteLength;

  assert.equal(byteLength, 42_529);
  assert.equal(MAX_PUBLIC_ORGANIZERS_JSON_BYTES, 245_018);
  assert.ok(byteLength < MAX_PUBLIC_ORGANIZERS_JSON_BYTES);
  assert.equal(
    toPublicEventDto(publicEventRow(organizerNamesJson)).organizers.length,
    24,
  );
});

test("the public-organizer aggregate rejects one UTF-8 byte over its bound", () => {
  const oversizedJson = "x".repeat(MAX_PUBLIC_ORGANIZERS_JSON_BYTES + 1);
  assert.equal(
    new TextEncoder().encode(oversizedJson).byteLength,
    MAX_PUBLIC_ORGANIZERS_JSON_BYTES + 1,
  );
  assert.throws(
    () => toPublicEventDto(publicEventRow(oversizedJson)),
    (error) =>
      error?.code === "internal_error" &&
      error?.status === 500 &&
      !String(error).includes(oversizedJson),
  );
});
