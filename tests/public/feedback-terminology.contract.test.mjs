import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePageRenderer } from "../../app/_components/HomePageRenderer.tsx";
import { PublicSubmissionForm } from "../../app/_components/PublicSubmissionForm.tsx";
import { SiteFooter } from "../../app/_components/SiteFooter.tsx";
import { publicFormLabel } from "../../lib/server/phase7/public-form-contract.ts";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";
import { buildPublicPageMetadataForOrigin } from "../../lib/server/public/metadata.ts";

const projectRoot = new URL("../../", import.meta.url);

test("the primary header remains exactly Events, Clubs, About, and Feedback", async () => {
  const header = await source("app/_components/SiteHeader.tsx");
  const requiredNavigation = header.match(
    /const requiredNavigation\s*=\s*\[([\s\S]*?)\]\s*as const;/u,
  )?.[1];
  assert.ok(requiredNavigation, "the required primary navigation must exist");

  const destinations = [...requiredNavigation.matchAll(
    /\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/gu,
  )].map((match) => ({ href: match[1], label: match[2] }));
  assert.deepEqual(destinations, [
    { href: "/events", label: "Events" },
    { href: "/clubs", label: "Clubs" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Feedback" },
  ]);
});

test("Feedback keeps the canonical contact route and complete public metadata", async () => {
  const [contactRoute, editorialPage] = await Promise.all([
    source("app/contact/page.tsx"),
    source("app/_components/EditorialPage.tsx"),
  ]);
  const feedbackPage = PUBLIC_CATALOG_PAGES.find(
    (page) => page.slug === "contact",
  );
  assert.ok(feedbackPage, "the contact-keyed public page must exist");
  const introduction = feedbackPage.sections.find((section) =>
    ["intro", "hero"].includes(section.type),
  );
  assert.ok(introduction, "Feedback must have an introduction");
  assert.equal(feedbackPage.title, "Feedback");
  assert.match(String(introduction.content.heading), /feedback/iu);
  assert.match(String(introduction.content.text), /feedback/iu);

  assert.match(contactRoute, /const route\s*=\s*"\/contact";/u);
  assert.match(contactRoute, /const slug\s*=\s*"contact";/u);
  assert.match(contactRoute, /formKey="contact"/u);
  assert.match(
    contactRoute,
    /buildEditorialMetadata\(\{[\s\S]*?fallbackTitle:\s*(?:"Feedback"|feedbackTitle),[\s\S]*?path:\s*route,[\s\S]*?route,[\s\S]*?slug,/u,
  );
  assert.match(
    contactRoute,
    /<ContactRouteBody page=\{(?:feedbackPage\()?loaded\.page\)?\}>/u,
  );

  assert.match(
    editorialPage,
    /<Breadcrumbs[\s\S]*?\{\s*label:\s*page\.title\s*\}/u,
    "the public breadcrumb must use the Feedback page title",
  );
  assert.match(
    editorialPage,
    /<PageMasthead[\s\S]*?title=\{introduction\?\.content\.heading\s*\?\?\s*page\.title\}/u,
    "the public H1 must use the Feedback introduction heading or title",
  );

  const description = String(introduction.content.text);
  const metadata = buildPublicPageMetadataForOrigin(
    {
      description,
      pathname: "/contact",
      title: feedbackPage.title,
    },
    new URL("https://preview.example"),
  );
  assert.equal(metadata.title, "Feedback");
  assert.equal(metadata.description, description);
  assert.equal(
    metadata.alternates?.canonical,
    "https://preview.example/contact",
  );
  assert.match(String(metadata.openGraph?.title), /^Feedback\b/u);
  assert.equal(metadata.openGraph?.description, description);
  assert.equal(metadata.openGraph?.url, "https://preview.example/contact");
  assert.match(String(metadata.twitter?.title), /^Feedback\b/u);
  assert.equal(metadata.twitter?.description, description);
});

test("the visitor form says Feedback while its private organizer key stays Contact", async () => {
  const [formSource, privateWorkspace] = await Promise.all([
    source("app/_components/PublicSubmissionForm.tsx"),
    source("app/_organizer/SubmissionWorkspace.tsx"),
  ]);
  const markup = renderToStaticMarkup(
    createElement(PublicSubmissionForm, { formKey: "contact" }),
  );

  assert.match(markup, /data-form-key="contact"/u);
  assert.match(markup, /<h2[^>]*>Feedback<\/h2>/u);
  assert.doesNotMatch(markup, /<h2[^>]*>Contact<\/h2>/u);
  assert.match(
    formSource,
    /case\s+"contact":\s*return\s+"Send feedback";/u,
    "the hydrated public form button must say Send feedback",
  );
  assert.equal(
    publicFormLabel("contact"),
    "Contact",
    "the stored form key and private organizer label must not be renamed",
  );
  assert.match(
    privateWorkspace,
    /publicFormLabel\(submission\.formKey\)/u,
    "the private submission workspace must retain the internal label helper",
  );
});

test("configured Contact footer copy is normalized to public Feedback", () => {
  const markup = renderToStaticMarkup(
    createElement(SiteFooter, {
      navigation: Object.freeze([
        Object.freeze({ href: "/contact", label: "Contact" }),
      ]),
    }),
  );
  assert.match(markup, /<a[^>]*href="\/contact"[^>]*>Feedback<\/a>/u);
  assert.doesNotMatch(markup, /<a[^>]*href="\/contact"[^>]*>Contact<\/a>/u);
});

test("the homepage exposes Get involved while its destination retains Host", async () => {
  const routeBodies = await source("app/_components/EditorialRouteBodies.tsx");
  const markup = renderToStaticMarkup(
    createElement(HomePageRenderer, {
      catalog: Object.freeze({
        clubs: Object.freeze([]),
        communityLinks: Object.freeze([]),
        lanes: Object.freeze([]),
        site: Object.freeze({ mission: "A thoughtful Vancouver community." }),
      }),
      events: Object.freeze([]),
      origin: null,
      page: Object.freeze({ slug: "home" }),
    }),
  );
  const main = markup.match(/<main\b[\s\S]*<\/main>/u)?.[0];
  assert.ok(main, "the homepage main must render");
  assert.match(main, /<a[^>]*href="\/get-involved"[^>]*>Get involved<\/a>/u);
  assert.match(
    routeBodies,
    /data-contribution-path="host"[\s\S]*?href="\/host-an-event"[\s\S]*?<strong>Host an event<\/strong>/u,
    "Get involved must continue to offer the Host an event path",
  );
});

async function source(pathname) {
  return readFile(new URL(pathname, projectRoot), "utf8");
}
