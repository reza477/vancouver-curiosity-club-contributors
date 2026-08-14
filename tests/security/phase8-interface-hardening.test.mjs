import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function source(...segments) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

function ruleBodies(styles, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [
    ...styles.matchAll(
      new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "gsu"),
    ),
  ].map((match) => match[1]);
}

function assertRuleContains(styles, selector, declarations) {
  assert.ok(
    ruleBodies(styles, selector).some((rule) =>
      declarations.every((declaration) => declaration.test(rule)),
    ),
    `${selector} must contain ${declarations.join(", ")}`,
  );
}

function atRuleBlocks(styles, header) {
  const blocks = [];
  let searchFrom = 0;

  while (searchFrom < styles.length) {
    const headerStart = styles.indexOf(header, searchFrom);
    if (headerStart < 0) break;
    const blockStart = styles.indexOf("{", headerStart + header.length);
    if (blockStart < 0) break;

    let depth = 0;
    let blockEnd = blockStart;
    for (; blockEnd < styles.length; blockEnd += 1) {
      if (styles[blockEnd] === "{") depth += 1;
      if (styles[blockEnd] === "}") depth -= 1;
      if (depth === 0) break;
    }
    blocks.push(styles.slice(blockStart + 1, blockEnd));
    searchFrom = blockEnd + 1;
  }

  return blocks;
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
  const css = source("app", "styles", "layout.css");
  for (const [href, label] of [
    ["/events", "Events"],
    ["/clubs", "Clubs"],
    ["/about", "About"],
    ["/contact", "Feedback"],
  ]) {
    assert.match(
      header,
      new RegExp(`\\{ href: "${href}", label: "${label}" \\}`, "u"),
    );
  }
  assert.doesNotMatch(header, /<details|<summary|site-navigation/u);
  assert.match(
    header,
    /href === "\/events"[\s\S]*?pathname === "\/events"[\s\S]*?pathname\.startsWith\("\/events\/"\)[\s\S]*?pathname === "\/calendar"/u,
  );
  assert.doesNotMatch(header, /pathname === "\/"/u);
  assertRuleContains(css, ".primary-nav", [
    /display:\s*grid;/u,
    /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/u,
    /border:\s*1px solid var\(--ink\);/u,
  ]);
  assertRuleContains(css, ".primary-nav a", [/min-height:\s*3rem;/u]);
  assertRuleContains(css, '.primary-nav a[aria-current="page"]', [
    /background:\s*[^;]+;/u,
    /color:\s*[^;]+;/u,
  ]);

  const tabletStyles = atRuleBlocks(css, "@media (max-width: 70rem)")[0] ?? "";
  assertRuleContains(tabletStyles, ".primary-nav", [/width:\s*100%;/u]);

  const phoneStyles = atRuleBlocks(css, "@media (max-width: 30rem)")[0] ?? "";
  assertRuleContains(phoneStyles, ".primary-nav", [
    /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u,
  ]);
  assertRuleContains(phoneStyles, ".primary-nav a", [
    /min-height:\s*2\.75rem;/u,
    /white-space:\s*normal;/u,
  ]);
});

test("public event detail restores readable ink after the legacy card rule", () => {
  const css = source("app", "styles", "pages", "event-detail.css");
  assertRuleContains(css, ".event-detail", [
    /color:\s*var\(--ink\);/u,
    /font-size:\s*1rem;/u,
  ]);
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

test("public navigation prefetches by default while private previews stay opted out", () => {
  const header = source("app", "_components", "SiteHeader.tsx");
  const footer = source("app", "_components", "SiteFooter.tsx");
  const preview = source("app", "_organizer", "PublicPreviewShell.tsx");

  assert.match(header, /prefetchInternalLinks = true/u);
  assert.match(
    header,
    /prefetch=\{prefetchInternalLinks\}/u,
  );
  assert.match(
    header,
    /className="wordmark"[\s\S]*?prefetch=\{prefetchInternalLinks\}/u,
  );
  assert.match(header, /normalizedPrimaryNavigation\(navigation\)/u);
  assert.match(header, /for \(const sourceItem of configured\)/u);
  assert.doesNotMatch(
    header,
    /\{ href: "\/organizer", label: "Organizer Login" \}/u,
  );
  assert.match(
    footer,
    /prefetch=\{prefetchInternalLinks\}/u,
  );
  assert.match(footer, /prefetchInternalLinks = true/u);
  assert.match(
    footer,
    /<Link href="\/organizer" prefetch=\{false\}>/u,
  );
  for (const component of ["SiteHeader", "SiteFooter", "EventsPageRenderer"]) {
    const callSite = preview.match(
      new RegExp(`<${component}\\b[\\s\\S]*?\\/>`, "u"),
    )?.[0];
    assert.ok(callSite, `${component} preview call site must exist`);
    assert.match(
      callSite,
      /prefetchInternalLinks=\{false\}/u,
      `${component} must keep private preview prefetch disabled`,
    );
  }
  assert.equal(
    (preview.match(/prefetchInternalLinks=\{false\}/gu) ?? []).length,
    3,
  );
});

test("public route loading feedback is accessible, stable, overflow-safe, and reduced-motion-safe", () => {
  const loading = source("app", "loading.tsx");
  const baseStyles = source("app", "styles", "base.css");
  const layoutStyles = source("app", "styles", "layout.css");

  assert.match(loading, /className="route-loading"/u);
  assert.match(loading, /aria-busy="true"/u);
  assert.match(loading, /aria-labelledby="route-loading-status"/u);
  assert.match(loading, /role="status"/u);
  assert.match(loading, /aria-live="polite"/u);
  assert.match(loading, /Loading the next page\.\.\./u);
  assert.match(loading, /className="route-loading__skeleton" aria-hidden="true"/u);

  assertRuleContains(baseStyles, ".route-loading", [
    /box-sizing:\s*border-box;/u,
    /width:\s*100%;/u,
    /min-width:\s*0;/u,
    /min-height:\s*clamp\([^;]+;/u,
    /(?:overflow-x:\s*clip|overflow:\s*clip(?:\s+hidden)?);/u,
    /contain:\s*layout paint;/u,
  ]);
  assert.match(
    layoutStyles,
    /\.wordmark,\s*\.primary-nav a,\s*\.footer-nav-group a\s*\{[^}]*min-block-size:\s*2\.75rem;/su,
  );
  const motionStyles = atRuleBlocks(
    baseStyles,
    "@media (prefers-reduced-motion: no-preference)",
  );
  assert.ok(
    motionStyles.some((block) =>
      ruleBodies(block, ".route-loading__shape").some((rule) =>
        /animation:\s*[^;]*route-loading-pulse[^;]*;/u.test(rule),
      ),
    ),
  );
  const reducedMotionStyles = atRuleBlocks(
    baseStyles,
    "@media (prefers-reduced-motion: reduce)",
  );
  assert.ok(
    reducedMotionStyles.some((block) =>
      ruleBodies(block, ".route-loading__shape").some((rule) =>
        /animation:\s*none;/u.test(rule),
      ),
    ),
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
