import { MEETUP_PUBLICATION_HORIZON_DAYS } from "./meetup-publication-policy.js";
import { CANONICAL_PUBLIC_COMMUNITY_URLS } from "./public-community-order";
import {
  calendarDateInTimeZone,
  DEFAULT_TIME_ZONE,
  localDateTimeToUtcMs,
} from "./time";

type PublicationWindow = Readonly<{
  endDateExclusive: string;
  endsAtUtcMs: number;
}>;

type ScheduledPublicEvent = Readonly<{
  rsvpUrl: string | null;
  schedule:
    | Readonly<{ kind: "timed"; startsAtUtc: string }>
    | Readonly<{ kind: "all_day"; startDate: string }>;
}>;

const OFFICIAL_EVENT_PREFIXES = CANONICAL_PUBLIC_COMMUNITY_URLS.map(
  (url) => `${url}events/`,
);

// Pure calendar arithmetic only: no event data, authorization or publication
// decision is cached. The key changes at Vancouver midnight on every request.
let cachedCalendarWindow:
  | Readonly<{ todayDate: string; window: PublicationWindow }>
  | undefined;

export function publicMeetupPublicationWindow(nowUtcMs: number): PublicationWindow {
  const todayDate = calendarDateInTimeZone(nowUtcMs, DEFAULT_TIME_ZONE);
  if (cachedCalendarWindow?.todayDate === todayDate) {
    return cachedCalendarWindow.window;
  }
  const calendarDay = new Date(`${todayDate}T00:00:00.000Z`);
  calendarDay.setUTCDate(calendarDay.getUTCDate() + MEETUP_PUBLICATION_HORIZON_DAYS);
  const endDateExclusive = calendarDay.toISOString().slice(0, 10);
  const window = Object.freeze({
    endDateExclusive,
    endsAtUtcMs: localDateTimeToUtcMs(
      `${endDateExclusive}T00:00`,
      DEFAULT_TIME_ZONE,
      "earlier",
    ),
  });
  cachedCalendarWindow = Object.freeze({ todayDate, window });
  return window;
}

/** Upper visibility bound; ordinary upcoming/archive rules own the lower bound. */
export function isPublicEventWithinMeetupWindow(
  event: ScheduledPublicEvent,
  nowUtcMs: number,
): boolean {
  if (!event.rsvpUrl || !OFFICIAL_EVENT_PREFIXES.some(
    (prefix) => event.rsvpUrl?.startsWith(prefix),
  )) return true;
  const window = publicMeetupPublicationWindow(nowUtcMs);
  return event.schedule.kind === "timed"
    ? Date.parse(event.schedule.startsAtUtc) < window.endsAtUtcMs
    : event.schedule.startDate < window.endDateExclusive;
}
