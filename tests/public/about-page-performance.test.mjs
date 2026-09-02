import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

test("About keeps its CMS gate and a truthful institutional narrative without loading projections", async () => {
  const [about, editorial, missionCopy, catalogDefinitions, styles] = await Promise.all([
    readFile(new URL("app/about/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/_components/EditorialPage.tsx", projectRoot), "utf8"),
    readFile(new URL("lib/public-mission-copy.ts", projectRoot), "utf8"),
    readFile(
      new URL("lib/server/public/catalog-definitions.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("public/styles/about.css", projectRoot), "utf8"),
  ]);
  const aboutPositioning = `${about}\n${missionCopy}\n${catalogDefinitions}`;

  assert.match(
    about,
    /await\s+loadEditorialPage\(slug, route\)/u,
    "About must still fail closed against its published CMS page",
  );
  assert.match(
    about,
    /className="about-hero"[\s\S]*?className="about-artwork-strip"[\s\S]*?className="about-board"[\s\S]*?className="about-model"[\s\S]*?className="about-evidence"[\s\S]*?className="about-communities"[\s\S]*?className="about-standards"[\s\S]*?className="about-closing"/u,
    "About must keep the approved institutional narrative order",
  );
  assert.match(
    about,
    /<\/header>\s*<div\s+className="about-artwork-strip"[\s\S]*?<\/div>\s*<section className="about-board" aria-labelledby="about-board-title">/u,
    "the genuine artwork strip must lead directly from the mission into the Board roster",
  );
  for (const copy of [
    "Our mission",
    "Vancouver Curiosity and Education Society makes meaningful lifelong learning accessible after people leave school or university.",
    "free, facilitated, in-person discussions and learning events",
    "At a time when much of social life takes place through screens",
    "Our purpose is to strengthen curiosity, critical thinking, mutual understanding and meaningful community connection.",
    "Vancouver Curiosity and Education Society",
    "Board of Directors",
    "Reza Rahnama",
    "Founder, President and Executive Director",
    "Nawar Alsaadi",
    "Vice-President and Treasurer; Strategy and Partnerships",
    "Nataliia Ivanova",
    "Digital Experience and Communications",
    "Anurag Kapale",
    "Director-at-Large; Technology, AI and Data",
    "What we organize",
    "Think",
    "Reset & Make",
    "Explore",
    "Eat & Play",
    "Help create the conditions for connection.",
  ]) {
    assert.ok(aboutPositioning.includes(copy), copy);
  }
  assert.doesNotMatch(
    aboutPositioning,
    /Building belonging through curiosity\./u,
    "the removed split-layout headline must not remain in the About experience",
  );
  assert.doesNotMatch(
    about,
    /about-overview|about-at-a-glance|Make meaningful community easier to find\.|Organization at a glance|Responsible contact/u,
    "the removed purpose and organization-summary section must not return",
  );
  assert.doesNotMatch(
    styles,
    /\.about-overview|\.about-at-a-glance|\.about-lead/u,
    "removed purpose-section styles must not remain in the route stylesheet",
  );
  assert.match(
    about,
    /descriptionOverride:\s*PUBLIC_ABOUT_MISSION_COPY\.metadataDescription/u,
  );
  assert.match(about, /PUBLIC_ABOUT_MISSION_COPY\.paragraphs\.map/u);
  assert.match(
    editorial,
    /descriptionOverride \?\?[\s\S]*?page\.metaDescription/u,
    "product-owned mission metadata must take precedence after the CMS page gate succeeds",
  );
  assert.match(
    about,
    /href="\/for-organizations"[\s\S]*?Explore organizational collaboration/u,
    "About must give prospective partners a focused next step",
  );
  assert.match(
    about,
    /href="\/events"[\s\S]*?View public events/u,
    "About must let prospective supporters inspect the public program",
  );
  assert.equal(
    [...about.matchAll(/file: "meetup-[0-9]+"/gu)].length,
    3,
    "About must reuse three genuine bundled event posters",
  );
  assert.match(about, /loading="lazy"/u);
  assert.doesNotMatch(
    about,
    /\bloadAboutData\b|\bloadPublicCatalog\b|\bqueryPublicEvents\b|\bEventCard\b/u,
    "About must not add another public data projection",
  );
  assert.doesNotMatch(
    about,
    /\bOrganizerNote\b|about-founder-note(?:-title)?/u,
    "About must not restore the removed self-authored organizer-note block",
  );
  assert.doesNotMatch(
    about,
    /\b(?:registered\s+)?(?:nonprofit|non-profit|charit(?:y|able)|tax[- ]deductible|tax receipt)\b/iu,
    "About must not claim an unverified legal or charitable status",
  );
  assert.doesNotMatch(
    about,
    /\b(?:members?|attendees?)\s+(?:say|said|report(?:ed)?|tell|told)\b|\btestimonial(?:s)?\b|<blockquote\b/iu,
    "About must not present invented member testimony as impact evidence",
  );
  assert.match(
    styles,
    /\.about-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*justify-items:\s*center;/su,
    "the mission must use one centered page column",
  );
  assert.match(
    styles,
    /\.about-hero__content\s*\{[^}]*width:\s*min\(100%, 52rem\);[^}]*margin:\s*0 auto;/su,
    "the mission statement must stay centered in a readable measure",
  );
  assert.match(
    styles,
    /\.about-hero h1\s*\{[^}]*font-size:\s*var\(--public-page-title\);[^}]*text-align:\s*center;/su,
    "Our mission must be the large centered page heading",
  );
  assert.doesNotMatch(
    about,
    /\bemoji\s*:|about-board__badge|director\.emoji/u,
    "the editorial Board roster must not restore non-informational emoji badges",
  );
  assert.match(
    styles,
    /\.about-board__list\s*\{[^}]*border-top:\s*1px solid var\(--line\);[^}]*list-style:\s*none;[^}]*display:\s*grid;/su,
    "the Board must remain a semantic ruled roster rather than a card grid",
  );
  assert.match(
    styles,
    /\.about-board__member\s*\{[^}]*grid-template-columns:\s*minmax\(10rem, 0\.68fr\) minmax\(0, 1\.32fr\);[^}]*display:\s*grid;/su,
    "each Board row must pair the name and role in an editorial masthead layout",
  );
  assert.doesNotMatch(styles, /\.about-board__badge\b/u);
  assert.match(
    styles,
    /\.about-model__steps > li:nth-child\(2\)\s*\{[^}]*width:\s*88%;[^}]*margin-left:\s*auto;/su,
    "the operating principles must use intentionally varied editorial rows",
  );
  assert.match(
    about,
    /publicProgramStreamVisualForLaneSlug\(lane\.slug\)[\s\S]*?data-program-stream=\{streamVisual\.id\}[\s\S]*?style=\{streamVisual\.style\}/u,
    "program-stream rows must retain their approved presentation-only colour identities",
  );
  assert.match(
    styles,
    /\.about-program-streams li:nth-child\(even\)\s*\{[^}]*width:\s*90%;[^}]*margin-left:\s*auto;/su,
    "program streams must use alternating editorial row widths rather than equal cards",
  );
});

test("primary navigation applies selective public prefetching", async () => {
  const [header, ...publicRoutes] = await Promise.all([
    readFile(
      new URL("app/_components/SiteHeader.tsx", projectRoot),
      "utf8",
    ),
    ...[
      "app/events/page.tsx",
      "app/clubs/page.tsx",
      "app/about/page.tsx",
      "app/contact/page.tsx",
    ].map((path) => readFile(new URL(path, projectRoot), "utf8")),
  ]);

  for (const route of publicRoutes) {
    assert.match(
      route,
      /export const dynamic = "force-dynamic";/u,
      "every primary destination covered by this contract must be dynamic",
    );
  }

  const requiredNavigation = header.match(
    /const requiredNavigation\s*=\s*\[([\s\S]*?)\]\s*as const;/u,
  )?.[1];
  assert.ok(requiredNavigation, "the required primary navigation must exist");
  assert.deepEqual(
    [...requiredNavigation.matchAll(
      /\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/gu,
    )].map((match) => ({ href: match[1], label: match[2] })),
    [
      { href: "/events", label: "Events" },
      { href: "/clubs", label: "Clubs" },
      { href: "/about", label: "About" },
      { href: "/for-organizations", label: "For Organizations" },
      { href: "/contact", label: "Contact" },
    ],
    "the institutional redesign must preserve the approved primary hrefs and order",
  );

  const navigationLinks = sourceSection(
    header,
    "function NavigationLinks",
    "function normalizedPrimaryNavigation",
  );
  assert.match(navigationLinks, /href=\{item\.href\}/u);
  assert.match(
    navigationLinks,
    /aria-current=\{[\s\S]*?isCurrentNavigationPath\(pathname, item\.href\)[\s\S]*?"page"/u,
    "the current-page treatment must remain wired to the destination",
  );
  assert.match(
    navigationLinks,
    /prefetch=\{prefetchInternalLinks\}/u,
    "every public primary destination must preserve the preview opt-out switch",
  );
  assert.match(
    header,
    /prefetchInternalLinks = true/u,
    "public primary navigation must default to allowing the route policy",
  );
  assert.match(
    header,
    /import \{ PublicRouteLink as Link \} from "@\/app\/_components\/PublicRouteLink";/u,
    "the route policy must decide which primary destinations are expensive",
  );
  assert.match(
    header,
    /className="wordmark"[\s\S]*?prefetch=\{prefetchInternalLinks\}/u,
    "the wordmark and primary links must share the preview opt-out switch",
  );
  assert.match(
    header,
    /href === "\/events"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)[\s\S]*?pathname === "\/calendar"[\s\S]*?pathname === href[\s\S]*?pathname\.startsWith\(`\$\{href\}\/`\)/u,
    "Events aliases and nested-route active states must remain intact",
  );
});

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}
