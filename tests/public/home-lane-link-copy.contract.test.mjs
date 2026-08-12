import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePageRenderer } from "../../app/_components/HomePageRenderer.tsx";

test("the Explore lane link reads as one useful action instead of Explore Explore", () => {
  const markup = renderToStaticMarkup(
    createElement(HomePageRenderer, {
      catalog: Object.freeze({
        clubs: Object.freeze([]),
        communityLinks: Object.freeze([]),
        lanes: Object.freeze([
          Object.freeze({
            description: "Walks, art, culture, and discovering Vancouver.",
            name: "Explore",
            slug: "explore",
          }),
        ]),
        site: Object.freeze({ mission: "A thoughtful Vancouver community." }),
      }),
      events: Object.freeze([]),
      origin: null,
      page: Object.freeze({ slug: "home" }),
    }),
  );
  const laneLink = /<a(?=[^>]*\bhref="\/events\?lane=explore")[^>]*>([\s\S]*?)<\/a>/u.exec(
    markup,
  );
  assert.ok(laneLink, "the Explore lane must retain its filtered events link");
  const linkText = visibleText(laneLink[1]);

  assert.doesNotMatch(linkText, /^Explore\s+Explore$/iu);
  assert.match(
    linkText,
    /^(?:Browse|See|View) Explore (?:events|gatherings)$/u,
    "the link should name the lane once and say what it opens",
  );
  assert.equal(
    linkText.match(/\bExplore\b/gu)?.length,
    1,
    "the lane name must appear exactly once",
  );
});

function visibleText(markup) {
  return markup
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}
