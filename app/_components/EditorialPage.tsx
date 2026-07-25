import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import {
  PageMasthead,
} from "@/app/_components/PageMasthead";
import type { FieldArtworkTone } from "@/app/_components/FieldArtwork";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  getPublicPageContent,
  listPublicCommunityLinks,
  type PublicCommunityLinkDto,
  type PublicPageDto,
  type PublicPageSectionDto,
} from "@/lib/server/public/catalog";
import { buildPublicPageMetadata } from "@/lib/server/public/metadata";
import { writeSafeLog } from "@/lib/validation/server-observability";

export type EditorialPageLoadState =
  | Readonly<{ kind: "available"; page: PublicPageDto }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unavailable" }>;

export type CommunityLinksLoadState =
  | Readonly<{
      kind: "available";
      links: readonly PublicCommunityLinkDto[];
    }>
  | Readonly<{ kind: "unavailable" }>;

export async function loadEditorialPage(
  slug: string,
  route: string,
): Promise<EditorialPageLoadState> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const page = await getPublicPageContent(database, slug);
    return page
      ? Object.freeze({ kind: "available" as const, page })
      : Object.freeze({ kind: "missing" as const });
  } catch {
    writeSafeLog("error", "public_editorial_page_unavailable", {
      code: "service_unavailable",
      operation: "read_public_page",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}

export async function loadCommunityDestinations(
  route: string,
): Promise<CommunityLinksLoadState> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const links = await listPublicCommunityLinks(database);
    return Object.freeze({ kind: "available" as const, links });
  } catch {
    writeSafeLog("error", "public_community_links_unavailable", {
      code: "service_unavailable",
      operation: "read_public_community_links",
      route,
      status: 503,
    });
    return Object.freeze({ kind: "unavailable" as const });
  }
}

export async function buildEditorialMetadata({
  fallbackTitle,
  path,
  route,
  slug,
}: Readonly<{
  fallbackTitle: string;
  path: string;
  route: string;
  slug: string;
}>): Promise<Metadata> {
  const loaded = await loadEditorialPage(slug, route);
  const page = loaded.kind === "available" ? loaded.page : null;
  const title = page?.title ?? fallbackTitle;
  const description = page ? (pageDescription(page) ?? page.title) : undefined;
  return page && description
    ? buildPublicPageMetadata({
        description,
        pathname: path,
        title,
      })
    : {
        title,
        robots: {
          index: false,
          follow: false,
        },
      };
}

export function EditorialPage({
  children,
  page,
  tone = "think",
}: Readonly<{
  children?: ReactNode;
  page: PublicPageDto;
  tone?: FieldArtworkTone;
}>) {
  const introduction = introductionFor(page);
  const sections = page.sections.filter(
    (section) => section !== introduction,
  );

  return (
    <main className="editorial-page">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: page.title },
        ]}
      />
      <PageMasthead
        deck={
          introduction?.content.text ??
          "Published notes from Vancouver Curiosity Club."
        }
        eyebrow={introduction?.content.eyebrow ?? "Field notes"}
        title={introduction?.content.heading ?? page.title}
        tone={tone}
      />

      {introduction?.content.paragraphs?.length ? (
        <section
          className="editorial-section editorial-section--prose"
          aria-label={`${page.title} details`}
        >
          {introduction.content.paragraphs.map((paragraph, index) => (
            <p key={`introduction-${index}`}>{paragraph}</p>
          ))}
        </section>
      ) : null}

      {sections.length > 0 ? (
        <div className="editorial-sections">
          {sections.map((section) => (
            <EditorialSection key={section.key} section={section} />
          ))}
        </div>
      ) : null}
      {children}
    </main>
  );
}

export function EditorialUnavailable({
  title,
}: Readonly<{ title: string }>) {
  return (
    <main className="editorial-page">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: title },
        ]}
      />
      <section className="public-service-state" aria-labelledby="service-title">
        <p className="section-kicker">Temporarily unavailable</p>
        <h1 id="service-title">{title} could not be prepared.</h1>
        <p>
          The public content service did not return a complete result. No
          substitute details are being shown.
        </p>
      </section>
    </main>
  );
}

export function CommunityDestinations({
  heading = "Confirmed Meetup groups",
  links,
}: Readonly<{
  heading?: string;
  links: readonly PublicCommunityLinkDto[];
}>) {
  return (
    <section
      className="community-destinations"
      aria-labelledby="community-destinations-heading"
    >
      <div>
        <p className="section-kicker">Official destinations</p>
        <h2 id="community-destinations-heading">{heading}</h2>
      </div>
      {links.length > 0 ? (
        <ul>
          {links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span>{link.label}</span>
                <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="public-empty-note">
          No confirmed public group destination is available here right now.
        </p>
      )}
    </section>
  );
}

export function CommunityDestinationsUnavailable() {
  return (
    <section className="community-destinations" aria-live="polite">
      <p className="section-kicker">Official destinations</p>
      <h2>Group links are temporarily unavailable.</h2>
      <p>
        No substitute address is being shown. Please return when the public
        catalog is available.
      </p>
    </section>
  );
}

function EditorialSection({
  section,
}: Readonly<{ section: PublicPageSectionDto }>) {
  const content = section.content;
  const headingId = `section-${section.key}`;
  const Wrapper = section.type === "callout" ? "aside" : "section";

  return (
    <Wrapper
      className={`editorial-section editorial-section--${section.type}`}
      aria-labelledby={content.heading ? headingId : undefined}
    >
      {content.eyebrow ? (
        <p className="section-kicker">{content.eyebrow}</p>
      ) : null}
      {content.heading ? <h2 id={headingId}>{content.heading}</h2> : null}
      {content.text ? <p>{content.text}</p> : null}
      {content.paragraphs?.map((paragraph, index) => (
        <p key={`${section.key}-${index}`}>{paragraph}</p>
      ))}
    </Wrapper>
  );
}

function introductionFor(
  page: PublicPageDto,
): PublicPageSectionDto | undefined {
  return (
    page.sections.find(
      (section) =>
        section.type === "intro" ||
        section.type === "hero" ||
        section.key === "intro" ||
        section.key === "hero",
    ) ?? page.sections[0]
  );
}

function pageDescription(page: PublicPageDto): string | undefined {
  const introduction = introductionFor(page);
  return (
    introduction?.content.text ??
    introduction?.content.paragraphs?.[0] ??
    undefined
  );
}
