import type { CSSProperties } from "react";
import { ClubDetailRenderer } from "@/app/_components/ClubDetailRenderer";
import { ProgramDetailRenderer } from "@/app/_components/ProgramDetailRenderer";
import {
  ClubsRouteBody,
  ContactRouteBody,
  GetInvolvedRouteBody,
  HostAnEventRouteBody,
} from "@/app/_components/EditorialRouteBodies";
import { HomePageRenderer } from "@/app/_components/HomePageRenderer";
import { EventsPageRenderer } from "@/app/_components/EventsPageRenderer";
import {
  CommunityDestinations,
  EditorialPage,
  editorialToneForSlug,
  hasCommunityLinksBlock,
} from "@/app/_components/EditorialPage";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { SiteFooter } from "@/app/_components/SiteFooter";
import { SiteHeader } from "@/app/_components/SiteHeader";
import styles from "@/app/_organizer/phase6.module.css";
import { resolvePublicBrandPalette } from "@/lib/brand";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import type {
  CmsRevisionPreviewDto,
} from "@/lib/server/organizer/cms";
import type {
  CmsClubProfileSnapshot,
  CmsCommunityLinkSnapshot,
  CmsLegalStatusSnapshot,
  CmsNavigationSnapshot,
  CmsPageSnapshot,
  CmsProgramProfileSnapshot,
  CmsSiteIdentitySnapshot,
} from "@/lib/server/organizer/cms-validation";
import {
  buildPublicPagePreviewDto,
  getPublicPageContent,
  resolvePublicOrganization,
  type PublicCatalogDto,
  type PublicClubDto,
  type PublicNavigationItemDto,
  type PublicProgramDto,
} from "@/lib/server/public/catalog";
import { vancouverCalendarDate } from "@/lib/server/public/date";
import {
  queryPublicEvents,
  type PublicEventPageDto,
} from "@/lib/server/public/events";
import {
  emptyPublicMonthCalendar,
  loadPublicMonthCalendar,
} from "@/lib/server/public/month-calendar";
import {
  resolveMediaAssetsForRendering,
} from "@/lib/server/media/usage";

export async function PublicPreviewShell({
  catalog,
  clubLane,
  programContext,
  preview,
}: Readonly<{
  catalog: PublicCatalogDto;
  clubLane?: Readonly<{ name: string; slug: string }> | null;
  programContext?: Readonly<{
    lane: Readonly<{ name: string; slug: string }>;
    parentClub: Readonly<{ name: string; slug: string }>;
  }> | null;
  preview: CmsRevisionPreviewDto;
}>) {
  const shell = previewShell(catalog, preview);
  const previewPalette = resolvePublicBrandPalette(shell.site.palette);
  const previewStyle = previewPalette
    ? ({
        "--cms-accent": previewPalette.accent,
        "--cms-background": previewPalette.background,
        "--cms-foreground": previewPalette.foreground,
        "--cms-secondary": previewPalette.secondary,
        "--background": previewPalette.background,
        "--cobalt": previewPalette.secondary,
        "--forest": previewPalette.accent,
        "--foreground": previewPalette.foreground,
        "--ink": previewPalette.foreground,
        "--paper": previewPalette.background,
      } as CSSProperties)
    : undefined;
  return (
    <div
      className={styles.publicPreviewShell}
      data-typography={shell.site.typography}
      style={previewStyle}
    >
      <aside className={styles.previewBanner} role="status">
        <div>
          <strong>Private preview · Revision {preview.revisionNumber}</strong>
          <p>
            This authenticated, no-store view uses the public Field Notes shell
            but is not published, shareable, indexed, or added to the sitemap.
          </p>
          <PreviewSeoSummary catalog={shell} preview={preview} />
        </div>
      </aside>
      <SiteHeader
        brandName={shell.site.brandName}
        logoAssetId={shell.site.logoAssetId}
        navigation={shell.navigation.header}
        prefetchInternalLinks={false}
        privateMedia
      />
      <div
        className="site-content"
        id="organizer-main"
        tabIndex={-1}
      >
        <PreviewEntityBody
          catalog={shell}
          clubLane={clubLane}
          programContext={programContext}
          preview={preview}
        />
      </div>
      <SiteFooter
        brandName={shell.site.brandName}
        legalFooter={shell.site.legalFooter}
        location={shell.site.locationLabel}
        mission={shell.site.footerMission}
        navigation={shell.navigation.footer}
        prefetchInternalLinks={false}
      />
    </div>
  );
}

async function PreviewEntityBody({
  catalog,
  clubLane,
  programContext,
  preview,
}: Readonly<{
  catalog: PublicCatalogDto;
  clubLane?: Readonly<{ name: string; slug: string }> | null;
  programContext?: Readonly<{
    lane: Readonly<{ name: string; slug: string }>;
    parentClub: Readonly<{ name: string; slug: string }>;
  }> | null;
  preview: CmsRevisionPreviewDto;
}>) {
  if (preview.entityType === "page") {
    const snapshot = preview.snapshot as CmsPageSnapshot;
    const page = buildPublicPagePreviewDto(snapshot);
    if (snapshot.slug === "home") {
      const events = await loadPreviewHomeEvents();
      return (
        <HomePageRenderer
          catalog={catalog}
          events={events}
          origin={null}
          page={page}
          previewMediaAssets={preview.mediaAssets}
          privatePreview
        />
      );
    }
    if (snapshot.slug === "events") {
      const context = await loadPreviewEventsContext();
      return (
        <EventsPageRenderer
          calendar={context.calendar}
          nowUtcMs={context.nowUtcMs}
          pageContent={page}
          siteOrigin={null}
          todayDate={context.todayDate}
        />
      );
    }
    if (snapshot.slug === "clubs") {
      const media = await loadPreviewClubDirectoryMedia(catalog);
      return (
        <ClubsRouteBody
          clubs={catalog.clubs}
          mediaById={new Map(
            media.map((asset) => [asset.assetId, asset]),
          )}
          page={page}
          previewCommunityLinks={catalog.communityLinks}
          previewMediaAssets={preview.mediaAssets}
          privatePreview
        />
      );
    }
    if (snapshot.slug === "get-involved") {
      return (
        <GetInvolvedRouteBody
          page={page}
          previewCommunityLinks={catalog.communityLinks}
          previewMediaAssets={preview.mediaAssets}
          privatePreview
        />
      );
    }
    if (snapshot.slug === "contact") {
      return (
        <ContactRouteBody
          page={page}
          previewCommunityLinks={catalog.communityLinks}
          previewMediaAssets={preview.mediaAssets}
          privatePreview
        />
      );
    }
    if (snapshot.slug === "host-an-event") {
      return (
        <HostAnEventRouteBody
          page={page}
          previewCommunityLinks={catalog.communityLinks}
          previewMediaAssets={preview.mediaAssets}
          privatePreview
        />
      );
    }
    return (
      <EditorialPage
        page={page}
        previewCommunityLinks={catalog.communityLinks}
        privatePreview
        previewMediaAssets={preview.mediaAssets}
        tone={editorialToneForSlug(snapshot.slug)}
      >
        {snapshot.slug === "community" &&
        !hasCommunityLinksBlock(page) ? (
          <CommunityDestinations links={catalog.communityLinks} />
        ) : null}
      </EditorialPage>
    );
  }
  if (preview.entityType === "club_public_profile") {
    const snapshot = preview.snapshot as CmsClubProfileSnapshot;
    const cover = snapshot.coverAssetId
      ? preview.mediaAssets.find(
          (asset) => asset.assetId === snapshot.coverAssetId,
        ) ?? null
      : null;
    const events = await loadPreviewClubEvents(preview.entityKey);
    return (
      <ClubDetailRenderer
        club={clubPreviewDto(
          snapshot,
          clubLane,
          preview.clubRelatedResources,
        )}
        coverMedia={cover}
        events={events}
      />
    );
  }
  if (preview.entityType === "program_public_profile") {
    const snapshot = preview.snapshot as CmsProgramProfileSnapshot;
    const cover = snapshot.coverAssetId
      ? preview.mediaAssets.find(
          (asset) => asset.assetId === snapshot.coverAssetId,
        ) ?? null
      : null;
    if (!programContext) {
      return (
        <PreviewNote
          deck="The canonical parent club or lane is unavailable."
          eyebrow="Program preview unavailable"
          paragraphs={[
            "No substitute scheduling or public relationship is being shown.",
          ]}
          title={snapshot.name}
        />
      );
    }
    return (
      <ProgramDetailRenderer
        coverMedia={cover}
        events={{
          kind: "available",
          past: emptyPreviewEventPage("past"),
          upcoming: emptyPreviewEventPage("upcoming"),
        }}
        program={programPreviewDto(
          snapshot,
          programContext,
          preview.clubRelatedResources,
        )}
      />
    );
  }
  if (preview.entityType === "community_link") {
    const communityPage = await loadPreviewCommunityPage();
    return (
      <EditorialPage
        page={
          communityPage ?? {
            metaDescription: null,
            openGraphAssetId: null,
            sections: Object.freeze([]),
            seoTitle: null,
            slug: "community",
            title: "Community",
          }
        }
        previewCommunityLinks={catalog.communityLinks}
        privatePreview
        tone="community"
      >
        {!communityPage || !hasCommunityLinksBlock(communityPage) ? (
          <CommunityDestinations
            heading="Confirmed community destinations"
            links={catalog.communityLinks}
          />
        ) : null}
      </EditorialPage>
    );
  }
  if (preview.entityType === "navigation") {
    return (
      <PreviewNote
        deck="The draft header and footer are rendered around this page."
        eyebrow="Navigation preview"
        paragraphs={[
          "Required public destinations remain protected.",
          "Optional Resources navigation appears only when its page is public.",
        ]}
        title="Header and footer navigation"
      />
    );
  }
  if (preview.entityType === "site_identity") {
    const snapshot = preview.snapshot as CmsSiteIdentitySnapshot;
    return (
      <PreviewNote
        deck={snapshot.tagline}
        eyebrow={snapshot.locationLabel}
        paragraphs={[snapshot.mission, snapshot.footerMission]}
        title={snapshot.brandName}
      />
    );
  }
  const snapshot = preview.snapshot as CmsLegalStatusSnapshot;
  return (
    <PreviewNote
      deck="This private view demonstrates the exact draft wording without confirming or publishing it."
      eyebrow="Private legal-status preview"
      paragraphs={[
        snapshot.legalName || "No legal name supplied.",
        snapshot.legalFormWording || "No legal form wording supplied.",
        snapshot.footerWording || "No legal footer wording supplied.",
      ]}
      title="Legal status"
    />
  );
}

async function loadPreviewClubDirectoryMedia(catalog: PublicCatalogDto) {
  const assetIds = catalog.clubs.flatMap((club) =>
    club.thumbnailAssetId ? [club.thumbnailAssetId] : [],
  );
  if (assetIds.length === 0) return Object.freeze([]);
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return Object.freeze([]);
    return resolveMediaAssetsForRendering(database, {
      organizationId: organization.id,
      publicationScope: "published",
      usages: catalog.clubs.flatMap((club) =>
        club.thumbnailAssetId
          ? [
              {
                assetId: club.thumbnailAssetId,
                entityKey: club.slug,
                entityType: "club_public_profile" as const,
                usageKind: "thumbnail",
              },
            ]
          : [],
      ),
    });
  } catch {
    return Object.freeze([]);
  }
}

function clubPreviewDto(
  snapshot: CmsClubProfileSnapshot,
  lane?: Readonly<{ name: string; slug: string }> | null,
  relatedResources: PublicClubDto["relatedResources"] = Object.freeze([]),
): PublicClubDto {
  return Object.freeze({
    archived: false,
    coverAssetId: snapshot.coverAssetId,
    description: snapshot.summary,
    featured: snapshot.featured,
    fullDescription: snapshot.description,
    imageAltText: snapshot.imageAltText,
    lane: Object.freeze({
      name: lane?.name ?? "Program",
      slug: lane?.slug ?? "think",
    }),
    metaDescription: snapshot.metaDescription,
    name: snapshot.name,
    openGraphAssetId: snapshot.openGraphAssetId,
    participantExpectations: snapshot.whatToExpect,
    preparationInformation: snapshot.preparation,
    programType: snapshot.programType,
    publicGroupUrl: snapshot.meetupGroupUrl,
    relatedResources,
    seoTitle: snapshot.seoTitle,
    slug: snapshot.slug,
    socialLinks: Object.freeze(
      snapshot.socialUrls.map((url) =>
        Object.freeze({
          label: new URL(url).hostname.replace(/^www\./u, ""),
          url,
        }),
      ),
    ),
    themeColor: snapshot.themeColor,
    thumbnailAssetId: snapshot.thumbnailAssetId,
    typicalFormat: snapshot.typicalFormat,
  });
}

async function loadPreviewHomeEvents() {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return Object.freeze([]);
    const nowUtcMs = readServerUtcMs();
    const page = await queryPublicEvents(database, {
      organizationId: organization.id,
      nowUtcMs,
      page: 1,
      pageSize: 6,
      todayDate: vancouverCalendarDate(nowUtcMs),
      view: "upcoming",
    });
    return page.events;
  } catch {
    return Object.freeze([]);
  }
}

async function loadPreviewEventsContext() {
  const nowUtcMs = readServerUtcMs();
  const todayDate = vancouverCalendarDate(nowUtcMs);
  const fallback = Object.freeze({
    calendar: emptyPublicMonthCalendar(undefined, todayDate),
    nowUtcMs,
    todayDate,
  });
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) return fallback;
    const calendar = await loadPublicMonthCalendar(database, {
      organizationId: organization.id,
      nowUtcMs,
      rawMonth: undefined,
      todayDate,
    });
    return Object.freeze({
      calendar,
      nowUtcMs,
      todayDate,
    });
  } catch {
    return fallback;
  }
}

function emptyPreviewEventPage(
  view: "past" | "upcoming",
): PublicEventPageDto {
  return Object.freeze({
    events: Object.freeze([]),
    hasMore: false,
    page: 1,
    pageSize: 12,
    totalCount: 0,
    view,
  });
}

async function loadPreviewClubEvents(clubId: string) {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await resolvePublicOrganization(database);
    if (!organization) {
      return Object.freeze({ kind: "unavailable" as const });
    }
    const club = await database
      .prepare(
        `SELECT slug
         FROM clubs
         WHERE id = ?
           AND organization_id = ?
           AND deleted_at IS NULL
         LIMIT 1`,
      )
      .bind(clubId, organization.id)
      .first<Record<string, unknown>>();
    const clubSlug =
      typeof club?.slug === "string" ? club.slug.trim() : "";
    if (!clubSlug) {
      return Object.freeze({ kind: "unavailable" as const });
    }
    const nowUtcMs = readServerUtcMs();
    const todayDate = vancouverCalendarDate(nowUtcMs);
    const [past, upcoming] = await Promise.all([
      queryPublicEvents(database, {
        clubSlug,
        nowUtcMs,
        organizationId: organization.id,
        page: 1,
        pageSize: 6,
        todayDate,
        view: "past",
      }),
      queryPublicEvents(database, {
        clubSlug,
        nowUtcMs,
        organizationId: organization.id,
        page: 1,
        pageSize: 6,
        todayDate,
        view: "upcoming",
      }),
    ]);
    return Object.freeze({
      kind: "available" as const,
      past,
      upcoming,
    });
  } catch {
    return Object.freeze({ kind: "unavailable" as const });
  }
}

async function loadPreviewCommunityPage() {
  try {
    const { database } = getRuntimeAuthConfiguration();
    return await getPublicPageContent(database, "community");
  } catch {
    return null;
  }
}

function previewCommunityLinks(
  published: PublicCatalogDto["communityLinks"],
  privateOrder: CmsRevisionPreviewDto["communityLinkOrder"],
  entityKey: string,
  snapshot: CmsCommunityLinkSnapshot,
) {
  const publicByUrl = new Map(published.map((link) => [link.url, link]));
  const contextualUrls = new Set(privateOrder.map((item) => item.url));
  const ordered = privateOrder.flatMap((item) => {
    if (item.entityKey === entityKey) return [];
    const link = publicByUrl.get(item.url);
    return link
      ? [Object.freeze({ entityKey: item.entityKey, link, sortOrder: item.sortOrder })]
      : [];
  });
  for (const [index, link] of published.entries()) {
    if (contextualUrls.has(link.url)) continue;
    ordered.push(
      Object.freeze({
        entityKey: `unmapped-${index}`,
        link,
        sortOrder: Number.MAX_SAFE_INTEGER,
      }),
    );
  }
  if (snapshot.confirmed) {
    ordered.push(
      Object.freeze({
        entityKey,
        link: Object.freeze({
          description: snapshot.description,
          label: snapshot.label,
          linkType: snapshot.destinationType,
          url: snapshot.url,
        }),
        sortOrder: snapshot.sortOrder,
      }),
    );
  }
  ordered.sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.link.label.localeCompare(right.link.label) ||
      left.entityKey.localeCompare(right.entityKey),
  );
  return Object.freeze(ordered.map((item) => item.link));
}

function PreviewSeoSummary({
  catalog,
  preview,
}: Readonly<{
  catalog: PublicCatalogDto;
  preview: CmsRevisionPreviewDto;
}>) {
  const summary = previewSeoSummary(catalog, preview);
  return (
    <section
      aria-labelledby="private-preview-seo-heading"
      className={styles.previewSeoSummary}
    >
      <h2 id="private-preview-seo-heading">Private search and sharing summary</h2>
      <dl>
        <div>
          <dt>Search title</dt>
          <dd>{summary.title}</dd>
        </div>
        <div>
          <dt>Search description</dt>
          <dd>{summary.description}</dd>
        </div>
        <div>
          <dt>Social card</dt>
          <dd>{summary.socialCard}</dd>
        </div>
      </dl>
    </section>
  );
}

function previewSeoSummary(
  catalog: PublicCatalogDto,
  preview: CmsRevisionPreviewDto,
): Readonly<{
  description: string;
  socialCard: string;
  title: string;
}> {
  let description =
    catalog.site.metaDescription ?? catalog.site.mission;
  let selectedAsset = false;
  let title = catalog.site.seoTitle ?? catalog.site.brandName;
  if (preview.entityType === "page") {
    const snapshot = preview.snapshot as CmsPageSnapshot;
    title = snapshot.seoTitle ?? snapshot.title;
    description =
      snapshot.metaDescription ??
      `No dedicated search description is set for ${snapshot.title}.`;
    selectedAsset = snapshot.openGraphAssetId !== null;
  } else if (preview.entityType === "club_public_profile") {
    const snapshot = preview.snapshot as CmsClubProfileSnapshot;
    title = snapshot.seoTitle ?? snapshot.name;
    description = snapshot.metaDescription ?? snapshot.summary;
    selectedAsset = snapshot.openGraphAssetId !== null;
  } else if (preview.entityType === "program_public_profile") {
    const snapshot = preview.snapshot as CmsProgramProfileSnapshot;
    title = snapshot.seoTitle || snapshot.name;
    description = snapshot.metaDescription || snapshot.summary;
    selectedAsset = snapshot.openGraphAssetId !== null;
  } else if (preview.entityType === "site_identity") {
    const snapshot = preview.snapshot as CmsSiteIdentitySnapshot;
    title = snapshot.seoTitle ?? snapshot.brandName;
    description = snapshot.metaDescription ?? snapshot.mission;
    selectedAsset = snapshot.openGraphAssetId !== null;
  } else if (preview.entityType === "community_link") {
    title = `Community · ${catalog.site.brandName}`;
    description =
      "This link uses the currently published Community page search metadata.";
  } else {
    title = "Private workflow preview";
    description =
      "This workflow record is not a standalone indexable public page.";
  }
  return Object.freeze({
    description,
    socialCard: selectedAsset
      ? "Selected approved revision artwork"
      : catalog.site.openGraphAssetId
        ? "Published site social artwork fallback"
        : "Bespoke Field Notes social card fallback",
    title,
  });
}

function programPreviewDto(
  snapshot: CmsProgramProfileSnapshot,
  context: Readonly<{
    lane: Readonly<{ name: string; slug: string }>;
    parentClub: Readonly<{ name: string; slug: string }>;
  }>,
  relatedResources: PublicProgramDto["relatedResources"],
): PublicProgramDto {
  return Object.freeze({
    archived: false,
    coverAssetId: snapshot.coverAssetId,
    description: snapshot.summary || null,
    featured: snapshot.featured,
    fullDescription: snapshot.description || null,
    lane: context.lane,
    metaDescription: snapshot.metaDescription || null,
    name: snapshot.name,
    openGraphAssetId: snapshot.openGraphAssetId,
    parentClub: context.parentClub,
    participantExpectations: snapshot.whatToExpect,
    preparationInformation: snapshot.preparation,
    programType:
      snapshot.programType === "circle" ||
      snapshot.programType === "series" ||
      snapshot.programType === "other"
        ? snapshot.programType
        : "program",
    publicGroupUrl: snapshot.meetupGroupUrl,
    relatedResources,
    seoTitle: snapshot.seoTitle || null,
    slug: snapshot.slug,
    socialLinks: Object.freeze(
      snapshot.socialUrls.map((url) =>
        Object.freeze({ label: new URL(url).hostname, url }),
      ),
    ),
    themeColor: snapshot.themeColor,
    thumbnailAssetId: snapshot.thumbnailAssetId,
    typicalFormat: snapshot.typicalFormat,
  });
}

function PreviewNote({
  deck,
  eyebrow,
  paragraphs,
  title,
}: Readonly<{
  deck: string;
  eyebrow: string;
  paragraphs: readonly string[];
  title: string;
}>) {
  return (
    <main className="editorial-page">
      <PageMasthead
        deck={deck}
        eyebrow={eyebrow}
        title={title}
        tone="community"
      />
      <section className="editorial-section editorial-section--prose">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
    </main>
  );
}

function previewShell(
  catalog: PublicCatalogDto,
  preview: CmsRevisionPreviewDto,
): PublicCatalogDto {
  let site = catalog.site;
  let navigation = catalog.navigation;
  let communityLinks = catalog.communityLinks;
  if (preview.entityType === "site_identity") {
    const snapshot = preview.snapshot as CmsSiteIdentitySnapshot;
    site = Object.freeze({
      ...site,
      brandName: snapshot.brandName,
      footerMission: snapshot.footerMission,
      locationLabel: snapshot.locationLabel,
      logoAssetId: snapshot.logoAssetId,
      metaDescription: snapshot.metaDescription,
      mission: snapshot.mission,
      openGraphAssetId: snapshot.openGraphAssetId,
      palette: snapshot.palette,
      seoTitle: snapshot.seoTitle,
      tagline: snapshot.tagline,
      typography: snapshot.typography,
    });
  } else if (preview.entityType === "legal_status") {
    const snapshot = preview.snapshot as CmsLegalStatusSnapshot;
    site = Object.freeze({
      ...site,
      legalFooter: snapshot.footerWording,
      legalName: snapshot.legalName,
    });
  } else if (preview.entityType === "navigation") {
    const snapshot = preview.snapshot as CmsNavigationSnapshot;
    const items = [...snapshot.items].sort(
      (left, right) => left.sortOrder - right.sortOrder,
    );
    navigation = Object.freeze({
      footer: navigationItems(items, "footer"),
      header: navigationItems(items, "header"),
    });
  } else if (preview.entityType === "community_link") {
    communityLinks = previewCommunityLinks(
      catalog.communityLinks,
      preview.communityLinkOrder,
      preview.entityKey,
      preview.snapshot as CmsCommunityLinkSnapshot,
    );
  }
  return Object.freeze({ ...catalog, communityLinks, navigation, site });
}

function navigationItems(
  items: CmsNavigationSnapshot["items"],
  placement: "footer" | "header",
): readonly PublicNavigationItemDto[] {
  return Object.freeze(
    items
      .filter((item) => item.placement === placement)
      .map((item) => Object.freeze({ href: item.target, label: item.label })),
  );
}
