import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
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
            our team has not received confirmed information.
          </li>
          <li>
            Some browsers may be unable to prepare a public form. If a form is
            unavailable, no information is sent.
          </li>
          <li>
            Meetup, map providers, and other external RSVP destinations have
            their own accessibility practices, which this website cannot
            control.
          </li>
        </ul>
        <p>
          If you encounter a barrier, use the{" "}
          <Link href="/contact">Contact form</Link> and choose the
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
          <p className="section-kicker">Clubs</p>
          <h2>Club pages are temporarily unavailable.</h2>
          <p>Please try again shortly.</p>
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
    <EditorialPage
      displayDeck="Attend a public program, volunteer, host a gathering, or begin a partnership conversation with our team."
      displayEyebrow="Get involved"
      displayParagraphs={[]}
      displayTitle="Bring something to the community"
      page={page}
      tone="community"
      {...preview}
    >
      <section className="contribution-hub" aria-labelledby="ways-heading">
        <div className="contribution-hub__intro">
          <p className="section-kicker">Choose a way to contribute</p>
          <h2 id="ways-heading">What would you like to make happen?</h2>
          <p>
            Have an event idea, want to help at a gathering, know a great
            venue, or want to support the work? Choose the path that best fits
            what you have in mind.
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
          <Link
            data-contribution-path="partner"
            href="/contact?topic=partnerships#contact-form"
          >
            <span aria-hidden="true">03</span>
            <strong>Offer a partnership or support</strong>
            <small>Discuss space, collaboration, funding, or sponsorship.</small>
          </Link>
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
  partnershipMode = false,
  ...preview
}: EditorialRoutePreviewProps &
  Readonly<{
    page: PublicPageDto;
    partnershipMode?: boolean;
  }>) {
  return (
    <EditorialPage
      displayDeck={
        partnershipMode
          ? "Tell us about your organization, what you are working on, and the kind of collaboration you have in mind."
          : "Send a private message to our team about events, accessibility, media, privacy, or another question."
      }
      displayEyebrow={partnershipMode ? "Partnership inquiry" : "Contact"}
      displayParagraphs={[]}
      displayTitle={
        partnershipMode ? "Start a conversation with our team." : "Contact"
      }
      page={page}
      tone="community"
      {...preview}
    >
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
    <EditorialPage
      displayDeck="Share a thoughtful event idea with our team for consideration as a public program."
      displayEyebrow="Public programs"
      displayParagraphs={[]}
      displayTitle="Propose an event"
      page={page}
      tone="reset-make"
      {...preview}
    >
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
