import { parseFiniteInteger } from "@/lib/validation";

export function vancouverCalendarDate(nowUtcMsInput: unknown): string {
  const nowUtcMs = parseFiniteInteger(nowUtcMsInput, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Vancouver",
    year: "numeric",
  }).formatToParts(new Date(nowUtcMs));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
