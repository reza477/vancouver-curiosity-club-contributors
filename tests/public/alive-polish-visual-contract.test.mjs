import assert from "node:assert/strict";
import test from "node:test";

import postcss from "postcss";

import { readPublicCss } from "../helpers/public-css.mjs";

test("event polish adds lane warmth and print shadows without recropping posters", async () => {
  const root = postcss.parse(await readPublicCss());

  assert.equal(
    lastDeclaration(root, ".event-card:before", "background"),
    "color-mix(in srgb, var(--event-accent) 10%, var(--paper))",
  );
  for (const [selector, shadow] of [
    [
      ".event-card__artwork",
      "0.35rem 0.35rem 0 var(--event-accent)",
    ],
    [".home-hero__poster", "0.35rem 0.35rem 0 var(--amber)"],
    [
      ".event-detail__lead > .event-detail__artwork",
      "0.35rem 0.35rem 0 var(--amber)",
    ],
  ]) {
    assert.equal(lastDeclaration(root, selector, "box-shadow"), shadow);
  }

  root.walkRules((rule) => {
    if (
      !rule.selectors.some((selector) =>
        /(?:event-card__artwork|event-detail__artwork|home-hero__poster) img/u.test(
          selector,
        ),
      )
    ) {
      return;
    }
    rule.walkDecls("transform", (declaration) => {
      assert.doesNotMatch(
        declaration.value,
        /(?:scale|rotate)\(/u,
        `${rule.selector} must keep poster lettering uncropped and level`,
      );
    });
  });
});

test("arrow and primary-action movement exists only for visitors who allow motion", async () => {
  const root = postcss.parse(await readPublicCss());
  const expectedTransforms = new Map([
    [
      ".event-card:hover .event-card__arrow",
      "translateX(2px)",
    ],
    [".event-card:focus-within .event-card__arrow", "translateX(2px)"],
    [".primary-action:hover", "translateY(-1px)"],
    [".primary-action:focus-visible", "translateY(-1px)"],
    [".primary-action:active", "translateY(1px)"],
  ]);
  const found = new Set();

  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      const expected = expectedTransforms.get(selector);
      if (!expected) continue;
      const transform = rule.nodes.find(
        (node) => node.type === "decl" && node.prop === "transform",
      );
      if (!transform) continue;
      assert.equal(transform.value, expected);
      assert.ok(
        isInsideMotionPreference(rule, "no-preference"),
        `${selector} movement must be gated behind no-preference`,
      );
      found.add(selector);
    }
  });

  assert.deepEqual(found, new Set(expectedTransforms.keys()));
  assert.equal(
    lastDeclaration(root, ".primary-action", "box-shadow"),
    "var(--public-button-shadow)",
  );
  assert.ok(
    [...root.nodes].some(
      (node) =>
        node.type === "atrule" &&
        node.name === "media" &&
        node.params === "(prefers-reduced-motion: reduce)",
    ),
    "the public stylesheet must retain an explicit reduced-motion boundary",
  );
});

function lastDeclaration(root, selector, property) {
  let value = null;
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (declaration) => {
      value = declaration.value;
    });
  });
  assert.ok(value, `missing ${property} for ${selector}`);
  return value;
}

function isInsideMotionPreference(rule, preference) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (
      parent.type === "atrule" &&
      parent.name === "media" &&
      parent.params === `(prefers-reduced-motion: ${preference})`
    ) {
      return true;
    }
  }
  return false;
}
