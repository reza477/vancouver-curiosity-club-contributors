import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(...segments) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

test("Phase 4 conflict centre is a protected private route with every required state", () => {
  const page = source("app", "organizer", "conflicts", "page.tsx");
  const center = source(
    "app",
    "_organizer",
    "ConflictReviewCenter.tsx",
  );
  assert.match(
    page,
    /loadOrganizerPageContext\("\/organizer\/conflicts"\)/u,
  );
  assert.match(page, /enforceOrganizerPageAccess\(loaded\)/u);
  assert.match(page, /force-dynamic/u);
  for (const state of [
    "Open",
    "Pending approval",
    "Approved",
    "Rejected",
    "Invalidated",
    "Resolved",
    "Draft warnings",
  ]) {
    assert.match(center, new RegExp(state));
  }
  for (const fact of [
    "Exact overlap",
    "Resources",
    "Coordination note",
    "View event",
    "Edit my event",
    "Change time",
    "Cancel my event",
    "Approve",
    "Reject",
    "Mark warning reviewed",
    "Read-only source event",
  ]) {
    assert.match(center, new RegExp(fact, "u"));
  }
  assert.match(center, /\/api\/organizer\/conflicts/u);
  assert.match(center, /\/reviews\/\$\{encodeURIComponent\(item\.id\)\}\/decision/u);
  assert.match(center, /\/incidents\/\$\{encodeURIComponent\(item\.id\)\}\/review/u);
  assert.doesNotMatch(center, /sourceUrl|privateNotes|email|identityHeader/u);
});

test("private navigation has the exact five core mobile destinations and no Phase 5 action", () => {
  const shell = source("app", "_organizer", "WorkspaceShell.tsx");
  const css = source("app", "_organizer", "workspace.module.css");
  const mobileStart = shell.indexOf('<nav className={styles.mobileNavigation}');
  const mobileEnd = shell.indexOf("</nav>", mobileStart);
  const mobile = shell.slice(mobileStart, mobileEnd);
  const destinations = [
    ["/organizer/calendar", "Calendar"],
    ["/organizer/events/new", "Add event"],
    ["/organizer/conflicts", "Conflicts"],
    ["/organizer/team", "Team"],
  ];
  let previous = -1;
  for (const [href, label] of destinations) {
    const index = mobile.indexOf(`href="${href}"`);
    assert.ok(index > previous, `${label} must be in the ordered mobile nav`);
    previous = index;
  }
  assert.match(mobile, /className=\{styles\.mobileMore\}/u);
  assert.match(mobile, /<summary>More<\/summary>/u);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.doesNotMatch(
    shell,
    />\s*(?:Publish|Unpublish|Public preview|Export|QR download)\s*</u,
  );
});

test("event editor follows the Phase 4 scheduling order and preserves rejected form state", () => {
  const editor = source("app", "_organizer", "EventEditorForm.tsx");
  const state = source("app", "_organizer", "event-editor-state.ts");
  const order = [
    ">Title ",
    ">Club ",
    "Schedule shape",
    ">Original timezone ",
    ">Primary organizer ",
    "<legend>Co-organizers</legend>",
    ">Venue</span>",
    ">Setup buffer, minutes</span>",
    ">Cleanup or travel buffer, minutes</span>",
    "Planning status",
    ">Publication</span>",
  ];
  let previous = -1;
  for (const marker of order) {
    const index = editor.indexOf(marker);
    assert.ok(index > previous, `${marker} must follow the Phase 4 form order`);
    previous = index;
  }
  assert.match(editor, /<strong>Private<\/strong>/u);
  assert.match(editor, /Website publication begins in a later authorized phase/u);
  assert.match(editor, /expectedContentVersion:\s*value\.expectedEditVersion/u);
  assert.match(editor, /expectedScheduleVersion:\s*value\.expectedScheduleVersion/u);
  assert.match(state, /privateMeetingDetails:\s*value\.privateMeetingDetails/u);
  assert.match(state, /venueId:\s*value\.venueId/u);
  assert.match(editor, /setErrors\(\[message\]\)/u);
  assert.match(editor, /summaryRef\.current\?\.focus\(\)/u);
  assert.doesNotMatch(
    editor,
    /catch[\s\S]{0,300}setValue\(initialValue\)|catch[\s\S]{0,300}reset\(\)/u,
  );
});

test("conflict preview is advisory, debounced, cancellable, stale-safe, and screen-reader restrained", () => {
  const editor = source("app", "_organizer", "EventEditorForm.tsx");
  assert.match(editor, /\/api\/organizer\/conflicts\/preview/u);
  assert.match(editor, /new AbortController\(\)/u);
  assert.match(editor, /previewSequenceRef/u);
  assert.match(editor, /window\.setTimeout\(async \(\) => \{/u);
  assert.match(editor, /\}, 350\)/u);
  assert.match(editor, /controller\.abort\(\)/u);
  assert.match(editor, /Final save will check D1 again/u);
  assert.match(editor, /aria-busy=\{preview\.kind === "checking"\}/u);
  assert.match(editor, /aria-atomic="true" aria-live="polite"/u);
  assert.match(editor, /Direct overlap/u);
  assert.match(editor, /Buffer conflict/u);
  assert.match(editor, /Conflict resources/u);
  assert.match(editor, /View event/u);
  assert.match(editor, /Change time/u);
  const fingerprint = /return JSON\.stringify\(\{([\s\S]*?)\n  \}\);/u.exec(editor);
  assert.ok(fingerprint, "preview payload must be explicit");
  assert.doesNotMatch(
    fingerprint[1],
    /privateNotes|internalNotes|description|publicSummary|publicDescription|email|sourceUrl/u,
  );
});

test("lifecycle controls use explicit guarded actions and an accessible focus-restoring dialog", () => {
  const actions = source("app", "_organizer", "EventActions.tsx");
  for (const label of [
    "Place hold",
    "Extend hold",
    "Release hold",
    "Confirm",
    "Cancel",
    "Archive",
  ]) {
    assert.match(actions, new RegExp(label, "u"));
  }
  assert.match(actions, /"complete"/u);
  assert.match(actions, /\/api\/organizer\/events\/\$\{encodeURIComponent\(eventId\)\}\/actions/u);
  assert.match(actions, /expectedContentVersion:\s*contentVersion/u);
  assert.match(actions, /expectedScheduleVersion:\s*scheduleVersion/u);
  assert.match(actions, /<dialog/u);
  assert.match(actions, /aria-labelledby="lifecycle-dialog-title"/u);
  assert.match(actions, /aria-describedby="lifecycle-dialog-description"/u);
  assert.match(actions, /data-dialog-initial-focus/u);
  assert.match(actions, /querySelector<HTMLElement>/u);
  assert.match(actions, /triggerRef\.current\?\.focus\(\)/u);
  assert.match(actions, /event remains a non-reserving private Draft/u);
  assert.match(actions, /Nothing here publishes the event/u);
});

test("settings expose private conflict policy and venue management without public CMS fields", () => {
  const page = source("app", "organizer", "settings", "page.tsx");
  const panels = source(
    "app",
    "_organizer",
    "Phase4SettingsPanels.tsx",
  );
  assert.match(page, /<Phase4SettingsPanels canManage=\{canManage\}/u);
  assert.match(panels, /\/api\/organizer\/settings\/conflict-policy/u);
  assert.match(panels, /warn_reason/u);
  assert.match(panels, /require_admin_approval/u);
  assert.match(panels, /value="block"/u);
  assert.match(panels, /defaultHoldHours/u);
  assert.match(panels, /nearingExpiryHours/u);
  assert.match(panels, /Only an Owner or Administrator/u);
  assert.match(panels, /\/api\/organizer\/venues/u);
  assert.match(panels, /Private address/u);
  assert.match(panels, /Private arrival directions/u);
  assert.match(panels, /Private accessibility notes/u);
  assert.doesNotMatch(
    panels,
    /name="(?:isPublic|publicAddress|publicLocationName)"|Publish venue/u,
  );
});

test("calendar conflict indicators have complete accessible names and non-color text", () => {
  const calendar = source("app", "_organizer", "CalendarWorkspace.tsx");
  const types = source("app", "_organizer", "types.ts");
  assert.match(types, /conflictCount\?:\s*number/u);
  assert.match(types, /conflictState\?:/u);
  assert.match(calendar, /calendarConflictLabel\(entry\)/u);
  assert.match(calendar, /entry\.fullScheduleLabel/u);
  assert.match(calendar, /entry\.organizer\.displayName/u);
  assert.match(calendar, /entry\.club\.name/u);
  assert.match(calendar, /statusLabel\(entry\.planningStatus\)/u);
  assert.match(calendar, /conflict indicator/u);
  assert.match(calendar, /Hold expired/u);
  assert.match(calendar, /Hold nearing expiry/u);
  assert.match(calendar, /label="Conflicts"/u);
  assert.match(calendar, /Only records with conflicts/u);
  assert.match(calendar, /filters\.conflicts !== "only"/u);
  assert.match(calendar, /entry\.conflictCount \?\? 0/u);
  assert.match(
    calendar,
    /No scheduled records with conflicts match\./u,
  );
  assert.match(calendar, /candidate\.conflicts === "only"/u);
});

test("event detail uses a scoped server conflict DTO and source-safe destinations", () => {
  const page = source("app", "organizer", "events", "[id]", "page.tsx");
  const service = source(
    "lib",
    "server",
    "organizer",
    "event-conflicts.ts",
  );
  assert.match(page, /listOrganizerEventConflictSummaries/u);
  assert.match(page, /conflict\.destination\.external/u);
  assert.match(page, /rel="noopener noreferrer"/u);
  assert.match(page, /Read-only source record/u);
  assert.doesNotMatch(page, /raw\.conflicts/u);
  assert.match(service, /incident\.organizer_event_id = \?/u);
  assert.match(
    service,
    /incident\.conflicting_source_kind = 'manual'[\s\S]*incident\.conflicting_event_id = \?/u,
  );
  assert.match(service, /source\.enabled = 1/u);
  assert.match(service, /generation\.state = 'published'/u);
  assert.doesNotMatch(
    service,
    /review\.reason|override\.reason|private_notes|normalized_email|source_url/u,
  );
});
