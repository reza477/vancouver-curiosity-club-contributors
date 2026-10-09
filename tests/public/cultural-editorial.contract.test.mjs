import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

function declarations(css, selector, property) {
  const values = [];
  postcss.parse(css).walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls(property, (declaration) => values.push(declaration.value));
    }
  });
  return values;
}

test("the programme is an open, ruled index with a natural phone reading order", async () => {
  const css = await source("app/styles/pages/home.css");
  assert.deepEqual(declarations(css, ".home-program", "background"), ["transparent"]);
  assert.deepEqual(declarations(css, ".home-program", "border-bottom"), ["1px solid var(--line)"]);
  assert.ok(declarations(css, ".home-programs", "grid-template-columns").includes("minmax(0, 1fr)"));
  assert.ok(declarations(css, ".home-program", "grid-template-columns").includes("minmax(0, 1fr)"));
  assert.match(css, /@media \(max-width: 56rem\)[\s\S]*?\.home-programs,[^{}]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u);
  assert.match(css, /@media \(max-width: 42rem\)[\s\S]*?\.home-program > a\s*\{[^}]*grid-column:\s*1;/u);
  assert.doesNotMatch(css, /\.home-program:nth-child\(even\)\s*\{[^}]*width:\s*(?:88|94)%;/u);
});

test("community expansion never hides descriptions, links, or the full artwork", async () => {
  const css = await source("app/styles/pages/home.css");
  assert.deepEqual(declarations(css, ".home-community__details", "grid-template-rows"), ["minmax(0, 1fr)"]);
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (!/home-community__(?:details|links)/u.test(rule.selector)) return;
    rule.walkDecls((declaration) => {
      assert.notEqual(`${declaration.prop}:${declaration.value}`, "visibility:hidden");
      assert.notEqual(`${declaration.prop}:${declaration.value}`, "grid-template-rows:0fr");
    });
  });
  for (const value of declarations(css, ".home-community__artwork img", "object-fit")) {
    assert.equal(value, "contain");
  }
  for (const value of declarations(css, ".home-community__artwork img", "height")) {
    assert.equal(value, "auto");
  }
  assert.match(css, /\.home-community:is\(:hover, :focus-within\)\s*\{[^}]*flex-grow:/u);
});

test("the paper-led section rhythm leaves emphasis to artwork and the navy identity band", async () => {
  const css = await source("app/styles/pages/home.css");
  for (const selector of [".home-programs", ".home-feedback", ".home-impact", ".home-public-invitation"]) {
    assert.deepEqual(declarations(css, selector, "background"), ["var(--paper)"]);
  }
  assert.equal(declarations(css, ".home-glance", "background")[0], "var(--ink)");
  assert.equal(declarations(css, ".home-glance", "color")[0], "var(--paper)");
  assert.deepEqual(declarations(css, ".home-hero__poster", "box-shadow"), ["none"]);
});

test("About posters have natural dimensions without dark equal-height frames", async () => {
  const css = await source("public/styles/about.css");
  assert.deepEqual(declarations(css, ".about-artwork-strip", "align-items"), ["start"]);
  assert.deepEqual(declarations(css, ".about-artwork-strip", "background"), ["var(--paper)"]);
  assert.deepEqual(declarations(css, ".about-artwork-strip img", "height"), ["auto"]);
  assert.match(css, /@media \(max-width: 44rem\)[\s\S]*?\.about-artwork-strip figure:nth-child\(2\)\s*\{[^}]*margin-top:\s*0;/u);
});
