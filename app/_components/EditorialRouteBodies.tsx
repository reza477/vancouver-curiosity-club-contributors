import Link from "next/link";
import type { ReactNode } from "react";
import { ClubDirectory } from "./ClubDirectory";
import {
  EditorialPage,
} from "./EditorialPage";
import type {
  PublicClubDto,
  PublicCommunityLinkDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type { PublicEventCardDto } from "@/lib/server/public/events";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";
import type { ClubDirectoryNextEventsState } from "./ClubDirectory";

type EditorialRoutePreviewProps = Readonly<{
  children?: ReactNode;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
}>;

export function ClubsRouteBody({
  clubs,
  mediaById,
  nextEventsByClubSlug = new Map(),
  nextEventsState = "omitted",
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    clubs: readonly PublicClubDto[] | null;
    mediaById: ReadonlyMap<string, ResponsiveMediaAssetDto>;
    nextEventsByClubSlug?: ReadonlyMap<string, PublicEventCardDto>;
    nextEventsState?: ClubDirectoryNextEventsState;
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="think" {...preview}>
      {clubs ? (
        <ClubDirectory
          clubs={clubs}
          mediaById={mediaById}
          nextEventsByClubSlug={nextEventsByClubSlug}
          nextEventsState={nextEventsState}
        />
      ) : (
        <section className="public-service-state" aria-live="polite">
          <p className="section-kicker">Published clubs</p>
          <h2>Club pages are temporarily unavailable.</h2>
          <p>No draft or substitute program information is being shown.</p>
        </section>
      )}
    </EditorialPage>
  );
}

export function GetInvolvedRouteBody({
  children,
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="community" {...preview}>
      <section className="contribution-hub" aria-labelledby="ways-heading">
        <div className="contribution-hub__intro">
          <p className="section-kicker">Choose a way to contribute</p>
          <h2 id="ways-heading">What would you like to make happen?</h2>
          <p>
            Have an event idea, want to help at a gathering, or know a great
            venue? Send the organizers the useful details in one of the forms
            below.
          </p>
        </div>
        <div className="contribution-paths">
          <a data-contribution-path="volunteer" href="#volunteer">
            <span aria-hidden="true">01</span>
            <strong>Volunteer</strong>
            <small>Help welcome people or support an event.</small>
          </a>
          <Link data-contribution-path="host" href="/host-an-event">
            <span aria-hidden="true">02</span>
            <strong>Host an event</strong>
            <small>Share a topic, activity, or gathering idea.</small>
          </Link>
          <a data-contribution-path="partner" href="#partner">
            <span aria-hidden="true">03</span>
            <strong>Offer a venue or partnership</strong>
            <small>Start a practical conversation with the organizers.</small>
          </a>
        </div>
      </section>
      {children}
    </EditorialPage>
  );
}

export function ContactRouteBody({
  children,
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="community" {...preview}>
      {children}
    </EditorialPage>
  );
}

export function HostAnEventRouteBody({
  children,
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="reset-make" {...preview}>
      {children}
    </EditorialPage>
  );
}
