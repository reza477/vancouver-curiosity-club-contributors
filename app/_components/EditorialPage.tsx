import type { Metadata } from "next";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { EventCard } from "@/app/_components/EventCard";
import { StructuredData } from "@/app/_components/StructuredData";
import {
  PageMasthead,
} from "@/app/_components/PageMasthead";
import type { FieldArtworkTone } from "@/app/_components/FieldArtwork";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import {
  getPublicSlugRedirect,
  listPublicClubs,
  listPublicCommunityLinks,
  resolvePublicOrganization,
  type PublicClubDto,
  type PublicCommunityLinkDto,
  type PublicPageDto,
  type PublicPageSectionDto,
} from "@/lib/server/public/catalog";
import {
  getRequestPublicOrganization,
  getRequestPublicPageContent,
  getRequestPublicSiteContext,
} from "@/lib/server/public/request-cache";
import { readServerUtcMs } from "@/lib/server/clock";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  getEditorialPublicEvents,
  type PublicEventCardDto,
} from "@/lib/server/public/events";
import {
  resolveMediaAssetsForRendering,
  type ResponsiveMediaAssetDto,
} from "@/lib/server/media/usage";
import {
  buildPublicPageMetadataForOrigin,
} from "@/lib/server/public/metadata";
import {
  getTrustedRequestOrigin,
  publicUrl,
} from "@/lib/server/public/origin";
import { writeSafeLog } from "@/lib/validation/server-observability";
import {
  focalPointObjectPosition,
  responsiveImageSrcSet,
} from "@/lib/media/presentation";
import { usesShippedSocialArtwork } from "@/lib/brand";

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

export type EditorialRenderContext = Readonly<{
  clubs: readonly PublicClubDto[] | null;
  communityLinks: readonly PublicCommunityLinkDto[] | null;
  eventsBySlug: ReadonlyMap<string, PublicEventCardDto> | null;
  mediaById: ReadonlyMap<string, ResponsiveMediaAssetDto>;
  upcomingEvents: readonly PublicEventCardDto[] | null;
}>;

export async function loadEditorialPage(
  slug: string,
  route: string,
): Promise<EditorialPageLoadState> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const page = await getRequestPublicPageContent(database, slug);
    if (page) return Object.freeze({ kind: "available" as const, page });
    return Object.freeze({ kind: "missing" as const });
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

export async function loadEditorialRedirect(
  slug: string,
  route: string,
): Promise<
  | Readonly<{ kind: "available"; slug: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unavailable" }>
> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const redirect = await getPublicSlugRedirect(database, {
      entityType: "page",
      fromSlug: slug,
    });
    return redirect
      ? Object.freeze({ kind: "available" as const, slug: redirect })
      : Object.freeze({ kind: "missing" as const });
  } catch {
    writeSafeLog("error", "public_editorial_redirect_unavailable", {
      code: "service_unavailable",
      operation: "read_public_page_redirect",
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
  absoluteTitle = false,
  descriptionOverride,
  fallbackTitle,
  path,
  route,
  slug,
}: Readonly<{
  absoluteTitle?: boolean;
  descriptionOverride?: string;
  fallbackTitle: string;
  path: string;
  route: string;
  slug: string;
}>): Promise<Metadata> {
  const [loaded, support, origin] = await Promise.all([
    loadEditorialPage(slug, route),
    loadEditorialMetadataSupport(),
    getTrustedRequestOrigin(),
  ]);
  const page = loaded.kind === "available" ? loaded.page : null;
  const site = support?.site ?? null;
  let socialMedia: ResponsiveMediaAssetDto | null = null;
  if (page && support) {
    try {
      const assetIds = [
        page.openGraphAssetId,
        site?.openGraphAssetId ?? null,
      ].flatMap((assetId) => (assetId ? [assetId] : []));
      if (support.organization && assetIds.length > 0) {
        const resolvedMedia = await resolveMediaAssetsForRendering(
          support.database,
          {
            organizationId: support.organization.id,
            publicationScope: "published",
            usages: [
              ...(page.openGraphAssetId
                ? [
                    {
                      assetId: page.openGraphAssetId,
                      entityKey: page.slug,
                      entityType: "page" as const,
                      usageKind: "open_graph",
                    },
                  ]
                : []),
              ...(site?.openGraphAssetId
                ? [
                    {
                      assetId: site.openGraphAssetId,
                      entityKey: support.organization.id,
                      entityType: "site_og" as const,
                      usageKind: "open_graph",
                    },
                  ]
                : []),
            ],
          },
        );
        socialMedia =
          resolvedMedia.find(
            ({ assetId }) => assetId === page.openGraphAssetId,
          ) ??
          resolvedMedia.find(
            ({ assetId }) => assetId === site?.openGraphAssetId,
          ) ??
          null;
      }
    } catch {
      socialMedia = null;
    }
  }
  const title = page?.seoTitle ?? page?.title ?? fallbackTitle;
  const description = page
    ? (descriptionOverride ??
      page.metaDescription ??
      pageDescription(page) ??
      page.title)
    : undefined;
  return buildEditorialMetadataFromResolved({
    absoluteTitle,
    description,
    fallbackTitle,
    origin,
    path,
    page,
    siteName: site?.brandName,
    socialMedia,
    title,
    useShippedSocialFallback: usesShippedSocialArtwork(site),
  });
}

async function loadEditorialMetadataSupport() {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const [organization, site] = await Promise.all([
      getRequestPublicOrganization(database),
      getRequestPublicSiteContext(database),
    ]);
    return Object.freeze({ database, organization, site });
  } catch {
    return null;
  }
}

export function buildEditorialMetadataFromResolved({
  absoluteTitle,
  description,
  fallbackTitle,
  origin,
  path,
  page,
  siteName,
  socialMedia,
  title = page?.seoTitle ?? page?.title ?? fallbackTitle,
  useShippedSocialFallback,
}: Readonly<{
  absoluteTitle: boolean;
  description: string | undefined;
  fallbackTitle: string;
  origin: URL | null;
  path: string;
  page: PublicPageDto | null;
  siteName: string | undefined;
  socialMedia: ResponsiveMediaAssetDto | null;
  title?: string;
  useShippedSocialFallback: boolean;
}>): Metadata {
  if (page && description) {
    const metadata = buildPublicPageMetadataForOrigin(
      {
        description,
        imageAlt: socialMedia
          ? (socialMedia.altText ?? "")
          : undefined,
        imageHeight: socialMedia?.variants.webp1600.height,
        imagePath:
          socialMedia?.variants.webp1600.url ??
          (useShippedSocialFallback ? undefined : null),
        imageWidth: socialMedia?.variants.webp1600.width,
        pathname: path,
        siteName,
        title,
      },
      origin,
    );
    return absoluteTitle
      ? { ...metadata, title: { absolute: title } }
      : metadata;
  }
  return {
    title: absoluteTitle ? { absolute: title } : title,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export async function EditorialPage({
  children,
  page,
  previewCommunityLinks,
  privatePreview = false,
  previewMediaAssets,
  tone = "think",
}: Readonly<{
  children?: ReactNode;
  page: PublicPageDto;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  privatePreview?: boolean;
  previewMediaAssets?: readonly ResponsiveMediaAssetDto[];
  tone?: FieldArtworkTone;
}>) {
  const introduction = introductionFor(page);
  const sections = page.sections.filter(
    (section) => section !== introduction,
  );
  const renderContext = await loadEditorialRenderContext({
    page,
    previewCommunityLinks,
    previewMediaAssets,
    privatePreview,
  });
  const origin = privatePreview ? null : await getTrustedRequestOrigin();

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
          "Stories and information from Vancouver Curiosity Club."
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
            <EditorialSection
              key={section.key}
              renderContext={renderContext}
              section={section}
            />
          ))}
        </div>
      ) : null}
      {children}
      {origin ? (
        <StructuredData
          value={{
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: publicUrl("/", origin),
              },
              {
                "@type": "ListItem",
                position: 2,
                name: page.title,
                item: publicUrl(
                  page.slug === "home" ? "/" : `/${page.slug}`,
                  origin,
                ),
              },
            ],
          }}
        />
      ) : null}
    </main>
  );
}

export async function loadEditorialRenderContext({
  page,
  previewCommunityLinks,
  previewMediaAssets,
  privatePreview,
}: Readonly<{
  page: PublicPageDto;
  previewCommunityLinks?: readonly PublicCommunityLinkDto[];
  previewMediaAssets: readonly ResponsiveMediaAssetDto[] | undefined;
  privatePreview: boolean;
}>): Promise<EditorialRenderContext> {
  const clubBlocks = page.sections.filter(
    (section) => section.type.replaceAll("_", "-") === "featured-clubs",
  );
  const communityBlocks = page.sections.filter(
    (section) => section.type.replaceAll("_", "-") === "community-links",
  );
  const eventBlocks = page.sections.filter(
    (section) => section.type.replaceAll("_", "-") === "featured-events",
  );
  const mediaIds = Object.freeze([
    ...new Set(
      page.sections.flatMap((section) =>
        section.content.assetId ? [section.content.assetId] : [],
      ),
    ),
  ]);
  const requestedEventSlugs = Object.freeze([
    ...new Set(
      eventBlocks.flatMap((section) =>
        (section.content.eventSlugs ?? []).slice(
          0,
          section.content.limit ?? 6,
        ),
      ),
    ),
  ]);
  const previewMediaById = new Map<string, ResponsiveMediaAssetDto>();
  for (const asset of previewMediaAssets ?? []) {
    previewMediaById.set(asset.assetId, asset);
  }
  try {
    const { database } = getRuntimeAuthConfiguration();
    const needsOrganization =
      eventBlocks.length > 0 ||
      (mediaIds.length > 0 && previewMediaAssets === undefined);
    const organization = needsOrganization
      ? await resolvePublicOrganization(database)
      : null;
    if (needsOrganization && !organization) {
      throw new Error("Public organization unavailable.");
    }
    const nowUtcMs = readServerUtcMs();
    const [clubs, communityLinks, editorialEvents, media] =
      await Promise.all([
        clubBlocks.length > 0 ? listPublicClubs(database) : Promise.resolve([]),
        communityBlocks.length > 0
          ? previewCommunityLinks !== undefined
            ? Promise.resolve(previewCommunityLinks)
            : listPublicCommunityLinks(database)
          : Promise.resolve([]),
        eventBlocks.length > 0 && organization
          ? getEditorialPublicEvents(database, {
              nowUtcMs,
              organizationId: organization.id,
              requestedSlugs: requestedEventSlugs,
              todayDate: vancouverCalendarDate(nowUtcMs),
            })
          : Promise.resolve({
              defaultUpcoming: Object.freeze([]),
              selected: Object.freeze([]),
            }),
        mediaIds.length > 0 &&
        previewMediaAssets === undefined &&
        organization
          ? resolveMediaAssetsForRendering(database, {
              organizationId: organization.id,
              publicationScope: privatePreview ? "draft" : "published",
              ...(privatePreview
                ? { assetIds: mediaIds }
                : {
                    usages: page.sections.flatMap((section) =>
                      section.content.assetId
                        ? [
                            {
                              assetId: section.content.assetId,
                              entityKey: page.slug,
                              entityType: "page" as const,
                              usageKind: `block:${section.key}`,
                            },
                          ]
                        : [],
                    ),
                  }),
            })
          : Promise.resolve([]),
      ]);
    for (const asset of media) previewMediaById.set(asset.assetId, asset);
    return Object.freeze({
      clubs: Object.freeze(clubs),
      communityLinks: Object.freeze(communityLinks),
      eventsBySlug: new Map(
        editorialEvents.selected.map((event) => [event.slug, event]),
      ),
      mediaById: previewMediaById,
      upcomingEvents: editorialEvents.defaultUpcoming,
    });
  } catch {
    return Object.freeze({
      clubs: clubBlocks.length > 0 ? null : Object.freeze([]),
      communityLinks:
        communityBlocks.length > 0 ? null : Object.freeze([]),
      eventsBySlug: eventBlocks.length > 0 ? null : new Map(),
      mediaById: previewMediaById,
      upcomingEvents: eventBlocks.length > 0 ? null : Object.freeze([]),
    });
  }
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
          This page is temporarily unavailable. No substitute details are
          being shown.
        </p>
      </section>
    </main>
  );
}

export function CommunityDestinations({
  heading = "Find the club on Meetup",
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
        <p className="section-kicker">Community links</p>
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
              {link.description ? <p>{link.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="public-empty-note">
          No group link is available here right now.
        </p>
      )}
    </section>
  );
}

export function CommunityDestinationsUnavailable() {
  return (
    <section className="community-destinations" aria-live="polite">
      <p className="section-kicker">Community links</p>
      <h2>Group links are temporarily unavailable.</h2>
      <p>
        No substitute address is being shown. Please try again later.
      </p>
    </section>
  );
}

export function hasCommunityLinksBlock(page: PublicPageDto): boolean {
  return page.sections.some(
    (section) =>
      section.type === "community_links" ||
      section.type === "community-links",
  );
}

export function editorialToneForSlug(slug: string): FieldArtworkTone {
  if (slug === "host-an-event" || slug === "accessibility") {
    return "reset-make";
  }
  if (
    slug === "community" ||
    slug === "about" ||
    slug === "get-involved" ||
    slug === "contact" ||
    slug === "conduct"
  ) {
    return "community";
  }
  return "think";
}

export function EditorialSection({
  renderContext,
  section,
}: Readonly<{
  renderContext: EditorialRenderContext;
  section: PublicPageSectionDto;
}>) {
  const content = section.content;
  const headingId = `section-${section.key}`;
  const type = section.type.replaceAll("_", "-");
  const Wrapper = type === "callout" ? "aside" : "section";

  if (type === "media" && content.assetId) {
    return (
      <PublicMediaBlock
        content={content}
        headingId={headingId}
        media={renderContext.mediaById.get(content.assetId)}
      />
    );
  }

  if (
    (type === "ordered-link-list" || type === "resource-list") &&
    content.links?.length
  ) {
    const List = type === "ordered-link-list" ? "ol" : "ul";
    return (
      <section
        className={`editorial-section editorial-section--${type}`}
        aria-labelledby={content.heading ? headingId : undefined}
      >
        {content.eyebrow ? (
          <p className="section-kicker">{content.eyebrow}</p>
        ) : null}
        {content.heading ? <h2 id={headingId}>{content.heading}</h2> : null}
        {content.text ? <p>{content.text}</p> : null}
        <List className="editorial-link-list">
          {content.links.map((link) => (
            <li key={`${link.label}-${link.url}`}>
              <PublicContentLink href={link.url} label={link.label} />
              {link.description ? <p>{link.description}</p> : null}
            </li>
          ))}
        </List>
      </section>
    );
  }

  if (type === "featured-clubs") {
    return (
      <FeaturedClubsBlock
        clubs={renderContext.clubs}
        content={content}
        headingId={headingId}
      />
    );
  }
  if (type === "community-links") {
    return (
      <CommunityLinksBlock
        content={content}
        headingId={headingId}
        published={renderContext.communityLinks}
      />
    );
  }
  if (type === "featured-events") {
    return (
      <FeaturedEventsBlock
        content={content}
        eventsBySlug={renderContext.eventsBySlug}
        headingId={headingId}
        upcomingEvents={renderContext.upcomingEvents}
      />
    );
  }

  return (
    <Wrapper
      className={`editorial-section editorial-section--${type}`}
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

function PublicMediaBlock({
  content,
  headingId,
  media,
}: Readonly<{
  content: PublicPageSectionDto["content"];
  headingId: string;
  media: ResponsiveMediaAssetDto | undefined;
}>) {
  if (!content.assetId || !media) {
    return <DynamicBlockUnavailable heading="Artwork" />;
  }
  const altText = media.altText ?? "";
  const caption = content.caption ?? media.caption;
  const srcSet = responsiveImageSrcSet([
    media.variants.webp480,
    media.variants.webp960,
    media.variants.webp1600,
  ]);
  return (
    <figure
      className="editorial-section editorial-section--media"
      aria-labelledby={content.heading ? headingId : undefined}
    >
      {content.heading ? <h2 id={headingId}>{content.heading}</h2> : null}
      <picture>
        <source
          sizes="(max-width: 42rem) 100vw, (max-width: 75rem) 86vw, 68rem"
          srcSet={srcSet}
          type="image/webp"
        />
        <img
          alt={altText}
          height={media.variants.webp1600.height}
          loading="lazy"
          sizes="(max-width: 42rem) 100vw, (max-width: 75rem) 86vw, 68rem"
          src={media.variants.webp1600.url}
          srcSet={srcSet}
          style={{
            objectPosition: focalPointObjectPosition(media.focalPoint),
          }}
          width={media.variants.webp1600.width}
        />
      </picture>
      {caption || media.credit ? (
        <figcaption>
          {caption ? <span>{caption}</span> : null}
          {caption && media.credit ? " · " : null}
          {media.credit ? <span>Credit: {media.credit}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function PublicContentLink({
  href,
  label,
}: Readonly<{ href: string; label: string }>) {
  return href.startsWith("/") ? (
    <Link href={href}>{label}</Link>
  ) : (
    <a href={href} rel="noreferrer noopener" target="_blank">
      {label}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function FeaturedClubsBlock({
  clubs,
  content,
  headingId,
}: Readonly<{
  clubs: readonly PublicClubDto[] | null;
  content: PublicPageSectionDto["content"];
  headingId: string;
}>) {
  if (clubs === null) {
    return <DynamicBlockUnavailable heading="Featured clubs" />;
  }
  const requested = content.clubSlugs ?? [];
  const bySlug = new Map(clubs.map((club) => [club.slug, club]));
  const visible =
    requested.length > 0
      ? requested
          .flatMap((slug) => {
            const club = bySlug.get(slug);
            return club ? [club] : [];
          })
          .slice(0, content.limit ?? 6)
      : clubs.filter((club) => club.featured).slice(0, content.limit ?? 6);
  return (
    <section
      className="editorial-section editorial-section--featured-clubs"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{content.heading ?? "Featured clubs"}</h2>
      {visible.length > 0 ? (
        <div className="editorial-feature-grid">
          {visible.map((club) => (
            <article key={club.slug}>
              <p className="section-kicker">{club.lane.name}</p>
              <h3>
                <Link href={`/clubs/${club.slug}`}>{club.name}</Link>
              </h3>
              {club.description ? <p>{club.description}</p> : null}
            </article>
          ))}
        </div>
      ) : (
        <p>No club matches this selection.</p>
      )}
    </section>
  );
}

function CommunityLinksBlock({
  content,
  headingId,
  published,
}: Readonly<{
  content: PublicPageSectionDto["content"];
  headingId: string;
  published: readonly PublicCommunityLinkDto[] | null;
}>) {
  if (published === null) {
    return <DynamicBlockUnavailable heading="Community destinations" />;
  }
  const requestedUrls = content.links?.map((link) => link.url) ?? [];
  const byUrl = new Map(published.map((link) => [link.url, link]));
  const links =
    requestedUrls.length > 0
      ? requestedUrls
          .flatMap((url) => {
            const link = byUrl.get(url);
            return link ? [link] : [];
          })
          .slice(0, content.limit ?? 12)
      : published.slice(0, content.limit ?? 12);
  return (
    <section
      className="editorial-section editorial-section--community-links"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{content.heading ?? "Community destinations"}</h2>
      {links.length > 0 ? (
        <ul className="editorial-link-list">
          {links.map((link) => (
            <li key={link.url}>
              <PublicContentLink href={link.url} label={link.label} />
            </li>
          ))}
        </ul>
      ) : (
        <p>No confirmed public destination is available right now.</p>
      )}
    </section>
  );
}

function FeaturedEventsBlock({
  content,
  eventsBySlug,
  headingId,
  upcomingEvents,
}: Readonly<{
  content: PublicPageSectionDto["content"];
  eventsBySlug: ReadonlyMap<string, PublicEventCardDto> | null;
  headingId: string;
  upcomingEvents: readonly PublicEventCardDto[] | null;
}>) {
  if (eventsBySlug === null || upcomingEvents === null) {
    return <DynamicBlockUnavailable heading="Events" />;
  }
  const requested = content.eventSlugs ?? [];
  const events =
    requested.length > 0
      ? requested
          .flatMap((slug) => {
            const event = eventsBySlug.get(slug);
            return event ? [event] : [];
          })
          .slice(0, content.limit ?? 6)
      : upcomingEvents.slice(0, content.limit ?? 6);
  return (
    <section
      className="editorial-section editorial-section--featured-events"
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{content.heading ?? "Upcoming events"}</h2>
      {events.length > 0 ? (
        <div className="event-list">
          {events.map((event) => (
            <EventCard event={event} key={event.slug} />
          ))}
        </div>
      ) : (
        <p>No upcoming event is listed right now.</p>
      )}
    </section>
  );
}

function DynamicBlockUnavailable({
  heading,
}: Readonly<{ heading: string }>) {
  return (
    <section className="editorial-section" aria-live="polite">
      <h2>{heading} are temporarily unavailable.</h2>
      <p>No private or substitute information is being shown.</p>
    </section>
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
    )
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
