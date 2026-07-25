import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
  robots: {
    index: false,
    follow: true,
  },
};

export default function CalendarCompatibilityRedirect(): never {
  permanentRedirect("/events");
}
