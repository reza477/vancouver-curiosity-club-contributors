import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventPosterImage } from "../../app/_components/EventPosterImage.tsx";

const projectRoot = new URL("../../", import.meta.url);

test("event poster images render the real image before a load failure", () => {
  const markup = renderToStaticMarkup(
    createElement(EventPosterImage, {
      alt: "A usable event poster.",
      fallback: createElement(
        "div",
        { className: "event-artwork-fallback" },
        "Branded poster fallback",
      ),
      height: 270,
      src: "/event-posters/usable-poster.jpeg",
      width: 480,
    }),
  );

  assert.match(markup, /<img/u);
  assert.match(markup, /src="\/event-posters\/usable-poster\.jpeg"/u);
  assert.match(markup, /alt="A usable event poster\."/u);
  assert.doesNotMatch(markup, /Branded poster fallback/u);
});

test("a failed event poster switches to its supplied branded fallback", async () => {
  const source = await readFile(
    new URL("app/_components/EventPosterImage.tsx", projectRoot),
    "utf8",
  );

  assert.match(source, /^"use client";/u);
  assert.match(source, /useState/u);
  assert.match(
    source,
    /onError=\{[\s\S]{0,500}setFailed[A-Za-z]*\(/u,
    "the browser image error must record the failed poster source",
  );
  assert.match(
    source,
    /failed[A-Za-z]*\s*===\s*[A-Za-z]*src[A-Za-z]*/u,
    "failure state must be tied to the current src so a changed poster can retry",
  );
  assert.match(
    source,
    /(?:return\s+fallback|\?\s*fallback\s*:)/u,
    "a failed poster must visibly render the supplied branded fallback",
  );
});

test("every public event-poster surface uses the failure-aware image", async () => {
  const callsites = Object.freeze([
    Object.freeze({
      minimumUses: 1,
      path: "app/_components/EventCard.tsx",
    }),
    Object.freeze({
      minimumUses: 1,
      path: "app/_components/PublicEventDetailRenderer.tsx",
    }),
    Object.freeze({
      minimumUses: 2,
      path: "app/_components/PublicMonthCalendar.tsx",
    }),
    Object.freeze({
      minimumUses: 1,
      path: "app/_components/HomePageRenderer.tsx",
    }),
  ]);

  for (const { minimumUses, path } of callsites) {
    const source = await readFile(new URL(path, projectRoot), "utf8");
    assert.match(
      source,
      /import\s+\{\s*EventPosterImage\s*\}\s+from/u,
      `${path} must import the shared poster failure boundary`,
    );
    assert.ok(
      (source.match(/<EventPosterImage\b/gu) ?? []).length >= minimumUses,
      `${path} must route every event poster through EventPosterImage`,
    );
  }
});
