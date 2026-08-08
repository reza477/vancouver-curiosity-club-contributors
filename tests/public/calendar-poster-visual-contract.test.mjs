import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../../", import.meta.url);

function findClosingBrace(styles, openIndex) {
  let depth = 1;
  for (let index = openIndex + 1; index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return styles.length;
}

function mediaBlocks(styles) {
  const blocks = [];
  for (const match of styles.matchAll(/@media\s*([^\{]+)\{/gu)) {
    const openIndex = match.index + match[0].length - 1;
    blocks.push({
      end: findClosingBrace(styles, openIndex),
      query: match[1],
      start: openIndex + 1,
    });
  }
  return blocks;
}

function mediaApplies(query, viewportWidth) {
  const maxWidth = query.match(/max-width:\s*([\d.]+)(px|rem)/u);
  if (
    maxWidth &&
    viewportWidth >
      Number(maxWidth[1]) * (maxWidth[2] === "rem" ? 16 : 1)
  ) {
    return false;
  }
  const minWidth = query.match(/min-width:\s*([\d.]+)(px|rem)/u);
  if (
    minWidth &&
    viewportWidth <
      Number(minWidth[1]) * (minWidth[2] === "rem" ? 16 : 1)
  ) {
    return false;
  }
  return true;
}

function declarationsForPropertyAtViewport(
  styles,
  selector,
  property,
  viewportWidth,
) {
  const declaration = new RegExp(
    `(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`,
    "gu",
  );
  const media = mediaBlocks(styles);
  const leafRule = /([^{}]+)\{([^{}]*)\}/gu;
  const declarations = [];

  for (const match of styles.matchAll(leafRule)) {
    const selectors = match[1]
      .split(",")
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    if (!selectors.includes(selector)) continue;

    const enclosingMedia = media.filter(
      (block) => match.index > block.start && match.index < block.end,
    );
    if (
      enclosingMedia.some(
        (block) => !mediaApplies(block.query, viewportWidth),
      )
    ) {
      continue;
    }
    declarations.push(
      ...[...match[2].matchAll(declaration)].map((item) => item[1].trim()),
    );
  }

  return declarations;
}

function lastDeclarationAtViewport(
  styles,
  selector,
  property,
  viewportWidth,
) {
  const declarations = declarationsForPropertyAtViewport(
    styles,
    selector,
    property,
    viewportWidth,
  );
  return declarations.at(-1) ?? null;
}

function horizontalRatio(value) {
  const match = value?.match(/^([\d.]+)\s*\/\s*([\d.]+)$/u);
  if (!match) return null;
  return Number(match[1]) / Number(match[2]);
}

test("the month calendar uses substantial brand accents without losing non-colour state cues", async () => {
  const [calendar, styles] = await Promise.all([
    readFile(
      new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  for (const viewportWidth of [390, 768, 1440]) {
    const toolbarBackground = lastDeclarationAtViewport(
      styles,
      ".public-calendar__toolbar",
      "background",
      viewportWidth,
    );
    assert.match(
      toolbarBackground ?? "",
      /--cal-paper-deep/u,
      `${viewportWidth}px calendar toolbar should use a visible brand accent, not a flat paper surface`,
    );
    assert.match(
      lastDeclarationAtViewport(
        styles,
        ".public-calendar__toolbar",
        "border-left",
        viewportWidth,
      ) ?? "",
      /--lane-think/u,
      `${viewportWidth}px month heading needs a substantial brand-colour edge`,
    );
    assert.match(
      lastDeclarationAtViewport(
        styles,
        ".public-calendar__toolbar",
        "box-shadow",
        viewportWidth,
      ) ?? "",
      /--lane-play/u,
      `${viewportWidth}px month heading needs a second non-neutral colour cue`,
    );
  }

  const weekdayAccents = new Set();
  for (const match of styles.matchAll(
    /\.public-calendar__grid\s+th:nth-child\([^)]*\)\s*\{([^}]*)\}/gu,
  )) {
    const background = match[1].match(
      /background(?:-color)?\s*:\s*([^;]+)/u,
    )?.[1];
    const accent = background?.match(
      /--(cal-navy-mid|cal-header-blue|cal-header-teal|cal-header-ochre|cal-header-brick)/u,
    )?.[1];
    if (accent) weekdayAccents.add(accent);
    assert.match(
      match[1],
      /color\s*:\s*var\(--cal-paper\)/u,
      "each coloured weekday surface needs an explicit high-contrast text token",
    );
  }
  assert.ok(
    weekdayAccents.size >= 3,
    "the month grid should use at least three substantial weekday accents rather than one repeated neutral header",
  );

  assert.match(calendar, /aria-pressed=\{selected\}/u);
  assert.match(
    styles,
    /\.public-calendar__day--selected[^{}]*\{[^}]*box-shadow:/su,
    "selected dates need a shape or border cue in addition to colour",
  );
  assert.match(
    styles,
    /button:focus-visible[\s\S]*?outline:\s*0\.2rem solid var\(--focus-ring-inner\)/u,
    "calendar buttons must retain the global visible keyboard focus treatment",
  );
  assert.match(
    styles,
    /\.public-calendar-event\s*\{[^}]*--event-accent:\s*var\(--lane-think\)/su,
    "calendar cards should use the accessible calendar-scoped lane palette",
  );
  assert.match(
    styles,
    /\.public-calendar-event__actions\s*>\s*a:first-child,[\s\S]*?\{[^}]*color:\s*var\(--cal-paper\)/su,
    "lane-coloured calendar actions need explicit high-contrast light text",
  );
  assert.match(
    styles,
    /\.public-calendar-event__artwork--fallback,[\s\S]*?\{[^}]*color:\s*var\(--cal-paper\)/su,
    "lane-coloured poster fallbacks need explicit high-contrast light text",
  );
  assert.match(
    styles,
    /--cal-line:\s*#8b795e;/u,
    "calendar cell boundaries need at least 3:1 contrast against adjacent cells",
  );
  assert.match(
    styles,
    /\.public-calendar__day--today \.public-calendar__day-number\s*\{[^}]*box-shadow:[^;]*--cal-navy/su,
    "today needs a high-contrast outline in addition to its gold fill",
  );
});

test("the Wednesday label has no orange font background", async () => {
  const styles = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );
  for (const viewportWidth of [390, 768, 1440]) {
    assert.equal(
      lastDeclarationAtViewport(
        styles,
        ".public-calendar__grid th:nth-child(4)",
        "background",
        viewportWidth,
      ),
      "var(--cal-navy-mid)",
      `the Wednesday label should use the deep navy background at ${viewportWidth}px`,
    );
    assert.equal(
      lastDeclarationAtViewport(
        styles,
        ".public-calendar__grid th:nth-child(4)",
        "color",
        viewportWidth,
      ),
      "var(--cal-paper)",
      `the Wednesday label should retain light high-contrast text at ${viewportWidth}px`,
    );
  }
});

test("event posters stay horizontal and uncropped across desktop, tablet, and phone discovery surfaces", async () => {
  const [calendar, cards, styles] = await Promise.all([
    readFile(
      new URL("app/_components/PublicMonthCalendar.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/_components/EventCard.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);

  for (const viewportWidth of [390, 768, 1440]) {
    for (const selector of [
      ".home-hero__poster img",
      ".event-card__artwork-frame",
      ".event-detail__artwork-frame",
    ]) {
      const ratio = horizontalRatio(
        lastDeclarationAtViewport(
          styles,
          selector,
          "aspect-ratio",
          viewportWidth,
        ),
      );
      assert.ok(
        ratio !== null && ratio >= 1.5,
        `${selector} should resolve to a horizontal frame at ${viewportWidth}px`,
      );
    }


    for (const selector of [
      ".event-card__artwork--fallback",
      ".event-detail__lead > .event-detail__artwork--fallback",
      ".home-hero__poster--fallback",
    ]) {
      const ratio = horizontalRatio(
        lastDeclarationAtViewport(
          styles,
          selector,
          "aspect-ratio",
          viewportWidth,
        ),
      );
      assert.ok(
        ratio !== null && ratio >= 1.5,
        `${selector} should resolve to a horizontal fallback at ${viewportWidth}px`,
      );
      assert.equal(
        lastDeclarationAtViewport(
          styles,
          selector,
          "min-height",
          viewportWidth,
        ),
        "0",
        `${selector} should not retain a portrait-making minimum height at ${viewportWidth}px`,
      );
    }

    for (const selector of [
      ".event-card__artwork img",
      ".event-detail__artwork img",
      ".home-hero__poster img",
      ".public-calendar-event__artwork img",
    ]) {
      assert.equal(
        lastDeclarationAtViewport(
          styles,
          selector,
          "object-fit",
          viewportWidth,
        ),
        "contain",
        `${selector} must stay uncropped at ${viewportWidth}px`,
      );
    }
  }

  for (const selector of [
    ".event-card__artwork figcaption",
    ".event-detail__artwork figcaption",
  ]) {
    assert.equal(
      lastDeclarationAtViewport(styles, selector, "position", 390),
      "static",
      `${selector} must sit below the poster instead of covering its lettering`,
    );
  }

  for (const viewportWidth of [390, 768]) {
    assert.equal(
      lastDeclarationAtViewport(
        styles,
        ".public-calendar__mobile-agenda-list img",
        "object-fit",
        viewportWidth,
      ),
      "contain",
      `agenda poster lettering must stay uncropped at ${viewportWidth}px`,
    );
    const agendaRatio = horizontalRatio(
      lastDeclarationAtViewport(
        styles,
        ".public-calendar__mobile-agenda-list img",
        "aspect-ratio",
        viewportWidth,
      ),
    );
    assert.ok(
      agendaRatio !== null && agendaRatio >= 1.5,
      `the ${viewportWidth}px agenda thumbnail should be explicitly horizontal`,
    );
  }

  assert.match(cards, /alt=\{event\.artwork\.altText \?\? ""\}/u);
  assert.match(
    calendar,
    /<img[\s\S]*?alt=""[\s\S]*?<strong>\{event\.title\}<\/strong>/u,
    "agenda artwork may stay decorative because the same button exposes the event title",
  );
  assert.match(
    styles,
    /\.public-calendar__mobile-agenda-list button\s*\{[^}]*grid-template-columns:[^;]*minmax\(0,\s*1fr\)/su,
    "the responsive agenda text column must be shrinkable to avoid horizontal overflow",
  );
  assert.match(
    calendar,
    /data-event-lane=\{event\.lane\?\.slug \?\? "think"\}/u,
    "real-poster agenda rows need the same lane colour identity as fallbacks",
  );
  assert.match(
    styles,
    /body\[data-surface="public"\]\s*\{[^}]*overflow-x:\s*clip;/su,
    "public pages should retain their no-horizontal-overflow guard",
  );
  assert.doesNotMatch(
    styles,
    /(?:event-card|home-hero__poster):(?:hover|focus-within)[^{]*img[^}]*\{[^}]*transform:\s*scale/su,
    "poster hover and focus states must not zoom and recrop artwork lettering",
  );
});
