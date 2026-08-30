import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectRoot } from "../helpers/public-css.mjs";

const source = (path) => readFile(new URL(path, projectRoot), "utf8");

test("supporting routes consume one bounded public typography and spacing system", async () => {
  const [tokens, layout, editorial, events, eventDetail, about, organizations] =
    await Promise.all([
      source("app/styles/tokens.css"),
      source("app/styles/layout.css"),
      source("app/styles/components/editorial.css"),
      source("public/styles/events.css"),
      source("app/styles/pages/event-detail.css"),
      source("public/styles/about.css"),
      source("public/styles/organizations.css"),
    ]);

  for (const token of [
    "--public-page-width",
    "--public-gutter",
    "--public-section-space",
    "--public-page-title",
    "--public-section-title",
    "--public-copy-measure",
    "--public-control-height",
    "--public-button-radius",
    "--public-button-shadow",
  ]) {
    assert.match(tokens, new RegExp(`${token}:`, "u"), `${token} must exist`);
  }

  for (const [name, css] of [
    ["shared masthead", layout],
    ["Events masthead", events],
    ["About", about],
    ["For Organizations", organizations],
  ]) {
    assert.match(
      css,
      /font-size:\s*var\(--public-page-title\)/u,
      `${name} must use the shared page-title scale`,
    );
  }
  assert.match(
    eventDetail,
    /\.event-detail__header h1\s*\{[^}]*font-size:\s*clamp\(3rem, 5vw, 4\.25rem\);/su,
    "Event detail must keep its balanced title scale within the public hierarchy",
  );

  assert.match(
    editorial,
    /\.editorial-section\s*\{[^}]*min-height:\s*0;/su,
  );
  assert.match(
    editorial,
    /\.editorial-sections\s*\{[^}]*flex-wrap:\s*wrap;[^}]*display:\s*flex;/su,
  );
  assert.match(editorial, /\.editorial-section\s*\{[^}]*flex:\s*1 1 32rem;/su);
  assert.doesNotMatch(
    editorial,
    /\.public-(?:service|empty)-state\s*\{[^}]*min-height:\s*24rem;/su,
  );
});

test("supporting cards, controls, states, and responsive columns use the same square editorial language", async () => {
  const [forms, catalog, editorial, eventDetail, base] = await Promise.all([
    source("app/styles/components/forms.css"),
    source("app/styles/components/catalog.css"),
    source("app/styles/components/editorial.css"),
    source("app/styles/pages/event-detail.css"),
    source("app/styles/base.css"),
  ]);

  assert.doesNotMatch(forms, /border-radius:\s*(?:0\.[1-9]|[1-9]|999)/u);
  assert.doesNotMatch(catalog, /border-radius:\s*999px/u);
  assert.match(
    catalog,
    /\.club-directory--clubs \.club-directory__artwork picture\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*border-radius:\s*0;/su,
  );
  assert.match(catalog, /@media \(max-width:\s*64rem\)/u);
  assert.match(eventDetail, /@media \(max-width:\s*64rem\)/u);
  assert.match(editorial, /\.notice-card\s*\{[^}]*border:\s*1px solid var\(--line\)/su);
  assert.doesNotMatch(base, /min-height:\s*80svh/u);
  assert.match(base, /\.error-panel h1\s*\{[^}]*font-size:\s*var\(--public-page-title\)/su);
});

test("public functional pages no longer present Field notes as a category", async () => {
  const publicSources = await Promise.all([
    source("app/_components/EditorialPage.tsx"),
    source("app/_components/PublicEventDetailRenderer.tsx"),
    source("app/_components/EventFilters.tsx"),
    source("app/error.tsx"),
    source("app/not-found.tsx"),
  ]);
  for (const sourceText of publicSources) {
    assert.doesNotMatch(sourceText, />\s*Field notes?\s*</iu);
  }
  assert.match(publicSources[0], /return "Public communities"/u);
  assert.match(publicSources[0], /return "Community information"/u);
  assert.match(publicSources[1], />About this event</u);
  assert.doesNotMatch(publicSources[1], />Event information</u);
  assert.match(publicSources[2], />Find a gathering</u);
});

test("Privacy keeps Contact on the expensive-route prefetch policy", async () => {
  const privacy = await source("app/_components/PublicFormPrivacyNotice.tsx");
  assert.match(privacy, /PublicRouteLink as Link/u);
  assert.doesNotMatch(privacy, /from "next\/link"/u);
});
