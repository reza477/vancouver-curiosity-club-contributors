import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("About keeps its CMS gate without loading catalog or event projections", async () => {
  const about = await readFile(
    new URL("app/about/page.tsx", projectRoot),
    "utf8",
  );

  assert.match(
    about,
    /await\s+loadEditorialPage\(slug, route\)/u,
    "About must still fail closed against its published CMS page",
  );
  assert.match(about, /<OrganizerNote headingId="about-founder-note-title" \/>/u);
  for (const className of [
    "about-hero",
    "about-feel",
    "about-audience",
    "about-solo",
    "about-founder-note",
    "about-closing",
  ]) {
    assert.match(
      about,
      new RegExp(`className="${className}"`, "u"),
      `${className} must remain on the useful static About page`,
    );
  }
  assert.match(
    about,
    /<Link\s+className="primary-action"\s+href="\/events"\s+prefetch=\{false\}>[\s\S]*?See upcoming gatherings[\s\S]*?<\/Link>/u,
    "About must retain a direct path to the live Events page without preloading it",
  );

  assert.doesNotMatch(
    about,
    /\bloadAboutData\b|\bloadPublicCatalog\b|\bqueryPublicEvents\b|\bEventCard\b/u,
    "About must not load its former catalog and event-card projection",
  );
  assert.doesNotMatch(
    about,
    /className="about-(?:facts|events)"/u,
    "the two sections backed by live catalog and event queries must stay removed",
  );
});
