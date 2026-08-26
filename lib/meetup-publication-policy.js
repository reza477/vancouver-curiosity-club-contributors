const MAX_DESCRIPTION_LINK_LENGTH = 2_048;

const ALLOWED_PUBLIC_DESCRIPTION_LINK_HOSTS = Object.freeze(
  new Set([
    "docs.google.com",
    "cambridgecognition.com",
    "deepcovekayak.com",
    "drive.google.com",
    "m.youtube.com",
    "maps.app.goo.gl",
    "reifelsanctuary.calendarspots.com",
    "summercinema.ca",
    "vancouver.ca",
    "viff.org",
    "www.focusfeatures.com",
    "www.gutenberg.org",
    "www.navneuro.com",
    "www.pbs.org",
    "www.pewresearch.org",
    "www.reifelbirdsanctuary.com",
    "www.ted.com",
    "www.vatican.va",
    "www.vogue.com",
    "www.youtube.com",
    "youtu.be",
  ]),
);

const PUBLIC_DESCRIPTION_LINK_QUERY_KEYS = Object.freeze({
  "m.youtube.com": Object.freeze(new Set(["index", "list", "start", "t", "v"])),
  "www.youtube.com": Object.freeze(
    new Set(["index", "list", "start", "t", "v"]),
  ),
  "youtu.be": Object.freeze(new Set(["list", "start", "t"])),
});

const CHEKHOV_CANONICAL_EVENT_ID = "315823022";
const APPROVED_PUBLIC_FLOOR = "Level 8";
const APPROVED_CHEKHOV_FLOOR_CLAIMS = Object.freeze(
  new Set(["number:8", "number:9"]),
);

export const MEETUP_EDITORIAL_OVERRIDE_POLICY_VERSION =
  "owner_approved_event_facts_v1";

// Owner-directed public horizon for the current event-maintenance cycle.
// Importers retain the complete Meetup source inventory; only the public
// projection excludes events beginning after this date.
export const MEETUP_PUBLICATION_END_DATE = "2026-09-30";
export const MEETUP_PUBLICATION_END_DATE_EXCLUSIVE = "2026-10-01";
export const MEETUP_PUBLICATION_WINDOW_EFFECTIVE_AT_UTC_MS = 1_787_702_400_000;

/**
 * Owner-approved facts are intentionally keyed by both the exact Meetup group
 * and event ID. They are a public projection policy, not a rewrite of imported
 * source material.
 */
export const APPROVED_MEETUP_EVENT_EDITORIAL_OVERRIDES = Object.freeze({
  "vancouver-literature-and-film/315823022": Object.freeze({
    approvedPublicFloor: APPROVED_PUBLIC_FLOOR,
    canonicalEventId: CHEKHOV_CANONICAL_EVENT_ID,
    eventId: "315823022",
    groupSlug: "vancouver-literature-and-film",
  }),
  "vancouver-meetup-group/315823081": Object.freeze({
    approvedPublicFloor: APPROVED_PUBLIC_FLOOR,
    canonicalEventId: CHEKHOV_CANONICAL_EVENT_ID,
    eventId: "315823081",
    groupSlug: "vancouver-meetup-group",
  }),
});

const STALE_CHEKHOV_FLOOR_PATTERN =
  /\b(?:(?:Level|Floor)\s*:?\s*9(?:th)?|9th(?:[ -]+)floor|ninth(?:[ -]+)floor)\b/giu;

const STALE_CHEKHOV_FLOOR_TEST_PATTERN =
  /\b(?:(?:Level|Floor)\s*:?\s*9(?:th)?|9th(?:[ -]+)floor|ninth(?:[ -]+)floor)\b/iu;

const TRAILING_TICKET_OR_RSVP_CTA_PATTERN =
  /(?:\b(?:buy|get|purchase|book|reserve)\b[^.!?\n]{0,100}\b(?:tickets?|passes?|seats?)\b(?:\s+(?:here|now|online))?|\b(?:rsvp|register|sign\s+up)\b[^.!?\n]{0,80}\b(?:here|now|online)\b|\b(?:tickets?|registration|rsvp)\s+(?:link|page)\b|\b(?:click|tap)\s+here\s+to\s+(?:buy|book|reserve|rsvp|register)\b[^.!?\n]{0,80})\s*:?\s*$/iu;

const NAMED_FLOORS = Object.freeze(
  new Set(["ground", "lower", "main", "mezzanine", "upper"]),
);

const ORDINAL_FLOOR_WORDS = Object.freeze({
  eighth: 8,
  ninth: 9,
});

export function approvedMeetupEventEditorialOverride(groupSlug, eventId) {
  if (typeof groupSlug !== "string" || typeof eventId !== "string") return null;
  return (
    APPROVED_MEETUP_EVENT_EDITORIAL_OVERRIDES[
      `${groupSlug}/${eventId}`
    ] ?? null
  );
}

/**
 * Apply the exact Chekhov venue correction to a derived public projection.
 * The caller retains its raw source object and persists only this returned
 * projection. Unexpected floor claims fail instead of being silently guessed.
 */
export function applyApprovedMeetupEventEditorialOverride(input) {
  const override = approvedMeetupEventEditorialOverride(
    input.groupSlug,
    input.eventId,
  );
  if (override === null) {
    return Object.freeze({
      approvedPublicFloor: null,
      description: input.description,
      descriptionBlocks: input.descriptionBlocks,
    });
  }

  const rawClaims = extractMeetupPublicFloorClaimKeys(input.description);
  if (rawClaims.some((claim) => !APPROVED_CHEKHOV_FLOOR_CLAIMS.has(claim))) {
    throw new Error("Approved Meetup editorial override found an unexpected floor claim.");
  }

  const description = replaceStaleChekhovFloor(input.description);
  const descriptionBlocks = Object.freeze(
    input.descriptionBlocks.map((block) => replaceFloorInDescriptionBlock(block)),
  );
  if (
    STALE_CHEKHOV_FLOOR_TEST_PATTERN.test(description) ||
    descriptionBlocks.some((block) =>
      STALE_CHEKHOV_FLOOR_TEST_PATTERN.test(descriptionBlockText(block)),
    )
  ) {
    throw new Error("Approved Meetup editorial override left stale floor wording.");
  }
  const correctedClaims = extractMeetupPublicFloorClaimKeys(description);
  if (
    correctedClaims.length > 1 ||
    (correctedClaims.length === 1 && correctedClaims[0] !== "number:8")
  ) {
    throw new Error("Approved Meetup editorial override produced conflicting floor claims.");
  }
  return Object.freeze({
    approvedPublicFloor: override.approvedPublicFloor,
    description,
    descriptionBlocks,
  });
}

export function extractMeetupPublicFloorClaimKeys(input) {
  if (typeof input !== "string") return Object.freeze([]);
  const claims = [];
  const leadingPattern =
    /\b(?:Level|Floor)\s*:?\s*(\d{1,3})(?:st|nd|rd|th)?\b/giu;
  for (const match of input.matchAll(leadingPattern)) {
    claims.push(`number:${Number(match[1])}`);
  }
  const ordinalPattern = /\b(\d{1,3})(?:st|nd|rd|th)[ -]+floor\b/giu;
  for (const match of input.matchAll(ordinalPattern)) {
    claims.push(`number:${Number(match[1])}`);
  }
  const namedLeadingPattern =
    /\b(?:Level|Floor)\s*:?\s*(ground|lower|main|mezzanine|upper)\b/giu;
  for (const match of input.matchAll(namedLeadingPattern)) {
    const value = match[1].toLowerCase();
    if (NAMED_FLOORS.has(value)) claims.push(`named:${value}`);
  }
  const wordOrdinalPattern = /\b(eighth|ninth)[ -]+floor\b/giu;
  for (const match of input.matchAll(wordOrdinalPattern)) {
    const value = ORDINAL_FLOOR_WORDS[match[1].toLowerCase()];
    if (value !== undefined) claims.push(`number:${value}`);
  }
  return Object.freeze([...new Set(claims)]);
}

export function splitTrailingMeetupTicketOrRsvpCallToAction(input) {
  if (typeof input !== "string" || input.length > 5_000) return null;
  const match = TRAILING_TICKET_OR_RSVP_CTA_PATTERN.exec(input);
  if (match === null || match.index < 0) return null;
  return Object.freeze({
    callToAction: input.slice(match.index),
    prefix: input.slice(0, match.index).trimEnd(),
  });
}

/**
 * Remove actionable ticket/RSVP wording unless that exact wording is backed
 * by an allowlisted public link. This is safe to run at ingestion and again at
 * render time for older synchronized snapshots.
 */
export function removeOrphanMeetupTicketAndRsvpCallToActions(blocks) {
  const sanitized = [];
  for (const block of blocks) {
    if ("items" in block) {
      const items = block.items
        .map((item) => sanitizeDescriptionInlines(item))
        .filter((item) => item.length > 0);
      if (items.length > 0) {
        sanitized.push(
          Object.freeze({ items: Object.freeze(items), type: block.type }),
        );
      }
      continue;
    }
    const content = sanitizeDescriptionInlines(block.content);
    if (content.length < 1) continue;
    sanitized.push(
      block.type === "heading"
        ? Object.freeze({ content, level: block.level, type: block.type })
        : Object.freeze({ content, type: block.type }),
    );
  }
  return Object.freeze(sanitized);
}

export function isAllowedMeetupPublicDescriptionHref(input) {
  if (
    typeof input !== "string" ||
    input.length < 1 ||
    input.length > MAX_DESCRIPTION_LINK_LENGTH
  ) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== "" ||
    parsed.hostname !== host ||
    !ALLOWED_PUBLIC_DESCRIPTION_LINK_HOSTS.has(host)
  ) {
    return false;
  }
  const allowedQueryKeys = PUBLIC_DESCRIPTION_LINK_QUERY_KEYS[host];
  for (const key of parsed.searchParams.keys()) {
    if (!allowedQueryKeys?.has(key)) return false;
  }
  return parsed.toString() === input;
}

function replaceStaleChekhovFloor(input) {
  return input.replace(STALE_CHEKHOV_FLOOR_PATTERN, APPROVED_PUBLIC_FLOOR);
}

function replaceFloorInDescriptionBlock(block) {
  if ("items" in block) {
    return Object.freeze({
      items: Object.freeze(
        block.items.map((item) => replaceFloorInDescriptionInlines(item)),
      ),
      type: block.type,
    });
  }
  const content = replaceFloorInDescriptionInlines(block.content);
  return block.type === "heading"
    ? Object.freeze({ content, level: block.level, type: block.type })
    : Object.freeze({ content, type: block.type });
}

function replaceFloorInDescriptionInlines(inlines) {
  return Object.freeze(
    inlines.map((inline) => {
      const text = replaceStaleChekhovFloor(inline.text);
      return text === inline.text ? inline : Object.freeze({ ...inline, text });
    }),
  );
}

function descriptionBlockText(block) {
  return ("items" in block ? block.items.flat() : block.content)
    .map((inline) => inline.text)
    .join("");
}

function sanitizeDescriptionInlines(inlines) {
  const allowedInlines = inlines.filter(
    (inline) =>
      inline.type !== "link" ||
      isAllowedMeetupPublicDescriptionHref(inline.href),
  );
  const text = allowedInlines.map((inline) => inline.text).join("");
  const callToAction = splitTrailingMeetupTicketOrRsvpCallToAction(text);
  if (callToAction === null) return Object.freeze(allowedInlines);

  const callToActionStart = callToAction.prefix.length;
  let cursor = 0;
  let hasBackingLink = false;
  for (const inline of allowedInlines) {
    const nextCursor = cursor + inline.text.length;
    if (
      inline.type === "link" &&
      nextCursor > callToActionStart &&
      isAllowedMeetupPublicDescriptionHref(inline.href)
    ) {
      hasBackingLink = true;
      break;
    }
    cursor = nextCursor;
  }
  if (hasBackingLink) return Object.freeze(allowedInlines);
  return truncateDescriptionInlines(allowedInlines, callToActionStart);
}

function truncateDescriptionInlines(inlines, maximumTextLength) {
  const result = [];
  let cursor = 0;
  for (const inline of inlines) {
    if (cursor >= maximumTextLength) break;
    const remaining = maximumTextLength - cursor;
    const text = inline.text.slice(0, remaining);
    if (text !== "") {
      result.push(
        text === inline.text ? inline : Object.freeze({ ...inline, text }),
      );
    }
    cursor += inline.text.length;
  }
  while (result.length > 0) {
    const last = result.at(-1);
    const text = last.text.trimEnd();
    if (text === "") {
      result.pop();
      continue;
    }
    if (text !== last.text) {
      result[result.length - 1] = Object.freeze({ ...last, text });
    }
    break;
  }
  return Object.freeze(result);
}
