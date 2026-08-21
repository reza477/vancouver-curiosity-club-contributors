import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

const PUBLIC_SURFACES = Object.freeze([
  "app/_components/ClubDetailRenderer.tsx",
  "app/_components/ClubDirectory.tsx",
  "app/_components/EditorialPage.tsx",
  "app/_components/EditorialRouteBodies.tsx",
  "app/_components/ProgramDetailRenderer.tsx",
  "app/_components/PublicFormPrivacyNotice.tsx",
  "app/_components/PublicSubmissionForm.tsx",
  "app/clubs/[slug]/page.tsx",
  "app/clubs/[slug]/programs/[programSlug]/page.tsx",
  "app/for-organizations/page.tsx",
  "app/privacy/page.tsx",
]);

const INTERNAL_OR_DEFENSIVE_COPY =
  /could not be stored|not claims? about existing partnerships|temporary substitute|defensive draft|organizer inbox|email-delivery provider|anonymous browser cookie|private keyed hash|raw network|form transport/iu;

test("institutional public surfaces avoid internal and defensive implementation language", async () => {
  for (const path of PUBLIC_SURFACES) {
    const source = await readFile(new URL(path, projectRoot), "utf8");
    assert.doesNotMatch(
      source,
      INTERNAL_OR_DEFENSIVE_COPY,
      `${path} must speak to visitors rather than expose implementation details`,
    );
  }
});

test("product-owned route copy overrides legacy CMS introductions", async () => {
  const routeBodies = await readFile(
    new URL("app/_components/EditorialRouteBodies.tsx", projectRoot),
    "utf8",
  );
  const privacyPage = await readFile(
    new URL("app/privacy/page.tsx", projectRoot),
    "utf8",
  );

  assert.ok(
    routeBodies.match(/displayParagraphs=\{\[\]\}/gu)?.length >= 3,
    "Get Involved, Contact, and Host must suppress stale CMS introductions",
  );
  assert.match(
    privacyPage,
    /displayParagraphs=\{\[\]\}/u,
    "Privacy must suppress stale CMS introduction copy",
  );
});
