import { readPublicCssSync } from "../helpers/public-css.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { blockedLaneArchiveExplanation } from "../../app/_organizer/taxonomy-copy.ts";

const ROOT = process.cwd();

test("club editor offers trusted published-resource choices without exposing IDs", () => {
  const editor = source("app", "_organizer", "ClubContentEditor.tsx");
  const route = source(
    "app",
    "organizer",
    "content",
    "clubs",
    "[id]",
    "page.tsx",
  );

  assert.match(editor, /Related published resources/u);
  assert.match(editor, /resource\.label/u);
  assert.match(editor, /resource\.href/u);
  assert.match(editor, /relatedResourceIds/u);
  assert.doesNotMatch(editor, />\s*\{resource\.id\}\s*</u);

  assert.match(
    route,
    /state\.workflow_status = 'published'/u,
  );
  assert.match(route, /page\.status = 'published'/u);
  assert.match(route, /page\.visibility = 'public'/u);
  assert.match(route, /resources=\{data\.resources\}/u);
});

test("structured editors retain raw multiline typing until server validation", () => {
  const page = source("app", "_organizer", "PageContentEditor.tsx");
  const club = source("app", "_organizer", "ClubContentEditor.tsx");
  const legal = source("app", "_organizer", "SiteContentSettings.tsx");

  assert.match(page, /paragraphsText/u);
  assert.match(page, /linksText/u);
  assert.match(page, /setParagraphsText\(event\.target\.value\)/u);
  assert.match(page, /setLinksText\(event\.target\.value\)/u);

  assert.match(club, /socialUrlsText/u);
  assert.match(club, /setSocialUrlsText\(event\.target\.value\)/u);

  assert.doesNotMatch(
    legal,
    /onChange=\{\(event\)\s*=>\s*setSnapshot\([^)]*emptyToNull/u,
  );
});

test("content dashboard exposes a no-code private Resources draft action", () => {
  const dashboard = source("app", "organizer", "content", "page.tsx");
  const button = source(
    "app",
    "_organizer",
    "CreateResourcesDraftButton.tsx",
  );

  assert.match(dashboard, /CreateResourcesDraftButton/u);
  assert.match(button, /Create Resources draft/u);
  assert.match(button, /slug:\s*"resources"/u);
  assert.match(button, /unpublished, non-renamable Resources page/u);
  assert.doesNotMatch(button, /published successfully|now live/u);
});

test("club profiles have a no-code draft creator, keyboard ordering, and honest archive controls", () => {
  const dashboard = source("app", "organizer", "content", "page.tsx");
  const creator = source(
    "app",
    "_organizer",
    "CreateClubProfileDraftButton.tsx",
  );
  const editor = source("app", "_organizer", "ClubContentEditor.tsx");
  const privateClubs = source("app", "_organizer", "ClubsWorkspace.tsx");

  assert.match(dashboard, /CreateClubProfileDraftButton/u);
  assert.match(dashboard, /NOT EXISTS \([\s\S]*club_public_profiles/u);
  assert.match(creator, /Create Club Profile Draft/u);
  assert.match(creator, /entityKey:\s*club\.id/u);
  assert.match(creator, /does not publish the club/u);
  assert.match(editor, /Published display order/u);
  assert.match(editor, /Move Earlier/u);
  assert.match(editor, /Move Later/u);
  assert.match(editor, /permissions\.canArchive/u);
  assert.match(editor, /retained as read-only\s+history/u);
  assert.match(editor, /New events cannot be scheduled in the archived club/u);
  assert.match(privateClubs, /Safe-delete archived club/u);
  assert.match(privateClubs, /no event, source, member, invitation, or program/u);
});

test("Program profiles expose only state-valid archive and safe-delete controls", () => {
  const dashboard = source("app", "organizer", "content", "page.tsx");
  const creator = source(
    "app",
    "_organizer",
    "CreateProgramDraftButton.tsx",
  );
  const editor = source("app", "_organizer", "ProgramContentEditor.tsx");

  assert.match(dashboard, /CreateProgramDraftButton/u);
  assert.match(creator, /Create Program Draft/u);
  assert.match(creator, /remains private until its confirmed content is explicitly published/u);
  assert.match(editor, /permissions\.canArchive/u);
  assert.match(editor, /permissions\.canDelete/u);
  assert.match(editor, /\/safe-delete/u);
  assert.match(editor, /immutable private revision and audit history/u);
  assert.match(editor, /Eligible past events and revision history remain/u);
  assert.match(editor, /unavailable for future scheduling/u);
});

test("event editors retain an exact archived lane or category without offering other archived choices", () => {
  const data = source("app", "_organizer", "data.ts");
  const editor = source("app", "_organizer", "EventEditorForm.tsx");
  const types = source("app", "_organizer", "types.ts");

  assert.match(types, /export type OrganizerOption[\s\S]*archived\?: boolean/u);
  assert.match(
    data,
    /SELECT id, name, deleted_at[\s\S]*FROM event_lanes/u,
  );
  assert.match(
    data,
    /SELECT category\.id, category\.name, category\.deleted_at[\s\S]*FROM categories AS category/u,
  );
  assert.match(data, /\(deleted_at IS NOT NULL\) ASC/u);
  assert.match(
    data,
    /LEFT JOIN category_taxonomy_states AS state[\s\S]*COALESCE\(state\.sort_order, 100000\) ASC/u,
  );
  assert.match(data, /\$\{label\} \(archived\)/u);
  assert.match(
    editor,
    /!option\.archived \|\| option\.id === selectedId/u,
  );
  assert.match(editor, /disabled=\{option\.archived\}/u);
  assert.match(
    editor,
    /This archived lane is retained for the existing event/u,
  );
  assert.match(
    editor,
    /This archived category is retained for the existing event/u,
  );
});

test("Settings exposes accessible CAS taxonomy management through the exact private API contract", () => {
  const settings = source("app", "organizer", "settings", "page.tsx");
  const panel = source(
    "app",
    "_organizer",
    "TaxonomySettingsPanel.tsx",
  );

  assert.match(settings, /<TaxonomySettingsPanel canManage=\{canManage\}/u);
  assert.match(
    panel,
    /const TAXONOMY_PATH = "\/api\/organizer\/settings\/taxonomy"/u,
  );
  assert.doesNotMatch(panel, /taxonomy\/action/u);
  assert.match(panel, /isRecord\(value\.workspace\)/u);
  assert.match(panel, /permissions\.canManage/u);
  assert.match(panel, /entityType:\s*kind/u);
  assert.match(panel, /expectedContentVersion:\s*item\.contentVersion/u);
  assert.match(panel, /action:\s*"update"/u);
  assert.match(panel, /action:\s*"reorder"/u);
  assert.match(panel, /"archive"/u);
  assert.match(panel, /"safe_delete"/u);
  assert.match(panel, /Move Up/u);
  assert.match(panel, /Move Down/u);
  assert.match(panel, /window\.confirm/u);
  assert.match(panel, /role="alert"/u);
  assert.match(panel, /aria-live="polite"/u);
  assert.ok(
    [...panel.matchAll(/noticeRef\.current\?\.focus\(\)/gu)].length >= 3,
    "taxonomy load, success, and failure paths must focus the result summary",
  );
  assert.match(
    panel,
    /Your entered values remain in the form/u,
  );
  assert.match(
    panel,
    /const activeItems = items\.filter\(\(item\) => !item\.archived\)/u,
  );
  assert.match(panel, /activeIndex === activeItemCount - 1/u);
  assert.match(
    panel,
    /Existing records keep their exact selection, but new records cannot select it/u,
  );
  assert.match(panel, /blockedLaneArchiveExplanation\(item\.slug\)/u);
  assert.match(panel, /stable slug cannot be changed after creation/u);
  assert.match(panel, /TAXONOMY_NAME_MAX/u);
  assert.match(panel, /TAXONOMY_SLUG_PATTERN_SOURCE/u);
  assert.match(panel, /This .* cannot be safely deleted[\s\S]*established usages/u);
});

test("blocked lane copy reserves canonical wording for the four required lanes", () => {
  for (const slug of [
    "think",
    "reset-and-make",
    "explore",
    "eat-and-play",
  ]) {
    assert.match(
      blockedLaneArchiveExplanation(slug),
      /required canonical lane/u,
      slug,
    );
  }

  const noncanonical = blockedLaneArchiveExplanation(
    "neighbourhood-stories",
  );
  assert.doesNotMatch(noncanonical, /canonical|required/u);
  assert.match(noncanonical, /established references/u);
  assert.match(noncanonical, /block archiving or deletion/u);
});

test("community editor identity changes cannot retain the previous link form", () => {
  const route = source(
    "app",
    "organizer",
    "content",
    "community",
    "page.tsx",
  );
  const editor = source(
    "app",
    "_organizer",
    "CommunityContentEditor.tsx",
  );

  assert.match(
    route,
    /key=\{data\.workspace\?\.entity\.entityKey \?\? "new-community-link"\}/u,
  );
  assert.match(editor, /Short description/u);
  assert.match(editor, /required/u);
});

test("public routes keep one combined Events renderer and private previews keep one focus target", () => {
  const homeRoute = source("app", "page.tsx");
  const eventsRoute = source("app", "events", "page.tsx");
  const calendarRoute = source("app", "calendar", "route.ts");
  const clubRoute = source("app", "clubs", "[slug]", "page.tsx");
  const preview = source("app", "_organizer", "PublicPreviewShell.tsx");

  assert.match(homeRoute, /<HomePageRenderer/u);
  assert.doesNotMatch(homeRoute, /CalendarPage|PublicMonthCalendar/u);
  assert.match(eventsRoute, /<EventsPageRenderer/u);
  assert.doesNotMatch(eventsRoute, /eventListValues|values\.state|values\.page/u);
  assert.doesNotMatch(eventsRoute, /calendar\/page|readPublicMeetupSyncState/u);
  assert.match(calendarRoute, /new URL\(request\.url\)/u);
  assert.match(
    calendarRoute,
    /new URL\(\s*["']\/events["'],\s*await getPublicRequestOrigin\(source\),?\s*\)/u,
  );
  assert.match(calendarRoute, /source\.searchParams\.getAll\(["']month["']\)/u);
  assert.match(calendarRoute, /Response\.redirect\(destination, 308\)/u);
  assert.doesNotMatch(
    calendarRoute,
    /<PublicMonthCalendar|<HomePageRenderer|<EventsPageRenderer|calendar-view-switcher/u,
  );
  assert.match(clubRoute, /<ClubDetailRenderer/u);
  assert.match(preview, /<HomePageRenderer/u);
  assert.match(preview, /<EventsPageRenderer/u);
  assert.doesNotMatch(preview, /eventListValues/u);
  assert.match(preview, /<ClubDetailRenderer/u);
  for (const [route, body] of [
    [["clubs", "page.tsx"], "ClubsRouteBody"],
    [["get-involved", "page.tsx"], "GetInvolvedRouteBody"],
    [["contact", "page.tsx"], "ContactRouteBody"],
    [["host-an-event", "page.tsx"], "HostAnEventRouteBody"],
  ]) {
    assert.match(source("app", ...route), new RegExp(`<${body}`, "u"));
    assert.match(preview, new RegExp(`<${body}`, "u"));
  }
  assert.equal(
    [...preview.matchAll(/id="organizer-main"/gu)].length,
    1,
  );
  assert.equal(
    [...preview.matchAll(/tabIndex=\{-1\}/gu)].length,
    1,
  );
  assert.match(
    source("app", "layout.tsx"),
    /isPrivatePath \? "#organizer-main" : "#page-content"/u,
  );
  assert.match(preview, /let communityLinks = catalog\.communityLinks/u);
  assert.match(
    preview,
    /communityLinks = previewCommunityLinks\([\s\S]*preview\.entityKey/u,
  );
  assert.match(
    preview,
    /return Object\.freeze\(\{ \.\.\.catalog, communityLinks, navigation, site \}\)/u,
  );
  assert.match(preview, /links=\{catalog\.communityLinks\}/u);
  assert.doesNotMatch(
    preview,
    /externalLinks=\{shell\.communityLinks\.map/u,
  );
  assert.match(preview, /item\.entityKey === entityKey/u);
  assert.match(preview, /if \(snapshot\.confirmed\)/u);
  assert.match(preview, /Private search and sharing summary/u);
  assert.match(preview, /Selected approved revision artwork/u);
  assert.match(preview, /Published site social artwork fallback/u);
});

test("published shell and editorial metadata use live media readiness and truthful fallbacks", () => {
  const layout = source("app", "layout.tsx");
  const home = source("app", "page.tsx");
  const routeBodies = source(
    "app",
    "_components",
    "EditorialRouteBodies.tsx",
  );
  const homeRenderer = source(
    "app",
    "_components",
    "HomePageRenderer.tsx",
  );
  const clubRenderer = source(
    "app",
    "_components",
    "ClubDetailRenderer.tsx",
  );
  const css = readPublicCssSync();

  assert.match(layout, /resolveMediaAssetsForRendering/u);
  assert.match(
    layout,
    /assetId: site\.logoAssetId,[\s\S]*entityKey: organization\.id,[\s\S]*entityType: "site_logo",[\s\S]*usageKind: "logo"/u,
  );
  assert.match(layout, /publicationScope: "published"/u);
  assert.match(layout, /\)\[0\]\?\.assetId \?\? null/u);
  assert.match(home, /absoluteTitle:\s*true/u);
  assert.match(
    source("app", "_components", "EditorialPage.tsx"),
    /buildEditorialMetadataFromResolved/u,
  );
  assert.match(
    routeBodies,
    /What would you like to make happen\?[\s\S]*Offer a partnership or support/u,
  );
  assert.doesNotMatch(routeBodies, /CommunityDestinations/u);
  assert.doesNotMatch(home, /loadCommunityDestinations|sameAs:/u);
  assert.match(
    homeRenderer,
    /link\.linkType === "meetup_group" \|\|[\s\S]*link\.linkType === "social_profile"/u,
  );
  assert.doesNotMatch(
    css,
    /color:\s*var\(--club-theme/u,
  );
  assert.match(
    clubRenderer,
    /className="club-directory__actions"[\s\S]*Explore program/u,
    "Program-card actions must retain the shared responsive grid placement",
  );
  assert.match(css, /border-top:[^;]*var\(--club-theme/u);
  assert.match(clubRenderer, /"--club-theme": club\.themeColor/u);
});

function source(...parts) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}
