import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import test from "node:test";
import braces from "../../vendor/braces-safe/index.js";

const require = createRequire(import.meta.url);
const nesting = (depth, open = "{", close = "}") =>
  open.repeat(depth) + "a" + close.repeat(depth);

test("transitive braces consumers resolve to the reviewed local derivative", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.devDependencies.braces, "file:vendor/braces-safe");
  assert.equal(packageJson.overrides.braces, "$braces");
  assert.equal(realpathSync(require.resolve("braces")), realpathSync("vendor/braces-safe/index.js"));
  const micromatchRequire = createRequire(require.resolve("micromatch"));
  assert.equal(realpathSync(micromatchRequire.resolve("braces")), realpathSync("vendor/braces-safe/index.js"));
});

test("the braces derivative records truthful upstream and security provenance", () => {
  const metadata = JSON.parse(readFileSync("vendor/braces-safe/package.json", "utf8"));
  assert.equal(metadata.version, "3.0.3-vcc.1");
  assert.equal(metadata.license, "MIT");
  const readme = readFileSync("vendor/braces-safe/README.md", "utf8");
  assert.match(readme, /28d440b5dd449dbf1fe6f3506cf94ecca4d02660/u);
  assert.match(readme, /not an upstream patched/u);
  assert.match(readFileSync("vendor/braces-safe/LICENSE", "utf8"), /MIT License/u);
});

test("all public string paths enforce brace and parenthesis nesting before stack exhaustion", () => {
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    for (const method of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.doesNotThrow(() => method(nesting(100, open, close)));
      for (const depth of [101, 1_000, 4_000]) {
        assert.throws(() => method(nesting(depth, open, close)), /exceeds max depth/u);
      }
      for (const options of [{ maxDepth: 1_000_000 }, { maxDepth: Infinity }, { maxDepth: NaN }]) {
        assert.throws(() => method(nesting(101, open, close), options), /exceeds max depth/u);
      }
      assert.throws(() => method(nesting(2, open, close), { maxDepth: 1.5 }), /exceeds max depth/u);
    }
  }
});

test("malformed nested input and oversized input cannot evade the hard parser bounds", () => {
  for (const method of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => method("{".repeat(101) + "a"), /exceeds max depth/u);
    assert.throws(() => method("(".repeat(101) + "a"), /exceeds max depth/u);
    for (const maxLength of [undefined, NaN, Infinity, 1_000_000]) {
      assert.throws(() => method("a".repeat(10_001), { maxLength }), /exceeds max characters/u);
    }
  }
});

test("direct AST inputs are checked iteratively for depth, size, and cycles", () => {
  for (const method of [braces.compile, braces.expand, braces.stringify]) {
    let deep = { type: "text", value: "a" };
    for (let index = 0; index < 10_000; index++) deep = { type: "brace", nodes: [deep] };
    assert.throws(() => method({ type: "root", nodes: [deep] }), /maximum nesting depth/u);
    const cyclic = { type: "root", nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => method(cyclic), /cyclic nodes/u);
    const wide = { type: "root", nodes: Array.from({ length: 10_001 }, () => ({ type: "text", value: "a" })) };
    assert.throws(() => method(wide), /maximum node count/u);
    assert.throws(() => method({ type: "text", value: "a".repeat(10_001) }), /maximum text length/u);
    assert.doesNotThrow(() => method(braces.parse(nesting(100))));
    assert.throws(() => method(braces.parse(nesting(2)), { maxDepth: 1.5 }), /exceeds max depth/u);
  }
});

test("expansion rejects cyclic caller-controlled AST parent chains", () => {
  const ast = braces.parse("(a)");
  const paren = ast.nodes.find((node) => node.type === "paren");
  paren.parent = paren;
  assert.throws(() => braces.expand(ast), /parent chain contains a cycle/u);
});

test("AST scalar fields reject nested arrays and objects before implicit coercion", () => {
  let nested = ["a"];
  for (let index = 0; index < 10_000; index++) nested = [nested];
  const object = { toString() { throw new Error("AST value coercion must never run"); } };
  for (const method of [braces.compile, braces.expand, braces.stringify]) {
    for (const value of [nested, object]) {
      assert.throws(() => method({ type: "text", value }), /Expected an AST node value string/u);
    }
    for (const field of ["ranges", "commas"]) {
      for (const value of [nested, object, Infinity, NaN, -1, 100_001]) {
        const ast = braces.parse("{a,b}");
        ast.nodes.find((node) => node.type === "brace")[field] = value;
        assert.throws(() => method(ast), /bounded integer AST range\/comma metadata/u);
      }
    }
  }
});

test("ordinary expansion, compilation, escaping, and stricter limits remain compatible", () => {
  assert.deepEqual(braces.expand("src/{app,lib}/**/*.{ts,tsx}"), [
    "src/app/**/*.ts", "src/app/**/*.tsx", "src/lib/**/*.ts", "src/lib/**/*.tsx",
  ]);
  assert.deepEqual(braces.expand("file-{01..03}.ts"), ["file-01.ts", "file-02.ts", "file-03.ts"]);
  assert.equal(braces.compile("a/{b,c}/d"), "a/(b|c)/d");
  assert.deepEqual(braces(["{a,b}", "{b,c}"], { expand: true, nodupes: true }), ["a", "b", "c"]);
  assert.equal(braces.stringify(braces.parse("{{a}}"), { escapeInvalid: true }), "{{a}}");
  assert.equal(braces.stringify("{1..8}", { escapeInvalid: true }), "{1..8}");
  assert.doesNotThrow(() => braces.compile("\\{".repeat(200)));
  assert.throws(() => braces.expand("{1..1001}"), /range limit/u);
  assert.throws(() => braces.parse("abcd", { maxLength: 3 }), /max characters/u);
  // Consumers use the same braces CommonJS interface; run again after install
  // so normal glob behavior is checked with the package override in place.
  const micromatch = require("micromatch");
  assert.deepEqual(micromatch(["a.ts", "b.tsx", "c.js"], "*.{ts,tsx}"), ["a.ts", "b.tsx"]);
});
