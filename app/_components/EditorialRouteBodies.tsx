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
import { PUBLIC_FORM_PURPOSE_COPY } from "@/lib/server/phase7/public-form-contract";
import type { ClubDirectoryNextEventsState } from "./ClubDirectory";

type EditorialRoutePreviewProps = Readonly<{
  children?: ReactNode;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  privatePreview?: boolean;
}>;

export function AccessibilityRouteBody({
  page,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    page: PublicPageDto;
  }>) {
  return (
    <EditorialPage page={page} tone="reset-make" {...preview}>
      <section
        className="editorial-section editorial-section--prose accessibility-statement"
        aria-labelledby="accessibility-target-title"
      >
        <p className="section-kicker">Accessibility statement</p>
        <h2 id="accessibility-target-title">Our accessibility target</h2>
        <p>We aim to meet WCAG 2.2 Level AA.</p>
        <p>
          This accessibility statement was reviewed on{" "}
          <time dateTime="2026-08-12">August 12, 2026</time>.
        </p>
        <h3>Known limitations</h3>
        <ul>
          <li>
            Some event listings do not yet include venue-access details because
            those details have not been confirmed by an organizer.
          </li>
          <li>
            Public forms require JavaScript to prepare secure sending. If
            scripts are unavailable, a form cannot be submitted through this
            website and no information is sent.
          </li>
          <li>
            Meetup, map providers, and other external RSVP destinations have
            their own accessibility practices, which this website cannot
            control.
          </li>
        </ul>
        <p>
          If you encounter a barrier, use the{" "}
          <Link href="/contact">Feedback form</Link> and choose the
          Accessibility topic. Include the page or event and what went wrong;
          device or assistive-technology details are welcome if you are
          comfortable sharing them.
        </p>
      </section>
    </EditorialPage>
  );
}

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
      <PublicFormPageGuidance />
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
      <PublicFormPageGuidance />
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
      <PublicFormPageGuidance />
      {children}
    </EditorialPage>
  );
}

function PublicFormPageGuidance() {
  return (
    <aside className="public-form-guidance" aria-label="Before you send">
      <p className="public-submission__privacy">
        We handle the details you send privately; read the{" "}
        <Link href="/privacy">Privacy notice</Link> for more information.
      </p>
      <p className="public-submission__process">
        {PUBLIC_FORM_PURPOSE_COPY}
      </p>
    </aside>
  );
}
