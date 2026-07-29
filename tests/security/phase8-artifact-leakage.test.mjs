import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, extname, join, relative } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const CLIENT = join(DIST, "client");
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".sql",
  ".txt",
]);
const TEXT_NAMES = new Set([".assetsignore", "_headers"]);

function filesUnder(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  return files.sort();
}

function textFilesUnder(root) {
  return filesUnder(root).filter(
    (file) =>
      TEXT_EXTENSIONS.has(extname(file).toLowerCase()) ||
      TEXT_NAMES.has(basename(file)),
  );
}

function joinedText(root) {
  return textFilesUnder(root)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function source(...segments) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

function appTargetForPath(pathname) {
  if (pathname === "/") return "app/page.tsx";
  if (pathname.startsWith("/templates/")) {
    return `public${pathname}`;
  }
  const route = pathname.slice(1);
  for (const candidate of [
    `app/${route}/page.tsx`,
    `app/${route}/route.ts`,
  ]) {
    if (existsSync(join(ROOT, candidate))) return candidate;
  }
  return null;
}

test(
  "built artifact contains only intended package roots and no debug residue",
  { skip: !existsSync(DIST) },
  () => {
    assert.deepEqual(
      readdirSync(DIST, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
      [".openai", "client", "server"],
    );

    const relativeFiles = filesUnder(DIST).map((file) =>
      relative(DIST, file).replaceAll("\\", "/"),
    );
    assert.ok(relativeFiles.length > 0);
    for (const file of relativeFiles) {
      assert.doesNotMatch(file, /\.map$/iu);
      assert.doesNotMatch(
        file,
        /(?:^|\/)(?:__mocks__|debug|fixtures?|mocks?|tests?)(?:\/|[._-])/iu,
      );
      assert.doesNotMatch(file, /(?:^|\/)\.env(?:\.|$)/iu);
      assert.doesNotMatch(file, /\.(?:db|log|sqlite|sqlite3)$/iu);
      assert.doesNotMatch(file, /\.(?:ts|tsx)$/iu);
    }

    assert.deepEqual(
      JSON.parse(source("dist", ".openai", "hosting.json")),
      {
        project_id: "appgprj_6a62eaf79c4881919bb8e47998af851a",
        d1: "DB",
        r2: "MEDIA",
      },
    );

    const wrangler = JSON.parse(source("dist", "server", "wrangler.json"));
    assert.deepEqual(wrangler.vars, {});
    assert.deepEqual(
      wrangler.d1_databases.map(({ binding }) => binding),
      ["DB"],
    );
    assert.deepEqual(
      wrangler.r2_buckets.map(({ binding }) => binding),
      ["MEDIA"],
    );
    assert.deepEqual(wrangler.secrets_store_secrets, []);
  },
);

test(
  "built text is free of source maps, local paths, identities, and private sentinels",
  { skip: !existsSync(DIST) },
  () => {
    const text = joinedText(DIST);
    for (const pattern of [
      /sourceMappingURL/iu,
      /sourcesContent/iu,
      /webpack:\/\//iu,
      /vite:\/\//iu,
      /[A-Z]:[\\/](?:Documents|Users)[\\/]/iu,
      /\/(?:Users|home)\/[^/"'\s<]+/iu,
      /C:[\\/]Users[\\/]user[\\/]Documents[\\/]Website/iu,
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    ]) {
      assert.doesNotMatch(text, pattern);
    }

    for (const sentinel of [
      "PRIVATE-R2-KEY-SENTINEL",
      "PRIVATE-FEED-SENTINEL",
      "ZOOM-CREDENTIAL-SENTINEL",
      "NESTED-TOKEN-SENTINEL",
      "PRIVATE-NOTE-SENTINEL",
      "CONFLICT-REASON-SENTINEL",
      "PROVIDER-IDENTITY-SENTINEL",
      "RUNTIME-VALUE-SENTINEL",
    ]) {
      assert.equal(text.includes(sentinel), false, sentinel);
    }

    for (const mojibake of ["Â·", "â€¦", "â€”", "ï¿½", "�"]) {
      assert.equal(text.includes(mojibake), false, mojibake);
    }
  },
);

test(
  "browser bundles contain no server-only schema, identity, or build secret",
  { skip: !existsSync(DIST) },
  () => {
    const clientText = joinedText(CLIENT);
    const serverConfig = JSON.parse(
      source("dist", "server", "vinext-server.json"),
    );
    const ssrConfig = JSON.parse(
      source("dist", "server", "ssr", "vinext-server.json"),
    );
    assert.match(serverConfig.prerenderSecret, /^[0-9a-f]{64}$/u);
    assert.equal(ssrConfig.prerenderSecret, serverConfig.prerenderSecret);

    for (const forbidden of [
      serverConfig.prerenderSecret,
      "INITIAL_OWNER_EMAIL",
      "oai-authenticated-user",
      "oai-authenticated-user-email",
      "siwc_subject",
      "token_hash",
      "source_feed_url",
      "object_key",
      "form_submissions",
      "form_submission_notes",
      "public_form_protection_keys",
      "public_form_rate_windows",
      "audit_logs",
      "organization_memberships",
      "site-creator-d1",
      "site-creator-r2",
    ]) {
      assert.equal(clientText.includes(forbidden), false, forbidden);
    }
  },
);

test(
  "shipped import downloads contain only the template header and field guide",
  { skip: !existsSync(DIST) },
  () => {
    const template = source(
      "dist",
      "client",
      "templates",
      "vcc-event-import-v1.csv",
    );
    const guide = source(
      "dist",
      "client",
      "templates",
      "vcc-event-import-v1-field-guide.txt",
    );
    const nonblankRows = template
      .split(/\r?\n/gu)
      .filter((row) => row.trim().length > 0);
    assert.equal(nonblankRows.length, 1);
    assert.equal(nonblankRows[0].split(",").length, 25);
    assert.doesNotMatch(template, /@|https?:\/\//iu);
    assert.doesNotMatch(guide, /@|https?:\/\//iu);
    assert.match(guide, /contains only the\s+canonical header row/iu);
    assert.match(guide, /Remote URLs, Excel, JSON, ICS, XML, HTML, ZIP/iu);
  },
);

test("literal internal links and download targets resolve to source routes", () => {
  const appFiles = filesUnder(join(ROOT, "app")).filter((file) =>
    /\.(?:ts|tsx)$/u.test(file),
  );
  const paths = new Set();
  const patterns = [
    /href\s*=\s*["'](\/[^"'#?]*)/gu,
    /(?:exportHref|fetch|new URL)\s*\(\s*["'](\/[^"'#?]*)/gu,
    /download\s*\(\s*["'][^"']+["']\s*,\s*["'](\/[^"'#?]*)/gu,
  ];
  for (const file of appFiles) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) paths.add(match[1]);
    }
  }

  assert.ok(paths.size >= 30);
  for (const pathname of paths) {
    assert.ok(
      appTargetForPath(pathname),
      `No page, route, or public file resolves ${pathname}`,
    );
  }

  for (const dynamicTarget of [
    "app/api/organizer/exports/media/[id]/original/route.ts",
    "app/clubs/[slug]/page.tsx",
    "app/clubs/[slug]/programs/[programSlug]/page.tsx",
    "app/events/[slug]/calendar.ics/route.ts",
    "app/events/[slug]/page.tsx",
    "app/organizer/content/revisions/[id]/page.tsx",
    "app/organizer/events/[id]/page.tsx",
    "app/organizer/events/[id]/preview/page.tsx",
    "app/organizer/imports/[id]/page.tsx",
    "app/organizer/media/[id]/page.tsx",
    "app/organizer/submissions/[id]/page.tsx",
  ]) {
    assert.equal(existsSync(join(ROOT, dynamicTarget)), true, dynamicTarget);
  }
});

test("anonymous media, export, sitemap, and form routes use explicit boundaries", () => {
  const mediaRoute = source("app", "media", "[id]", "[variant]", "route.ts");
  assert.match(mediaRoute, /getPublicMediaVariant/u);
  assert.match(mediaRoute, /route: "\/media\/\[id\]\/\[variant\]"/u);
  assert.doesNotMatch(mediaRoute, /object_key|objectKey/u);

  const mediaService = source("lib", "server", "media", "storage.ts");
  const publicMediaStart = mediaService.indexOf(
    "export async function getPublicMediaVariant",
  );
  const privateMediaStart = mediaService.indexOf(
    "export async function getPrivateMediaVariant",
    publicMediaStart,
  );
  const publicMedia = mediaService.slice(publicMediaStart, privateMediaStart);
  const publicReturn = publicMedia.match(
    /return Object\.freeze\(\{\s*body,\s*etag: row\.sha256,\s*mimeType: row\.mimeType,\s*\}\);/su,
  );
  assert.ok(publicReturn);
  assert.doesNotMatch(publicReturn[0], /objectKey|object_key/u);

  const exports = source(
    "lib",
    "server",
    "phase7",
    "public-exports.ts",
  );
  for (const field of [
    '"title"',
    '"public_url"',
    '"club"',
    '"program"',
    '"lane"',
    '"category"',
    '"public_venue"',
    '"public_rsvp_url"',
    '"status"',
  ]) {
    assert.ok(exports.includes(field), field);
  }
  assert.doesNotMatch(
    exports,
    /JSON\.stringify\s*\(\s*(?:event|record|row)/u,
  );

  const sitemap = source("app", "sitemap.ts");
  assert.match(sitemap, /listPublicCatalogSitemapEntries/u);
  assert.match(sitemap, /listPublicEventSitemapEntries/u);
  assert.doesNotMatch(sitemap, /organizer_events|form_submissions|audit_logs/u);

  const formSubmit = source(
    "app",
    "api",
    "forms",
    "[formKey]",
    "route.ts",
  );
  assert.match(formSubmit, /publicReference: result\.publicReference/u);
  assert.match(formSubmit, /stored: true/u);
  assert.doesNotMatch(
    formSubmit,
    /JSON\.stringify\s*\(\s*(?:result|row|submission)/u,
  );
});
