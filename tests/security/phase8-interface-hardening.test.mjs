import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(...segments) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

test("event validation links every schedule error to its exact control", () => {
  const editor = source("app", "_organizer", "EventEditorForm.tsx");
  for (const fieldId of [
    "event-start-date",
    "event-start-time",
    "event-end-date",
    "event-end-time",
    "event-all-day-start",
    "event-all-day-end",
  ]) {
    assert.match(editor, new RegExp(`id="${fieldId}"`, "u"));
    assert.match(
      editor,
      new RegExp(
        `aria-invalid=\\{hasFieldError\\(errors, "${fieldId}"\\)\\}`,
        "u",
      ),
    );
    assert.match(
      editor,
      new RegExp(`<FieldError errors=\\{errors\\} fieldId="${fieldId}"`, "u"),
    );
    assert.match(editor, new RegExp(`add\\("${fieldId}",`, "u"));
  }
  assert.match(
    editor,
    /add\("event-end-time", "The timed end must be after the start\."\)/u,
  );
  assert.match(editor, /href=\{`#\$\{error\.fieldId\}`\}/u);
  assert.match(editor, /summaryRef\.current\?\.focus\(\)/u);
});

test("month calendar exposes one roving tab stop and complete keyboard movement", () => {
  const calendar = source("app", "_organizer", "CalendarWorkspace.tsx");
  assert.match(
    calendar,
    /tabIndex=\{cell\.date === selectedDate \? 0 : -1\}/u,
  );
  assert.match(calendar, /data-calendar-date=\{cell\.date\}/u);
  for (const key of [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ]) {
    assert.match(calendar, new RegExp(`event\\.key === "${key}"`, "u"));
  }
  assert.match(calendar, /requestAnimationFrame/u);
  assert.match(calendar, /\?\.focus\(\)/u);
  assert.doesNotMatch(calendar, /<div[^>]+aria-label="Agenda"/u);
  assert.doesNotMatch(calendar, /<div[^>]+aria-label=\{`Week of/u);
});

test("mobile organizer controls keep readable type and useful touch targets", () => {
  const workspace = source("app", "_organizer", "workspace.module.css");
  assert.match(
    workspace,
    /\.memberManagement fieldset label\s*\{[^}]*min-height:\s*2\.75rem/su,
  );
  const mobile = workspace.slice(workspace.indexOf("@media (max-width: 38rem)"));
  for (const selector of [
    ".primaryAction",
    ".statusPill",
    ".calendarToolbar button",
    ".formFooter button",
    ".indexFilters button",
    ".mobileNavigation > a",
    ".mobileMore > div a",
  ]) {
    assert.ok(mobile.includes(selector), `${selector} needs a mobile rule`);
  }
  assert.match(mobile, /font-size:\s*1rem/u);
});

test("outside-month text has a non-color cue and AA contrast", () => {
  const workspace = source("app", "_organizer", "workspace.module.css");
  assert.match(
    workspace,
    /\.monthView \.outsideMonth\s*\{[^}]*color:\s*#58615c[^}]*text-decoration:\s*underline;[^}]*text-decoration-style:\s*dotted/su,
  );
  assert.ok(contrastRatio("#58615c", "#e8e3d7") >= 4.5);
});

test("public route links stay visible, prominent, and keyboard-sized at every width", () => {
  const header = source("app", "_components", "SiteHeader.tsx");
  const css = source("app", "globals.css");
  for (const [href, label] of [
    ["/calendar", "Calendar"],
    ["/about", "About"],
    ["/get-involved", "Contribute"],
  ]) {
    assert.match(
      header,
      new RegExp(`\\{ href: "${href}", label: "${label}" \\}`, "u"),
    );
  }
  assert.doesNotMatch(header, /<details|<summary|site-navigation/u);
  assert.match(
    header,
    /href === "\/calendar"[\s\S]*?pathname === "\/"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)/u,
  );
  assert.match(
    css,
    /\.primary-nav\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[^}]*border:\s*1px solid var\(--ink\);/su,
  );
  assert.match(
    css,
    /\.primary-nav a\s*\{[^}]*min-height:\s*3rem;/su,
  );
  assert.match(
    css,
    /\.primary-nav a\[aria-current="page"\]\s*\{[^}]*background:\s*var\(--ink\);[^}]*color:\s*var\(--paper\);/su,
  );
  assert.match(
    css,
    /@media \(max-width: 70rem\)[\s\S]*?\.primary-nav\s*\{[^}]*width:\s*100%;/u,
  );
  assert.match(
    css,
    /@media \(max-width: 30rem\)[\s\S]*?\.primary-nav a\s*\{[^}]*min-height:\s*2\.75rem;[^}]*white-space:\s*nowrap;/u,
  );
});

test("public event detail restores readable ink after the legacy card rule", () => {
  const css = source("app", "globals.css");
  const detailStart = css.indexOf(".event-detail {", css.indexOf(".event-detail-page {"));
  const detailRule = css.slice(detailStart, css.indexOf("}", detailStart) + 1);

  assert.match(detailRule, /color:\s*var\(--ink\);/u);
  assert.match(detailRule, /font-size:\s*1rem;/u);
});

test("media upload panels and file controls shrink within narrow viewports", () => {
  const media = source("app", "_organizer", "MediaLibrary.tsx");
  const styles = source("app", "_organizer", "phase6.module.css");
  assert.match(media, /<section className=\{styles\.editorPanel\}/u);
  assert.match(media, /<label className=\{styles\.uploadDrop\}>/u);
  assert.match(media, /name="original"[\s\S]*?type="file"/u);
  assert.match(
    styles,
    /\.panel,\s*\.editorPanel\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/su,
  );
  assert.match(
    styles,
    /\.form,\s*\.fieldGrid,\s*\.blockList,\s*\.noticeStack\s*\{[^}]*min-width:\s*0;/su,
  );
  assert.match(
    styles,
    /\.uploadDrop\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/su,
  );
  assert.match(
    styles,
    /\.uploadDrop input\[type="file"\]\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*2\.75rem;/su,
  );
});

test("Phase 7 export controls keep explicit useful touch targets", () => {
  const panel = source("app", "_organizer", "Phase7ExportsPanel.tsx");
  const styles = source("app", "_organizer", "workspace.module.css");
  assert.match(
    panel,
    /Download operational CSV[\s\S]*?Allowlisted JSON backup/su,
  );
  assert.equal(
    (panel.match(/className=\{styles\.secondaryButton\}/gu) ?? []).length,
    2,
  );
  assert.equal(
    (panel.match(/className=\{styles\.primaryButton\}/gu) ?? []).length,
    1,
  );
  assert.match(panel, /<label className=\{styles\.exportConfirmation\}>/u);
  assert.match(
    styles,
    /\.exportConfirmation input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*3rem;/su,
  );
  assert.match(
    styles,
    /\.formFooter button,\s*\.primaryButton,\s*\.secondaryButton\s*\{[^}]*min-height:\s*3rem;/su,
  );
});

test("global public navigation disables speculative RSC prefetches", () => {
  const header = source("app", "_components", "SiteHeader.tsx");
  const footer = source("app", "_components", "SiteFooter.tsx");

  assert.match(
    header,
    /<Link[\s\S]*?href=\{item\.href\}[\s\S]*?prefetch=\{false\}/u,
  );
  assert.match(header, /return Object\.freeze\(requiredNavigation\)/u);
  assert.doesNotMatch(
    header,
    /\{ href: "\/organizer", label: "Organizer Login" \}/u,
  );
  assert.match(
    footer,
    /<Link[\s\S]*?href=\{item\.href\}[\s\S]*?prefetch=\{false\}/u,
  );
  assert.match(
    footer,
    /<Link href="\/organizer" prefetch=\{false\}>/u,
  );
});

function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return (
    channels[0] * 0.2126 +
    channels[1] * 0.7152 +
    channels[2] * 0.0722
  );
}
