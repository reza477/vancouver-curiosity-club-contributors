import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PUBLIC_METADATA_DESCRIPTION_LENGTH,
  buildPublicEventMetadataDescription,
} from "../../lib/server/public/metadata.ts";

const FALLBACK = "Event details from Vancouver Curiosity Club.";

test("event metadata prefers a complete useful sentence within the concise limit", () => {
  const firstSentence =
    "Join a thoughtful Vancouver conversation about imagination, evidence, and the stories that shape public life.";
  const description = buildPublicEventMetadataDescription({
    description: "A separate long-form event body.",
    fallback: FALLBACK,
    metaDescription: null,
    summary: `${firstSentence} ${"Additional context keeps going beyond the metadata limit. ".repeat(4)}`,
  });

  assert.equal(description, firstSentence);
  assert.ok(description.length <= MAX_PUBLIC_METADATA_DESCRIPTION_LENGTH);
});

test("event metadata truncation stops after a complete word", () => {
  const description = buildPublicEventMetadataDescription({
    description: "A separate long-form event body.",
    fallback: FALLBACK,
    metaDescription: null,
    summary:
      "Curious neighbours gather for an open discussion with careful listening and practical prompts that make it easy to participate without preparation " +
      "while the rest of this deliberately long summary continues",
  });

  assert.ok(description.length <= MAX_PUBLIC_METADATA_DESCRIPTION_LENGTH);
  assert.match(description, /\p{L}…$/u);
  assert.doesNotMatch(description, /prepar…$/u);
});

test("event metadata never republishes the full imported description as its summary", () => {
  const importedDescription =
    "This complete imported description is intentionally short enough to fit in metadata but belongs only in the event body.";
  assert.equal(
    buildPublicEventMetadataDescription({
      description: importedDescription,
      fallback: FALLBACK,
      metaDescription: importedDescription,
      summary: null,
    }),
    FALLBACK,
  );
});

test("pathological unbroken input uses the safe generated fallback instead of cutting mid-word", () => {
  assert.equal(
    buildPublicEventMetadataDescription({
      description: null,
      fallback: FALLBACK,
      metaDescription: null,
      summary: "x".repeat(500),
    }),
    FALLBACK,
  );
});

test("concise metadata is normalized without destructive rewriting", () => {
  assert.equal(
    buildPublicEventMetadataDescription({
      description: "A different event body.",
      fallback: FALLBACK,
      metaDescription: "  A concise\nowner-approved event summary.  ",
      summary: null,
    }),
    "A concise owner-approved event summary.",
  );
});
