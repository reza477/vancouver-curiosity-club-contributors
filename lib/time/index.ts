import {
  parseBoundedString,
  validationIssue,
} from "../validation";

export const DEFAULT_TIME_ZONE = "America/Vancouver";

export type CalendarDate = `${number}-${number}-${number}`;
export type LocalDateTime = `${CalendarDate}T${string}`;
export type TimeDisambiguation = "earlier" | "later" | "reject";

export type TimedEventRange = Readonly<{
  endsAtUtc: string;
  endsAtUtcMs: number;
  kind: "timed";
  originalTimeZone: string;
  startsAtUtc: string;
  startsAtUtcMs: number;
}>;

export type AllDayEventRange = Readonly<{
  endDateExclusive: CalendarDate;
  kind: "all_day";
  startDate: CalendarDate;
}>;

type DateTimeParts = Readonly<{
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}>;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function isValidIanaTimeZone(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64
  ) {
    return false;
  }
  try {
    getFormatter(value);
    return true;
  } catch {
    return false;
  }
}

export function parseIanaTimeZone(
  value: unknown,
  path = "timeZone",
): string {
  const zone = parseBoundedString(value, {
    path,
    minLength: 1,
    maxLength: 64,
  });
  if (!isValidIanaTimeZone(zone)) {
    throw validationIssue(path, "invalid_timezone", "Expected an IANA timezone.");
  }
  return zone;
}

export function parseCalendarDate(
  value: unknown,
  path = "date",
): CalendarDate {
  const date = parseBoundedString(value, {
    path,
    minLength: 10,
    maxLength: 10,
    trim: false,
  });
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) {
    throw validationIssue(
      path,
      "invalid_date",
      "Expected a calendar date in YYYY-MM-DD form.",
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw validationIssue(path, "invalid_date", "Expected a real calendar date.");
  }
  return date as CalendarDate;
}

export function parseLocalDateTime(
  value: unknown,
  path = "localDateTime",
): DateTimeParts {
  const input = parseBoundedString(value, {
    path,
    minLength: 16,
    maxLength: 19,
    trim: false,
  });
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(input);
  if (!match) {
    throw validationIssue(
      path,
      "invalid_datetime",
      "Expected a local date and time without an offset.",
    );
  }

  const parts: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
  if (
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59 ||
    !isRealDate(parts)
  ) {
    throw validationIssue(
      path,
      "invalid_datetime",
      "Expected a real local date and time.",
    );
  }
  return parts;
}

/**
 * Converts a wall-clock value into a UTC instant without hardcoding an offset.
 * Nonexistent spring-forward times and ambiguous fall-back times are rejected
 * unless the caller explicitly chooses the earlier or later occurrence.
 */
export function localDateTimeToUtcMs(
  localDateTime: unknown,
  timeZone: unknown = DEFAULT_TIME_ZONE,
  disambiguation: TimeDisambiguation = "reject",
): number {
  const zone = parseIanaTimeZone(timeZone);
  const local = parseLocalDateTime(localDateTime);
  const naiveUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );

  const offsets = new Set<number>();
  for (
    let sample = naiveUtcMs - 36 * 60 * 60_000;
    sample <= naiveUtcMs + 36 * 60 * 60_000;
    sample += 6 * 60 * 60_000
  ) {
    const wall = partsAtInstant(sample, zone);
    const wallAsUtc = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    offsets.add(wallAsUtc - sample);
  }

  const candidates = [...offsets]
    .map((offset) => naiveUtcMs - offset)
    .filter((candidate) => sameParts(partsAtInstant(candidate, zone), local))
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .sort((left, right) => left - right);

  if (candidates.length === 0) {
    throw validationIssue(
      "localDateTime",
      "nonexistent_local_time",
      "This local time does not exist because of a timezone transition.",
    );
  }
  if (candidates.length > 1) {
    if (disambiguation === "earlier") return candidates[0];
    if (disambiguation === "later") return candidates[candidates.length - 1];
    throw validationIssue(
      "localDateTime",
      "ambiguous_local_time",
      "This local time occurs twice because of a timezone transition.",
    );
  }
  return candidates[0];
}

export function normalizeTimedEventRange(input: Readonly<{
  disambiguation?: TimeDisambiguation;
  endLocal: unknown;
  startLocal: unknown;
  timeZone?: unknown;
}>): TimedEventRange {
  const originalTimeZone = parseIanaTimeZone(
    input.timeZone ?? DEFAULT_TIME_ZONE,
  );
  const disambiguation = input.disambiguation ?? "reject";
  if (!["earlier", "later", "reject"].includes(disambiguation)) {
    throw validationIssue(
      "disambiguation",
      "invalid_choice",
      "Expected a supported timezone disambiguation.",
    );
  }
  const startsAtUtcMs = localDateTimeToUtcMs(
    input.startLocal,
    originalTimeZone,
    disambiguation,
  );
  const endsAtUtcMs = localDateTimeToUtcMs(
    input.endLocal,
    originalTimeZone,
    disambiguation,
  );
  if (endsAtUtcMs === startsAtUtcMs) {
    throw validationIssue(
      "endLocal",
      "zero_duration",
      "A timed event must have a positive duration.",
    );
  }
  if (endsAtUtcMs < startsAtUtcMs) {
    throw validationIssue(
      "endLocal",
      "end_before_start",
      "The event end must be after its start.",
    );
  }
  return Object.freeze({
    kind: "timed" as const,
    originalTimeZone,
    startsAtUtcMs,
    endsAtUtcMs,
    startsAtUtc: new Date(startsAtUtcMs).toISOString(),
    endsAtUtc: new Date(endsAtUtcMs).toISOString(),
  });
}

/**
 * All-day ranges use an exclusive end date, matching calendar/ICS semantics.
 * A one-day event therefore has the next calendar date as its end.
 */
export function normalizeAllDayEventRange(input: Readonly<{
  endDateExclusive: unknown;
  startDate: unknown;
}>): AllDayEventRange {
  const startDate = parseCalendarDate(input.startDate, "startDate");
  const endDateExclusive = parseCalendarDate(
    input.endDateExclusive,
    "endDateExclusive",
  );
  if (endDateExclusive <= startDate) {
    throw validationIssue(
      "endDateExclusive",
      "invalid_date_range",
      "An all-day event must end after its start date.",
    );
  }
  return Object.freeze({
    kind: "all_day" as const,
    startDate,
    endDateExclusive,
  });
}

export function calendarDateInTimeZone(
  utcInstant: Date | number,
  timeZone: unknown = DEFAULT_TIME_ZONE,
): CalendarDate {
  const zone = parseIanaTimeZone(timeZone);
  const epochMs =
    typeof utcInstant === "number" ? utcInstant : utcInstant.getTime();
  if (!Number.isFinite(epochMs)) {
    throw validationIssue(
      "utcInstant",
      "invalid_datetime",
      "Expected a valid UTC instant.",
    );
  }
  const parts = partsAtInstant(epochMs, zone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}` as CalendarDate;
}

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "iso8601",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  // Force eager validation; some runtimes defer invalid-zone errors.
  formatter.format(new Date(0));
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function partsAtInstant(epochMs: number, timeZone: string): DateTimeParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of getFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }
  if (
    values.year === undefined ||
    values.month === undefined ||
    values.day === undefined ||
    values.hour === undefined ||
    values.minute === undefined ||
    values.second === undefined
  ) {
    throw validationIssue(
      "timeZone",
      "timezone_format_failed",
      "The timezone could not be evaluated.",
    );
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function isRealDate(parts: DateTimeParts): boolean {
  const roundTrip = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  );
  return (
    roundTrip.getUTCFullYear() === parts.year &&
    roundTrip.getUTCMonth() === parts.month - 1 &&
    roundTrip.getUTCDate() === parts.day
  );
}

function sameParts(left: DateTimeParts, right: DateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}
