import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("Home removes repeated introductions while preserving its institutional path", async () => {
  const source = await readFile(
    new URL("app/_components/HomePageRenderer.tsx", projectRoot),
    "utf8",
  );

  assert.doesNotMatch(source, /home-section-heading--split|home-hero__events-link/u);
  assert.doesNotMatch(
    source,
    /Our program streams give people several ways|Current events show the range|coordinates public communities with/u,
  );
  assert.match(source, /data-home-section="public-invitation"/u);
  assert.match(source, /View the public event calendar/u);
  assert.match(source, /Explore upcoming events/u);
  assert.match(source, /institutionalEventTitle\(event\)/u);
  assert.match(
    source,
    /className="home-hero__poster-link"[\s\S]*?href=\{`\/events\/\$\{event\.slug\}`\}[\s\S]*?<EventPosterImage/u,
  );
  assert.match(source, /className="home-hero__poster-preview" aria-hidden="true"/u);
});

test("Home uses shared spacing and compact responsive fallbacks", async () => {
  const css = await readFile(
    new URL("app/styles/pages/home.css", projectRoot),
    "utf8",
  );

  assert.match(
    css,
    /\.home-hero,[\s\S]*?padding:\s*var\(--public-section-space\)[\s\S]*?var\(--public-gutter\)/u,
  );
  assert.match(
    css,
    /\.home-hero:not\(\.home-hero--text-only\)[\s\S]*?grid-template-columns/u,
  );
  assert.match(
    css,
    /\.home-work__empty\s*\{[^}]*min-height:\s*0;[^}]*padding:/u,
  );
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.home-partnerships\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/u,
  );
  assert.match(
    css,
    /\.home-hero__poster-link\s*\{[^}]*position:\s*relative;[^}]*linear-gradient/su,
  );
  assert.match(
    css,
    /\.home-hero__poster-preview\s*\{[^}]*position:\s*absolute;/su,
  );
  assert.doesNotMatch(css, /\.home-section-heading--split|\.home-hero__events-link/u);
});
