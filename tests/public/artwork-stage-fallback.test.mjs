import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as stageHelpers from "../../lib/public-artwork-stage.ts";

const source = await readFile(new URL("../../app/_components/PublicArtworkMotion.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${source}\nexport { enhanceStage };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("failed-image fallback inserted before decode rejection activates once without another scroll", async () => {
  let rejectDecode;
  const pending = new Promise((_, reject) => { rejectDecode = reject; });
  const node = () => ({
    dataset: {}, attributes: {}, listeners: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
    removeEventListener(key) { delete this.listeners[key]; },
  });
  const articles = [0, 1].map(index => {
    const article = node();
    article.summary = node(); article.poster = node();
    article.image = { decode: () => index ? pending : Promise.resolve(), complete: true, naturalWidth: 800 };
    article.fallback = null;
    article.querySelector = selector => selector === "figure img" ? article.image
      : selector === ".home-artwork-fallback" ? article.fallback
      : selector === "[data-stage-summary]" ? article.summary : article.poster;
    return article;
  });
  const stage = { ...node(), querySelectorAll: () => articles };
  const fallbackObservers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; fallbackObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  class IntersectionObserver { observe() {} disconnect() {} }
  const timers = new Map(); let timerId = 0;
  const exports = {};
  vm.runInNewContext(code, {
    exports, MutationObserver, IntersectionObserver,
    document: { activeElement: null },
    window: { innerHeight: 900, setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) },
    require: name => name.endsWith("public-artwork-stage") ? stageHelpers
      : name.endsWith("public-artwork-motion") ? { PUBLIC_ARTWORK_MOTION: { artworkDurationMs: 560 } } : {},
  });
  const cleanup = exports.enhanceStage(stage, new WeakSet());
  articles[1].listeners.focusin();
  assert.equal(articles[0].dataset.stageState, "active");
  articles[1].image = null;
  articles[1].fallback = {};
  fallbackObservers[0].callback();
  rejectDecode(new Error("image failed"));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(articles[1].dataset.stageState, "active");
  assert.equal(articles[1].summary.attributes["aria-current"], "true");
  assert.equal(articles[1].poster.attributes["aria-hidden"], "false");
  assert.equal(articles[0].dataset.stageState, "idle");
  assert.equal(timers.size, 0, "fallback must not animate or retain a decode timer");
  cleanup();
  assert.equal(fallbackObservers[0].disconnected, true);
  assert.equal(Object.keys(stage.listeners).length, 0);
  assert.equal(Object.keys(articles[1].listeners).length, 0);
});
