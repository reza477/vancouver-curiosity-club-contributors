import assert from "node:assert/strict";
import test from "node:test";
import { selectCanonicalPublicCommunities } from "../../lib/public-community-order.ts";

test("canonical public communities survive local slug changes and keep the required order", () => {
  const clubs = [
    club("literature-renamed", "https://www.meetup.com/vancouver-literature-and-film/"),
    club("unrelated", "https://www.meetup.com/unrelated-community/"),
    club("science-fiction-renamed", "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/"),
    club("curiosity-renamed", "https://www.meetup.com/vancouver-meetup-group/"),
  ];

  assert.deepEqual(
    selectCanonicalPublicCommunities(clubs).map(({ slug }) => slug),
    ["curiosity-renamed", "science-fiction-renamed", "literature-renamed"],
  );
});

function club(slug, publicGroupUrl) {
  return Object.freeze({ archived: false, publicGroupUrl, slug });
}
