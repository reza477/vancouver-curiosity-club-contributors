import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";

const projectRoot = new URL("../../", import.meta.url);
const directImportsSupported = typeof nodeModule.registerHooks === "function";
if (directImportsSupported) {
  const cloudflareWorkersShim = dataModule("export const env = {};");
  const serverOnlyShim = dataModule("export {};");
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "cloudflare:workers") {
        return { shortCircuit: true, url: cloudflareWorkersShim };
      }
      if (specifier === "server-only") {
        return { shortCircuit: true, url: serverOnlyShim };
      }
      return nextResolve(specifier, context);
    },
  });
}
const routeBodies = directImportsSupported
  ? await import(
      "../../app/_components/EditorialRouteBodies.tsx?accessibility-accountability-test"
    )
  : null;
const directImportOptions = directImportsSupported
  ? {}
  : { skip: "Route rendering requires node:module registerHooks." };
const accessibilityDefinition = PUBLIC_CATALOG_PAGES.find(
  (page) => page.slug === "accessibility",
);
assert.ok(accessibilityDefinition, "the public Accessibility page must exist");

test("the public and organizer-preview Accessibility route share one accountable statement", directImportOptions, async () => {
  const { AccessibilityRouteBody } = routeBodies;
  const [markup, routeSource, previewSource] = await Promise.all([
    render(
      createElement(AccessibilityRouteBody, {
        page: {
          metaDescription: null,
          openGraphAssetId: null,
          sections: accessibilityDefinition.sections,
          seoTitle: null,
          slug: accessibilityDefinition.slug,
          title: accessibilityDefinition.title,
        },
        previewCommunityLinks: [],
        previewMediaAssets: [],
        privatePreview: true,
      }),
    ),
    readFile(new URL("app/accessibility/page.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_organizer/PublicPreviewShell.tsx", projectRoot),
      "utf8",
    ),
  ]);

  assert.match(markup, /We aim to meet WCAG 2\.2 Level AA\./u);
  assert.match(
    markup,
    /<time dateTime="2026-08-12">August 12, 2026<\/time>/u,
    "the statement needs a semantic, visible review date",
  );
  assert.match(markup, /<h3>Known limitations<\/h3>/u);
  assert.match(
    markup,
    /event listings do not yet include venue-access details/u,
  );
  assert.match(markup, /external RSVP destinations/u);
  assert.match(markup, /<a[^>]*href="\/contact"[^>]*>Contact form<\/a>/u);

  assert.match(routeSource, /<AccessibilityRouteBody page=\{loaded\.page\} \/>/u);
  assert.match(
    previewSource,
    /snapshot\.slug === "accessibility"[\s\S]*<AccessibilityRouteBody[\s\S]*privatePreview/u,
    "the organizer preview must render the same statement as the public route",
  );
});

async function render(element) {
  const stream = await renderToReadableStream(element);
  return new Response(stream).text();
}

function dataModule(sourceText) {
  return `data:text/javascript,${encodeURIComponent(sourceText)}`;
}
