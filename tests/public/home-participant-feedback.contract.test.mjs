import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PUBLIC_HOME_PARTICIPANT_FEEDBACK } from "../../lib/public-home-participant-feedback.ts";

const projectRoot = new URL("../../", import.meta.url);

const expectedFeedback = {
  meetupGroupName: "Vancouver Curiosity Club",
  meetupGroupUrl: "https://www.meetup.com/vancouver-meetup-group/",
  rating: 4.9,
  ratingScale: 5,
  ratingCount: 471,
  fiveStarRatingCount: 415,
  verificationDate: "August 30, 2026",
  quotes: [
    {
      comment:
        "“Great discussion! I learnt lots on the topic. Group was excellent.”",
      displayName: "Gigi D.A.",
      eventContext: "Emotions discussion",
    },
    {
      comment: "“It was a great evening and I met good people :)”",
      displayName: "Olesia",
      eventContext: "Shipyards Night Market",
    },
    {
      comment: "“Lively discussion.”",
      displayName: "Tom C.",
      eventContext: "Areopagitica discussion",
    },
  ],
};

test("Home feedback keeps every verified Meetup fact in one static object", async () => {
  const dataSource = await source("lib/public-home-participant-feedback.ts");

  assert.deepEqual(PUBLIC_HOME_PARTICIPANT_FEEDBACK, expectedFeedback);
  assert.equal(PUBLIC_HOME_PARTICIPANT_FEEDBACK.quotes.length, 3);
  assert.doesNotMatch(
    dataSource,
    /\b(?:fetch|axios|browser|scrape|schedule|cron|automation|Meetup API)\b/iu,
  );
});

test("Home renders one compact semantic feedback section in the approved position", async () => {
  const renderer = await source("app/_components/HomePageRenderer.tsx");
  const feedback = sectionSource(renderer, "home-feedback");
  const workIndex = renderer.indexOf('data-home-section="work-in-action"');
  const feedbackIndex = renderer.indexOf('data-home-section="participant-feedback"');
  const impactIndex = renderer.indexOf('data-home-section="why-it-matters"');

  assert.ok(workIndex < feedbackIndex && feedbackIndex < impactIndex);
  assert.match(feedback, /aria-labelledby="home-feedback-title"/u);
  assert.match(feedback, />What participants say\.<\/h2>/u);
  assert.match(feedback, /PUBLIC_HOME_PARTICIPANT_FEEDBACK\.quotes\.map/u);
  assert.equal((feedback.match(/<blockquote\b/gu) ?? []).length, 1);
  assert.match(feedback, /<footer>[\s\S]*?<cite>/u);
  assert.match(feedback, /rel="noreferrer noopener"/u);
  assert.match(feedback, /target="_blank"/u);
  assert.doesNotMatch(
    feedback,
    /section-kicker|eyebrow|home-.*__number|avatar|testimonial-card|carousel|counter|Meetup logo|Meetup badge/iu,
  );
});

test("Home feedback has an asymmetric continuous layout and a mobile stack", async () => {
  const css = await source("app/styles/pages/home.css");

  assert.match(
    css,
    /\.home-feedback\s*\{[^}]*background:\s*var\(--blue-surface\);[^}]*grid-template-columns:\s*minmax\(14rem, 0\.52fr\) minmax\(0, 1\.48fr\);/su,
  );
  assert.match(
    css,
    /\.home-feedback__quote--lead\s*\{[^}]*grid-column:\s*1 \/ -1;/su,
  );
  assert.match(
    css,
    /@media \(max-width: 56rem\)[\s\S]*?\.home-feedback,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  assert.match(
    css,
    /@media \(max-width: 42rem\)[\s\S]*?\.home-feedback__quotes\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/su,
  );
  const feedbackCss = css.slice(
    css.indexOf(".home-feedback {"),
    css.indexOf(".home-impact {"),
  );
  assert.doesNotMatch(feedbackCss, /linear-gradient|radial-gradient|box-shadow|::before|::after/u);
});

test("Participant feedback remains absent from every other public page", async () => {
  const otherSurfaces = await Promise.all(
    [
      "app/about/page.tsx",
      "app/for-organizations/page.tsx",
      "app/_components/EventsPageRenderer.tsx",
      "app/_components/ClubDirectory.tsx",
      "app/_components/SiteFooter.tsx",
    ].map(source),
  );

  assert.doesNotMatch(
    otherSurfaces.join("\n"),
    /PUBLIC_HOME_PARTICIPANT_FEEDBACK|What participants say\.|Gigi D\.A\.|Shipyards Night Market|Areopagitica discussion/u,
  );
});

function sectionSource(moduleSource, className) {
  const start = moduleSource.indexOf(`className="${className}"`);
  assert.notEqual(start, -1, `missing ${className} section`);
  const sectionStart = moduleSource.lastIndexOf("<section", start);
  const sectionEnd = moduleSource.indexOf("</section>", start);
  assert.ok(sectionStart >= 0 && sectionEnd > start, `incomplete ${className} section`);
  return moduleSource.slice(sectionStart, sectionEnd + "</section>".length);
}

async function source(pathname) {
  return readFile(new URL(pathname, projectRoot), "utf8");
}
