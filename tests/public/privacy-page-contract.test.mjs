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
  /starter notice|legal review before (?:a )?(?:public )?launch|marked internally|owner\/legal review|\bD1\b|\bR2\b|\bthis release\b|(?:publication|publishing (?:a )?page) is not a claim of (?:legal )?compliance/iu;

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

  assert.match(
    text,
    /Contact[^.]*name[^.]*reply email[^.]*topic[^.]*message/iu,
    "visitors must be told what the Contact form collects",
  );
  assert.match(
    text,
    /Volunteer[^.]*name[^.]*reply email[^.]*interest/iu,
    "visitors must be told what the Volunteer form collects",
  );
  assert.match(
    text,
    /Host an Event[^.]*name[^.]*reply email[^.]*event/iu,
    "visitors must be told what the hosting form collects",
  );
  assert.match(
    text,
    /Partnership or Funding Support[^.]*name[^.]*reply email[^.]*supporter[^.]*website/iu,
    "visitors must be told what the partnership form collects",
  );
  assert.match(
    text,
    /authorized[^.]*organizers[^.]*(?:review|respond)|(?:review|respond)[^.]*authorized[^.]*organizers/iu,
    "the form-data purpose and audience must be clear",
  );

  assert.match(text, /12 months/iu);
  assert.match(text, /retention[^.]*review|review[^.]*retention/iu);
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
    /(?:access|submissions?)[^.]*(?:limited|restricted)[^.]*authorized|only authorized[^.]*(?:access|review)/iu,
    "the policy must describe the access boundary",
  );
  assert.match(
    text,
    /(?:no|cannot)[^.]*guarantee[^.]*(?:security|secure)|(?:security|secure)[^.]*(?:cannot|not)[^.]*guarantee|(?:cannot|never|not)[^.]*completely secure|no[^.]*absolute security/iu,
    "the policy must not imply absolute security",
  );
  assert.match(text, /anonymous[^.]*cookie/iu);
  assert.match(text, /cookie[^.]*(?:one year|12 months)/iu);
  assert.match(text, /cookie[^.]*(?:abuse|rate-limit|retry)/iu);
  assert.match(
    text,
    /IP[- ]address[^.]*browser user-agent[^.]*accepted-language/iu,
    "the policy must identify the bounded request facts used for abuse limits",
  );
  assert.match(text, /private keyed[^.]*hash/iu);
  assert.match(text, /raw[^.]*(?:network|browser)[^.]*not stored/iu);

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
