import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import postcss from "postcss";

const projectRoot = new URL("../../", import.meta.url);

test("non-current primary navigation labels stay visible on hover and keyboard focus", async () => {
  const styles = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );
  const root = postcss.parse(styles);

  for (const interaction of ["hover", "focus-visible"]) {
    const background = cascadedDeclaration(
      root,
      interaction,
      "background",
    );
    const color = cascadedDeclaration(root, interaction, "color");

    assert.equal(
      background?.value,
      "var(--paper)",
      `the ${interaction} state should use the light modern navigation surface`,
    );
    assert.equal(
      color?.value,
      "var(--forest)",
      `the ${interaction} state must keep the violet label readable on the light surface`,
    );
  }
});

function cascadedDeclaration(root, interaction, property) {
  const candidates = [];
  let order = 0;

  root.walkRules((rule) => {
    for (const selector of splitSelectors(rule.selector)) {
      if (!matchesNonCurrentEventsLink(selector, interaction)) continue;

      rule.walkDecls(property, (declaration) => {
        candidates.push({
          important: declaration.important,
          order,
          specificity: specificityOf(selector),
          value: declaration.value,
        });
      });
    }
    order += 1;
  });

  candidates.sort(compareCascade);
  return candidates.at(-1) ?? null;
}

function matchesNonCurrentEventsLink(selector, interaction) {
  if (!selector.includes(".primary-nav") || !/(?:^|\s|>)a(?=[\s[:.#]|$)/u.test(selector)) {
    return false;
  }

  if (selector.includes(":hover") && interaction !== "hover") return false;
  if (
    selector.includes(":focus-visible") &&
    interaction !== "focus-visible"
  ) {
    return false;
  }

  const otherInteraction = interaction === "hover" ? "focus-visible" : "hover";
  if (selector.includes(`:${otherInteraction}`)) return false;

  const destination = selector.match(
    /\[data-primary-destination=["']([^"']+)["']\]/u,
  )?.[1];
  if (destination && destination !== "events") return false;

  const withoutNonCurrentGuard = selector.replaceAll(
    /:not\(\[aria-current=["']page["']\]\)/gu,
    "",
  );
  return !withoutNonCurrentGuard.includes("[aria-current");
}

function splitSelectors(value) {
  const selectors = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      selectors.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  selectors.push(value.slice(start).trim());
  return selectors;
}

function specificityOf(selector) {
  const withoutWhere = selector.replaceAll(/:where\([^)]*\)/gu, "");
  const normalized = withoutWhere.replaceAll(/:not\(([^)]*)\)/gu, "$1");
  const ids = normalized.match(/#[\w-]+/gu)?.length ?? 0;
  const classes = normalized.match(/\.[\w-]+/gu)?.length ?? 0;
  const attributes = normalized.match(/\[[^\]]+\]/gu)?.length ?? 0;
  const pseudoClasses =
    normalized.match(/:(?!:|is\()[\w-]+(?:\([^)]*\))?/gu)?.length ?? 0;
  const types = normalized.match(/(?:^|[\s>+~])a(?=[\s[:.#]|$)/gu)?.length ?? 0;

  return [ids, classes + attributes + pseudoClasses, types];
}

function compareCascade(left, right) {
  if (left.important !== right.important) return left.important ? 1 : -1;
  for (let index = 0; index < left.specificity.length; index += 1) {
    if (left.specificity[index] !== right.specificity[index]) {
      return left.specificity[index] - right.specificity[index];
    }
  }
  return left.order - right.order;
}
