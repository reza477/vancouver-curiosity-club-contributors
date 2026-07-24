import {
  DEFAULT_TIME_ZONE,
  localDateTimeToUtcMs,
  normalizeAllDayEventRange,
  parseCalendarDate,
  parseIanaTimeZone,
} from "../../time";
import {
  parseBoundedString,
  validationIssue,
} from "../../validation";
import { MeetupSyncError } from "./errors";
import { parseOfficialMeetupEventUrl } from "./url";

export const MAX_MEETUP_ICS_BYTES = 2_000_000;
export const MAX_MEETUP_ICS_EVENTS = 500;
const MAX_PHYSICAL_LINES = 60_000;
const MAX_UNFOLDED_LINES = 50_000;
const MAX_UNFOLDED_LINE_LENGTH = 24_000;

export type ParsedMeetupEventStatus =
  | "cancelled"
  | "confirmed"
  | "tentative";

export type ParsedMeetupSchedule =
  | Readonly<{
      endDateExclusive: string;
      kind: "all_day";
      startDate: string;
      timeZone: string;
    }>
  | Readonly<{
      endsAtUtcMs: number;
      kind: "timed";
      startsAtUtcMs: number;
      timeZone: string;
    }>;

export type ParsedMeetupEvent = Readonly<{
  componentIndex: number;
  description: string | null;
  eventUrl: string;
  lastModifiedUtcMs: number | null;
  location: string | null;
  recurrenceId: string | null;
  schedule: ParsedMeetupSchedule;
  sequence: number;
  sourceKey: string;
  status: ParsedMeetupEventStatus;
  title: string;
  uid: string;
}>;

export type ParsedMeetupRejectedEvent = Readonly<{
  componentIndex: number;
  errorCode: "unsupported_recurrence";
}>;

export type ParsedMeetupCalendar = Readonly<{
  events: readonly ParsedMeetupEvent[];
  method: "CANCEL" | "PUBLISH" | null;
  rejectedEvents: readonly ParsedMeetupRejectedEvent[];
}>;

type IcsProperty = Readonly<{
  name: string;
  parameters: ReadonlyMap<string, string>;
  value: string;
}>;

type ParsedDateValue =
  | Readonly<{
      canonical: string;
      date: string;
      kind: "date";
      timeZone: string;
    }>
  | Readonly<{
      canonical: string;
      kind: "instant";
      timeZone: string;
      utcMs: number;
    }>;

export function parseMeetupIcs(
  input: unknown,
  options: Readonly<{ maxBytes?: number; maxEvents?: number }> = {},
): ParsedMeetupCalendar {
  try {
    const maxBytes = boundedLimit(
      options.maxBytes,
      MAX_MEETUP_ICS_BYTES,
      MAX_MEETUP_ICS_BYTES,
    );
    const maxEvents = boundedLimit(
      options.maxEvents,
      MAX_MEETUP_ICS_EVENTS,
      MAX_MEETUP_ICS_EVENTS,
    );
    const text = parseBoundedString(input, {
      path: "calendar",
      minLength: 20,
      maxLength: maxBytes,
      trim: false,
    }).replace(/^\uFEFF/u, "");
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw validationIssue(
        "calendar",
        "calendar_too_large",
        "The calendar exceeds the supported size.",
      );
    }

    const lines = unfoldLines(text);
    if (
      lines[0]?.toUpperCase() !== "BEGIN:VCALENDAR" ||
      lines.at(-1)?.toUpperCase() !== "END:VCALENDAR"
    ) {
      invalidCalendar();
    }

    const calendarProperties: IcsProperty[] = [];
    const eventPropertySets: IcsProperty[][] = [];
    let currentEvent: IcsProperty[] | null = null;
    const skippedComponents: string[] = [];
    for (const line of lines.slice(1, -1)) {
      // Tolerate harmless empty content lines emitted by calendar exporters.
      // Whitespace-prefixed lines have already been unfolded above, so this
      // cannot turn a continuation into a separate property.
      if (line === "") continue;
      const upper = line.toUpperCase();
      const componentStart = /^BEGIN:([A-Z][A-Z0-9-]{0,63})$/u.exec(upper);
      const componentEnd = /^END:([A-Z][A-Z0-9-]{0,63})$/u.exec(upper);
      if (skippedComponents.length > 0) {
        if (componentStart) {
          if (skippedComponents.length >= 8) invalidCalendar();
          skippedComponents.push(componentStart[1]);
        } else if (componentEnd) {
          if (skippedComponents.at(-1) !== componentEnd[1]) {
            invalidCalendar();
          }
          skippedComponents.pop();
        }
        continue;
      }
      if (upper === "BEGIN:VEVENT") {
        if (currentEvent !== null) invalidCalendar();
        currentEvent = [];
        continue;
      }
      if (upper === "END:VEVENT") {
        if (currentEvent === null) invalidCalendar();
        eventPropertySets.push(currentEvent);
        if (eventPropertySets.length > maxEvents) invalidCalendar();
        currentEvent = null;
        continue;
      }
      if (componentStart) {
        if (
          currentEvent !== null ||
          componentStart[1] === "VCALENDAR" ||
          componentStart[1] === "VEVENT"
        ) {
          invalidCalendar();
        }
        skippedComponents.push(componentStart[1]);
        continue;
      }
      if (componentEnd) invalidCalendar();
      const property = parseProperty(line);
      if (currentEvent === null) {
        calendarProperties.push(property);
      } else {
        currentEvent.push(property);
      }
    }
    if (currentEvent !== null || skippedComponents.length > 0) {
      invalidCalendar();
    }

    const methodValue = optionalSingle(calendarProperties, "METHOD");
    const method =
      methodValue === null
        ? null
        : parseCalendarMethod(methodValue.value);
    const events: ParsedMeetupEvent[] = [];
    const rejectedEvents: ParsedMeetupRejectedEvent[] = [];
    eventPropertySets.forEach((properties, index) => {
      if (
        properties.some((property) =>
          ["EXDATE", "RDATE", "RRULE"].includes(property.name),
        )
      ) {
        rejectedEvents.push(
          Object.freeze({
            componentIndex: index,
            errorCode: "unsupported_recurrence" as const,
          }),
        );
        return;
      }
      events.push(parseEvent(properties, method, index));
    });
    return Object.freeze({
      method,
      events: Object.freeze(events),
      rejectedEvents: Object.freeze(rejectedEvents),
    });
  } catch (error) {
    if (error instanceof MeetupSyncError) throw error;
    throw new MeetupSyncError("calendar_invalid");
  }
}

function unfoldLines(text: string): string[] {
  const physicalLines = text.split(/\r\n|\n|\r/u);
  if (physicalLines.length > MAX_PHYSICAL_LINES) invalidCalendar();
  const lines: string[] = [];
  for (const physicalLine of physicalLines) {
    if (physicalLine.startsWith(" ") || physicalLine.startsWith("\t")) {
      if (lines.length === 0) invalidCalendar();
      lines[lines.length - 1] += physicalLine.slice(1);
    } else {
      lines.push(physicalLine);
    }
    if (
      lines.length > MAX_UNFOLDED_LINES ||
      (lines.at(-1)?.length ?? 0) > MAX_UNFOLDED_LINE_LENGTH
    ) {
      invalidCalendar();
    }
  }
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function parseProperty(line: string): IcsProperty {
  const separator = line.indexOf(":");
  if (separator < 1) invalidCalendar();
  const declaration = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const parts = declaration.split(";");
  const name = parts[0].toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{0,63}$/u.test(name)) invalidCalendar();
  const parameters = new Map<string, string>();
  for (const parameter of parts.slice(1)) {
    const equals = parameter.indexOf("=");
    if (equals < 1) invalidCalendar();
    const key = parameter.slice(0, equals).toUpperCase();
    let parameterValue = parameter.slice(equals + 1);
    if (
      parameterValue.startsWith('"') &&
      parameterValue.endsWith('"') &&
      parameterValue.length >= 2
    ) {
      parameterValue = parameterValue.slice(1, -1);
    }
    if (
      !/^[A-Z][A-Z0-9-]{0,63}$/u.test(key) ||
      parameterValue.length === 0 ||
      parameterValue.length > 256 ||
      parameters.has(key)
    ) {
      invalidCalendar();
    }
    parameters.set(key, parameterValue);
  }
  return Object.freeze({
    name,
    parameters,
    value,
  });
}

function parseEvent(
  properties: readonly IcsProperty[],
  method: ParsedMeetupCalendar["method"],
  index: number,
): ParsedMeetupEvent {
  const uid = boundedIdentity(
    requiredSingle(properties, "UID").value,
    `events.${index}.uid`,
    512,
  );
  const startProperty = requiredSingle(properties, "DTSTART");
  const start = parseDateValue(startProperty, undefined);
  const end = parseDateValue(
    requiredSingle(properties, "DTEND"),
    start.timeZone,
  );
  const schedule = buildSchedule(start, end);
  const recurrenceProperty = optionalSingle(properties, "RECURRENCE-ID");
  const recurrence = recurrenceProperty
    ? parseDateValue(recurrenceProperty, start.timeZone)
    : null;
  const recurrenceId = recurrence?.canonical ?? null;
  const title = boundedText(
    decodeIcsText(requiredSingle(properties, "SUMMARY").value),
    `events.${index}.summary`,
    300,
  );
  const description = optionalText(
    properties,
    "DESCRIPTION",
    `events.${index}.description`,
    20_000,
  );
  const location = optionalText(
    properties,
    "LOCATION",
    `events.${index}.location`,
    1_000,
  );
  const eventUrl = parseOfficialMeetupEventUrl(
    decodeIcsText(requiredSingle(properties, "URL").value),
    `events.${index}.url`,
  );
  const statusProperty = optionalSingle(properties, "STATUS");
  const status =
    method === "CANCEL"
      ? "cancelled"
      : parseEventStatus(statusProperty?.value ?? "CONFIRMED");
  const sequenceProperty = optionalSingle(properties, "SEQUENCE");
  const sequence = sequenceProperty
    ? parseSequence(sequenceProperty.value)
    : 0;
  const lastModifiedProperty = optionalSingle(
    properties,
    "LAST-MODIFIED",
  );
  const lastModified = lastModifiedProperty
    ? parseDateValue(lastModifiedProperty, "UTC")
    : null;
  if (lastModified?.kind === "date") invalidCalendar();

  return Object.freeze({
    componentIndex: index,
    uid,
    recurrenceId,
    sourceKey: `${uid}\u001F${recurrenceId ?? ""}`,
    title,
    description,
    location,
    eventUrl,
    status,
    sequence,
    lastModifiedUtcMs: lastModified?.utcMs ?? null,
    schedule,
  });
}

function parseDateValue(
  property: IcsProperty,
  fallbackTimeZone: string | undefined,
): ParsedDateValue {
  const valueKind = property.parameters.get("VALUE")?.toUpperCase();
  const timeZoneParameter = property.parameters.get("TZID");
  const isDate = valueKind === "DATE" || /^\d{8}$/u.test(property.value);
  if (isDate) {
    if (
      timeZoneParameter !== undefined ||
      (valueKind !== undefined && valueKind !== "DATE")
    ) {
      invalidCalendar();
    }
    const date = compactDateToCalendarDate(property.value);
    return Object.freeze({
      canonical: `date:${date}`,
      date,
      kind: "date" as const,
      timeZone: DEFAULT_TIME_ZONE,
    });
  }
  if (valueKind !== undefined && valueKind !== "DATE-TIME") {
    invalidCalendar();
  }

  const utcMatch = /^(\d{8})T(\d{4}|\d{6})Z$/u.exec(property.value);
  if (utcMatch) {
    if (timeZoneParameter !== undefined) invalidCalendar();
    const utcMs = compactUtcDateTimeToMs(utcMatch[1], utcMatch[2]);
    return Object.freeze({
      canonical: `instant:${utcMs}`,
      kind: "instant" as const,
      timeZone: "UTC",
      utcMs,
    });
  }

  const localMatch = /^(\d{8})T(\d{4}|\d{6})$/u.exec(property.value);
  if (!localMatch) invalidCalendar();
  const timeZone = parseIanaTimeZone(
    timeZoneParameter ?? fallbackTimeZone ?? DEFAULT_TIME_ZONE,
  );
  const localDateTime = compactLocalDateTime(
    localMatch[1],
    localMatch[2],
  );
  const utcMs = localDateTimeToUtcMs(localDateTime, timeZone, "reject");
  return Object.freeze({
    canonical: `instant:${utcMs}`,
    kind: "instant" as const,
    timeZone,
    utcMs,
  });
}

function buildSchedule(
  start: ParsedDateValue,
  end: ParsedDateValue,
): ParsedMeetupSchedule {
  if (start.kind !== end.kind) invalidCalendar();
  if (start.kind === "date" && end.kind === "date") {
    const range = normalizeAllDayEventRange({
      startDate: start.date,
      endDateExclusive: end.date,
    });
    return Object.freeze({
      kind: "all_day" as const,
      startDate: range.startDate,
      endDateExclusive: range.endDateExclusive,
      timeZone: DEFAULT_TIME_ZONE,
    });
  }
  if (start.kind !== "instant" || end.kind !== "instant") invalidCalendar();
  if (end.utcMs <= start.utcMs) invalidCalendar();
  return Object.freeze({
    kind: "timed" as const,
    startsAtUtcMs: start.utcMs,
    endsAtUtcMs: end.utcMs,
    timeZone: start.timeZone,
  });
}

function compactDateToCalendarDate(value: string): string {
  if (!/^\d{8}$/u.test(value)) invalidCalendar();
  return parseCalendarDate(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
  );
}

function compactLocalDateTime(date: string, time: string): string {
  const seconds = time.length === 4 ? "00" : time.slice(4, 6);
  return `${compactDateToCalendarDate(date)}T${time.slice(0, 2)}:${time.slice(
    2,
    4,
  )}:${seconds}`;
}

function compactUtcDateTimeToMs(date: string, time: string): number {
  const local = compactLocalDateTime(date, time);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/u.exec(local);
  if (!match) invalidCalendar();
  const utcMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  if (
    !Number.isSafeInteger(utcMs) ||
    new Date(utcMs).toISOString().slice(0, 19) !== local
  ) {
    invalidCalendar();
  }
  return utcMs;
}

function requiredSingle(
  properties: readonly IcsProperty[],
  name: string,
): IcsProperty {
  const property = optionalSingle(properties, name);
  if (!property) invalidCalendar();
  return property;
}

function optionalSingle(
  properties: readonly IcsProperty[],
  name: string,
): IcsProperty | null {
  const matches = properties.filter((property) => property.name === name);
  if (matches.length > 1) invalidCalendar();
  return matches[0] ?? null;
}

function optionalText(
  properties: readonly IcsProperty[],
  name: string,
  path: string,
  maxLength: number,
): string | null {
  const property = optionalSingle(properties, name);
  if (!property || property.value === "") return null;
  return boundedText(decodeIcsText(property.value), path, maxLength);
}

function boundedText(
  value: string,
  path: string,
  maxLength: number,
): string {
  return parseBoundedString(value, {
    path,
    maxLength,
    trim: true,
  });
}

function boundedIdentity(
  value: string,
  path: string,
  maxLength: number,
): string {
  const identity = boundedText(value, path, maxLength);
  if (/[\u0000-\u001F\u007F]/u.test(identity)) invalidCalendar();
  return identity;
}

function decodeIcsText(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }
    index += 1;
    const escaped = value[index];
    if (escaped === undefined) invalidCalendar();
    if (escaped === "n" || escaped === "N") {
      result += "\n";
    } else if (
      escaped === "\\" ||
      escaped === "," ||
      escaped === ";"
    ) {
      result += escaped;
    } else {
      invalidCalendar();
    }
  }
  return result;
}

function parseSequence(value: string): number {
  if (!/^(0|[1-9]\d{0,9})$/u.test(value)) invalidCalendar();
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) invalidCalendar();
  return sequence;
}

function parseEventStatus(value: string): ParsedMeetupEventStatus {
  switch (value.trim().toUpperCase()) {
    case "CANCELLED":
      return "cancelled";
    case "CONFIRMED":
      return "confirmed";
    case "TENTATIVE":
      return "tentative";
    default:
      return invalidCalendar();
  }
}

function parseCalendarMethod(
  value: string,
): ParsedMeetupCalendar["method"] {
  const normalized = value.trim().toUpperCase();
  if (normalized === "PUBLISH" || normalized === "CANCEL") {
    return normalized;
  }
  return invalidCalendar();
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    invalidCalendar();
  }
  return value;
}

function invalidCalendar(): never {
  throw new MeetupSyncError("calendar_invalid");
}
