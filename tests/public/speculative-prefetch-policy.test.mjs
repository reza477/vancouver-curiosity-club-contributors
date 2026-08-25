import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isExpensivePublicRouteHref,
  publicRoutePrefetch,
} from "../../lib/public-prefetch.ts";
import { canLinkPrefetch } from "../../node_modules/vinext/dist/shims/link-prefetch.js";

const projectRoot = new URL("../../", import.meta.url);

test("only data-heavy public route families disable speculative prefetch", () => {
  for (const href of [
    "/",
    "/contact",
    "/contact?topic=partnerships#contact-form",
    "/calendar",
    "/calendar/",
    "/calendar?month=2026-08",
    "/events",
    "/events?state=past",
    "/events/summer-picnic",
    "/clubs",
    "/clubs/fantasy-and-sci-fi",
    "/clubs/fantasy-and-sci-fi/programs/book-club",
    "/for-organizations",
    { pathname: "/events" },
  ]) {
    assert.equal(isExpensivePublicRouteHref(href), true, String(href));
    assert.equal(publicRoutePrefetch(href, true), false, String(href));
  }

  for (const href of [
    "/about",
    "/get-involved",
    "/conduct",
    "/privacy",
    "/host-an-event",
    "https://www.meetup.com/example",
  ]) {
    assert.equal(isExpensivePublicRouteHref(href), false, String(href));
    assert.equal(
      publicRoutePrefetch(href, true),
      "auto",
      `${String(href)} should retain ordinary automatic prefetch`,
    );
  }

  assert.equal(
    publicRoutePrefetch("/about", false),
    false,
    "the organizer preview's explicit global opt-out must win",
  );
  assert.equal(
    publicRoutePrefetch("#new-here"),
    false,
    "an in-page anchor must not speculate on the current route",
  );
});

test("every public component that can emit an expensive href uses the policy link", async () => {
  const paths = [
    "app/about/page.tsx",
    "app/error.tsx",
    "app/events/[slug]/page.tsx",
    "app/for-organizations/page.tsx",
    "app/not-found.tsx",
    "app/page.tsx",
    "app/_components/Breadcrumbs.tsx",
    "app/_components/ClubDetailRenderer.tsx",
    "app/_components/ClubDirectory.tsx",
    "app/_components/ClubEventList.tsx",
    "app/_components/EditorialRouteBodies.tsx",
    "app/_components/EditorialPage.tsx",
    "app/_components/EventCard.tsx",
    "app/_components/EventFilters.tsx",
    "app/_components/EventsPageRenderer.tsx",
    "app/_components/HomePageRenderer.tsx",
    "app/_components/ProgramDetailRenderer.tsx",
    "app/_components/PublicEventDetailRenderer.tsx",
    "app/_components/PublicFormPrivacyNotice.tsx",
    "app/_components/PublicMonthCalendar.tsx",
    "app/_components/SiteFooter.tsx",
    "app/_components/SiteHeader.tsx",
  ];

  for (const path of paths) {
    const source = await readFile(new URL(path, projectRoot), "utf8");
    assert.match(
      source,
      /import \{ PublicRouteLink as Link \} from ["']@\/app\/_components\/PublicRouteLink["'];/u,
      `${path} must route its internal links through the public prefetch policy`,
    );
    assert.doesNotMatch(
      source,
      /import Link from ["']next\/link["'];/u,
      `${path} must not bypass the public prefetch policy`,
    );
  }
});

test("pending Vinext RSC prefetch duplication is removed for expensive destinations", async () => {
  const [linkSource, navigationSource, browserSource] = await Promise.all([
    readFile(
      new URL("node_modules/vinext/dist/shims/link.js", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("node_modules/vinext/dist/shims/navigation.js", projectRoot),
      "utf8",
    ),
    readFile(
      new URL(
        "node_modules/vinext/dist/server/app-browser-entry.js",
        projectRoot,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    linkSource,
    /if \(isDangerous \|\| prefetchProp === false\) return "disabled";/u,
    "the installed Vinext must honor an explicit Link prefetch opt-out",
  );
  assert.match(
    navigationSource,
    /if \(entry\.pending \|\| entry\.outcome !== "cache-seeded"\) return null;/u,
    "this contract targets Vinext's pending-prefetch cache miss",
  );
  assert.match(
    browserSource,
    /consumePrefetchResponse\([\s\S]*?if \(!navResponse\) navResponse = await fetch\(rscUrl,/u,
    "a click during a pending prefetch must be proven to start another RSC fetch",
  );

  const before = instrumentPendingNavigation(true);
  const after = instrumentPendingNavigation(
    publicRoutePrefetch("/events?view=calendar", true),
  );
  assert.deepEqual(before, ["prefetch", "navigation"]);
  assert.deepEqual(after, ["navigation"]);
  assert.equal(
    after.length,
    before.length - 1,
    "an expensive click must issue one RSC request instead of the former two-request waterfall",
  );

  assert.equal(publicRoutePrefetch("/about", true), "auto");
  assert.deepEqual(
    instrumentSettledNavigation("auto"),
    ["prefetch"],
    "a cheap route keeps automatic prefetch and reuses its settled response",
  );
});

function instrumentPendingNavigation(prefetch) {
  const requests = [];
  if (
    canLinkPrefetch({
      isDangerous: false,
      nodeEnv: "production",
      prefetch,
    })
  ) {
    requests.push("prefetch");
  }
  requests.push("navigation");
  return requests;
}

function instrumentSettledNavigation(prefetch) {
  const requests = [];
  if (
    canLinkPrefetch({
      isDangerous: false,
      nodeEnv: "production",
      prefetch,
    })
  ) {
    requests.push("prefetch");
  } else {
    requests.push("navigation");
  }
  return requests;
}
