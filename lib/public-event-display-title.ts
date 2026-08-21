import type { PublicEventCardDto } from "@/lib/server/public/events";

type InstitutionalEventTitleInput = Pick<
  PublicEventCardDto,
  "rsvpUrl" | "title"
>;

type ApprovedInstitutionalEventTitle = Readonly<{
  displayTitle: string;
  reviewedSourceTitle: string;
}>;

const APPROVED_INSTITUTIONAL_EVENT_TITLES = Object.freeze<
  Readonly<Record<string, ApprovedInstitutionalEventTitle>>
>({
  "https://www.meetup.com/vancouver-literature-and-film/events/316159440/":
    Object.freeze({
      displayTitle: "Office Space — Movie Outing at VIFF",
      reviewedSourceTitle:
        "🖨️💼 Office Space at VIFF - work is fake and the printer deserved it",
    }),
});

export type InstitutionalEventTitleResolution = Readonly<{
  status: "approved" | "canonical" | "stale-override";
  title: string;
}>;

/**
 * Resolves a reviewed title for organization-facing surfaces without changing
 * the canonical title synchronized from Meetup. The exact source-title guard
 * makes an upstream edit fail safely back to the current Meetup wording so an
 * outdated editorial title is never presented as if it were still approved.
 */
export function resolveInstitutionalEventTitle(
  event: InstitutionalEventTitleInput,
): InstitutionalEventTitleResolution {
  const override = event.rsvpUrl
    ? APPROVED_INSTITUTIONAL_EVENT_TITLES[event.rsvpUrl]
    : undefined;
  if (!override) {
    return Object.freeze({ status: "canonical", title: event.title });
  }
  if (override.reviewedSourceTitle !== event.title) {
    return Object.freeze({ status: "stale-override", title: event.title });
  }
  return Object.freeze({ status: "approved", title: override.displayTitle });
}

export function institutionalEventTitle(
  event: InstitutionalEventTitleInput,
): string {
  return resolveInstitutionalEventTitle(event).title;
}
