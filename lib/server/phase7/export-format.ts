import { SafeApplicationError } from "../../validation/server-observability";

export const PUBLIC_ICS_EVENT_LIMIT = 500;
export const PUBLIC_CSV_EVENT_LIMIT = 2_000;
export const OPERATIONAL_CSV_EVENT_LIMIT = 5_000;
export const PUBLIC_EXPORT_MAX_RANGE_DAYS = 366;

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"] as const;
const ICS_LINE_OCTET_LIMIT = 75;
export const ICS_SEQUENCE_MAX = 2_147_483_647;

export type CalendarExportEvent = Readonly<{
  description: string | null;
  lastModifiedAt: number;
  location: string | null;
  sequence: number;
  status: "cancelled" | "confirmed" | "tentative" | "completed";
  summary: string;
  timeZone: string;
  uid: string;
  url: string;
  schedule:
    | Readonly<{
        endDateExclusive: string;
        kind: "all_day";
        startDate: string;
      }>
    | Readonly<{
        endsAtUtc: string;
        kind: "timed";
        startsAtUtc: string;
  }>;
}>;

export type CalendarComponentFacts = Omit<
  CalendarExportEvent,
  "lastModifiedAt" | "sequence"
>;

export function buildIcalendar(
  events: readonly CalendarExportEvent[],
  options: Readonly<{
    calendarName: string;
    generatedAt: number;
  }>,
): string {
  if (events.length > PUBLIC_ICS_EVENT_LIMIT) {
    throw new SafeApplicationError(
      "validation_failed",
      422,
      "Narrow the filters before downloading this calendar.",
    );
  }
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vancouver Curiosity Club//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
  ];
  const dtstamp = formatIcsUtc(options.generatedAt);
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `LAST-MODIFIED:${formatIcsUtc(event.lastModifiedAt)}`,
      `SEQUENCE:${readSequence(event.sequence)}`,
      ...calendarComponentContentLines(event),
    );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/**
 * The exact canonical, revision-independent VEVENT facts. Both rendering and
 * persisted component fingerprinting use these lines so a revision advances
 * only when emitted event content changes. DTSTAMP, LAST-MODIFIED and
 * SEQUENCE are deliberately excluded.
 */
export function calendarComponentContentLines(
  event: CalendarComponentFacts,
): readonly string[] {
  const lines: string[] = [];
  if (event.schedule.kind === "timed") {
    lines.push(
      `DTSTART:${formatIcsUtc(Date.parse(event.schedule.startsAtUtc))}`,
      `DTEND:${formatIcsUtc(Date.parse(event.schedule.endsAtUtc))}`,
      `X-VCC-TIMEZONE:${escapeIcsText(event.timeZone)}`,
    );
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${formatIcsDate(event.schedule.startDate)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(
        event.schedule.endDateExclusive,
      )}`,
    );
  }
  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  lines.push(`URL:${escapeIcsText(event.url)}`);
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  lines.push(`STATUS:${calendarComponentStatus(event.status)}`);
  return Object.freeze(lines);
}

export function canonicalCalendarComponent(
  event: CalendarComponentFacts,
): string {
  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    ...calendarComponentContentLines(event),
    "END:VEVENT",
  ]
    .map(foldIcsLine)
    .join("\r\n");
}

export function buildCsv(
  headers: readonly string[],
  rows: readonly (readonly (boolean | null | number | string)[])[],
): string {
  if (
    headers.length === 0 ||
    rows.some((row) => row.length !== headers.length)
  ) {
    throw new TypeError("Every CSV row must match the declared header.");
  }
  return `${[
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n")}\r\n`;
}

export function neutralizeSpreadsheetFormula(value: string): string {
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;
}

export function sanitizeDownloadFilename(
  value: string,
  fallback: string,
): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return normalized || fallback;
}

export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/gu, "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

export function foldIcsLine(value: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new TypeError("An iCalendar content line cannot contain CR or LF.");
  }
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= ICS_LINE_OCTET_LIMIT) return value;

  const physicalLines: string[] = [];
  let current = "";
  let currentBytes = 0;
  let capacity = ICS_LINE_OCTET_LIMIT;
  for (const character of value) {
    const bytes = encoder.encode(character).byteLength;
    if (currentBytes > 0 && currentBytes + bytes > capacity) {
      physicalLines.push(current);
      current = character;
      currentBytes = bytes;
      capacity = ICS_LINE_OCTET_LIMIT - 1;
    } else {
      current += character;
      currentBytes += bytes;
    }
  }
  if (current) physicalLines.push(current);
  return physicalLines.join("\r\n ");
}

function calendarComponentStatus(
  status: CalendarExportEvent["status"],
): "CANCELLED" | "CONFIRMED" | "TENTATIVE" {
  if (status === "cancelled") return "CANCELLED";
  if (status === "tentative") return "TENTATIVE";
  return "CONFIRMED";
}

function csvCell(value: boolean | null | number | string): string {
  const raw =
    value === null ? "" : typeof value === "boolean" ? String(value) : `${value}`;
  const safe = neutralizeSpreadsheetFormula(raw);
  return /[",\r\n]/u.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

function readSequence(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > ICS_SEQUENCE_MAX
  ) {
    throw new TypeError(
      "iCalendar sequence must be a signed 32-bit nonnegative integer.",
    );
  }
  return value;
}

function formatIcsUtc(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("iCalendar timestamps must be valid UTC instants.");
  }
  return new Date(value)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function formatIcsDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError("iCalendar all-day dates must use YYYY-MM-DD.");
  }
  return value.replaceAll("-", "");
}
