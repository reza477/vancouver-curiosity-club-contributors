import { parseOfficialMeetupEventUrl } from "./url";

export type MeetupEventAlias = Readonly<{
  aliasUrl: string;
  canonicalUrl: string;
  maxTimedEndDriftMs?: number;
}>;

const MAX_OWNER_REVIEWED_TIMED_END_DRIFT_MS = 30 * 60 * 1_000;

/**
 * Part of the importer policy recorded in each calendar snapshot hash. Bump
 * this when alias interpretation changes even if the exact URL inventory does
 * not; the inventory itself is also hashed so adding or removing a pair
 * restarts any in-flight generation deterministically.
 */
export const MEETUP_EVENT_ALIAS_POLICY_VERSION = "exact_url_v3";

const EXACT_EVENT_ALIASES = [
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315511475/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315508432/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315511480/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315508537/",
    // Meetup's two public Titanic listings currently disagree only on the end
    // time by 30 minutes. Keep this exception pair-specific and bounded; every
    // other owner-reviewed alias remains an exact schedule match.
    maxTimedEndDriftMs: MAX_OWNER_REVIEWED_TIMED_END_DRIFT_MS,
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315675704/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315675534/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315772829/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315772811/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315823081/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315823022/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315976207/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315294587/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315511485/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315510842/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315851495/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315851485/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315776403/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315776148/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315511487/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315510890/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/315777485/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315777434/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/316159366/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/316159440/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/316050934/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/316050915/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/316263002/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/316263063/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/316263346/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/316263362/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-meetup-group/events/316248155/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/316248163/",
  },
  {
    aliasUrl:
      "https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/events/315776566/",
    canonicalUrl:
      "https://www.meetup.com/vancouver-literature-and-film/events/315776601/",
  },
] as const;

const NUMERIC_EVENT_URL = /\/events\/[0-9]+\/$/u;

function exactNumericMeetupEventUrl(value: string): string {
  const canonical = parseOfficialMeetupEventUrl(value, "meetupEventAlias");
  if (canonical !== value || !NUMERIC_EVENT_URL.test(canonical)) {
    throw new TypeError(
      "Meetup event aliases must use exact canonical numeric event URLs.",
    );
  }
  return canonical;
}

function groupSlug(value: string): string {
  return new URL(value).pathname.split("/")[1] ?? "";
}

function validatedAliases(
  aliases: readonly MeetupEventAlias[],
): readonly MeetupEventAlias[] {
  const aliasUrls = new Set<string>();
  const canonicalUrls = new Set<string>();
  const validated = aliases.map((entry) => {
    const aliasUrl = exactNumericMeetupEventUrl(entry.aliasUrl);
    const canonicalUrl = exactNumericMeetupEventUrl(entry.canonicalUrl);
    const maxTimedEndDriftMs = entry.maxTimedEndDriftMs ?? 0;
    if (
      aliasUrl === canonicalUrl ||
      groupSlug(aliasUrl) === groupSlug(canonicalUrl) ||
      aliasUrls.has(aliasUrl) ||
      canonicalUrls.has(canonicalUrl) ||
      !Number.isSafeInteger(maxTimedEndDriftMs) ||
      maxTimedEndDriftMs < 0 ||
      maxTimedEndDriftMs > MAX_OWNER_REVIEWED_TIMED_END_DRIFT_MS
    ) {
      throw new TypeError("Meetup event aliases must be unique cross-group pairs.");
    }
    aliasUrls.add(aliasUrl);
    canonicalUrls.add(canonicalUrl);
    return Object.freeze({ aliasUrl, canonicalUrl, maxTimedEndDriftMs });
  });
  for (const entry of validated) {
    if (aliasUrls.has(entry.canonicalUrl)) {
      throw new TypeError("Meetup event alias chains and cycles are not allowed.");
    }
  }
  return Object.freeze(validated);
}

export const MEETUP_EVENT_ALIASES = validatedAliases(EXACT_EVENT_ALIASES);

const EVENT_ALIAS_BY_URL = new Map(
  MEETUP_EVENT_ALIASES.map((entry) => [entry.aliasUrl, entry]),
);

export const MEETUP_EVENT_ALIAS_URLS = Object.freeze(
  MEETUP_EVENT_ALIASES.map((entry) => entry.aliasUrl),
);

export function canonicalMeetupEventUrlForAlias(
  eventUrl: string,
): string | null {
  return EVENT_ALIAS_BY_URL.get(eventUrl)?.canonicalUrl ?? null;
}

export function meetupEventAliasForUrl(
  eventUrl: string,
): MeetupEventAlias | null {
  return EVENT_ALIAS_BY_URL.get(eventUrl) ?? null;
}
