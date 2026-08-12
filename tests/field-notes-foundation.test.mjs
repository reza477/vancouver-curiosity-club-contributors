import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("Field Notes carries the honest D1-backed Phase 2 public foundation", async () => {
  const [
    page,
    homeData,
    homeRenderer,
    layout,
    header,
    footer,
    catalog,
    requestCache,
    css,
    packageJson,
  ] =
    await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("lib/server/public/home.ts", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/HomePageRenderer.tsx", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(
      new URL("app/_components/SiteHeader.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("app/_components/SiteFooter.tsx", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("lib/server/public/catalog-definitions.ts", projectRoot),
      "utf8",
    ),
    readFile(
      new URL("lib/server/public/request-cache.ts", projectRoot),
      "utf8",
    ),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);

  assert.match(page, /import \{ HomePageRenderer \}/u);
  assert.match(page, /<HomePageRenderer/u);
  assert.doesNotMatch(page, /CalendarPage|PublicMonthCalendar/u);
  assert.match(homeRenderer, /<StructuredData/u);
  assert.doesNotMatch(page, /loadCommunityDestinations|sameAs/u);
  assert.match(homeData, /await getRequestPublicCatalog\(database\)/u);
  assert.match(requestCache, /import \{ cache \} from "react";/u);
  assert.match(
    requestCache,
    /getRequestPublicNavigation\s*=\s*cache\([\s\S]*?listPublicNavigation\(database\)/u,
  );
  assert.match(
    requestCache,
    /getRequestPublicCatalog\s*=\s*cache\([\s\S]*?getRequestPublicSiteContext\(database\)[\s\S]*?getRequestPublicLanes\(database\)[\s\S]*?getRequestPublicClubs\(database\)[\s\S]*?getRequestPublicCommunityLinks\(database\)[\s\S]*?getRequestPublicNavigation\(database\)/u,
  );
  assert.doesNotMatch(requestCache, /loadPublicCatalog/u);
  assert.match(
    homeData,
    /getRequestPublicPageContent\(database, "home"\)/u,
  );
  assert.match(
    requestCache,
    /getRequestPublicPageContent\s*=\s*cache\([\s\S]*?getPublicPageContent\(database, slug\)/u,
  );
  assert.match(homeData, /queryPublicEventSlice\(database, \{/u);
  assert.match(homeData, /pageSize:\s*6/u);
  assert.match(homeRenderer, /Books, films, ideas, walks & creative nights in Vancouver/u);
  assert.match(homeRenderer, /Come curious\. Leave knowing people\./u);
  assert.match(homeRenderer, /See upcoming gatherings/u);
  assert.match(homeRenderer, /New here\? Start here/u);
  assert.match(homeRenderer, /home-hero__poster-collage/u);
  assert.doesNotMatch(homeRenderer, /FieldArtwork/u);
  assert.match(catalog, /A social calendar with a brain\./);
  assert.match(catalog, /Vancouver Curiosity Club/);
  assert.match(layout, /Skip to main content/);
  assert.match(layout, /getRequestPublicNavigation\(database\)/u);
  assert.match(layout, /getRequestPublicSiteContext\(database\)/u);
  assert.doesNotMatch(layout, /getRequestPublicCatalog/u);
  assert.match(layout, /<SiteHeader[\s\S]*brandName=\{shell\?\.brandName\}/);
  assert.match(layout, /<SiteFooter/);
  assert.match(header, /aria-label="Primary navigation"/);
  const destinations = [
    ['{ href: "/events", label: "Events" }', "Events"],
    ['{ href: "/clubs", label: "Clubs" }', "Clubs"],
    ['{ href: "/about", label: "About" }', "About"],
    ['{ href: "/contact", label: "Feedback" }', "Feedback"],
  ];
  let previousDestination = -1;
  for (const [literal, label] of destinations) {
    const destination = header.indexOf(literal);
    assert.ok(destination > previousDestination, `${label} navigation order`);
    previousDestination = destination;
  }
  assert.doesNotMatch(header, /\{ href: "\/calendar", label: "Calendar" \}/u);
  assert.doesNotMatch(header, /\{ href: "\/get-involved", label: "Contribute" \}/u);
  assert.doesNotMatch(header, /\{ href: "\/community", label: "Community" \}/u);
  assert.doesNotMatch(header, /<details|site-navigation/u);
  assert.doesNotMatch(header, /Organizer Login/);
  assert.match(footer, /Organizer Login/);
  assert.doesNotMatch(footer, /\{ href: "\/community", label: "Community" \}/u);
  assert.match(footer, /item\.href === "\/community"/u);
  assert.doesNotMatch(
    catalog,
    /section\("(?:attending|invitation|community)"/u,
  );
  const homepageSections = [
    "home-hero",
    "home-events",
    "home-newcomer",
    "home-community-feel",
    "lane-index",
    "home-clubs",
    "home-proof",
    "home-closing",
  ];
  let previousSection = -1;
  for (const className of homepageSections) {
    const section = homeRenderer.indexOf(`className="${className}`);
    assert.ok(section > previousSection, `${className} section order`);
    previousSection = section;
  }
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /const isUnknownPath = !isKnownApplicationPath/);
  assert.match(layout, /robots:\s*isUnknownPath/);
  assert.match(layout, /index:\s*false/);
  assert.match(layout, /follow:\s*false/);
  assert.match(layout, /noarchive:\s*true/);
  assert.match(layout, /:\s*undefined/);
  assert.doesNotMatch(layout, /(?:^|\n)\s*index:\s*true/m);
  assert.doesNotMatch(layout, /follow:\s*true/);
  assert.doesNotMatch(
    layout,
    /\/og\.png/,
    "leaf routes own social metadata; root layout must not leak Home artwork",
  );
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--focus-ring-inner:\s*#000000/u);
  assert.match(css, /--focus-ring-outer:\s*#ffffff/u);
  assert.match(css, /--line:\s*var\(--ink\)/u);
  assert.match(css, /--paper-line:\s*var\(--paper\)/u);
  assert.match(
    css,
    /--ink-soft:\s*var\(--cms-foreground,\s*#514b68\)/u,
  );
  assert.match(css, /--warm-surface-ink:\s*#221c3d/u);
  assert.match(
    css,
    /outline:\s*0\.2rem solid var\(--focus-ring-inner\)/u,
  );
  assert.match(
    css,
    /box-shadow:\s*0 0 0 0\.42rem var\(--focus-ring-outer\)/u,
  );
  assert.doesNotMatch(
    css,
    /:focus-visible[\s\S]{0,180}var\(--coral\)/u,
  );
  for (const selector of [
    "::selection",
    ".agenda-card-meta .cancelled-badge",
    ".meetup-controls button:hover:not(:disabled)",
    ".status-chip--tentative",
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(
      css,
      new RegExp(
        `${escapedSelector}[\\s\\S]{0,260}color:\\s*var\\(--warm-surface-ink\\)`,
        "u",
      ),
    );
  }
  assert.match(
    css,
    /\.primary-nav a\[aria-current="page"\]\s*\{[^}]*background:\s*[^;]+;[^}]*color:\s*[^;]+;/su,
  );
  for (const selector of [".cancellation-banner", ".public-error-state"]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(
      css,
      new RegExp(
        `${escapedSelector}[\\s\\S]{0,260}background:\\s*var\\(--paper-deep\\)[\\s\\S]{0,120}color:\\s*var\\(--ink\\)`,
        "u",
      ),
    );
  }
  assert.match(
    css,
    /\.event-card__artwork figcaption,[\s\S]{0,340}background:\s*var\(--forest\);[\s\S]{0,80}color:\s*var\(--paper\)/u,
  );
  assert.match(
    css,
    /\.event-card::before[\s\S]{0,260}background:\s*var\(--paper-deep\)/u,
  );
  for (const selector of [
    ".calendar-state-label span",
    ".lane-dot",
    ".source-mark",
    ".source-status > span",
    ".status-chip--tentative",
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(
      css,
      new RegExp(
        `${escapedSelector}[\\s\\S]{0,220}border:\\s*2px solid var\\(--(?:paper|ink)\\)`,
        "u",
      ),
    );
  }
  assert.doesNotMatch(
    css,
    /color:\s*#(?:68c4be|c8d0d6|91a0ad|9ba8b4|aeb8c0|d4dade|e1e6e8|78ccc5|92dfd9)/iu,
    "dynamic ink surfaces must use the validated opposing paper token",
  );
  assert.doesNotMatch(
    css,
    /background:\s*rgba\((?:232,\s*91,\s*72|22,\s*34,\s*32|255,\s*255,\s*255)/iu,
    "text-bearing public surfaces must remain opaque and contrast-predictable",
  );
  for (const [selector, background, foreground] of [
    [".site-footer", "--cobalt", "--paper"],
    [".lane-index", "--paper-deep", "--ink"],
    [".community-destinations", "--forest", "--paper"],
    [".event-filters", "--ink", "--paper"],
    [".editorial-section--callout", "--ink", "--paper"],
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const blocks = [
      ...css.matchAll(
        new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "gu"),
      ),
    ];
    assert.ok(
      blocks.some(
        (match) =>
          new RegExp(`background:\\s*var\\(${background}\\)`, "u").test(
            match[1] ?? "",
          ) &&
          new RegExp(`color:\\s*var\\(${foreground}\\)`, "u").test(
            match[1] ?? "",
          ),
      ),
      `${selector} must use its validated modern surface pair`,
    );
  }
  assert.match(packageJson, /"name": "vancouver-curiosity-club"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(`${page}\n${homeRenderer}`, /SkeletonPreview|codex-preview/);

  assert.deepEqual(
    await readdir(new URL("app/_sites-preview", projectRoot)),
    [],
    "the disposable starter preview directory must remain empty",
  );
});

test("social assets are local PNGs with the expected dimensions", async () => {
  const assets = [
    ["public/og.png", 1200, 630],
    ["public/icon.png", 64, 64],
    ["public/apple-touch-icon.png", 180, 180],
  ];

  for (const [path, expectedWidth, expectedHeight] of assets) {
    const url = new URL(path, projectRoot);
    const [bytes, details] = await Promise.all([readFile(url), stat(url)]);

    assert.ok(details.size > 0, `${path} must not be empty`);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${path} must be a PNG`,
    );
    assert.equal(bytes.readUInt32BE(16), expectedWidth, `${path} width`);
    assert.equal(bytes.readUInt32BE(20), expectedHeight, `${path} height`);
  }
});

test("the worker applies a security and noindex header foundation", async () => {
  const [worker, requestPathname] = await Promise.all([
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
    readFile(new URL("lib/request-pathname.ts", projectRoot), "utf8"),
  ]);

  assert.match(worker, /Content-Security-Policy/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(worker, /base-uri 'none'/);
  assert.match(worker, /object-src 'none'/);
  assert.match(worker, /X-Content-Type-Options/);
  assert.match(worker, /X-Frame-Options/);
  assert.match(worker, /Permissions-Policy/);
  assert.match(worker, /Strict-Transport-Security/);
  assert.match(worker, /X-Robots-Tag/);
  assert.match(worker, /isPrivateOrIdentityPath/);
  assert.match(requestPathname, /"\/_sites-preview"/);
  assert.match(requestPathname, /"\/organizer"/);
  assert.match(requestPathname, /"\/api"/);
  assert.match(
    requestPathname,
    /pathname\.startsWith\(`\$\{path\}\/`\)/,
  );
  const invariantInitialization = worker.indexOf(
    "await ensureDatabaseInvariants(env.DB)",
  );
  const applicationDispatch = worker.indexOf("handler.fetch(");
  assert.ok(invariantInitialization >= 0);
  assert.ok(applicationDispatch > invariantInitialization);
  assert.match(worker, /database_invariants_unavailable/);
  assert.match(worker, /The site is temporarily unavailable\./);
});
