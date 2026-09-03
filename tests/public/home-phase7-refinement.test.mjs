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
  const [homeCss, motionCss] = await Promise.all([
    readFile(new URL("app/styles/pages/home.css", projectRoot), "utf8"),
    readFile(new URL("app/styles/motion.css", projectRoot), "utf8"),
  ]);
  const css = `${homeCss}\n${motionCss}`;

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
    /\.home-hero__poster-media\s*\{[^}]*position:\s*relative;[^}]*background:\s*var\(--amber-surface\);/su,
  );
  assert.match(
    css,
    /\.home-hero__poster-preview\s*\{[^}]*position:\s*absolute;/su,
  );
  const heroPosterCss = css.slice(
    css.indexOf(".home-hero__featured-poster"),
    css.indexOf(".home-section-heading"),
  );
  assert.doesNotMatch(heroPosterCss, /(?:linear|radial)-gradient/u);
  assert.doesNotMatch(css, /\.home-section-heading--split|\.home-hero__events-link/u);
  assert.match(
    css,
    /\.home-glance\s*\{[^}]*background:\s*var\(--ink\);[^}]*color:\s*var\(--paper\);[^}]*grid-template-columns:\s*minmax\(0, 0\.78fr\) minmax\(0, 1\.22fr\);/su,
  );
  assert.match(
    css,
    /\.home-glance__facts\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.82fr\) minmax\(0, 1\.18fr\);/su,
  );
  assert.match(
    css,
    /\.home-glance__fact--location,[\s\S]*?\.home-glance__fact--standards\s*\{[^}]*grid-column:\s*1 \/ -1;/u,
  );
  assert.match(
    css,
    /@media \(max-width: 56rem\)[\s\S]*?\.home-glance__facts\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.home-glance\s*\{[^}]*padding-block:\s*clamp\(2\.5rem, 11vw, 3rem\);/u,
  );
  assert.match(
    css,
    /@media \(forced-colors: active\)[\s\S]*?\.home-glance__stream-rule\s*\{[^}]*display:\s*none;/u,
  );
  assert.match(
    css,
    /\.home-programs\s*\{[^}]*background:\s*var\(--coral-strong\);[^}]*color:\s*var\(--warm-surface-inverse\);/su,
  );
  assert.match(
    css,
    /@media \(scripting: enabled\) and \(min-width: 64rem\) and \(min-height: 42rem\) and \(prefers-reduced-motion: no-preference\)[\s\S]*?\.home-work__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.16fr\) minmax\(22rem,\s*0\.84fr\);/u,
  );
  assert.match(
    css,
    /\.home-work-card__poster-link\s*\{[^}]*position:\s*sticky;[^}]*visibility:\s*hidden;/su,
  );
  assert.match(
    css,
    /\.home-work-card\[data-stage-state="incoming"\] \.home-work-card__poster-link\s*\{[^}]*animation:[^;]*artwork-poster-reveal;/su,
  );
  assert.match(
    css,
    /@media \(max-width: 56rem\)[\s\S]*?\.home-work__grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u,
  );
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.home-work__grid\s*\{[^}]*grid-template-columns:\s*1fr;/u,
  );
  assert.match(
    css,
    /\.home-impact__statement h2\s*\{[^}]*font-size:\s*clamp\(3\.4rem, 6\.6vw, 7rem\);/su,
  );
  assert.match(
    css,
    /\.home-impact__sequence\s*\{[^}]*border:\s*1px solid var\(--ink\);[^}]*border-inline-start:\s*0\.35rem solid var\(--coral-strong\);/su,
  );
  assert.match(
    css,
    /\.home-impact__sequence li \+ li\s*\{[^}]*border-top:\s*1px solid var\(--ink\);/su,
  );
  assert.match(
    css,
    /@media \(min-width: 56\.001rem\)[\s\S]*?\.home-communities__list\s*\{[^}]*height:\s*clamp\(30rem, 55svh, 35rem\);[^}]*display:\s*flex;/u,
  );
  assert.match(
    css,
    /\.home-community:is\(:hover, :focus-within\)\s*\{[^}]*flex-grow:\s*2\.35;/su,
  );
  assert.match(
    css,
    /\.home-community:first-child \.home-community__details,[\s\S]*?\.home-community:is\(:hover, :focus-within\) \.home-community__details\s*\{[^}]*grid-template-rows:\s*1fr;/u,
  );
  assert.match(
    css,
    /@media \(max-width: 56rem\)[\s\S]*?\.home-community,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  assert.match(
    css,
    /@media \(scripting: enabled\) and \(min-width: 64rem\)[\s\S]*?\(prefers-reduced-motion: no-preference\)[\s\S]*?\.home-work-card__poster-link/u,
  );
  assert.doesNotMatch(
    css,
    /\.home-glance__facts,\s*\.home-impact|\.home-programs__list,\s*\.home-communities__list/u,
  );
});
