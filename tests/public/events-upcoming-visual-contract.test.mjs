import { readPublicRouteCss } from "../helpers/public-css.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const PHONE_VIEWPORTS = Object.freeze([320, 375]);
const TABLET_AND_DESKTOP_VIEWPORTS = Object.freeze([768, 1024, 1440]);
const VIEWPORTS = Object.freeze([
  ...PHONE_VIEWPORTS,
  ...TABLET_AND_DESKTOP_VIEWPORTS,
]);
const ROOT_FONT_SIZE_PX = 16;

test("Upcoming cards stack on phones and keep posters substantial at larger widths", async () => {
  const styles = await readPublicRouteCss("events");

  for (const viewportWidth of PHONE_VIEWPORTS) {
    const columns = declarationAtViewport(
      styles,
      [".event-card", ".events-upcoming__list .event-card"],
      "grid-template-columns",
      viewportWidth,
    );
    assert.ok(columns, `missing Upcoming card columns at ${viewportWidth}px`);
    assert.equal(
      topLevelWhitespaceParts(columns).length,
      1,
      `${viewportWidth}px Upcoming cards should stack the poster above the copy instead of squeezing both into columns`,
    );
  }

  for (const viewportWidth of TABLET_AND_DESKTOP_VIEWPORTS) {
    const columns = declarationAtViewport(
      styles,
      [".event-card", ".events-upcoming__list .event-card"],
      "grid-template-columns",
      viewportWidth,
    );
    assert.ok(columns, `missing Upcoming card columns at ${viewportWidth}px`);
    const tracks = topLevelWhitespaceParts(columns);
    assert.ok(
      tracks.length >= 2,
      `${viewportWidth}px Upcoming cards should retain a poster and a shrinkable copy track`,
    );
    const posterWidth = resolveLengthPx(tracks[0], viewportWidth);
    const usableWidth =
      viewportWidth - inlinePaddingPx(styles, viewportWidth);
    const posterShare = posterWidth / usableWidth;
    const [minimumShare, maximumShare] =
      viewportWidth === 768 ? [0.25, 0.42] : [0.2, 0.34];
    assert.ok(
      posterShare >= minimumShare && posterShare <= maximumShare,
      `${viewportWidth}px poster track should use ${(minimumShare * 100).toFixed(0)}%-${(maximumShare * 100).toFixed(0)}% of the usable card width; got ${(posterShare * 100).toFixed(1)}%`,
    );
  }
});

test("Upcoming-card typography keeps titles, dates, associations, and facts balanced", async () => {
  const styles = await readPublicRouteCss("events");

  for (const viewportWidth of VIEWPORTS) {
    const titleSize = fontSizePx(
      styles,
      [".event-card h3", ".events-upcoming__list .event-card h3"],
      viewportWidth,
    );
    const dateSize = fontSizePx(
      styles,
      [
        ".event-card__date strong",
        ".events-upcoming__list .event-card__date strong",
      ],
      viewportWidth,
    );
    const metaSize = inheritedCardFontSizePx(
      styles,
      [
        ".event-card__meta",
        ".events-upcoming__list .event-card__meta",
      ],
      viewportWidth,
    );
    const factsSize = inheritedCardFontSizePx(
      styles,
      [
        ".event-card__facts",
        ".events-upcoming__list .event-card__facts",
      ],
      viewportWidth,
    );
    const titleToDateRatio = titleSize / dateSize;

    assert.ok(
      titleToDateRatio >= 0.78 && titleToDateRatio <= 1.35,
      `${viewportWidth}px title and date should share emphasis without either dominating; ratio was ${titleToDateRatio.toFixed(2)}`,
    );
    assert.ok(
      metaSize / ROOT_FONT_SIZE_PX >= 0.8125,
      `${viewportWidth}px event associations should remain readable, not miniature`,
    );
    assert.ok(
      factsSize / ROOT_FONT_SIZE_PX >= 0.875,
      `${viewportWidth}px When, Where, and Capacity details should remain readable`,
    );
    assert.ok(
      titleSize / factsSize >= 1.6 && titleSize / factsSize <= 3.2,
      `${viewportWidth}px title should lead the facts without overwhelming them`,
    );
  }
});

function fontSizePx(styles, selectors, viewportWidth) {
  const value = declarationAtViewport(
    styles,
    selectors,
    "font-size",
    viewportWidth,
  );
  assert.ok(value, `missing font size for ${selectors.join(" or ")}`);
  return resolveLengthPx(value, viewportWidth);
}

function inheritedCardFontSizePx(styles, selectors, viewportWidth) {
  const direct = declarationAtViewport(
    styles,
    selectors,
    "font-size",
    viewportWidth,
  );
  if (direct) return resolveLengthPx(direct, viewportWidth);

  for (const parents of [
    [".event-card__body"],
    [".event-card"],
    ["body"],
  ]) {
    const inherited = declarationAtViewport(
      styles,
      parents,
      "font-size",
      viewportWidth,
    );
    if (inherited) return resolveLengthPx(inherited, viewportWidth);
  }
  return ROOT_FONT_SIZE_PX;
}

function inlinePaddingPx(styles, viewportWidth) {
  const value = declarationAtViewport(
    styles,
    [".events-page__upcoming"],
    "padding",
    viewportWidth,
  );
  assert.ok(value, "missing Events Upcoming padding");
  const parts = topLevelWhitespaceParts(value);
  const [right, left] =
    parts.length === 1
      ? [parts[0], parts[0]]
      : parts.length === 2
        ? [parts[1], parts[1]]
        : parts.length === 3
          ? [parts[1], parts[1]]
          : [parts[1], parts[3]];
  return (
    resolveLengthPx(right, viewportWidth) +
    resolveLengthPx(left, viewportWidth)
  );
}

function declarationAtViewport(
  styles,
  matchingSelectors,
  property,
  viewportWidth,
) {
  const declaration = new RegExp(
    `(?:^|;)\\s*${escapeRegex(property)}\\s*:\\s*([^;]+)`,
    "gu",
  );
  const media = mediaBlocks(styles);
  const candidates = [];
  let order = 0;

  for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
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

    for (const selector of match[1]
      .split(",")
      .map((candidate) => candidate.trim())) {
      if (!matchingSelectors.includes(selector)) continue;
      for (const item of match[2].matchAll(declaration)) {
        candidates.push({
          order: order += 1,
          specificity: selectorSpecificity(selector),
          value: item[1].trim(),
        });
      }
    }
  }

  candidates.sort((left, right) => {
    const specificity = compareSpecificity(
      left.specificity,
      right.specificity,
    );
    return specificity === 0 ? left.order - right.order : specificity;
  });
  return candidates.at(-1)?.value ?? null;
}

function selectorSpecificity(selector) {
  const ids = (selector.match(/#[\w-]+/gu) ?? []).length;
  const classes = (
    selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/gu) ?? []
  ).length;
  const elements = selector
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/gu, " ")
    .split(/\s+|>|\+|~/u)
    .filter((part) => /^[a-z][\w-]*$/iu.test(part)).length;
  return [ids, classes, elements];
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function resolveLengthPx(value, viewportWidth) {
  const normalized = value.trim();
  if (normalized === "0" || /^env\(/u.test(normalized)) return 0;

  const scalar = normalized.match(/^(-?[\d.]+)(px|rem|vw)$/u);
  if (scalar) {
    const amount = Number(scalar[1]);
    if (scalar[2] === "px") return amount;
    if (scalar[2] === "rem") return amount * ROOT_FONT_SIZE_PX;
    return amount * viewportWidth / 100;
  }

  const expression = normalized.match(/^(clamp|min|max)\((.*)\)$/u);
  assert.ok(expression, `unsupported responsive length: ${value}`);
  const resolved = topLevelCommaParts(expression[2]).map((part) =>
    resolveLengthPx(part, viewportWidth),
  );
  if (expression[1] === "min") return Math.min(...resolved);
  if (expression[1] === "max") return Math.max(...resolved);
  assert.equal(resolved.length, 3, `invalid clamp length: ${value}`);
  return Math.max(resolved[0], Math.min(resolved[1], resolved[2]));
}

function topLevelWhitespaceParts(value) {
  return splitTopLevel(value, (character) => /\s/u.test(character));
}

function topLevelCommaParts(value) {
  return splitTopLevel(value, (character) => character === ",");
}

function splitTopLevel(value, separator) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && separator(character)) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
