import { readPublicCss } from "./helpers/public-css.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const legacyDarkSurfaces = new Set(["#071b31", "#145e59"]);

test("the public palette stays coherent and primary navigation labels remain readable", async () => {
  const css = await readPublicCss();
  const rootVariables = declarationsFor(css, ":root");
  const publicVariables = new Map([
    ...rootVariables,
    ...declarationsFor(css, 'body[data-surface="public"]'),
  ]);

  for (const token of [
    "--paper",
    "--ink",
    "--accent",
    "--accent-quiet",
    "--forest",
    "--cobalt",
  ]) {
    const rootColor = resolveColor(`var(${token})`, rootVariables);
    const publicColor = resolveColor(`var(${token})`, publicVariables);
    assert.equal(
      publicColor,
      rootColor,
      `${token} must use the same default in the base and public CMS palettes`,
    );
  }

  const pageBackground = resolveColor("var(--paper)", publicVariables);
  const pageText = resolveColor("var(--ink)", publicVariables);
  assert.ok(
    contrastRatio(pageText, pageBackground) >= 4.5,
    "the default public text/background pair must meet WCAG AA",
  );
  const raisedBackground = resolveColor(
    "var(--paper-raised)",
    publicVariables,
  );
  for (const token of ["--accent", "--accent-quiet", "--ink-soft"]) {
    const foreground = resolveColor(`var(${token})`, publicVariables);
    assert.ok(
      contrastRatio(foreground, pageBackground) >= 4.5,
      `${token} must meet WCAG AA on the default paper`,
    );
    assert.ok(
      contrastRatio(foreground, raisedBackground) >= 4.5,
      `${token} must meet WCAG AA on the raised paper`,
    );
  }

  for (const { label, matches } of [
    {
      label: 'primary navigation a[aria-current="page"]',
      matches: (selectors) =>
        selectors.includes('.primary-nav a[aria-current="page"]'),
    },
    {
      label: "primary navigation hover/focus",
      matches: (selectors) =>
        selectors.includes(".primary-nav a:hover") &&
        selectors.includes(".primary-nav a:focus-visible"),
    },
  ]) {
    const rule = cssRules(css).find(({ selectors }) => matches(selectors));
    assert.ok(rule, `missing CSS rule for ${label}`);
    const { declarations } = rule;
    const background = resolvedDeclarationColor(
      declarations,
      "background",
      publicVariables,
    );
    const foreground = resolvedDeclarationColor(
      declarations,
      "color",
      publicVariables,
    );

    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `${label} must keep its label readable at WCAG AA contrast`,
    );
    assert.ok(
      !legacyDarkSurfaces.has(background),
      `${label} must not restore the old dark green/navy background`,
    );
  }

  for (const { selectors, declarations } of cssRules(css)) {
    if (!isPublicInteractiveLabel(selectors)) {
      continue;
    }
    const backgroundValue =
      declarations.get("background-color") ?? declarations.get("background");
    if (!backgroundValue) {
      continue;
    }
    const background = resolveColor(backgroundValue, publicVariables);
    assert.ok(
      !legacyDarkSurfaces.has(background),
      `${selectors.trim()} must not put an interactive label on a legacy dark surface`,
    );
  }
});

function declarationsFor(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "u"));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return declarationMap(match[1]);
}

function declarationMap(body) {
  const declarations = new Map();
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//gu, "");
  for (const match of withoutComments.matchAll(
    /(^|;)\s*([\w-]+)\s*:\s*([^;]+)(?=;|$)/gu,
  )) {
    declarations.set(match[2], match[3].trim());
  }
  return declarations;
}

function resolvedDeclarationColor(declarations, property, variables) {
  const value = declarations.get(property);
  assert.ok(value, `missing ${property} declaration`);
  return resolveColor(value, variables);
}

function resolveColor(value, variables, seen = new Set()) {
  const normalized = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/u.test(normalized)) {
    return normalized;
  }
  if (/^#[\da-f]{3}$/u.test(normalized)) {
    return `#${normalized
      .slice(1)
      .split("")
      .map((character) => character.repeat(2))
      .join("")}`;
  }

  const variable = normalized.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/u);
  assert.ok(variable, `expected a resolvable hex color, received ${value}`);
  const [, token, fallback] = variable;
  assert.ok(!seen.has(token), `cyclic color token ${token}`);
  const nextSeen = new Set(seen).add(token);
  const tokenValue = variables.get(token);
  if (tokenValue) {
    const cmsVariable = tokenValue.match(/^var\((--cms-[\w-]+),\s*(.+)\)$/u);
    if (cmsVariable) {
      return resolveColor(cmsVariable[2], variables, nextSeen);
    }
    return resolveColor(tokenValue, variables, nextSeen);
  }
  assert.ok(fallback, `missing color token ${token}`);
  return resolveColor(fallback, variables, nextSeen);
}

function cssRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selectors: match[1],
    declarations: declarationMap(match[2]),
  }));
}

function isPublicInteractiveLabel(selectors) {
  return (
    /\.primary-nav|\.primary-action|\.secondary-action|\.calendar-cta|\.pagination|\.events-page__timeframe|\.event-detail__mobile-rsvp/u.test(
      selectors,
    ) ||
    /(?:^|,)\s*(?:a|button|summary)(?:[\s:[.#]|$)/u.test(selectors)
  );
}

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
