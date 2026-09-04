import assert from "node:assert/strict";
import test from "node:test";

import { rememberArtworkReveal } from "../../lib/public-artwork-reveal.ts";

test("generic artwork reveals are remembered once per rendered element", () => {
  const revealedElements = new WeakSet();
  const aboutPoster = {};
  const clubCard = {};

  assert.equal(rememberArtworkReveal(revealedElements, aboutPoster), true);
  assert.equal(rememberArtworkReveal(revealedElements, clubCard), true);
  assert.equal(rememberArtworkReveal(revealedElements, aboutPoster), false);
  assert.equal(rememberArtworkReveal(revealedElements, clubCard), false);
});
