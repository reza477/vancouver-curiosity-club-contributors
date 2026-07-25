import {
  parseBoundedString,
  validationIssue,
} from "../../validation";

const OFFICIAL_MEETUP_HOSTS = new Set(["meetup.com", "www.meetup.com"]);
const GROUP_SEGMENT = "[A-Za-z0-9][A-Za-z0-9_-]{0,119}";
const EVENT_SEGMENT = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const GROUP_CALENDAR_PATH = new RegExp(
  `^/(${GROUP_SEGMENT})/events/ical/?$`,
  "u",
);
const EVENT_PATH = new RegExp(
  `^/(${GROUP_SEGMENT})/events/(${EVENT_SEGMENT})/?$`,
  "u",
);

export type MeetupGroupCalendarFeed = Readonly<{
  groupSlug: string;
  url: string;
}>;

export function parseMeetupGroupCalendarFeedUrl(
  value: unknown,
  path = "feedUrl",
): MeetupGroupCalendarFeed {
  const parsed = parseOfficialMeetupUrl(value, path);
  const match = GROUP_CALENDAR_PATH.exec(parsed.pathname);
  if (
    !match ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw validationIssue(
      path,
      "invalid_meetup_calendar_url",
      "Expected an official Meetup group calendar export URL.",
    );
  }
  const groupSlug = match[1].toLowerCase();
  return Object.freeze({
    groupSlug,
    url: `https://www.meetup.com/${groupSlug}/events/ical/`,
  });
}

export function parseOfficialMeetupEventUrl(
  value: unknown,
  path = "eventUrl",
): string {
  const parsed = parseOfficialMeetupUrl(value, path);
  const match = EVENT_PATH.exec(parsed.pathname);
  if (!match) {
    throw validationIssue(
      path,
      "invalid_meetup_event_url",
      "Expected an official Meetup event URL.",
    );
  }
  return `https://www.meetup.com/${match[1]}/events/${match[2]}/`;
}

export function isOfficialMeetupEventUrl(value: unknown): value is string {
  try {
    parseOfficialMeetupEventUrl(value);
    return true;
  } catch {
    return false;
  }
}

function parseOfficialMeetupUrl(value: unknown, path: string): URL {
  const input = parseBoundedString(value, {
    path,
    maxLength: 2_048,
  });
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw validationIssue(path, "invalid_url", "Expected a valid URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    !OFFICIAL_MEETUP_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw validationIssue(
      path,
      "invalid_meetup_url",
      "Expected an official secure Meetup URL.",
    );
  }
  return parsed;
}
