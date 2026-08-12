import generatedManifest from "./meetup-event-enrichment.generated.json";
import {
  extractMeetupPublicEventFacts,
  validateMeetupPublicEventFactsCandidate,
} from "./meetup-public-event-facts.js";
import type { MeetupPublicEventFacts } from "./meetup-public-event-facts.js";

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
const MAX_DESCRIPTION_BLOCKS = 400;
const MAX_DESCRIPTION_INLINE_NODES = 4_000;
const MAX_DESCRIPTION_LIST_ITEMS = 300;
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
    "www.pewresearch.org",
    "www.reifelbirdsanctuary.com",
    "www.ted.com",
    "www.vatican.va",
    "www.youtube.com",
    "youtu.be",
  ]),
);
const PUBLIC_DESCRIPTION_LINK_QUERY_KEYS: Readonly<
  Record<string, ReadonlySet<string>>
> = Object.freeze({
  "m.youtube.com": Object.freeze(new Set(["index", "list", "start", "t", "v"])),
  "www.youtube.com": Object.freeze(
    new Set(["index", "list", "start", "t", "v"]),
  ),
  "youtu.be": Object.freeze(new Set(["list", "start", "t"])),
});

type AllowedMeetupGroupSlug =
  (typeof ALLOWED_MEETUP_GROUP_SLUGS)[number];

export type CuratedMeetupEventEnrichment = Readonly<{
  description: string;
  descriptionBlocks: readonly CuratedMeetupDescriptionBlock[];
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
  }> | null;
  summary: string;
  venue: Readonly<{
    address: string | null;
    city: string | null;
    name: string;
    state: string | null;
  }> | null;
}> & MeetupPublicEventFacts;

export type CuratedMeetupDescriptionInline =
  | Readonly<{ text: string; type: "strong" | "text" }>
  | Readonly<{ href: string; text: string; type: "link" }>;

export type CuratedMeetupDescriptionBlock =
  | Readonly<{
      content: readonly CuratedMeetupDescriptionInline[];
      level: 3 | 4;
      type: "heading";
    }>
  | Readonly<{
      content: readonly CuratedMeetupDescriptionInline[];
      type: "paragraph";
    }>
  | Readonly<{
      items: readonly (readonly CuratedMeetupDescriptionInline[])[];
      type: "ordered-list" | "unordered-list";
    }>;

export type CuratedMeetupPosterVariant = Readonly<{
  height: number;
  localPath: string;
  width: number;
}>;

if (generatedManifest.schemaVersion !== 3) {
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

/**
 * Reuse the same fail-closed semantic validator for description blocks staged
 * by the automatic Meetup source importer. The generated manifest remains a
 * fallback, but it is no longer the only path capable of preserving source
 * headings, lists, emphasis, and allowlisted links.
 */
export function validateMeetupDescriptionBlocks(
  candidate: unknown,
): readonly CuratedMeetupDescriptionBlock[] {
  return normalizePublicDescriptionBlocks(candidate);
}

/**
 * Older synchronized snapshots used a generic "Open example.com" label for a
 * bare URL and left the source call-to-action beside it as plain text. Keep
 * those already-published snapshots useful while newly imported descriptions
 * are normalized at ingestion time.
 */
export function meetupDescriptionBlocksForDisplay(
  blocks: readonly CuratedMeetupDescriptionBlock[],
  eventUrl: string | null = null,
): readonly CuratedMeetupDescriptionBlock[] {
  const normalized = blocks.map((block) => {
    const restoredHref = legacyExternalResourceHref(eventUrl, block);
    if ("items" in block) {
      return Object.freeze({
        items: Object.freeze(
          block.items.map((item, itemIndex) =>
            Object.freeze(
              normalizeLegacyDescriptionInlines(
                normalizeDescriptionCallToActionInlines(item),
                false,
                itemIndex === 0 ? restoredHref : null,
              ),
            ),
          ),
        ),
        type: block.type,
      });
    }
    const content = Object.freeze(
      normalizeLegacyDescriptionInlines(
        normalizeDescriptionCallToActionInlines(block.content),
        block.type === "heading",
        restoredHref,
      ),
    );
    return block.type === "heading"
      ? Object.freeze({ content, level: block.level, type: block.type })
      : Object.freeze({ content, type: block.type });
  });
  const merged: CuratedMeetupDescriptionBlock[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const block = normalized[index];
    const next = normalized[index + 1];
    const callToAction = standaloneDescriptionCallToAction(block);
    const link = standaloneGenericDescriptionLink(next);
    if (callToAction !== null && link !== null) {
      const content = Object.freeze([
        ...(callToAction.prefix
          ? [Object.freeze({ text: callToAction.prefix, type: "text" as const })]
          : []),
        Object.freeze({
          ...link,
          text: callToAction.label,
          type: "link" as const,
        }),
      ]);
      merged.push(
        block.type === "heading"
          ? Object.freeze({ content, level: block.level, type: block.type })
          : Object.freeze({ content, type: "paragraph" as const }),
      );
      index += 1;
      continue;
    }
    merged.push(block);
  }
  return Object.freeze(merged);
}

const LEGACY_PADDLEBOARDING_EVENT_URL =
  "https://www.meetup.com/vancouver-meetup-group/events/316069135/";
const PADDLEBOARDING_LESSON_URL =
  "https://deepcovekayak.com/lesson/intro-to-sup/";
const LEGACY_AUTISM_EVENT_URL =
  "https://www.meetup.com/vancouver-meetup-group/events/315969091/";
const AUTISM_SOURCE_URL =
  "https://cambridgecognition.com/autism-spectrum-disorder/";
const LEGACY_SUMMER_CINEMA_EVENT_URL =
  "https://www.meetup.com/vancouver-meetup-group/events/316069183/";
const SUMMER_CINEMA_URL = "https://summercinema.ca/";

function legacyExternalResourceHref(
  eventUrl: string | null,
  block: CuratedMeetupDescriptionBlock,
): string | null {
  const isStandalonePlaceholder =
    block.type === "paragraph" &&
    block.content.length === 1 &&
    block.content[0]?.type === "text" &&
    block.content[0].text === "External resource";
  if (isStandalonePlaceholder) {
    if (eventUrl === LEGACY_PADDLEBOARDING_EVENT_URL) {
      return PADDLEBOARDING_LESSON_URL;
    }
  }
  const isSummerCinemaPlaceholder =
    eventUrl === LEGACY_SUMMER_CINEMA_EVENT_URL &&
    block.type === "paragraph" &&
    block.content.length === 1 &&
    block.content[0]?.type === "text" &&
    block.content[0].text ===
      "Official Evo Summer Cinema details: External resource";
  if (isSummerCinemaPlaceholder) return SUMMER_CINEMA_URL;
  const isAutismSourcePlaceholder =
    eventUrl === LEGACY_AUTISM_EVENT_URL &&
    block.type === "unordered-list" &&
    block.items.length === 1 &&
    block.items[0]?.length === 1 &&
    block.items[0][0]?.type === "text" &&
    block.items[0][0].text === "External resource";
  return isAutismSourcePlaceholder ? AUTISM_SOURCE_URL : null;
}

function normalizeLegacyDescriptionInlines(
  inlines: readonly CuratedMeetupDescriptionInline[],
  heading: boolean,
  restoredHref: string | null,
): readonly CuratedMeetupDescriptionInline[] {
  return inlines.map((inline) => {
    if (
      restoredHref !== null &&
      inline.type === "text" &&
      (inline.text === "External resource" ||
        (restoredHref === SUMMER_CINEMA_URL &&
          inline.text ===
            "Official Evo Summer Cinema details: External resource"))
    ) {
      const displayHost = new URL(restoredHref).hostname.replace(/^www\./u, "");
      return Object.freeze({
        href: restoredHref,
        text:
          restoredHref === SUMMER_CINEMA_URL
            ? "Official Evo Summer Cinema details"
            : `Open ${displayHost}`,
        type: "link" as const,
      });
    }
    let text = inline.text
      .normalize("NFKC")
      .replace(/\\([!-/:-@\[-`{-~])/gu, "$1")
      .replace(/^\*\*([^*].*?:)\*$/u, "$1")
      .replace(/\*\(\*([^*]+)\)\*/gu, "($1)");
    if (heading) {
      const redundantStrong = /^\*\*\s*([^*].*?)\s*\*\*$/u.exec(text);
      text = redundantStrong?.[1]?.trim() ?? text;
    }
    return text === inline.text ? inline : Object.freeze({ ...inline, text });
  });
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
      `https://www.meetup.com/${candidate.groupSlug}/events/${candidate.eventId}/`
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
  const descriptionBlocks = normalizePublicDescriptionBlocks(
    candidate.descriptionBlocks,
  );
  if (meetupDescriptionBlocksToPlainText(descriptionBlocks) !== description) {
    throw new Error("Invalid curated Meetup event description structure.");
  }
  const poster = candidate.poster === null
    ? null
    : validateCuratedMeetupPoster(candidate.eventId, candidate.poster);
  const venue = normalizePublicVenue(candidate.venue);
  const publicEventFacts = validateMeetupPublicEventFactsCandidate(
    candidate,
    extractMeetupPublicEventFacts(description, {
      hasPublicVenue: venue !== null,
    }),
  );
  return Object.freeze({
    ...candidate,
    ...publicEventFacts,
    description,
    descriptionBlocks,
    groupSlug: candidate.groupSlug as AllowedMeetupGroupSlug,
    poster,
    summary,
    venue,
  });
}

function validateCuratedMeetupPoster(
  eventId: string,
  candidate: Exclude<
    (typeof generatedManifest.events)[number]["poster"],
    null
  >,
): NonNullable<CuratedMeetupEventEnrichment["poster"]> {
  const sourceAspectRatio = candidate.sourceWidth / candidate.sourceHeight;
  if (
    !/^https:\/\/secure\.meetupstatic\.com\/photos\/event\/[0-9a-f/]+\/highres_[0-9]+\.jpe?g$/iu.test(
      candidate.sourceUrl,
    ) ||
    candidate.sourceWidth < 480 ||
    candidate.sourceHeight < 270 ||
    sourceAspectRatio < 1.7 ||
    sourceAspectRatio > 1.82
  ) {
    throw new Error(`Invalid curated Meetup poster ${eventId}.`);
  }
  const altText = normalizePublicSafeSingleLine(
    candidate.altText,
    "poster alt text",
    300,
  );
  const credit = normalizePublicSafeSingleLine(
    candidate.credit,
    "poster credit",
    300,
  );
  for (const [size, variant] of Object.entries(candidate.variants)) {
    if (
      !["small", "medium", "large"].includes(size) ||
      variant.width < 1 ||
      variant.height < 1 ||
      variant.width > candidate.sourceWidth ||
      variant.height > candidate.sourceHeight ||
      !new RegExp(
        `^/event-posters/meetup-${eventId}(?:-[0-9]+)?\\.jpeg$`,
        "u",
      ).test(variant.localPath)
    ) {
      throw new Error(`Invalid curated Meetup poster ${eventId}.`);
    }
  }
  return Object.freeze({
    ...candidate,
    altText,
    credit,
    variants: Object.freeze({
      large: Object.freeze(candidate.variants.large),
      medium: Object.freeze(candidate.variants.medium),
      small: Object.freeze(candidate.variants.small),
    }),
  });
}

function normalizePublicDescriptionBlocks(
  candidate: unknown,
): readonly CuratedMeetupDescriptionBlock[] {
  if (
    !Array.isArray(candidate) ||
    candidate.length < 1 ||
    candidate.length > MAX_DESCRIPTION_BLOCKS
  ) {
    throw new Error("Invalid curated Meetup event description structure.");
  }
  const budget = { inlineNodes: 0, listItems: 0 };
  return Object.freeze(
    candidate.map((block) => normalizePublicDescriptionBlock(block, budget)),
  );
}

function normalizeDescriptionCallToActionInlines(
  inlines: readonly CuratedMeetupDescriptionInline[],
): CuratedMeetupDescriptionInline[] {
  const normalized: CuratedMeetupDescriptionInline[] = [];
  for (const inline of inlines) {
    const previous = normalized.at(-1);
    const callToAction =
      inline.type === "link" && isGenericDescriptionLinkText(inline.text)
        ? descriptionCallToAction(
            previous?.type === "text" ? previous.text : "",
          )
        : null;
    if (inline.type === "link" && callToAction !== null) {
      normalized.pop();
      if (callToAction.prefix) {
        normalized.push(
          Object.freeze({ text: callToAction.prefix, type: "text" }),
        );
      }
      normalized.push(
        Object.freeze({ ...inline, text: callToAction.label }),
      );
      continue;
    }
    normalized.push(inline);
  }
  return normalized;
}

function standaloneDescriptionCallToAction(
  block: CuratedMeetupDescriptionBlock | undefined,
): DescriptionCallToAction | null {
  if (block === undefined || "items" in block || block.content.length !== 1) {
    return null;
  }
  const inline = block.content[0];
  return inline.type === "text"
    ? descriptionCallToAction(inline.text)
    : null;
}

function standaloneGenericDescriptionLink(
  block: CuratedMeetupDescriptionBlock | undefined,
): Extract<CuratedMeetupDescriptionInline, { type: "link" }> | null {
  if (
    block === undefined ||
    block.type !== "paragraph" ||
    block.content.length !== 1
  ) {
    return null;
  }
  const inline = block.content[0];
  return inline.type === "link" && isGenericDescriptionLinkText(inline.text)
    ? inline
    : null;
}

type DescriptionCallToAction = Readonly<{ label: string; prefix: string }>;

function descriptionCallToAction(input: string): DescriptionCallToAction | null {
  const normalized = input.trimEnd();
  if (!normalized.endsWith(":")) return null;
  const candidate = normalized.slice(0, -1);
  const suffix = /(Buy\b[^:]{0,80}\bhere|Google Maps|(?:Official|Public|Reservation|Planning|Ticket|Tickets|YouTube|Video|Event|Film|Source) [^.!?:]{1,60}|(?:\d+-minute )?written summary)$/iu.exec(
    candidate,
  );
  const suffixIndex = suffix?.index ?? null;
  const wholeLabel = candidate.trim();
  const start =
    suffixIndex ??
    (wholeLabel.length <= 80 &&
    !/[.!?]/u.test(wholeLabel) &&
    !/^[,;:]/u.test(wholeLabel)
      ? candidate.indexOf(wholeLabel)
      : null);
  if (start === null) return null;
  const label = candidate.slice(start).trim();
  if (label.length < 3 || label.length > 80) return null;
  const rawPrefix = candidate.slice(0, start);
  const prefixIsOnlySpacing = rawPrefix.trim().length === 0;
  return Object.freeze({
    label: `${prefixIsOnlySpacing ? rawPrefix : ""}${label}`,
    prefix: prefixIsOnlySpacing ? "" : rawPrefix,
  });
}

function isGenericDescriptionLinkText(input: string): boolean {
  return /^Open [a-z0-9.-]+$/iu.test(input);
}

function normalizePublicDescriptionBlock(
  candidate: unknown,
  budget: { inlineNodes: number; listItems: number },
): CuratedMeetupDescriptionBlock {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new Error("Invalid curated Meetup event description block.");
  }
  const block = candidate as Record<string, unknown>;
  if (block.type === "paragraph") {
    assertExactDescriptionKeys(block, ["content", "type"]);
    return Object.freeze({
      content: normalizePublicDescriptionInlines(block.content, budget),
      type: "paragraph",
    });
  }
  if (block.type === "heading") {
    assertExactDescriptionKeys(block, ["content", "level", "type"]);
    if (block.level !== 3 && block.level !== 4) {
      throw new Error("Invalid curated Meetup event description heading.");
    }
    return Object.freeze({
      content: normalizePublicDescriptionInlines(block.content, budget),
      level: block.level,
      type: "heading",
    });
  }
  if (block.type === "ordered-list" || block.type === "unordered-list") {
    assertExactDescriptionKeys(block, ["items", "type"]);
    if (
      !Array.isArray(block.items) ||
      block.items.length < 1 ||
      block.items.length > MAX_DESCRIPTION_LIST_ITEMS
    ) {
      throw new Error("Invalid curated Meetup event description list.");
    }
    budget.listItems += block.items.length;
    if (budget.listItems > MAX_DESCRIPTION_LIST_ITEMS) {
      throw new Error("Invalid curated Meetup event description list.");
    }
    return Object.freeze({
      items: Object.freeze(
        block.items.map((item) =>
          normalizePublicDescriptionInlines(item, budget),
        ),
      ),
      type: block.type,
    });
  }
  throw new Error("Invalid curated Meetup event description block.");
}

function normalizePublicDescriptionInlines(
  candidate: unknown,
  budget: { inlineNodes: number },
): readonly CuratedMeetupDescriptionInline[] {
  if (!Array.isArray(candidate) || candidate.length < 1) {
    throw new Error("Invalid curated Meetup event description inline content.");
  }
  budget.inlineNodes += candidate.length;
  if (budget.inlineNodes > MAX_DESCRIPTION_INLINE_NODES) {
    throw new Error("Invalid curated Meetup event description inline content.");
  }
  return Object.freeze(
    candidate.map((inline) => normalizePublicDescriptionInline(inline)),
  );
}

function normalizePublicDescriptionInline(
  candidate: unknown,
): CuratedMeetupDescriptionInline {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new Error("Invalid curated Meetup event description inline content.");
  }
  const inline = candidate as Record<string, unknown>;
  if (inline.type === "text" || inline.type === "strong") {
    assertExactDescriptionKeys(inline, ["text", "type"]);
    return Object.freeze({
      text: normalizePublicDescriptionInlineText(inline.text),
      type: inline.type,
    });
  }
  if (inline.type === "link") {
    assertExactDescriptionKeys(inline, ["href", "text", "type"]);
    return Object.freeze({
      href: normalizePublicDescriptionLink(inline.href),
      text: normalizePublicDescriptionInlineText(inline.text),
      type: "link",
    });
  }
  throw new Error("Invalid curated Meetup event description inline content.");
}

function normalizePublicDescriptionInlineText(candidate: unknown): string {
  if (typeof candidate !== "string") {
    throw new Error("Invalid curated Meetup event description inline text.");
  }
  const value = candidate.normalize("NFKC").replace(/\s+/gu, " ");
  if (
    value !== candidate ||
    value.trim().length < 1 ||
    value.length > 5_000 ||
    UNSAFE_CONTROL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    FORBIDDEN_PUBLIC_TEXT_PATTERN.test(value)
  ) {
    throw new Error("Invalid curated Meetup event description inline text.");
  }
  return value;
}

function normalizePublicDescriptionLink(candidate: unknown): string {
  if (
    typeof candidate !== "string" ||
    candidate.length < 1 ||
    candidate.length > MAX_DESCRIPTION_LINK_LENGTH
  ) {
    throw new Error("Invalid curated Meetup event description link.");
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Invalid curated Meetup event description link.");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    !ALLOWED_PUBLIC_DESCRIPTION_LINK_HOSTS.has(host)
  ) {
    throw new Error("Invalid curated Meetup event description link.");
  }
  parsed.hostname = host;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (
      /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|g_st|ouid|rtpof|sd|usp)$/iu.test(
        key,
      )
    ) {
      parsed.searchParams.delete(key);
    }
  }
  const allowedQueryKeys = PUBLIC_DESCRIPTION_LINK_QUERY_KEYS[host];
  for (const key of parsed.searchParams.keys()) {
    if (!allowedQueryKeys?.has(key)) {
      throw new Error("Invalid curated Meetup event description link.");
    }
  }
  const normalized = parsed.toString();
  if (normalized !== candidate || normalized.length > MAX_DESCRIPTION_LINK_LENGTH) {
    throw new Error("Invalid curated Meetup event description link.");
  }
  return normalized;
}

function assertExactDescriptionKeys(
  candidate: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(candidate).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== [...expected].sort()[index])
  ) {
    throw new Error("Invalid curated Meetup event description structure.");
  }
}

export function meetupDescriptionBlocksToPlainText(
  blocks: readonly CuratedMeetupDescriptionBlock[],
): string {
  return blocks
    .map((block) => {
      if ("items" in block) {
        return block.items
          .map((item, index) => {
            const marker = block.type === "ordered-list" ? `${index + 1}.` : "•";
            return `${marker} ${descriptionInlinesToText(item)}`;
          })
          .join("\n");
      }
      return descriptionInlinesToText(block.content);
    })
    .join("\n\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function descriptionInlinesToText(
  inlines: readonly CuratedMeetupDescriptionInline[],
): string {
  return inlines.map((inline) => inline.text).join("").trim();
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
