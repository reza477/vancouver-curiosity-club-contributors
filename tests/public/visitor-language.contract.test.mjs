import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";

const projectRoot = new URL("../../", import.meta.url);
const INTERNAL_PUBLICATION_COPY =
  /genuinely published|live catalog|official destinations?|club notes?/iu;

const PRODUCT_OWNED_SURFACES = Object.freeze([
  Object.freeze({
    anchor: /Help create the conditions for connection\./u,
    label: "About closing invitation",
    path: "app/about/page.tsx",
    rejected: /live catalog/iu,
  }),
  Object.freeze({
    anchor: /Continue on Meetup/u,
    label: "club Meetup destination and fallback",
    path: "app/_components/ClubDetailRenderer.tsx",
    rejected:
      /official destination|(?:club|program) note|published calendar/iu,
  }),
  Object.freeze({
    anchor: /Explore club/u,
    label: "club directory",
    path: "app/_components/ClubDirectory.tsx",
    rejected: /published clubs/iu,
  }),
  Object.freeze({
    anchor: /club-event-list/u,
    label: "club event list",
    path: "app/_components/ClubEventList.tsx",
    rejected: /from the published calendar/iu,
  }),
  Object.freeze({
    anchor: /Community links are temporarily unavailable/u,
    label: "community destinations",
    path: "app/_components/EditorialPage.tsx",
    rejected:
      /official destinations?|public content service|published artwork|published events|No draft|Draft programs|substitute (?:address|details|information)/iu,
  }),
  Object.freeze({
    anchor: /Related events/u,
    label: "event details",
    path: "app/events/[slug]/page.tsx",
    rejected: /related published events/iu,
  }),
  Object.freeze({
    anchor: /Program events are temporarily unavailable/u,
    label: "program details",
    path: "app/_components/ProgramDetailRenderer.tsx",
    rejected: /published calendar|program note/iu,
  }),
  Object.freeze({
    anchor: /Program page could not be prepared/u,
    label: "program route fallback",
    path: "app/clubs/[slug]/programs/[programSlug]/page.tsx",
    rejected: /program note/iu,
  }),
  Object.freeze({
    anchor: /Stories and information/u,
    label: "editorial fallback",
    path: "app/_components/EditorialPage.tsx",
    rejected: /published notes/iu,
  }),
  Object.freeze({
    anchor: /not-found-title/u,
    label: "not-found recovery",
    path: "app/not-found.tsx",
    rejected: /club notes?/iu,
  }),
  Object.freeze({
    anchor: /could not be prepared/u,
    label: "club route error",
    path: "app/clubs/[slug]/page.tsx",
    rejected: /club note/iu,
  }),
  Object.freeze({
    anchor: /website is\s+ready/u,
    label: "home service fallback",
    path: "app/page.tsx",
    rejected: /public catalog/iu,
  }),
]);

test("the Events starter copy speaks to visitors without internal publication language", () => {
  const eventsPage = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === "events",
  );
  const introduction = eventsPage?.sections.find(
    (section) => section.key === "intro",
  );

  assert.ok(eventsPage, "the public Events catalog definition must exist");
  assert.equal(introduction?.type, "intro");
  assert.equal(typeof introduction.content.text, "string");
  assert.doesNotMatch(
    introduction.content.text,
    INTERNAL_PUBLICATION_COPY,
    "starter CMS copy must describe what visitors can do, not publication state",
  );
  assert.match(
    introduction.content.text,
    /calendar|events|gatherings/iu,
    "the revised introduction must still orient visitors to the Events page",
  );
});

for (const { anchor, label, path, rejected } of PRODUCT_OWNED_SURFACES) {
  test(`${label} uses visitor-facing language`, async () => {
    const source = await readFile(new URL(path, projectRoot), "utf8");

    assert.match(source, anchor, `${label} public surface must remain present`);
    assert.doesNotMatch(
      source,
      rejected,
      `${label} must use visitor-facing language`,
    );
  });
}
