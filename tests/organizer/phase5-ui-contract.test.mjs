import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(...segments) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

test("Phase 5 publication APIs retain trusted identity, bounded same-origin bodies, and private responses", () => {
  const routes = [
    ["events", "[id]", "publication", "route.ts"],
    ["events", "[id]", "publication", "actions", "route.ts"],
    ["settings", "publication-policy", "route.ts"],
  ];
  for (const route of routes) {
    const routeSource = source("app", "api", "organizer", ...route);
    assert.match(routeSource, /requireOrganizerApiActor\(/u);
    assert.match(routeSource, /privateOrganizerJson\(/u);
    assert.match(routeSource, /organizerApiError\(/u);
    assert.doesNotMatch(
      routeSource,
      /request\.(?:headers|cookies).*?(?:actor|email|membership|organization|role)/isu,
    );
    if (/export async function (?:PATCH|POST)/u.test(routeSource)) {
      const authorization = routeSource.lastIndexOf(
        "requireOrganizerApiActor(",
      );
      const boundedBody = routeSource.lastIndexOf(
        "readOrganizerMutationBody(",
      );
      assert.ok(
        authorization >= 0 && boundedBody > authorization,
        `${route.join("/")} must authenticate before reading its body`,
      );
    }
  }
});

test("event publication workspace has a truthful readiness gate and complete Phase 5 controls", () => {
  const panel = source(
    "app",
    "_organizer",
    "WebsitePublicationPanel.tsx",
  );
  const page = source("app", "organizer", "events", "[id]", "page.tsx");
  for (const field of [
    "Attendance mode",
    "Approved public location name",
    "Approved public address",
    "Public online URL",
    "Public access note",
    "Availability",
    "Capacity, when genuinely known",
    "Cost text",
    "Preparation information",
    "What to bring",
    "Arrival instructions",
    "Weather note",
    "Verified accessibility notes",
    "RSVP information",
    "Public hosts",
  ]) {
    assert.match(panel, new RegExp(field, "u"));
  }
  for (const action of [
    "Open protected preview",
    "Publish to Website",
    "Schedule publication",
    "Cancel scheduled publication",
    "Unpublish from Website",
  ]) {
    assert.match(panel, new RegExp(action, "u"));
  }
  assert.match(panel, /readiness\.missing\.map/u);
  assert.match(panel, /D1\s+still rechecks authorization/u);
  assert.match(panel, /first relevant request at or after/u);
  assert.match(
    panel,
    /priorStatus === "published" && resultStatus === "published"/u,
  );
  assert.match(panel, /live public page has been updated/u);
  assert.match(
    panel,
    /priorStatus === "scheduled" && resultStatus === "unpublished"/u,
  );
  assert.match(panel, /scheduled publication was cancelled/u);
  assert.match(panel, /Website details saved privately/u);
  assert.doesNotMatch(panel, /Nothing was published by this save/u);
  assert.match(panel, /keeping its public page as a truthful\s+cancellation notice/u);
  assert.match(panel, /confirmMeetupEventUrl/u);
  assert.match(panel, /exact individual Meetup event URL/u);
  assert.match(panel, /publicHostProfileIds/u);
  assert.match(panel, /aria-atomic="true" aria-live="polite"/u);
  assert.match(panel, /errorRef\.current\?\.focus/u);
  assert.doesNotMatch(
    panel,
    /type="file"|media library|CMS editor|>Publish to Meetup</iu,
  );
  assert.match(page, /readOrganizerPublicationWorkspace/u);
  assert.match(page, /<WebsitePublicationPanel/u);
});

test("publication UI honors every server permission boolean without inferring a role", () => {
  const panel = source(
    "app",
    "_organizer",
    "WebsitePublicationPanel.tsx",
  );
  for (const permission of [
    "canCancelScheduledPublication",
    "canEditPublicDetails",
    "canPreview",
    "canPublish",
    "canSchedule",
    "canUnpublish",
  ]) {
    assert.match(
      panel,
      new RegExp(
        `${permission}:\\s*permissions\\.${permission} === true`,
        "u",
      ),
    );
  }
  assert.match(
    panel,
    /fieldset disabled=\{!workspace\.permissions\.canEditPublicDetails \|\| busy\}/u,
  );
  assert.match(
    panel,
    /\{workspace\.permissions\.canEditPublicDetails \? \(/u,
  );
  assert.match(
    panel,
    /\{workspace\.permissions\.canPreview \? \(/u,
  );
  assert.match(
    panel,
    /workspace\.permissions\.canPublish \? \(/u,
  );
  assert.match(
    panel,
    /workspace\.permissions\.canSchedule \? \(/u,
  );
  assert.match(
    panel,
    /workspace\.permissions\.canCancelScheduledPublication \? \(/u,
  );
  assert.match(
    panel,
    /workspace\.permissions\.canUnpublish \? \(/u,
  );
  assert.doesNotMatch(
    panel,
    /permissions\.(?:role|isOwner|isAdministrator|isOrganizer)/u,
  );
});

test("protected preview uses the exact allowlisted public renderer without discovery or sharing", () => {
  const preview = source(
    "app",
    "organizer",
    "events",
    "[id]",
    "preview",
    "page.tsx",
  );
  assert.match(preview, /loadOrganizerPageContext\(route\)/u);
  assert.match(preview, /enforceOrganizerPageAccess\(loaded\)/u);
  assert.match(preview, /readOrganizerPublicationPreview/u);
  assert.match(preview, /<PublicEventDetailRenderer/u);
  assert.match(preview, /showShareControls=\{false\}/u);
  assert.match(preview, /canonicalUrl=\{null\}/u);
  assert.match(preview, /force-dynamic/u);
  assert.match(preview, /index:\s*false/u);
  assert.match(preview, /noarchive:\s*true/u);
  assert.match(preview, /Not a public page/u);
  assert.doesNotMatch(
    preview,
    /privateNotes|privateMeetingDetails|conflictReason|identityHeader|invitation/u,
  );

  const publicationService = source(
    "lib",
    "server",
    "organizer",
    "publication.ts",
  );
  assert.match(
    publicationService,
    /hasAuthorizedOrganizerEventPublicPreview\(database,/u,
  );
  assert.match(
    publicationService,
    /canPreview:\s*canEditPublicDetails && hasPreviewProjection/u,
  );
  assert.doesNotMatch(
    publicationService,
    /canPreview:\s*detailsRow\s*!==\s*null/u,
  );
});

test("publication policy is a narrow Owner and Administrator setting", () => {
  const panel = source(
    "app",
    "_organizer",
    "PublicationPolicyPanel.tsx",
  );
  const route = source(
    "app",
    "api",
    "organizer",
    "settings",
    "publication-policy",
    "route.ts",
  );
  const page = source("app", "organizer", "settings", "page.tsx");
  assert.match(panel, /Organizer self-publishing/u);
  assert.match(panel, /organizerSelfPublishEnabled/u);
  assert.match(panel, /assigned club/u);
  assert.match(panel, /This policy is read-only for Organizers/u);
  assert.match(
    route,
    /requireOrganizerApiActor\(\[\s*"owner",\s*"administrator",\s*\]\)/u,
  );
  assert.match(page, /<PublicationPolicyPanel canManage=\{canManage\}/u);
  assert.doesNotMatch(panel, /branding|footer|legal|media|Community/u);
});

test("canonical summary and description remain in the event editor with current Phase 5 copy", () => {
  const editor = source("app", "_organizer", "EventEditorForm.tsx");
  const state = source("app", "_organizer", "event-editor-state.ts");
  assert.match(editor, />Public summary<\/span>/u);
  assert.match(editor, />Public description<\/span>/u);
  assert.match(editor, /Website publication on\s+the event page/u);
  assert.match(state, /summary:\s*value\.publicSummary/u);
  assert.match(state, /description:\s*value\.publicDescription/u);
  assert.doesNotMatch(
    editor,
    /Website publication begins in a later authorized phase/u,
  );
});

test("organizer shell gives current website publication guidance", () => {
  const shell = source("app", "_organizer", "WorkspaceShell.tsx");
  assert.match(
    shell,
    /website publication\s+controls live here[\s\S]*protected preview[\s\S]*public page/u,
  );
  assert.doesNotMatch(
    shell,
    /Website publishing remains unavailable in this phase/u,
  );
});
