import type { PublicEventCardDto } from "./server/public/events";

const CALENDAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/u;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const PUBLIC_CALENDAR_TIME_ZONE = "America/Vancouver";

export type PublicCalendarCell = Readonly<{
  date: string;
  inMonth: boolean;
}>;

export type ResolvedPublicCalendarMonth = Readonly<{
  invalid: boolean;
  maxMonth: string;
  minMonth: string;
  month: string;
}>;

export function resolvePublicCalendarMonth(
  value: unknown,
  todayDate: string,
): ResolvedPublicCalendarMonth {
  const todayMonth = validCalendarDate(todayDate)
    ? todayDate.slice(0, 7)
    : "1970-01";
  const minMonth = shiftPublicCalendarMonth(todayMonth, -12);
  const maxMonth = shiftPublicCalendarMonth(todayMonth, 12);
  const candidate =
    typeof value === "string" && value.length > 0 ? value : todayMonth;
  const valid =
    validCalendarMonth(candidate) &&
    candidate >= minMonth &&
    candidate <= maxMonth;
  return Object.freeze({
    invalid: !valid,
    maxMonth,
    minMonth,
    month: valid ? candidate : todayMonth,
  });
}

export function publicCalendarMonthBounds(month: string): Readonly<{
  endDate: string;
  startDate: string;
}> {
  const parsed = parseCalendarMonth(month);
  const start = new Date(Date.UTC(parsed.year, parsed.monthIndex, 1));
  const end = new Date(Date.UTC(parsed.year, parsed.monthIndex + 1, 0));
  return Object.freeze({
    endDate: dateKey(end),
    startDate: dateKey(start),
  });
}

export function publicCalendarMonthCells(
  month: string,
): readonly PublicCalendarCell[] {
  const parsed = parseCalendarMonth(month);
  const first = new Date(Date.UTC(parsed.year, parsed.monthIndex, 1));
  const targetMonth = first.getUTCMonth();
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return Object.freeze(
    Array.from({ length: 42 }, (_, index) => {
      const cell = new Date(first);
      cell.setUTCDate(first.getUTCDate() + index);
      return Object.freeze({
        date: dateKey(cell),
        inMonth: cell.getUTCMonth() === targetMonth,
      });
    }),
  );
}

export function shiftPublicCalendarMonth(
  month: string,
  delta: number,
): string {
  const parsed = parseCalendarMonth(month);
  const date = new Date(
    Date.UTC(parsed.year, parsed.monthIndex + delta, 1),
  );
  return dateKey(date).slice(0, 7);
}

export function eventOccursOnCalendarDate(
  event: PublicEventCardDto,
  date: string,
): boolean {
  if (!validCalendarDate(date)) return false;
  if (event.schedule.kind === "all_day") {
    return (
      event.schedule.startDate <= date &&
      event.schedule.endDateExclusive > date
    );
  }
  const startDate = dateKeyInTimeZone(
    event.schedule.startsAtUtc,
    PUBLIC_CALENDAR_TIME_ZONE,
  );
  const inclusiveEndMs =
    new Date(event.schedule.endsAtUtc).getTime() - 1;
  const endDate = dateKeyInTimeZone(
    new Date(inclusiveEndMs).toISOString(),
    PUBLIC_CALENDAR_TIME_ZONE,
  );
  return startDate <= date && endDate >= date;
}

export function publicEventCalendarStartDate(
  event: PublicEventCardDto,
): string {
  return event.schedule.kind === "all_day"
    ? event.schedule.startDate
    : dateKeyInTimeZone(
        event.schedule.startsAtUtc,
        PUBLIC_CALENDAR_TIME_ZONE,
      );
}

export function formatPublicCalendarMonth(month: string): string {
  const parsed = parseCalendarMonth(month);
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(parsed.year, parsed.monthIndex, 1)));
}

export function formatPublicCalendarDate(date: string): string {
  const parsed = parseCalendarDate(date);
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(
    new Date(Date.UTC(parsed.year, parsed.monthIndex, parsed.day)),
  );
}

export function formatPublicCalendarEventTime(
  event: PublicEventCardDto,
): string {
  if (event.schedule.kind === "all_day") return "All day";
  const start = new Date(event.schedule.startsAtUtc);
  const end = new Date(event.schedule.endsAtUtc);
  const startTime = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.schedule.timeZone,
  }).format(start);
  const endTime = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.schedule.timeZone,
    timeZoneName: "short",
  }).format(end);
  return `${startTime}-${endTime}`;
}

function dateKeyInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const record = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${record.year}-${record.month}-${record.day}`;
}

function dateKey(value: Date): string {
  return [
    value.getUTCFullYear().toString().padStart(4, "0"),
    (value.getUTCMonth() + 1).toString().padStart(2, "0"),
    value.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function validCalendarMonth(value: string): boolean {
  const match = CALENDAR_MONTH_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return (
    Number.isInteger(year) &&
    year >= 1970 &&
    year <= 9999 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  );
}

function validCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;
  try {
    const parsed = parseCalendarDate(value);
    return (
      dateKey(
        new Date(Date.UTC(parsed.year, parsed.monthIndex, parsed.day)),
      ) === value
    );
  } catch {
    return false;
  }
}

function parseCalendarMonth(month: string): Readonly<{
  monthIndex: number;
  year: number;
}> {
  const match = CALENDAR_MONTH_PATTERN.exec(month);
  if (!match) throw new RangeError("Invalid public calendar month.");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (
    !Number.isInteger(year) ||
    year < 1970 ||
    year > 9999 ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12
  ) {
    throw new RangeError("Invalid public calendar month.");
  }
  return Object.freeze({ year, monthIndex: monthNumber - 1 });
}

function parseCalendarDate(date: string): Readonly<{
  day: number;
  monthIndex: number;
  year: number;
}> {
  const match = CALENDAR_DATE_PATTERN.exec(date);
  if (!match) throw new RangeError("Invalid public calendar date.");
  return Object.freeze({
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  });
}
