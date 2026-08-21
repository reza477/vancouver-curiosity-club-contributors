import {
  assertOnlyKeys,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import { parseCalendarDate } from "../../time";
import {
  assertNoProtectedLegalClaim,
  containsProtectedLegalClaim,
  containsNegativeCharityStatusClaim,
  containsNegativeCharityBenefitClaim,
  containsPositiveCharityStatusClaim,
  containsPositiveCharityBenefitClaim,
  containsProvincialStatusClaim,
} from "../../validation/protected-legal-claims";

export const CMS_ENTITY_TYPES = [
  "page",
  "club_public_profile",
  "program_public_profile",
  "community_link",
  "navigation",
  "site_identity",
  "legal_status",
] as const;

export type CmsEntityType = (typeof CMS_ENTITY_TYPES)[number];

export const CMS_WORKFLOW_STATES = [
  "draft",
  "published",
  "unpublished",
  "archived",
] as const;

export type CmsWorkflowState = (typeof CMS_WORKFLOW_STATES)[number];

export const PAGE_BLOCK_TYPES = [
  "hero",
  "intro",
  "prose",
  "callout",
  "ordered_link_list",
  "media",
  "featured_events",
  "featured_clubs",
  "community_links",
  "resource_list",
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];

export type CmsPageBlock = Readonly<{
  config: Readonly<Record<string, unknown>>;
  id: string;
  type: PageBlockType;
}>;

export type CmsPageSnapshot = Readonly<{
  blocks: readonly CmsPageBlock[];
  metaDescription: string;
  openGraphAssetId: string | null;
  seoTitle: string;
  slug: string;
  title: string;
}>;

export type CmsCommunityLinkSnapshot = Readonly<{
  confirmed: boolean;
  description: string;
  destinationType:
    | "community_platform"
    | "meetup_discussion"
    | "meetup_group"
    | "other"
    | "resource"
    | "social_profile";
  label: string;
  sortOrder: number;
  url: string;
}>;

export type CmsNavigationItem = Readonly<{
  id: string;
  label: string;
  placement: "footer" | "header";
  sortOrder: number;
  target: string;
}>;

export type CmsNavigationSnapshot = Readonly<{
  items: readonly CmsNavigationItem[];
}>;

export type CmsInstitutionalFactsSnapshot = Readonly<{
  attendanceTotal: number | null;
  attendanceTotalAsOf: string | null;
  attendanceTotalConfirmed: boolean;
  foundedYear: number | null;
  foundedYearConfirmed: boolean;
  memberTotal: number | null;
  memberTotalAsOf: string | null;
  memberTotalConfirmed: boolean;
}>;

export type CmsSiteIdentitySnapshot = Readonly<{
  brandName: string;
  footerMission: string;
  institutionalFacts: CmsInstitutionalFactsSnapshot;
  locationLabel: string;
  logoAssetId: string | null;
  metaDescription: string;
  mission: string;
  openGraphAssetId: string | null;
  palette: Readonly<{
    accent: string;
    background: string;
    foreground: string;
    secondary: string;
  }>;
  seoTitle: string;
  tagline: string;
  typography: "editorial" | "humanist" | "system";
}>;

export type CmsLegalStatusSnapshot = Readonly<{
  charityNumber: string | null;
  charityStatus: "confirmed_not_registered" | "registered" | "unconfirmed";
  effectiveDate: string | null;
  footerWording: string | null;
  jurisdiction: string | null;
  legalFormWording: string | null;
  legalName: string | null;
  registrationNumber: string | null;
}>;

export type CmsClubProfileSnapshot = Readonly<{
  contentConfirmed: boolean;
  coverAssetId: string | null;
  description: string;
  displayOrder: number;
  featured: boolean;
  imageAltText: string | null;
  laneId: string;
  meetupGroupUrl: string | null;
  metaDescription: string;
  name: string;
  openGraphAssetId: string | null;
  preparation: string | null;
  programType: string;
  relatedResourceIds: readonly string[];
  seoTitle: string;
  slug: string;
  socialUrls: readonly string[];
  summary: string;
  themeColor: string;
  thumbnailAssetId: string | null;
  typicalFormat: string | null;
  whatToExpect: string | null;
}>;

export type CmsProgramProfileSnapshot = Readonly<{
  clubId: string;
  contentConfirmed: boolean;
  coverAssetId: string | null;
  description: string;
  displayOrder: number;
  featured: boolean;
  laneId: string;
  meetupGroupUrl: string | null;
  metaDescription: string;
  name: string;
  openGraphAssetId: string | null;
  preparation: string | null;
  programType: string;
  relatedResourceIds: readonly string[];
  seoTitle: string;
  slug: string;
  socialUrls: readonly string[];
  summary: string;
  themeColor: string;
  thumbnailAssetId: string | null;
  typicalFormat: string | null;
  whatToExpect: string | null;
}>;

const MAX_PAGE_BLOCKS = 24;
const MAX_REVISION_BYTES = 128 * 1024;
export const CMS_HEADER_NAVIGATION_MAX = 5;
export const CMS_FOOTER_NAVIGATION_MAX = 24;
export const CMS_NAVIGATION_MAX =
  CMS_HEADER_NAVIGATION_MAX + CMS_FOOTER_NAVIGATION_MAX;
const SAFE_INTERNAL_ROUTES = new Set([
  "/",
  "/about",
  "/accessibility",
  "/clubs",
  "/community",
  "/conduct",
  "/contact",
  "/events",
  "/for-organizations",
  "/get-involved",
  "/host-an-event",
  "/privacy",
  "/resources",
]);
const RESERVED_SLUGS = new Set([
  "accept-invitation",
  "api",
  "callback",
  "for-organizations",
  "organizer",
  "preview",
  "signin-with-chatgpt",
  "signout-with-chatgpt",
]);
const REQUIRED_HEADER_ITEMS = new Map([
  ["/events", "Events"],
  ["/clubs", "Clubs"],
  ["/about", "About"],
  ["/for-organizations", "For Organizations"],
  ["/contact", "Contact"],
]);
const REQUIRED_HEADER_TARGETS = new Set(REQUIRED_HEADER_ITEMS.keys());
const REQUIRED_FOOTER_ITEMS = new Map([
  ["/events", "Events"],
  ["/clubs", "Clubs"],
  ["/about", "About"],
  ["/for-organizations", "For Organizations"],
  ["/get-involved", "Get Involved"],
  ["/host-an-event", "Host an Event"],
  ["/contact", "Contact"],
  ["/conduct", "Code of Conduct"],
  ["/accessibility", "Accessibility"],
  ["/privacy", "Privacy"],
]);
const LEGACY_HEADER_TARGETS = new Set([
  "/events",
  "/clubs",
  "/community",
  "/about",
  "/get-involved",
  "/organizer",
]);
const LEGACY_FOOTER_TARGETS = new Set([
  "/events",
  "/clubs",
  "/community",
  "/about",
  "/get-involved",
  "/contact",
  "/accessibility",
  "/conduct",
  "/privacy",
]);
const LEGACY_HEADER_NAVIGATION_MAX = 12;
const REQUIRED_PAGE_INTRO_TYPES = new Map<string, PageBlockType>([
  ["home", "hero"],
  ["events", "intro"],
  ["clubs", "intro"],
  ["community", "intro"],
  ["about", "intro"],
  ["get-involved", "intro"],
  ["host-an-event", "intro"],
  ["contact", "intro"],
  ["conduct", "intro"],
  ["accessibility", "intro"],
  ["privacy", "intro"],
]);
const UNSAFE_TEXT_MARKUP =
  /(?:<[^>]*>|```|\[[^\]\r\n]{0,256}\]\([^)\r\n]{1,2048}\)|\b(?:javascript|vbscript|data)\s*:)/iu;

export function parseCmsEntityType(value: unknown): CmsEntityType {
  return parseEnum(value, CMS_ENTITY_TYPES, "entityType");
}

export function parseExpectedContentVersion(value: unknown): number {
  return parseFiniteInteger(value, {
    path: "expectedContentVersion",
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  });
}

export function parsePageSnapshot(value: unknown): CmsPageSnapshot {
  const input = parseObject(value, "snapshot");
  assertOnlyKeys(
    input,
    [
      "blocks",
      "metaDescription",
      "openGraphAssetId",
      "seoTitle",
      "slug",
      "title",
    ],
    "snapshot",
  );
  const title = plainText(input.title, "snapshot.title", 120);
  const slug = publicSlug(input.slug, "snapshot.slug");
  const seoTitle = plainText(input.seoTitle, "snapshot.seoTitle", 60);
  const metaDescription = plainText(
    input.metaDescription,
    "snapshot.metaDescription",
    160,
  );
  if (!Array.isArray(input.blocks) || input.blocks.length > MAX_PAGE_BLOCKS) {
    throw validationIssue(
      "snapshot.blocks",
      "invalid_length",
      `A page may contain at most ${MAX_PAGE_BLOCKS} blocks.`,
    );
  }
  const seenIds = new Set<string>();
  const blocks = input.blocks.map((block, index) => {
    const parsed = parsePageBlock(block, index);
    if (seenIds.has(parsed.id)) {
      throw validationIssue(
        `snapshot.blocks.${index}.id`,
        "duplicate_identifier",
        "Every page block must have a unique identifier.",
      );
    }
    seenIds.add(parsed.id);
    return parsed;
  });
  return enforceRevisionSize(
    Object.freeze({
      blocks: Object.freeze(blocks),
      metaDescription,
      openGraphAssetId: optionalIdentifier(
        input.openGraphAssetId,
        "snapshot.openGraphAssetId",
      ),
      seoTitle,
      slug,
      title,
    }),
  );
}

export function assertPagePublicationStructure(
  snapshot: CmsPageSnapshot,
): void {
  const requiredType = REQUIRED_PAGE_INTRO_TYPES.get(snapshot.slug);
  if (!requiredType) return;
  const requiredBlocks = snapshot.blocks.filter(
    (block) => block.type === requiredType,
  );
  const substantiveBlock = requiredBlocks.find((block) => {
    const heading =
      typeof block.config.heading === "string"
        ? block.config.heading.trim()
        : "";
    const text =
      typeof block.config.text === "string"
        ? block.config.text.trim()
        : "";
    const paragraphs = Array.isArray(block.config.paragraphs)
      ? block.config.paragraphs.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [];
    const body = [text, ...paragraphs].join(" ").trim();
    return heading.length >= 3 && body.length >= 20;
  });
  if (
    snapshot.title.trim().length < 3 ||
    snapshot.seoTitle.trim().length < 3 ||
    snapshot.metaDescription.trim().length < 20 ||
    !substantiveBlock
  ) {
    throw validationIssue(
      "snapshot.blocks",
      "required_page_structure",
      `${
        snapshot.slug === "home" ? "Home" : snapshot.title
      } requires a substantive ${requiredType} heading and body plus complete public metadata before publication.`,
    );
  }
}

export function parseCommunityLinkSnapshot(
  value: unknown,
): CmsCommunityLinkSnapshot {
  const input = parseObject(value, "snapshot");
  assertOnlyKeys(
    input,
    [
      "confirmed",
      "description",
      "destinationType",
      "label",
      "sortOrder",
      "url",
    ],
    "snapshot",
  );
  if (typeof input.confirmed !== "boolean") {
    throw validationIssue(
      "snapshot.confirmed",
      "invalid_type",
      "Expected a confirmation choice.",
    );
  }
  const destinationType = parseEnum(
    input.destinationType,
    [
      "meetup_group",
      "meetup_discussion",
      "social_profile",
      "community_platform",
      "resource",
      "other",
    ] as const,
    "snapshot.destinationType",
  );
  const url =
    destinationType === "meetup_group"
      ? canonicalMeetupGroupUrl(input.url, "snapshot.url")
      : destinationType === "meetup_discussion"
        ? canonicalMeetupDiscussionUrl(input.url, "snapshot.url")
        : canonicalHttpsUrl(input.url, "snapshot.url");
  return enforceRevisionSize(
    Object.freeze({
      confirmed: input.confirmed,
      description: plainText(
        input.description,
        "snapshot.description",
        240,
      ),
      destinationType,
      label: plainText(input.label, "snapshot.label", 80),
      sortOrder: parseFiniteInteger(input.sortOrder, {
        path: "snapshot.sortOrder",
        minimum: 0,
        maximum: 10_000,
      }),
      url,
    }),
  );
}

export function parseNavigationSnapshot(
  value: unknown,
): CmsNavigationSnapshot {
  return parseNavigationSnapshotForStorage(value, false);
}

export function parsePersistedNavigationSnapshot(
  value: unknown,
): CmsNavigationSnapshot {
  return parseNavigationSnapshotForStorage(value, true);
}

function parseNavigationSnapshotForStorage(
  value: unknown,
  permitLegacy: boolean,
): CmsNavigationSnapshot {
  const input = parseObject(value, "snapshot");
  assertOnlyKeys(input, ["items"], "snapshot");
  const maximumItems = permitLegacy
    ? LEGACY_HEADER_NAVIGATION_MAX + CMS_FOOTER_NAVIGATION_MAX
    : CMS_NAVIGATION_MAX;
  if (
    !Array.isArray(input.items) ||
    input.items.length > maximumItems
  ) {
    throw validationIssue(
      "snapshot.items",
      "invalid_length",
      `Navigation may contain at most ${maximumItems} items.`,
    );
  }
  const ids = new Set<string>();
  const placementTargets = new Set<string>();
  const items = input.items.map((value, index) => {
    const item = parseObject(value, `snapshot.items.${index}`);
    assertOnlyKeys(
      item,
      ["id", "label", "placement", "sortOrder", "target"],
      `snapshot.items.${index}`,
    );
    const id = parseIdentifier(item.id, `snapshot.items.${index}.id`);
    if (ids.has(id)) {
      throw validationIssue(
        `snapshot.items.${index}.id`,
        "duplicate_identifier",
        "Navigation item identifiers must be unique.",
      );
    }
    ids.add(id);
    const target = safeNavigationTarget(
      item.target,
      `snapshot.items.${index}.target`,
    );
    const label = plainText(
      item.label,
      `snapshot.items.${index}.label`,
      80,
    );
    if (target === "/organizer" && !permitLegacy) {
      throw validationIssue(
        `snapshot.items.${index}.target`,
        "protected_navigation",
        "Organizer Login is a fixed footer-only system link.",
      );
    }
    const placement = parseEnum(
      item.placement,
      ["header", "footer"] as const,
      `snapshot.items.${index}.placement`,
    );
    const placementTarget = `${placement}:${target}`;
    if (placementTargets.has(placementTarget)) {
      throw validationIssue(
        `snapshot.items.${index}.target`,
        "duplicate_navigation_target",
        "A navigation destination may appear only once in each placement.",
      );
    }
    placementTargets.add(placementTarget);
    return Object.freeze({
      id,
      label,
      placement,
      sortOrder: parseFiniteInteger(item.sortOrder, {
        path: `snapshot.items.${index}.sortOrder`,
        minimum: 0,
        maximum: 10_000,
      }),
      target,
    });
  });
  const headerCount = items.filter(
    (item) => item.placement === "header",
  ).length;
  const footerCount = items.length - headerCount;
  if (
    headerCount >
      (permitLegacy
        ? LEGACY_HEADER_NAVIGATION_MAX
        : CMS_HEADER_NAVIGATION_MAX) ||
    footerCount > CMS_FOOTER_NAVIGATION_MAX
  ) {
    throw validationIssue(
      "snapshot.items",
      "invalid_length",
      `Navigation may contain at most ${permitLegacy ? LEGACY_HEADER_NAVIGATION_MAX : CMS_HEADER_NAVIGATION_MAX} header items and ${CMS_FOOTER_NAVIGATION_MAX} footer items.`,
    );
  }
  if (permitLegacy && isLegacyNavigationSnapshot(items)) {
    return enforceRevisionSize(Object.freeze({ items: Object.freeze(items) }));
  }
  requireNavigationItems(items);
  return enforceRevisionSize(Object.freeze({ items: Object.freeze(items) }));
}

export function parseSiteIdentitySnapshot(
  value: unknown,
): CmsSiteIdentitySnapshot {
  const input = parseObject(value, "snapshot");
  assertOnlyKeys(
    input,
    [
      "brandName",
      "footerMission",
      "institutionalFacts",
      "locationLabel",
      "logoAssetId",
      "metaDescription",
      "mission",
      "openGraphAssetId",
      "palette",
      "seoTitle",
      "tagline",
      "typography",
    ],
    "snapshot",
  );
  return enforceRevisionSize(
    Object.freeze({
      brandName: plainText(input.brandName, "snapshot.brandName", 120),
      footerMission: plainText(
        input.footerMission,
        "snapshot.footerMission",
        300,
      ),
      institutionalFacts: parseInstitutionalFacts(
        input.institutionalFacts,
      ),
      locationLabel: plainText(
        input.locationLabel,
        "snapshot.locationLabel",
        120,
      ),
      logoAssetId: optionalIdentifier(
        input.logoAssetId,
        "snapshot.logoAssetId",
      ),
      metaDescription: plainText(
        input.metaDescription,
        "snapshot.metaDescription",
        160,
      ),
      mission: plainText(input.mission, "snapshot.mission", 500),
      openGraphAssetId: optionalIdentifier(
        input.openGraphAssetId,
        "snapshot.openGraphAssetId",
      ),
      palette: parsePalette(input.palette),
      seoTitle: plainText(input.seoTitle, "snapshot.seoTitle", 60),
      tagline: plainText(input.tagline, "snapshot.tagline", 160),
      typography: parseEnum(
        input.typography,
        ["editorial", "humanist", "system"] as const,
        "snapshot.typography",
      ),
    }),
  );
}

function parseInstitutionalFacts(
  value: unknown,
): CmsInstitutionalFactsSnapshot {
  if (value === undefined) {
    return Object.freeze({
      attendanceTotal: null,
      attendanceTotalAsOf: null,
      attendanceTotalConfirmed: false,
      foundedYear: null,
      foundedYearConfirmed: false,
      memberTotal: null,
      memberTotalAsOf: null,
      memberTotalConfirmed: false,
    });
  }
  const input = parseObject(value, "snapshot.institutionalFacts");
  assertOnlyKeys(
    input,
    [
      "attendanceTotal",
      "attendanceTotalAsOf",
      "attendanceTotalConfirmed",
      "foundedYear",
      "foundedYearConfirmed",
      "memberTotal",
      "memberTotalAsOf",
      "memberTotalConfirmed",
    ],
    "snapshot.institutionalFacts",
  );
  const attendanceTotal = optionalWholeNumber(
    input.attendanceTotal,
    "snapshot.institutionalFacts.attendanceTotal",
    100_000_000,
  );
  const attendanceTotalAsOf = optionalInstitutionalDate(
    input.attendanceTotalAsOf,
    "snapshot.institutionalFacts.attendanceTotalAsOf",
  );
  const attendanceTotalConfirmed = optionalBoolean(
    input.attendanceTotalConfirmed,
    "snapshot.institutionalFacts.attendanceTotalConfirmed",
  );
  const foundedYear = optionalWholeNumber(
    input.foundedYear,
    "snapshot.institutionalFacts.foundedYear",
    9_999,
    1_800,
  );
  const foundedYearConfirmed = optionalBoolean(
    input.foundedYearConfirmed,
    "snapshot.institutionalFacts.foundedYearConfirmed",
  );
  const memberTotal = optionalWholeNumber(
    input.memberTotal,
    "snapshot.institutionalFacts.memberTotal",
    100_000_000,
  );
  const memberTotalAsOf = optionalInstitutionalDate(
    input.memberTotalAsOf,
    "snapshot.institutionalFacts.memberTotalAsOf",
  );
  const memberTotalConfirmed = optionalBoolean(
    input.memberTotalConfirmed,
    "snapshot.institutionalFacts.memberTotalConfirmed",
  );
  if (foundedYearConfirmed && foundedYear === null) {
    throw validationIssue(
      "snapshot.institutionalFacts.foundedYearConfirmed",
      "missing_verified_value",
      "A founding year is required before it can be confirmed for public display.",
    );
  }
  if (
    attendanceTotalConfirmed &&
    (attendanceTotal === null || attendanceTotalAsOf === null)
  ) {
    throw validationIssue(
      "snapshot.institutionalFacts.attendanceTotalConfirmed",
      "missing_verified_value",
      "An attendance total and as-of date are required before public display.",
    );
  }
  if (
    memberTotalConfirmed &&
    (memberTotal === null || memberTotalAsOf === null)
  ) {
    throw validationIssue(
      "snapshot.institutionalFacts.memberTotalConfirmed",
      "missing_verified_value",
      "A member total and as-of date are required before public display.",
    );
  }
  return Object.freeze({
    attendanceTotal,
    attendanceTotalAsOf,
    attendanceTotalConfirmed,
    foundedYear,
    foundedYearConfirmed,
    memberTotal,
    memberTotalAsOf,
    memberTotalConfirmed,
  });
}

function optionalWholeNumber(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw validationIssue(
      path,
      "invalid_number",
      `Expected a whole number from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw validationIssue(path, "invalid_boolean", "Expected true or false.");
  }
  return value;
}

function optionalInstitutionalDate(
  value: unknown,
  path: string,
): string | null {
  const parsed = optionalPlainText(value, path, 10);
  return parsed ? parseCalendarDate(parsed, path) : null;
}

export function parseLegalStatusSnapshot(
  value: unknown,
): CmsLegalStatusSnapshot {
  const input = parseObject(value, "snapshot");
  assertOnlyKeys(
    input,
    [
      "charityNumber",
      "charityStatus",
      "effectiveDate",
      "footerWording",
      "jurisdiction",
      "legalFormWording",
      "legalName",
      "registrationNumber",
    ],
    "snapshot",
  );
  const charityStatus = parseEnum(
    input.charityStatus,
    ["unconfirmed", "registered", "confirmed_not_registered"] as const,
    "snapshot.charityStatus",
  );
  const charityNumber = optionalPlainText(
    input.charityNumber,
    "snapshot.charityNumber",
    120,
    { permitProtectedLegalClaims: true },
  );
  if (
    (charityStatus === "registered" && !charityNumber) ||
    (charityStatus !== "registered" && charityNumber)
  ) {
    throw validationIssue(
      "snapshot.charityNumber",
      "charity_status_mismatch",
      "A charity number is allowed only with confirmed registered-charity status.",
    );
  }
  const effectiveDateInput = optionalPlainText(
    input.effectiveDate,
    "snapshot.effectiveDate",
    10,
  );
  const effectiveDate = effectiveDateInput
    ? parseCalendarDate(effectiveDateInput, "snapshot.effectiveDate")
    : null;
  return enforceRevisionSize(
    Object.freeze({
      charityNumber,
      charityStatus,
      effectiveDate,
      footerWording: optionalPlainText(
        input.footerWording,
        "snapshot.footerWording",
        500,
        { permitProtectedLegalClaims: true },
      ),
      jurisdiction: optionalPlainText(
        input.jurisdiction,
        "snapshot.jurisdiction",
        120,
        { permitProtectedLegalClaims: true },
      ),
      legalFormWording: optionalPlainText(
        input.legalFormWording,
        "snapshot.legalFormWording",
        240,
        { permitProtectedLegalClaims: true },
      ),
      legalName: optionalPlainText(
        input.legalName,
        "snapshot.legalName",
        240,
        { permitProtectedLegalClaims: true },
      ),
      registrationNumber: optionalPlainText(
        input.registrationNumber,
        "snapshot.registrationNumber",
        120,
        { permitProtectedLegalClaims: true },
      ),
    }),
  );
}

export function assertLegalStatusSnapshotCoherent(
  snapshot: CmsLegalStatusSnapshot,
): CmsLegalStatusSnapshot {
  const publicWording = [
    snapshot.footerWording,
    snapshot.jurisdiction,
    snapshot.legalFormWording,
    snapshot.legalName,
    snapshot.registrationNumber,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");
  const hasPositiveCharityStatus =
    containsPositiveCharityStatusClaim(publicWording);
  const hasNegativeCharityStatus =
    containsNegativeCharityStatusClaim(publicWording);
  const hasPositiveCharityBenefit =
    containsPositiveCharityBenefitClaim(publicWording);
  const hasNegativeCharityBenefit =
    containsNegativeCharityBenefitClaim(publicWording);
  const hasProvincialStatus =
    containsProvincialStatusClaim(publicWording);
  if (
    containsProtectedLegalClaim(publicWording) &&
    !hasPositiveCharityStatus &&
    !hasNegativeCharityStatus &&
    !hasPositiveCharityBenefit &&
    !hasNegativeCharityBenefit &&
    !hasProvincialStatus
  ) {
    throw validationIssue(
      "snapshot.footerWording",
      "ambiguous_legal_claim",
      "Protected legal wording must map to the exact confirmed provincial or charity-status facts.",
    );
  }
  if (
    (hasPositiveCharityStatus || hasPositiveCharityBenefit) &&
    (snapshot.charityStatus !== "registered" ||
      !snapshot.charityNumber)
  ) {
    throw validationIssue(
      "snapshot.charityStatus",
      "charity_claim_requires_registration",
      "Charity, CRA, tax-receipt, tax-deductibility, and tax-exemption wording requires confirmed registered-charity status and the exact charity number.",
    );
  }
  if (
    hasNegativeCharityStatus &&
    snapshot.charityStatus !== "confirmed_not_registered"
  ) {
    throw validationIssue(
      "snapshot.charityStatus",
      "negative_charity_claim_requires_confirmation",
      "Wording that says the organization is not a registered charity requires the explicit confirmed-not-registered status.",
    );
  }
  if (
    hasNegativeCharityBenefit &&
    snapshot.charityStatus === "unconfirmed"
  ) {
    throw validationIssue(
      "snapshot.charityStatus",
      "negative_tax_claim_requires_confirmed_status",
      "Negative tax-deductibility or receipt wording requires an explicitly confirmed charity status; it is not inferred from that status.",
    );
  }
  const makesProvincialClaim =
    hasProvincialStatus ||
    snapshot.registrationNumber !== null;
  if (
    makesProvincialClaim &&
    (!snapshot.legalName ||
      !snapshot.jurisdiction ||
      !snapshot.legalFormWording ||
      !snapshot.registrationNumber ||
      !snapshot.effectiveDate)
  ) {
    throw validationIssue(
      "snapshot.legalFormWording",
      "provincial_claim_requires_complete_facts",
      "Provincial registration or incorporation wording requires the exact legal name, jurisdiction, legal form, registration number, and effective date.",
    );
  }
  return snapshot;
}

export function parseClubProfileSnapshot(
  value: unknown,
): CmsClubProfileSnapshot {
  const input = parseObject(value, "snapshot");
  assertOnlyKeys(
    input,
    [
      "contentConfirmed",
      "coverAssetId",
      "description",
      "displayOrder",
      "featured",
      "imageAltText",
      "laneId",
      "meetupGroupUrl",
      "metaDescription",
      "name",
      "openGraphAssetId",
      "preparation",
      "programType",
      "relatedResourceIds",
      "seoTitle",
      "slug",
      "socialUrls",
      "summary",
      "themeColor",
      "thumbnailAssetId",
      "typicalFormat",
      "whatToExpect",
    ],
    "snapshot",
  );
  if (typeof input.featured !== "boolean") {
    throw validationIssue(
      "snapshot.featured",
      "invalid_type",
      "Expected a featured choice.",
    );
  }
  if (
    input.contentConfirmed !== undefined &&
    typeof input.contentConfirmed !== "boolean"
  ) {
    throw validationIssue(
      "snapshot.contentConfirmed",
      "invalid_type",
      "Expected an explicit public-content confirmation choice.",
    );
  }
  const themeColor = hexColor(input.themeColor, "snapshot.themeColor");
  for (const background of ["#FBF7F0", "#F3EBDD"] as const) {
    if (contrastRatio(themeColor, background) < 4.5) {
      throw validationIssue(
        "snapshot.themeColor",
        "insufficient_contrast",
        "The club theme color must remain readable on the Field Notes paper backgrounds.",
      );
    }
  }
  return enforceRevisionSize(
    Object.freeze({
      contentConfirmed: input.contentConfirmed === true,
      coverAssetId: optionalIdentifier(
        input.coverAssetId,
        "snapshot.coverAssetId",
      ),
      description: plainText(
        input.description,
        "snapshot.description",
        8_000,
        0,
      ),
      displayOrder:
        input.displayOrder === undefined
          ? 1_000
          : parseFiniteInteger(input.displayOrder, {
              path: "snapshot.displayOrder",
              minimum: 0,
              maximum: 100_000,
            }),
      featured: input.featured,
      imageAltText: optionalPlainText(
        input.imageAltText,
        "snapshot.imageAltText",
        300,
      ),
      laneId: parseIdentifier(input.laneId, "snapshot.laneId"),
      meetupGroupUrl:
        input.meetupGroupUrl === null ||
        input.meetupGroupUrl === undefined ||
        input.meetupGroupUrl === ""
          ? null
          : canonicalMeetupGroupUrl(
              input.meetupGroupUrl,
              "snapshot.meetupGroupUrl",
            ),
      metaDescription: plainText(
        input.metaDescription,
        "snapshot.metaDescription",
        160,
        0,
      ),
      name: plainText(input.name, "snapshot.name", 120),
      openGraphAssetId: optionalIdentifier(
        input.openGraphAssetId,
        "snapshot.openGraphAssetId",
      ),
      preparation: optionalPlainText(
        input.preparation,
        "snapshot.preparation",
        2_000,
      ),
      programType: parseEnum(
        input.programType,
        ["club", "program", "circle", "series", "other"] as const,
        "snapshot.programType",
      ),
      relatedResourceIds: identifierArray(
        input.relatedResourceIds,
        "snapshot.relatedResourceIds",
        24,
      ),
      seoTitle: plainText(input.seoTitle, "snapshot.seoTitle", 60),
      slug: publicSlug(input.slug, "snapshot.slug"),
      socialUrls: httpsUrlArray(
        input.socialUrls,
        "snapshot.socialUrls",
        12,
      ),
      summary: plainText(input.summary, "snapshot.summary", 500, 0),
      themeColor,
      thumbnailAssetId: optionalIdentifier(
        input.thumbnailAssetId,
        "snapshot.thumbnailAssetId",
      ),
      typicalFormat: optionalPlainText(
        input.typicalFormat,
        "snapshot.typicalFormat",
        2_000,
      ),
      whatToExpect: optionalPlainText(
        input.whatToExpect,
        "snapshot.whatToExpect",
        2_000,
      ),
    }),
  );
}

export function parseProgramProfileSnapshot(
  value: unknown,
): CmsProgramProfileSnapshot {
  const input = parseObject(value, "snapshot");
  assertOnlyKeys(
    input,
    [
      "clubId",
      "contentConfirmed",
      "coverAssetId",
      "description",
      "displayOrder",
      "featured",
      "laneId",
      "meetupGroupUrl",
      "metaDescription",
      "name",
      "openGraphAssetId",
      "preparation",
      "programType",
      "relatedResourceIds",
      "seoTitle",
      "slug",
      "socialUrls",
      "summary",
      "themeColor",
      "thumbnailAssetId",
      "typicalFormat",
      "whatToExpect",
    ],
    "snapshot",
  );
  if (typeof input.featured !== "boolean") {
    throw validationIssue(
      "snapshot.featured",
      "invalid_type",
      "Expected a featured choice.",
    );
  }
  if (
    input.contentConfirmed !== undefined &&
    typeof input.contentConfirmed !== "boolean"
  ) {
    throw validationIssue(
      "snapshot.contentConfirmed",
      "invalid_type",
      "Expected an explicit public-content confirmation choice.",
    );
  }
  const themeColor = hexColor(input.themeColor, "snapshot.themeColor");
  for (const background of ["#FBF7F0", "#F3EBDD"] as const) {
    if (contrastRatio(themeColor, background) < 4.5) {
      throw validationIssue(
        "snapshot.themeColor",
        "insufficient_contrast",
        "The program theme color must remain readable on the Field Notes paper backgrounds.",
      );
    }
  }
  return enforceRevisionSize(
    Object.freeze({
      clubId: parseIdentifier(input.clubId, "snapshot.clubId"),
      contentConfirmed: input.contentConfirmed === true,
      coverAssetId: optionalIdentifier(
        input.coverAssetId,
        "snapshot.coverAssetId",
      ),
      description: plainText(
        input.description,
        "snapshot.description",
        20_000,
        0,
      ),
      displayOrder:
        input.displayOrder === undefined
          ? 1_000
          : parseFiniteInteger(input.displayOrder, {
              path: "snapshot.displayOrder",
              minimum: 0,
              maximum: 100_000,
            }),
      featured: input.featured,
      laneId: parseIdentifier(input.laneId, "snapshot.laneId"),
      meetupGroupUrl:
        input.meetupGroupUrl === null ||
        input.meetupGroupUrl === undefined ||
        input.meetupGroupUrl === ""
          ? null
          : canonicalMeetupGroupUrl(
              input.meetupGroupUrl,
              "snapshot.meetupGroupUrl",
            ),
      metaDescription: plainText(
        input.metaDescription,
        "snapshot.metaDescription",
        160,
        0,
      ),
      name: plainText(input.name, "snapshot.name", 120),
      openGraphAssetId: optionalIdentifier(
        input.openGraphAssetId,
        "snapshot.openGraphAssetId",
      ),
      preparation: optionalPlainText(
        input.preparation,
        "snapshot.preparation",
        2_000,
      ),
      programType: parseEnum(
        input.programType,
        ["program", "circle", "series", "other"] as const,
        "snapshot.programType",
      ),
      relatedResourceIds: identifierArray(
        input.relatedResourceIds,
        "snapshot.relatedResourceIds",
        24,
      ),
      seoTitle: plainText(input.seoTitle, "snapshot.seoTitle", 60),
      slug: publicSlug(input.slug, "snapshot.slug"),
      socialUrls: httpsUrlArray(
        input.socialUrls,
        "snapshot.socialUrls",
        12,
      ),
      summary: plainText(input.summary, "snapshot.summary", 500, 0),
      themeColor,
      thumbnailAssetId: optionalIdentifier(
        input.thumbnailAssetId,
        "snapshot.thumbnailAssetId",
      ),
      typicalFormat: optionalPlainText(
        input.typicalFormat,
        "snapshot.typicalFormat",
        2_000,
      ),
      whatToExpect: optionalPlainText(
        input.whatToExpect,
        "snapshot.whatToExpect",
        2_000,
      ),
    }),
  );
}

export function parseRestoreInput(value: unknown): Readonly<{
  expectedContentVersion: number;
  revisionId: string;
}> {
  const input = parseObject(value);
  assertOnlyKeys(input, ["expectedContentVersion", "revisionId"]);
  return Object.freeze({
    expectedContentVersion: parseExpectedContentVersion(
      input.expectedContentVersion,
    ),
    revisionId: parseIdentifier(input.revisionId, "revisionId"),
  });
}

export function parsePublishInput(value: unknown): Readonly<{
  expectedContentVersion: number;
}> {
  const input = parseObject(value);
  assertOnlyKeys(input, ["expectedContentVersion"]);
  return Object.freeze({
    expectedContentVersion: parseExpectedContentVersion(
      input.expectedContentVersion,
    ),
  });
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parsePageBlock(value: unknown, index: number): CmsPageBlock {
  const path = `snapshot.blocks.${index}`;
  const input = parseObject(value, path);
  assertOnlyKeys(input, ["config", "id", "type"], path);
  const id = parseIdentifier(input.id, `${path}.id`);
  const type = parseEnum(input.type, PAGE_BLOCK_TYPES, `${path}.type`);
  const config = parseObject(input.config, `${path}.config`);
  return Object.freeze({
    config: Object.freeze(parseBlockConfig(type, config, path)),
    id,
    type,
  });
}

function parseBlockConfig(
  type: PageBlockType,
  input: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  if (
    type === "hero" ||
    type === "intro" ||
    type === "prose" ||
    type === "callout"
  ) {
    assertOnlyKeys(
      input,
      ["eyebrow", "heading", "paragraphs", "text"],
      `${path}.config`,
    );
    const paragraphs =
      input.paragraphs === undefined
        ? []
        : plainTextArray(
            input.paragraphs,
            `${path}.config.paragraphs`,
            12,
            4_000,
          );
    const result: Record<string, unknown> = {
      paragraphs,
    };
    for (const [key, maximum] of [
      ["eyebrow", 120],
      ["heading", 240],
      ["text", 4_000],
    ] as const) {
      const parsed = optionalPlainText(
        input[key],
        `${path}.config.${key}`,
        maximum,
      );
      if (parsed) result[key] = parsed;
    }
    if (
      !result.eyebrow &&
      !result.heading &&
      !result.text &&
      paragraphs.length === 0
    ) {
      throw validationIssue(
        `${path}.config`,
        "empty_block",
        "The content block cannot be empty.",
      );
    }
    return result;
  }
  if (type === "ordered_link_list" || type === "resource_list") {
    assertOnlyKeys(input, ["heading", "items"], `${path}.config`);
    const items = parseLinkItems(
      input.items,
      `${path}.config.items`,
      type === "resource_list" ? 40 : 24,
    );
    return {
      heading: optionalPlainText(
        input.heading,
        `${path}.config.heading`,
        240,
      ),
      items,
    };
  }
  if (type === "media") {
    assertOnlyKeys(
      input,
      ["assetId", "caption", "heading"],
      `${path}.config`,
    );
    return {
      assetId: parseIdentifier(
        input.assetId,
        `${path}.config.assetId`,
      ),
      caption: optionalPlainText(
        input.caption,
        `${path}.config.caption`,
        1_000,
      ),
      heading: optionalPlainText(
        input.heading,
        `${path}.config.heading`,
        240,
      ),
    };
  }
  assertOnlyKeys(
    input,
    ["heading", "ids", "limit"],
    `${path}.config`,
  );
  const ids =
    input.ids === undefined
      ? []
      : identifierArray(input.ids, `${path}.config.ids`, 24);
  const limit =
    input.limit === undefined
      ? 6
      : parseFiniteInteger(input.limit, {
          path: `${path}.config.limit`,
          minimum: 1,
          maximum: 12,
        });
  return {
    heading: optionalPlainText(
      input.heading,
      `${path}.config.heading`,
      240,
    ),
    ids,
    limit,
  };
}

function parseLinkItems(
  value: unknown,
  path: string,
  maximum: number,
): readonly Readonly<{
  description: string | null;
  label: string;
  url: string;
}>[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw validationIssue(
      path,
      "invalid_length",
      `The link list may contain at most ${maximum} items.`,
    );
  }
  return Object.freeze(
    value.map((entry, index) => {
      const input = parseObject(entry, `${path}.${index}`);
      assertOnlyKeys(
        input,
        ["description", "label", "url"],
        `${path}.${index}`,
      );
      return Object.freeze({
        description: optionalPlainText(
          input.description,
          `${path}.${index}.description`,
          500,
        ),
        label: plainText(input.label, `${path}.${index}.label`, 120),
        url: safeContentUrl(input.url, `${path}.${index}.url`),
      });
    }),
  );
}

function publicSlug(value: unknown, path: string): string {
  const slug = parseBoundedString(value, {
    path,
    maxLength: 128,
  }).toLowerCase();
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) ||
    RESERVED_SLUGS.has(slug)
  ) {
    throw validationIssue(
      path,
      "invalid_slug",
      "Expected an available public slug.",
    );
  }
  return slug;
}

function safeContentUrl(value: unknown, path: string): string {
  const input = parseBoundedString(value, { path, maxLength: 2_048 });
  if (input.startsWith("/")) {
    const pathname = input.split(/[?#]/u, 1)[0] ?? "";
    if (
      !SAFE_INTERNAL_ROUTES.has(pathname) ||
      input.startsWith("//") ||
      /[\u0000-\u001F\u007F\\]/u.test(input)
    ) {
      throw validationIssue(
        path,
        "protected_url",
        "Expected a supported public route.",
      );
    }
    return input;
  }
  return canonicalHttpsUrl(input, path);
}

function safeNavigationTarget(value: unknown, path: string): string {
  const input = parseBoundedString(value, { path, maxLength: 2_048 });
  if (input === "/organizer") return input;
  return safeContentUrl(input, path);
}

function canonicalHttpsUrl(value: unknown, path: string): string {
  const input = parseBoundedString(value, { path, maxLength: 2_048 });
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw validationIssue(path, "invalid_url", "Expected a valid URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hostname.length === 0
  ) {
    throw validationIssue(
      path,
      "invalid_url",
      "Expected a secure HTTPS URL without credentials.",
    );
  }
  parsed.hash = "";
  return parsed.toString();
}

function canonicalMeetupGroupUrl(value: unknown, path: string): string {
  const canonical = canonicalHttpsUrl(value, path);
  const parsed = new URL(canonical);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.hostname !== "www.meetup.com" ||
    parts.length !== 1
  ) {
    throw validationIssue(
      path,
      "invalid_meetup_group_url",
      "Expected an exact Meetup group destination.",
    );
  }
  return `https://www.meetup.com/${parts[0]}/`;
}

function canonicalMeetupDiscussionUrl(value: unknown, path: string): string {
  const canonical = canonicalHttpsUrl(value, path);
  const parsed = new URL(canonical);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.hostname !== "www.meetup.com" ||
    parts.length !== 2 ||
    parts[1] !== "discussions"
  ) {
    throw validationIssue(
      path,
      "invalid_meetup_discussion_url",
      "Expected an exact Meetup group discussions destination.",
    );
  }
  return `https://www.meetup.com/${parts[0]}/discussions/`;
}

function requireNavigationItems(
  items: readonly CmsNavigationItem[],
): void {
  const headerItems = items.filter((item) => item.placement === "header");
  if (
    headerItems.length !== REQUIRED_HEADER_ITEMS.size ||
    headerItems.some((item) => !REQUIRED_HEADER_TARGETS.has(item.target))
  ) {
    throw validationIssue(
      "snapshot.items",
      "required_navigation",
      "The public header must contain exactly Events, Clubs, About, For Organizations, and Contact.",
    );
  }
  for (const [target, label] of REQUIRED_HEADER_ITEMS) {
    const matches = items.filter(
      (item) => item.placement === "header" && item.target === target,
    );
    if (matches.length !== 1 || matches[0]?.label !== label) {
      throw validationIssue(
        "snapshot.items",
        "required_navigation",
        "Required public header labels and destinations cannot be changed.",
      );
    }
  }
  for (const [target, label] of REQUIRED_FOOTER_ITEMS) {
    const match = items.find(
      (item) => item.placement === "footer" && item.target === target,
    );
    if (!match || match.label !== label) {
      throw validationIssue(
        "snapshot.items",
        "required_navigation",
        "Required footer labels and destinations must remain reachable.",
      );
    }
  }
}

function isLegacyNavigationSnapshot(
  items: readonly CmsNavigationItem[],
): boolean {
  const headerItems = items.filter((item) => item.placement === "header");
  if (
    headerItems.some(
      (item) =>
        item.target === "/organizer" && item.label !== "Organizer Login",
    )
  ) {
    return false;
  }
  for (const target of LEGACY_HEADER_TARGETS) {
    if (
      headerItems.filter((item) => item.target === target).length !== 1
    ) {
      return false;
    }
  }
  for (const target of LEGACY_FOOTER_TARGETS) {
    if (
      !items.some(
        (item) => item.placement === "footer" && item.target === target,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function institutionalNavigationItems(
  configured: readonly CmsNavigationItem[],
): readonly CmsNavigationItem[] {
  const byPlacementTarget = new Map(
    configured.map((item) => [`${item.placement}:${item.target}`, item]),
  );
  const configuredIds = new Set(configured.map((item) => item.id));
  const usedIds = new Set<string>();
  const configuredIdOrGenerated = (
    configuredItem: CmsNavigationItem | undefined,
    base: string,
  ): string => {
    if (configuredItem && !usedIds.has(configuredItem.id)) {
      usedIds.add(configuredItem.id);
      return configuredItem.id;
    }
    let candidate = base;
    let suffix = 2;
    while (configuredIds.has(candidate) || usedIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
  };
  const result: CmsNavigationItem[] = [];
  for (const [index, [target, label]] of [...REQUIRED_HEADER_ITEMS].entries()) {
    const configuredItem = byPlacementTarget.get(`header:${target}`);
    result.push(Object.freeze({
      id: configuredIdOrGenerated(configuredItem, `required-header-${index}`),
      label,
      placement: "header",
      sortOrder: (index + 1) * 10,
      target,
    }));
  }
  for (const [index, [target, label]] of [...REQUIRED_FOOTER_ITEMS].entries()) {
    const configuredItem = byPlacementTarget.get(`footer:${target}`);
    result.push(Object.freeze({
      id: configuredIdOrGenerated(configuredItem, `required-footer-${index}`),
      label,
      placement: "footer",
      sortOrder: (index + 1) * 10,
      target,
    }));
  }
  const resources = byPlacementTarget.get("footer:/resources");
  if (resources) {
    result.push(Object.freeze({
      id: configuredIdOrGenerated(resources, "optional-footer-resources"),
      label: resources.label,
      placement: "footer",
      sortOrder: 110,
      target: "/resources",
    }));
  }
  const externalByTarget = new Map<string, CmsNavigationItem>();
  for (const item of configured) {
    if (!item.target.startsWith("https://")) continue;
    const existing = externalByTarget.get(item.target);
    if (!existing || item.placement === "footer") {
      externalByTarget.set(item.target, item);
    }
  }
  const availableExternalSlots =
    CMS_FOOTER_NAVIGATION_MAX - REQUIRED_FOOTER_ITEMS.size - (resources ? 1 : 0);
  for (const item of [...externalByTarget.values()].slice(0, availableExternalSlots)) {
    if (!usedIds.has(item.id)) {
      usedIds.add(item.id);
      result.push(Object.freeze({
        id: item.id,
        label: item.label,
        placement: "footer",
        sortOrder: item.sortOrder,
        target: item.target,
      }));
    }
  }
  return Object.freeze(result);
}

function plainText(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 1,
  options: Readonly<{ permitProtectedLegalClaims?: boolean }> = {},
): string {
  const parsed = parseBoundedString(value, {
    path,
    minLength: minimum,
    maxLength: maximum,
  });
  if (UNSAFE_TEXT_MARKUP.test(parsed)) {
    throw validationIssue(
      path,
      "unsafe_markup",
      "Content must be plain text without executable markup.",
    );
  }
  return options.permitProtectedLegalClaims
    ? parsed
    : assertNoProtectedLegalClaim(parsed, path);
}

function optionalPlainText(
  value: unknown,
  path: string,
  maximum: number,
  options: Readonly<{ permitProtectedLegalClaims?: boolean }> = {},
): string | null {
  const parsed = parseOptionalBoundedString(value, {
    path,
    maxLength: maximum,
  });
  return parsed
    ? plainText(parsed, path, maximum, 1, options)
    : null;
}

function plainTextArray(
  value: unknown,
  path: string,
  maximumEntries: number,
  maximumText: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumEntries) {
    throw validationIssue(
      path,
      "invalid_length",
      `Expected at most ${maximumEntries} text entries.`,
    );
  }
  return Object.freeze(
    value.map((entry, index) =>
      plainText(entry, `${path}.${index}`, maximumText),
    ),
  );
}

function identifierArray(
  value: unknown,
  path: string,
  maximum: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw validationIssue(
      path,
      "invalid_length",
      `Expected at most ${maximum} identifiers.`,
    );
  }
  const parsed = value.map((entry, index) =>
    parseIdentifier(entry, `${path}.${index}`),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw validationIssue(
      path,
      "duplicate_identifier",
      "Duplicate identifiers are not supported.",
    );
  }
  return Object.freeze(parsed);
}

function httpsUrlArray(
  value: unknown,
  path: string,
  maximum: number,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw validationIssue(
      path,
      "invalid_length",
      `Expected at most ${maximum} URLs.`,
    );
  }
  const parsed = value.map((entry, index) =>
    canonicalHttpsUrl(entry, `${path}.${index}`),
  );
  if (new Set(parsed).size !== parsed.length) {
    throw validationIssue(
      path,
      "duplicate_url",
      "Duplicate destinations are not supported.",
    );
  }
  return Object.freeze(parsed);
}

function optionalIdentifier(value: unknown, path: string): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : parseIdentifier(value, path);
}

function hexColor(value: unknown, path: string): string {
  const color = parseBoundedString(value, {
    path,
    minLength: 7,
    maxLength: 7,
  });
  if (!/^#[0-9A-Fa-f]{6}$/u.test(color)) {
    throw validationIssue(
      path,
      "invalid_color",
      "Expected a six-digit hexadecimal color.",
    );
  }
  return color.toUpperCase();
}

function parsePalette(value: unknown): CmsSiteIdentitySnapshot["palette"] {
  const input = parseObject(value, "snapshot.palette");
  assertOnlyKeys(
    input,
    ["accent", "background", "foreground", "secondary"],
    "snapshot.palette",
  );
  const palette = Object.freeze({
    accent: hexColor(input.accent, "snapshot.palette.accent"),
    background: hexColor(input.background, "snapshot.palette.background"),
    foreground: hexColor(input.foreground, "snapshot.palette.foreground"),
    secondary: hexColor(input.secondary, "snapshot.palette.secondary"),
  });
  const textBackgroundPairs = [
    ["foreground", palette.foreground, "background", palette.background],
    ["foreground", palette.foreground, "paper-raised", "#F3EBDD"],
    ["ink-soft", "#3D4A66", "background", palette.background],
    ["accent", palette.accent, "background", palette.background],
    ["accent", palette.accent, "paper-raised", "#F3EBDD"],
    ["secondary", palette.secondary, "background", palette.background],
    ["secondary", palette.secondary, "paper-raised", "#F3EBDD"],
  ] as const;
  for (const [textName, textColor, backgroundName, backgroundColor] of
    textBackgroundPairs) {
    if (contrastRatio(textColor, backgroundColor) < 4.5) {
      throw validationIssue(
        "snapshot.palette",
        "insufficient_contrast",
        `The ${textName} color does not meet the required contrast against ${backgroundName}.`,
      );
    }
  }
  return palette;
}

export function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  const values = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (
    (values[0] ?? 0) * 0.2126 +
    (values[1] ?? 0) * 0.7152 +
    (values[2] ?? 0) * 0.0722
  );
}

function enforceRevisionSize<T>(value: T): T {
  if (
    new TextEncoder().encode(canonicalJson(value)).byteLength >
    MAX_REVISION_BYTES
  ) {
    throw validationIssue(
      "snapshot",
      "revision_too_large",
      "The revision exceeds the supported size.",
    );
  }
  return value;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}
