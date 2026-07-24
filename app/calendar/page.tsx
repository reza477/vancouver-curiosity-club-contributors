import type { Metadata } from "next";
import { CalendarView, type PublicCalendarSnapshot } from "./CalendarView";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { listDefaultPublicMeetupCalendar } from "@/lib/server/meetup";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar",
  description:
    "Source-backed upcoming events from Vancouver Curiosity Club, with honest connection and refresh status.",
};

export default async function CalendarPage() {
  const nowUtcMs = readServerUtcMs();
  let calendar: PublicCalendarSnapshot;

  try {
    const { database } = getRuntimeAuthConfiguration();
    calendar = await listDefaultPublicMeetupCalendar(database, {
      fromUtcMs: nowUtcMs,
      todayDate: vancouverCalendarDate(nowUtcMs),
      nowUtcMs,
    });
  } catch {
    writeSafeLog("error", "public_meetup_calendar_unavailable", {
      code: "service_unavailable",
      operation: "list_public_meetup_calendar",
      route: "/calendar",
      status: 503,
    });
    calendar = {
      sync: {
        status: "error",
        lastSuccessAt: null,
      },
      events: [],
    };
  }

  return <CalendarView calendar={calendar} />;
}

function vancouverCalendarDate(nowUtcMs: number) {
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
