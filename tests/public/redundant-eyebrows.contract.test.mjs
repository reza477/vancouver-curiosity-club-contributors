import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

function exactLabel(label, className = "section-kicker") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `<p\\s+className=["']${className}["']>\\s*${escaped}\\s*<\\/p>`,
    "iu",
  );
}

test("institutional pages omit only the approved redundant eyebrow labels", async () => {
  const [home, about, organizations, clubs, events] = await Promise.all([
    source("app/_components/HomePageRenderer.tsx"),
    source("app/about/page.tsx"),
    source("app/for-organizations/page.tsx"),
    source("app/_components/ClubDirectory.tsx"),
    source("app/_components/EventsPageRenderer.tsx"),
  ]);

  for (const label of [
    "Organization at a glance",
    "What we do",
    "Our work in action",
    "Why this work matters",
    "Partnership opportunities",
    "Open to the public",
  ]) {
    assert.doesNotMatch(home, exactLabel(label), label);
  }
  assert.doesNotMatch(home, /One organization, three public communities/u);

  for (const label of [
    "Leadership and governance",
    "How the model works",
    "The work in practice",
    "Three public communities",
    "Public standards",
    "For organizations",
  ]) {
    assert.doesNotMatch(about, exactLabel(label), label);
  }

  assert.doesNotMatch(organizations, exactLabel("For organizations", "eyebrow"));
  for (const label of [
    "Current public work",
    "Collaboration pathways",
    "Public operating standards",
    "Start a conversation",
  ]) {
    assert.doesNotMatch(organizations, exactLabel(label), label);
  }

  assert.doesNotMatch(
    clubs,
    /<header>\s*<p className="section-kicker">Clubs<\/p>/u,
  );
  assert.doesNotMatch(clubs, exactLabel("The promise"));
  assert.doesNotMatch(events, exactLabel("Vancouver gatherings"));
});

test("Clubs suppresses its page-level eyebrow without changing shared mastheads", async () => {
  const [routes, editorial, masthead] = await Promise.all([
    source("app/_components/EditorialRouteBodies.tsx"),
    source("app/_components/EditorialPage.tsx"),
    source("app/_components/PageMasthead.tsx"),
  ]);

  assert.match(
    routes,
    /<EditorialPage displayEyebrow=\{null\} page=\{page\} tone="think"/u,
  );
  assert.match(editorial, /displayEyebrow\?: string \| null/u);
  assert.match(masthead, /\{eyebrow \? <p className="eyebrow">\{eyebrow\}<\/p> : null\}/u);
});

test("detail pages remove adjacent editorial repeats and retain functional labels", async () => {
  const [eventDetail, eventPage, clubDirectory, clubEvents, footer, missionCopy] =
    await Promise.all([
      source("app/_components/PublicEventDetailRenderer.tsx"),
      source("app/events/[slug]/page.tsx"),
      source("app/_components/ClubDirectory.tsx"),
      source("app/_components/ClubEventList.tsx"),
      source("app/_components/SiteFooter.tsx"),
      source("lib/public-mission-copy.ts"),
    ]);

  assert.doesNotMatch(eventDetail, exactLabel("Event information"));
  assert.doesNotMatch(eventDetail, exactLabel("People"));
  assert.doesNotMatch(eventPage, exactLabel("Keep following the thread"));

  assert.match(missionCopy, /eyebrow:\s*"Our mission"/u);
  assert.match(clubDirectory, exactLabel("Next gathering"));
  assert.match(clubEvents, exactLabel("Club events"));
  assert.match(clubEvents, /<h2 id=\{id\}>\{heading\}<\/h2>/u);
  assert.match(eventDetail, /<h2 id="facts-title">The essentials<\/h2>/u);
  assert.match(eventDetail, /<dt>When<\/dt>/u);
  assert.match(eventDetail, /<dt>Location<\/dt>/u);
  assert.match(eventDetail, /<dt>Capacity<\/dt>/u);
  assert.match(eventDetail, /RSVP on Meetup/u);
  assert.match(eventDetail, /<AddToCalendar/u);
  assert.match(eventDetail, /\{event\.club\.name\}/u);

  for (const heading of ["Explore", "Participate", "Community information"]) {
    assert.match(footer, new RegExp(`>${heading}<`, "u"));
  }
});
