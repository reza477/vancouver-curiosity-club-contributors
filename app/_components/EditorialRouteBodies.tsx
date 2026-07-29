import Link from "next/link";
import type { ReactNode } from "react";
import { ClubDirectory } from "./ClubDirectory";
import {
  CommunityDestinations,
  CommunityDestinationsUnavailable,
  EditorialPage,
  type CommunityLinksLoadState,
} from "./EditorialPage";
import type {
  PublicClubDto,
  PublicCommunityLinkDto,
  PublicPageDto,
} from "@/lib/server/public/catalog";
import type { ResponsiveMediaAssetDto } from "@/lib/server/media/usage";

type EditorialRoutePreviewProps = Readonly<{
  children?: ReactNode;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
}>;

export function ClubsRouteBody({
  clubs,
  mediaById,
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    clubs: readonly PublicClubDto[] | null;
    mediaById: ReadonlyMap<string, ResponsiveMediaAssetDto>;
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="think" {...preview}>
      {clubs ? (
        <ClubDirectory clubs={clubs} mediaById={mediaById} />
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
  destinations,
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    destinations: CommunityLinksLoadState | null;
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="community" {...preview}>
      <section className="editorial-actions" aria-labelledby="ways-heading">
        <div>
          <p className="section-kicker">Ways in</p>
          <h2 id="ways-heading">Start with what is available now.</h2>
        </div>
        <div className="editorial-actions__links">
          <Link href="/events">Explore upcoming events</Link>
          <Link href="/host-an-event">Read about hosting</Link>
        </div>
      </section>
      <Destinations state={destinations} />
      {children}
    </EditorialPage>
  );
}

export function ContactRouteBody({
  children,
  destinations,
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    destinations: CommunityLinksLoadState | null;
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="community" {...preview}>
      {destinations?.kind === "available" ? (
        <CommunityDestinations
          heading={contactDestinationHeading(destinations.links)}
          links={destinations.links}
        />
      ) : destinations ? (
        <CommunityDestinationsUnavailable />
      ) : null}
      {children}
    </EditorialPage>
  );
}

export function HostAnEventRouteBody({
  children,
  destinations,
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    destinations: CommunityLinksLoadState | null;
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="reset-make" {...preview}>
      {destinations?.kind === "available" ? (
        <CommunityDestinations
          heading="Connect through a confirmed group"
          links={destinations.links}
        />
      ) : destinations ? (
        <CommunityDestinationsUnavailable />
      ) : null}
      {children}
    </EditorialPage>
  );
}

export function contactDestinationHeading(
  links: readonly PublicCommunityLinkDto[],
): string {
  return links.length > 0 &&
    links.every((link) => link.linkType === "meetup_group")
    ? "Choose the relevant Meetup group"
    : "Choose a community destination";
}

function Destinations({
  state,
}: Readonly<{ state: CommunityLinksLoadState | null }>) {
  return state?.kind === "available" ? (
    <CommunityDestinations links={state.links} />
  ) : state ? (
    <CommunityDestinationsUnavailable />
  ) : null;
}
