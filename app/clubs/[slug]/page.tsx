import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { ClubEventList } from "@/app/_components/ClubEventList";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import {
  getPublicClubBySlug,
  resolvePublicOrganization,
  type PublicClubDto,
} from "@/lib/server/public/catalog";
import {
  queryPublicEvents,
  type PublicEventPageDto,
} from "@/lib/server/public/events";
import { buildPublicPageMetadata } from "@/lib/server/public/metadata";
import {
  DEFAULT_TIME_ZONE,
  calendarDateInTimeZone,
} from "@/lib/time";
import { writeSafeLog } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

type ClubPageProps = Readonly<{
  params: Promise<{ slug: string }>;
}>;

type ClubEventsState =
  | Readonly<{
      kind: "available";
      past: PublicEventPageDto;
      upcoming: PublicEventPageDto;
    }>
  | Readonly<{ kind: "unavailable" }>;

export async function generateMetadata({
  params,
}: ClubPageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadPublicClub(slug, `/clubs/${slug}`);
  const club = loaded.kind === "available" ? loaded.club : null;
  return club
    ? buildPublicPageMetadata({
        description:
          club.description ?? "A published Vancouver Curiosity Club program.",
        pathname: `/clubs/${club.slug}`,
        title: club.name,
      })
    : {
        title: "Club not found",
        robots: {
          index: false,
          follow: false,
        },
      };
}

export default async function ClubDetailPage({ params }: ClubPageProps) {
  const { slug } = await params;
  const route = `/clubs/${slug}`;
  const loaded = await loadPublicClub(slug, route);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return (
      <main className="editorial-page">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/clubs", label: "Clubs" },
            { label: "Unavailable" },
          ]}
        />
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Temporarily unavailable</p>
          <h1>The club note could not be prepared.</h1>
          <p>No draft or substitute club information is being shown.</p>
        </section>
      </main>
    );
  }

  const events = await loadClubEvents(loaded.club, route);
  return (
    <main className="club-detail">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: "/clubs", label: "Clubs" },
          { label: loaded.club.name },
        ]}
      />
      <PageMasthead
        deck={
          loaded.club.description ??
          "A published Vancouver Curiosity Club program."
        }
        eyebrow={loaded.club.lane.name}
        title={loaded.club.name}
        tone={artworkTone(loaded.club.lane.slug)}
      />

      <section
        className="club-detail__destination"
        aria-labelledby="club-destination-heading"
      >
        <div>
          <p className="section-kicker">Official destination</p>
          <h2 id="club-destination-heading">Continue on Meetup</h2>
          <p>
            Event RSVPs and group activity continue on this club&apos;s
            confirmed public Meetup page.
          </p>
        </div>
        {loaded.club.publicGroupUrl ? (
          <a
            href={loaded.club.publicGroupUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open {loaded.club.name} on Meetup
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </section>

      {events.kind === "available" ? (
        <div className="club-detail__events">
          <ClubEventList
            emptyCopy="No upcoming published events are available for this club."
            events={events.upcoming.events}
            heading="Upcoming"
            id="club-upcoming"
          />
          <ClubEventList
            emptyCopy="No past published events are available for this club."
            events={events.past.events}
            heading="Past"
            id="club-past"
          />
        </div>
      ) : (
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Published calendar</p>
          <h2>Club events are temporarily unavailable.</h2>
          <p>
            The club note remains available, but no substitute event facts are
            being shown.
          </p>
        </section>
      )}
    </main>
  );
}

async function loadPublicClub(
  slug: string,
  route: string,
): Promise<
  | Readonly<{ club: PublicClubDto; kind: "available" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unavailable" }>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const club = await getPublicClubBySlug(database, slug);
    return club
      ? Object.freeze({ club, kind: "available" as const })
      : Object.freeze({ kind: "missing" as const });
  } catch {
    writeSafeLog("error", "public_club_unavailable", {
      code: "service_unavailable",
      operation: "read_public_club",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}

async function loadClubEvents(
  club: PublicClubDto,
  route: string,
): Promise<ClubEventsState> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) {
      return Object.freeze({ kind: "unavailable" as const });
    }
    const nowUtcMs = readServerUtcMs();
    const todayDate = calendarDateInTimeZone(
      nowUtcMs,
      DEFAULT_TIME_ZONE,
    );
    const [upcoming, past] = await Promise.all([
      queryPublicEvents(database, {
        clubSlug: club.slug,
        nowUtcMs,
        organizationId: organization.id,
        page: 1,
        pageSize: 6,
        todayDate,
        view: "upcoming",
      }),
      queryPublicEvents(database, {
        clubSlug: club.slug,
        nowUtcMs,
        organizationId: organization.id,
        page: 1,
        pageSize: 6,
        todayDate,
        view: "past",
      }),
    ]);
    return Object.freeze({
      kind: "available" as const,
      past,
      upcoming,
    });
  } catch {
    writeSafeLog("error", "public_club_events_unavailable", {
      code: "service_unavailable",
      operation: "list_public_club_events",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}

function artworkTone(laneSlug: string) {
  if (laneSlug === "reset-and-make") return "reset-make" as const;
  if (laneSlug === "explore") return "explore" as const;
  if (laneSlug === "eat-and-play") return "eat-play" as const;
  return "think" as const;
}
