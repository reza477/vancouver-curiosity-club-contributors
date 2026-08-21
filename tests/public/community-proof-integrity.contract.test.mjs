import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("Home describes designed impact without presenting links as community proof", async () => {
  const home = await source("app/_components/HomePageRenderer.tsx");
  const mission = sectionSource(home, "home-impact");

  assert.match(
    mission,
    /Shared curiosity makes connection easier to begin/u,
    "impact copy must describe the program design rather than claim measured outcomes",
  );
  assert.match(mission, /communityModel\.map/u);
  assert.match(
    home,
    /Arrive without an existing circle[\s\S]*?Start with something shared[\s\S]*?Have a reason to return[\s\S]*?Find more than one way in/u,
  );
  assert.doesNotMatch(
    home,
    /className="home-proof home-community"|Official community links|>Community proof</u,
    "removing the redundant proof section must not turn official links into attendee evidence",
  );
  assert.match(
    home,
    /sameAs:\s*catalog\.communityLinks[\s\S]*?\.map\(\(link\) => link\.url\)/u,
    "confirmed destinations must remain available to Organization structured data",
  );
  assert.doesNotMatch(
    mission,
    /attendee (?:voice|quote|testimonial)|member (?:voice|quote|testimonial)/iu,
    "the impact section must not be presented as attendee testimony",
  );
});

test("Home and About omit the dormant self-authored Reza note", async () => {
  const [home, about, note] = await Promise.all([
    source("app/_components/HomePageRenderer.tsx"),
    source("app/about/page.tsx"),
    source("app/_components/OrganizerNote.tsx"),
  ]);

  assert.doesNotMatch(home, /<OrganizerNote\b|A note from Reza/u);
  assert.doesNotMatch(
    about,
    /\bOrganizerNote\b|about-founder-note|A note from Reza|Curiosity is enough to begin|I want this to be a place|<cite>\s*Reza\s*<\/cite>/u,
    "About must not retain the organizer-note component, heading, quote, or attribution",
  );
  assert.match(note, />A note from Reza</u);
  assert.match(note, />Curiosity is enough to begin\.</u);
  assert.match(note, /<blockquote\b/u);
  const quote = note.match(/<blockquote[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/u)?.[1] ?? "";
  assert.equal(
    normalizeJsxText(quote),
    "“I want this to be a place where you can follow a real interest without needing to impress anyone. Choose an event that pulls you in, come as you are, and we’ll take it from there.”",
    "the shared note must reuse the exact already-authorized self-authored copy",
  );
  assert.match(note, /<cite>\s*Reza\s*<\/cite>/u);
  const visibleNoteCopy = note
    .replace(/export function OrganizerNote[\s\S]*?return\s*\(/u, "")
    .replace(/className="[^"]*"/gu, "");
  assert.doesNotMatch(
    visibleNoteCopy,
    /\b(?:organizer|founder|owner|host|surname|last name|e-?mail|phone)\b/iu,
    "the note must not claim an unapproved role or expand private identity",
  );
  assert.ok(words(quote) <= 80, "the organizer introduction must stay concise");
});

test("mission positioning avoids unverified legal and testimonial claims", async () => {
  const [home, about, organizations, formContract, missionCopy] = await Promise.all([
    source("app/_components/HomePageRenderer.tsx"),
    source("app/about/page.tsx"),
    source("app/for-organizations/page.tsx"),
    source("lib/server/phase7/public-form-contract.ts"),
    source("lib/public-mission-copy.ts"),
  ]);
  const publicPositioning = `${home}\n${about}\n${organizations}\n${missionCopy}`;

  assert.match(publicPositioning, /community organization/u);
  assert.match(publicPositioning, /conversations about financial support/u);
  assert.match(
    formContract,
    /PARTNERSHIP_TYPES[\s\S]*?"Funding or sponsorship"/u,
    "the partnership path must let funders identify the purpose of their inquiry",
  );
  assert.doesNotMatch(
    publicPositioning,
    /\b(?:registered nonprofit|nonprofit organization|registered society|registered charity|charitable organization|tax[- ]deductible|tax receipt)\b/iu,
    "legal status and donation-receipt language require confirmed legal evidence",
  );
  assert.doesNotMatch(
    publicPositioning,
    /members? (?:say|report|found|became)|attendees? (?:say|report|found|became)|changed (?:their|people's) lives/iu,
    "impact language must not invent attendee outcomes",
  );
});

test("organizer imagery stays absent or passes the confirmed attribution and media-rights boundary", async () => {
  const [about, note, publicModules] = await Promise.all([
    source("app/about/page.tsx"),
    source("app/_components/OrganizerNote.tsx"),
    publicModuleSources(),
  ]);
  const introduction = note;

  if (introduction.includes("<FieldArtwork")) {
    assert.match(
      introduction,
      /Original illustration(?:\s+[—-])?\s+not a gathering photograph\./u,
      "non-photographic art must be labelled rather than implied to document attendees",
    );
  }

  if (!/<img\b/u.test(introduction)) {
    assert.doesNotMatch(introduction, /className="[^"]*(?:photo|portrait)[^"]*"/iu);
    return;
  }

  const loaderName = organizerLoaderName(about);
  assert.ok(loaderName, "an organizer photo requires a public attribution loader");
  const loaderModule = publicModules.find((module) =>
    new RegExp(
      `export\\s+async\\s+function\\s+${escapeRegex(loaderName)}\\b`,
      "u",
    ).test(module.source),
  );
  assert.ok(loaderModule, `${loaderName} must be a public server export`);
  const boundary = loaderModule.source;
  for (const requiredBoundary of [
    /organizer_public_attribution_states/u,
    /workflow_status\s*=\s*'confirmed'/u,
    /organizer_public_attribution_receipts/u,
    /receipt\.consent\s*=\s*1/u,
    /profile\.public_attribution_consent\s*=\s*1/u,
    /rights_status\s*=\s*'approved'/u,
    /participant_consent_status[\s\S]{0,120}(?:'not_applicable'[\s\S]{0,80}'confirmed'|'confirmed'[\s\S]{0,80}'not_applicable')/u,
  ]) {
    assert.match(boundary, requiredBoundary);
  }
  assert.match(introduction, /\.photo\.(?:url|altText|credit)\b/u);
});

test("Home and About fail closed when no genuine attendee voices exist", async () => {
  const [home, about, note] = await Promise.all([
    source("app/_components/HomePageRenderer.tsx"),
    source("app/about/page.tsx"),
    source("app/_components/OrganizerNote.tsx"),
  ]);
  const attendeeProofSurfaces = `${home}\n${about}\n${note.replace(
    /<blockquote[^>]*>[\s\S]*?<\/blockquote>/u,
    "",
  )}`;

  assert.doesNotMatch(
    attendeeProofSurfaces,
    /<blockquote\b|<q\b|data-(?:attendee-)?testimonial|data-attendee-quote/iu,
    "the current source has no consented attendee quotation data to render",
  );
  assert.doesNotMatch(
    attendeeProofSurfaces,
    /(?:const|let|var)\s+(?:attendee|member)(?:Quotes?|Testimonials?|Voices?)\s*=/iu,
    "attendee voices must not be invented as local marketing copy",
  );
});

async function publicModuleSources() {
  const directory = new URL("lib/server/public/", projectRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map(async (entry) => ({
        path: `lib/server/public/${entry.name}`,
        source: await readFile(new URL(entry.name, directory), "utf8"),
      })),
  );
}

function organizerLoaderName(about) {
  const candidates = [
    ...about.matchAll(
      /\b((?:get|list|load|query|resolve)[A-Z][A-Za-z]*(?:Organizer|Founder)(?!ation)[A-Za-z]*)\b/gu,
    ),
  ].map((match) => match[1]);
  return candidates.find((name) =>
    new RegExp(`await\\s+${escapeRegex(name)}\\s*\\(`, "u").test(about),
  );
}

function sectionSource(moduleSource, className) {
  const start = moduleSource.indexOf(`className="${className}"`);
  assert.notEqual(start, -1, `missing ${className} section`);
  const sectionStart = moduleSource.lastIndexOf("<section", start);
  const sectionEnd = moduleSource.indexOf("</section>", start);
  assert.ok(sectionStart >= 0 && sectionEnd > start, `incomplete ${className} section`);
  return moduleSource.slice(sectionStart, sectionEnd + "</section>".length);
}

function normalizeJsxText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function words(sourceValue) {
  return sourceValue
    .replace(/<[^>]+>/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function source(pathname) {
  return readFile(new URL(pathname, projectRoot), "utf8");
}
