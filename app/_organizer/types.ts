import type {
  AuthorizedMembership,
  D1DatabaseLike,
  TrustedServerIdentity,
} from "@/lib/server/auth";

export type OrganizerRole = AuthorizedMembership["role"];

export type OrganizerPageContext = Readonly<{
  database: D1DatabaseLike;
  defaultTimezone: string;
  identity: TrustedServerIdentity;
  membership: AuthorizedMembership;
  organizerDisplayName: string;
  organizerInitials: string;
  unreadNotificationCount: number;
  workspaceName: string;
}>;

export type OrganizerPageLoad =
  | Readonly<{
      context: OrganizerPageContext;
      kind: "granted";
    }>
  | Readonly<{
      kind: "denied" | "unavailable" | "unconfigured";
    }>;

export type OrganizerCalendarEntry = Readonly<{
  allDay: boolean;
  category: Readonly<{ id: string; name: string }> | null;
  club: Readonly<{ id: string; name: string }>;
  conflictCount?: number;
  conflictState?:
    | "approved"
    | "invalidated"
    | "none"
    | "open"
    | "pending"
    | "rejected"
    | "resolved"
    | "warning";
  dateKey: string;
  endDateKey: string;
  fullScheduleLabel: string;
  holdExpiryLabel?: string | null;
  holdState?: "active" | "expired" | "nearing_expiry" | null;
  id: string;
  lane: Readonly<{ id: string; name: string }> | null;
  organizer: Readonly<{
    color: string;
    displayName: string;
    id: string;
    initials: string;
  }>;
  organizerIds: readonly string[];
  planningStatus:
    | "archived"
    | "cancelled"
    | "completed"
    | "confirmed"
    | "draft"
    | "idea"
    | "tentative_hold";
  publicationStatus: "private" | "published" | "scheduled" | "unpublished";
  readOnly: boolean;
  source: "legacy" | "manual" | "meetup";
  sourceUrl: string | null;
  timeLabel: string;
  title: string;
}>;

export type OrganizerEventSummary = Readonly<{
  clubName: string;
  deleted: boolean;
  id: string;
  planningStatus:
    | "archived"
    | "cancelled"
    | "completed"
    | "confirmed"
    | "draft"
    | "idea"
    | "tentative_hold";
  publicationStatus: "private" | "published" | "scheduled" | "unpublished";
  scheduleLabel: string;
  title: string;
  updatedAtLabel: string;
}>;

export type OrganizerOption = Readonly<{
  id: string;
  label: string;
}>;

export type OrganizerEventFormOptions = Readonly<{
  categories: readonly OrganizerOption[];
  clubs: readonly OrganizerOption[];
  lanes: readonly OrganizerOption[];
  organizers: readonly Readonly<{
    clubs: readonly string[];
    id: string;
    label: string;
    organizationWide: boolean;
  }>[];
  programs: readonly Readonly<{
    clubId: string;
    id: string;
    label: string;
  }>[];
  venues?: readonly Readonly<{
    archived?: boolean;
    id: string;
    label: string;
    timezone: string;
  }>[];
}>;
