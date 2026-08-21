import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicFormPrivacyNotice } from "../../app/_components/PublicFormPrivacyNotice.tsx";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";

const PROJECT_ROOT = process.cwd();

const INTERNAL_OR_PRELAUNCH_COPY =
  /starter notice|legal review before (?:a )?(?:public )?launch|marked internally|owner\/legal review|\bD1\b|\bR2\b|\bthis release\b|(?:publication|publishing (?:a )?page) is not a claim of (?:legal )?compliance|organizer inbox|email-delivery provider|fixed organizer email|outside the application|anonymous browser cookie|IP[- ]address|user-agent|private keyed hash|raw network|CSRF|URL parameters|server validation|database behaviour|form transport/iu;

test("the public Privacy surface contains only visitor-facing policy copy", () => {
  const privacyPageSource = source("app/privacy/page.tsx");
  const privacyNoticeSource = source(
    "app/_components/PublicFormPrivacyNotice.tsx",
  );
  const privacySeed = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === "privacy",
  );

  assert.ok(privacySeed, "the public catalog must seed a Privacy page");
  assert.doesNotMatch(privacyPageSource, INTERNAL_OR_PRELAUNCH_COPY);
  assert.doesNotMatch(privacyNoticeSource, INTERNAL_OR_PRELAUNCH_COPY);
  assert.doesNotMatch(
    JSON.stringify(privacySeed.sections),
    INTERNAL_OR_PRELAUNCH_COPY,
  );
});

test("the rendered Privacy notice explains the site's real data boundaries", () => {
  const html = renderToStaticMarkup(
    React.createElement(PublicFormPrivacyNotice),
  );
  const text = visibleText(html);

  assert.doesNotMatch(text, INTERNAL_OR_PRELAUNCH_COPY);

  assert.match(text, /asks only for the details needed/iu);
  assert.match(text, /name[^.]*email[^.]*organization[^.]*topic/iu);
  assert.match(text, /Our team[^.]*(?:review|follow up)/iu);

  assert.match(text, /12 months/iu);
  assert.match(text, /review submissions 12 months/iu);
  assert.match(
    text,
    /request[^.]*(?:review|correct|correction)/iu,
    "the policy must explain how to request a review or correction",
  );
  assert.match(
    text,
    /request[^.]*(?:delete|deletion)/iu,
    "the policy must explain how to request deletion without promising an outcome",
  );
  assert.match(html, /href="\/contact"/u);
  assert.match(text, /Privacy topic/iu);

  assert.match(
    text,
    /Access is limited[^.]*people responsible/iu,
    "the policy must describe the access boundary",
  );
  assert.match(text, /protect submissions/iu);
  assert.match(text, /not used for advertising or attendee profiles/iu);

  assert.match(
    text,
    /(?:Meetup|third-party)[^.]*RSVP|RSVP[^.]*(?:Meetup|third-party)/iu,
    "the policy must identify external RSVP services",
  );
  assert.match(
    text,
    /(?:external|Meetup|third-party)[^.]*(?:privacy policy|privacy practices)|(?:privacy policy|privacy practices)[^.]*(?:external|Meetup|third-party)/iu,
    "visitors must know external destinations have their own privacy terms",
  );
  assert.match(
    text,
    /(?:site|website|Vancouver Curiosity Club)[^.]*(?:does not|doesn’t|doesn't)[^.]*(?:collect|receive|handle|process)[^.]*RSVP|RSVP[^.]*(?:happens|is|are)[^.]*(?:handled|processed)[^.]*Meetup/iu,
    "the policy must distinguish this site from the RSVP processor",
  );
});

function source(path) {
  return readFileSync(join(PROJECT_ROOT, path), "utf8");
}

function visibleText(html) {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/gu, " ")
    .trim();
}
