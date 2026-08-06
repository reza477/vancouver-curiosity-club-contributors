import generatedManifest from "./meetup-event-enrichment.generated.json";

const ALLOWED_MEETUP_GROUP_SLUGS = Object.freeze([
  "vancouver-fantasy-scifi-meetup-group",
  "vancouver-literature-and-film",
  "vancouver-meetup-group",
] as const);

const FORBIDDEN_PUBLIC_TEXT_PATTERN =
  /(?:https?:\/\/|\bwww\.|\b(?:mailto|tel|sms|javascript|data):|\b(?:zoom\.us|meet\.google|teams\.microsoft\.com|webex\.com|discord\.gg)\b|\b(?:passcode|password|access\s+code)\b|\b(?:token|key|pwd)=)/iu;
const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;

type AllowedMeetupGroupSlug =
  (typeof ALLOWED_MEETUP_GROUP_SLUGS)[number];

export type CuratedMeetupEventEnrichment = Readonly<{
  description: string;
  eventId: string;
  eventUrl: string;
  groupSlug: AllowedMeetupGroupSlug;
  poster: Readonly<{
    altText: string;
    credit: string;
    sourceHeight: number;
    sourceUrl: string;
    sourceWidth: number;
    variants: Readonly<{
      large: CuratedMeetupPosterVariant;
      medium: CuratedMeetupPosterVariant;
      small: CuratedMeetupPosterVariant;
    }>;
  }>;
  summary: string;
  venue: Readonly<{
    address: string | null;
    city: string | null;
    name: string;
    state: string | null;
  }> | null;
}>;

export type CuratedMeetupPosterVariant = Readonly<{
  height: number;
  localPath: string;
  width: number;
}>;

if (generatedManifest.schemaVersion !== 1) {
  throw new Error("Unsupported curated Meetup enrichment schema.");
}

export const CURATED_MEETUP_EVENT_ENRICHMENTS = Object.freeze(
  Object.fromEntries(
    generatedManifest.events.map((candidate) => {
      const event = validateCuratedMeetupEventCandidate(candidate);
      return [event.eventId, event] as const;
    }),
  ),
) as Readonly<Record<string, CuratedMeetupEventEnrichment>>;

export function curatedMeetupEventForEventUrl(
  eventUrl: string | null,
): CuratedMeetupEventEnrichment | null {
  if (eventUrl === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(eventUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "www.meetup.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return null;
  }
  const match = /^\/([^/]+)\/events\/([0-9]+)\/?$/u.exec(
    parsed.pathname,
  );
  if (!match) return null;
  const candidate = CURATED_MEETUP_EVENT_ENRICHMENTS[match[2]] ?? null;
  if (
    candidate === null ||
    candidate.groupSlug !== match[1] ||
    candidate.eventUrl !== parsed.href
  ) {
    return null;
  }
  return candidate;
}

export function validateCuratedMeetupEventCandidate(
  candidate: (typeof generatedManifest.events)[number],
): CuratedMeetupEventEnrichment {
  if (
    !/^[0-9]{6,20}$/u.test(candidate.eventId) ||
    !ALLOWED_MEETUP_GROUP_SLUGS.includes(
      candidate.groupSlug as AllowedMeetupGroupSlug,
    ) ||
    candidate.eventUrl !==
      `https://www.meetup.com/${candidate.groupSlug}/events/${candidate.eventId}/` ||
    !/^https:\/\/secure\.meetupstatic\.com\/photos\/event\/[0-9a-f/]+\/highres_[0-9]+\.jpe?g$/iu.test(
      candidate.poster.sourceUrl,
    ) ||
    candidate.poster.sourceWidth < 1_200 ||
    candidate.poster.sourceHeight < 600
  ) {
    throw new Error(`Invalid curated Meetup event ${candidate.eventId}.`);
  }
  const summary = normalizePublicSafeSingleLine(
    candidate.summary,
    "event summary",
    500,
    10,
  );
  const description = normalizePublicSafeMultiline(
    candidate.description,
    "event description",
    20_000,
    10,
  );
  const altText = normalizePublicSafeSingleLine(
    candidate.poster.altText,
    "poster alt text",
    300,
  );
  const credit = normalizePublicSafeSingleLine(
    candidate.poster.credit,
    "poster credit",
    300,
  );
  for (const [size, variant] of Object.entries(
    candidate.poster.variants,
  )) {
    if (
      !["small", "medium", "large"].includes(size) ||
      variant.width < 1 ||
      variant.height < 1 ||
      variant.width > candidate.poster.sourceWidth ||
      variant.height > candidate.poster.sourceHeight ||
      !new RegExp(
        `^/event-posters/meetup-${candidate.eventId}(?:-[0-9]+)?\\.jpeg$`,
        "u",
      ).test(variant.localPath)
    ) {
      throw new Error(`Invalid curated Meetup poster ${candidate.eventId}.`);
    }
  }
  const venue = normalizePublicVenue(candidate.venue);
  return Object.freeze({
    ...candidate,
    description,
    groupSlug: candidate.groupSlug as AllowedMeetupGroupSlug,
    poster: Object.freeze({
      ...candidate.poster,
      altText,
      credit,
      variants: Object.freeze({
        large: Object.freeze(candidate.poster.variants.large),
        medium: Object.freeze(candidate.poster.variants.medium),
        small: Object.freeze(candidate.poster.variants.small),
      }),
    }),
    summary,
    venue,
  });
}

function normalizePublicVenue(
  candidate: unknown,
): CuratedMeetupEventEnrichment["venue"] {
  if (candidate === null || candidate === undefined) return null;
  if (
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error("Invalid curated Meetup venue.");
  }
  const row = candidate as Record<string, unknown>;
  const name = normalizeOptionalPublicSafeSingleLine(
    row.name,
    "venue name",
    200,
  );
  // An anonymous Meetup response can intentionally omit its public venue.
  // Never infer a location from any remaining object fields in that case.
  if (name === null) return null;
  return Object.freeze({
    address: normalizeOptionalPublicSafeSingleLine(
      row.address,
      "venue address",
      300,
    ),
    city: normalizeOptionalPublicSafeSingleLine(
      row.city,
      "venue city",
      120,
    ),
    name,
    state: normalizeOptionalPublicSafeSingleLine(
      row.state,
      "venue state",
      120,
    ),
  });
}

function normalizeOptionalPublicSafeSingleLine(
  input: unknown,
  label: string,
  maximum: number,
): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "string" && input.trim() === "") return null;
  return normalizePublicSafeSingleLine(input, label, maximum);
}

function normalizePublicSafeSingleLine(
  input: unknown,
  label: string,
  maximum: number,
  minimum = 1,
): string {
  if (typeof input !== "string") {
    throw new Error(`Invalid curated Meetup ${label}.`);
  }
  const value = input.normalize("NFKC").replace(/\s+/gu, " ").trim();
  assertPublicSafeText(value, label, maximum, minimum);
  return value;
}

function normalizePublicSafeMultiline(
  input: unknown,
  label: string,
  maximum: number,
  minimum = 1,
): string {
  if (typeof input !== "string") {
    throw new Error(`Invalid curated Meetup ${label}.`);
  }
  const value = input
    .normalize("NFKC")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  assertPublicSafeText(value, label, maximum, minimum);
  return value;
}

function assertPublicSafeText(
  value: string,
  label: string,
  maximum: number,
  minimum: number,
): void {
  if (
    value.length < minimum ||
    value.length > maximum ||
    UNSAFE_CONTROL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    FORBIDDEN_PUBLIC_TEXT_PATTERN.test(value)
  ) {
    throw new Error(`Invalid curated Meetup ${label}.`);
  }
}
