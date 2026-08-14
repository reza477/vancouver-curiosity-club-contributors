import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CANONICAL_PUBLIC_ORIGIN,
  canonicalPublicRedirectTarget,
  parsePublicSiteOrigin,
  resolvedPublicSiteOrigin,
  trustedPublicRequestOrigin,
} from "../../lib/public-domain.ts";

const ALTERNATE_PUBLIC_ORIGINS = [
  "https://www.vancouvercuriosityclub.com",
  "https://vancouvercuriosityclub.ca",
  "https://www.vancouvercuriosityclub.ca",
  "https://vancouver-curiosity-club.reza5777.chatgpt.site",
];
const projectRoot = new URL("../../", import.meta.url);

test("alternate public hosts permanently redirect to the apex .com", () => {
  for (const sourceOrigin of ALTERNATE_PUBLIC_ORIGINS) {
    const source = new URL(
      "/events/a-curious-night?lane=think&page=2",
      sourceOrigin,
    );
    assert.equal(
      canonicalPublicRedirectTarget(source)?.toString(),
      "https://vancouvercuriosityclub.com/events/a-curious-night?lane=think&page=2",
      sourceOrigin,
    );
  }
});

test("canonical host stays put while HTTP and nonstandard ports canonicalize", () => {
  const canonical = new URL(
    "/contact?topic=feedback",
    CANONICAL_PUBLIC_ORIGIN,
  );
  assert.equal(canonicalPublicRedirectTarget(canonical), null);

  for (const [source, destination] of [
    [
      "http://vancouvercuriosityclub.com/events//%61/?x=%2F&empty=",
      "https://vancouvercuriosityclub.com/events//%61/?x=%2F&empty=",
    ],
    [
      "https://vancouvercuriosityclub.com:8443/contact?topic=feedback",
      "https://vancouvercuriosityclub.com/contact?topic=feedback",
    ],
    [
      "http://www.vancouvercuriosityclub.com:8080/contact?topic=feedback",
      "https://vancouvercuriosityclub.com/contact?topic=feedback",
    ],
    [
      "https://www.vancouvercuriosityclub.ca:8443/events/%61?x=%2F",
      "https://vancouvercuriosityclub.com/events/%61?x=%2F",
    ],
  ]) {
    const redirected = canonicalPublicRedirectTarget(new URL(source));
    assert.equal(redirected?.toString(), destination, source);
    assert.equal(canonicalPublicRedirectTarget(redirected), null, source);
  }
});

test("only exact allowlisted hostnames redirect", () => {
  assert.equal(
    canonicalPublicRedirectTarget(
      new URL("https://www.vancouvercuriosityclub.com.evil.example/events"),
    ),
    null,
  );
});

test("production metadata uses .com while local rendering remains usable", () => {
  for (const requestOrigin of [
    "https://vancouvercuriosityclub.com",
    ...ALTERNATE_PUBLIC_ORIGINS,
    "https://another-sites-dispatch-host.example.net",
  ]) {
    assert.equal(
      trustedPublicRequestOrigin(new URL(requestOrigin)),
      CANONICAL_PUBLIC_ORIGIN,
      requestOrigin,
    );
  }

  assert.equal(
    trustedPublicRequestOrigin(new URL("https://preview.example")),
    "https://preview.example",
  );
  assert.equal(
    trustedPublicRequestOrigin(new URL("http://localhost:4173")),
    "http://localhost:4173",
  );
});

test("a strict PUBLIC_SITE_URL changes canonical redirects and production origins", () => {
  const configured = "https://events.example.org";
  assert.equal(parsePublicSiteOrigin(`${configured}/`), configured);
  assert.equal(resolvedPublicSiteOrigin(configured), configured);
  assert.equal(
    canonicalPublicRedirectTarget(
      new URL("https://www.events.example.org/events/a?lane=think"),
      configured,
    )?.toString(),
    "https://events.example.org/events/a?lane=think",
  );
  assert.equal(
    canonicalPublicRedirectTarget(
      new URL("https://vancouvercuriosityclub.com/contact?topic=feedback"),
      configured,
    )?.toString(),
    "https://events.example.org/contact?topic=feedback",
  );
  assert.equal(
    canonicalPublicRedirectTarget(
      new URL("https://events.example.org/events"),
      configured,
    ),
    null,
  );
  assert.equal(
    trustedPublicRequestOrigin(
      new URL("https://sites-dispatch.example.net"),
      configured,
    ),
    configured,
  );
});

test("invalid PUBLIC_SITE_URL values fail closed to the established .com apex", () => {
  for (const invalid of [
    undefined,
    "",
    " https://events.example.org",
    "http://events.example.org",
    "https://user:password@events.example.org",
    "https://events.example.org:8443",
    "https://events.example.org/path",
    "https://events.example.org?query=1",
    "https://events.example.org#fragment",
    "https://localhost",
  ]) {
    assert.equal(parsePublicSiteOrigin(invalid), null, String(invalid));
    assert.equal(
      resolvedPublicSiteOrigin(invalid),
      CANONICAL_PUBLIC_ORIGIN,
      String(invalid),
    );
  }
});

test("the runtime binding is threaded through the Worker and trusted origin seam", async () => {
  const [environment, origin, worker, ...absoluteRoutes] = await Promise.all([
    readFile(new URL(".env.example", projectRoot), "utf8"),
    readFile(new URL("lib/server/public/origin.ts", projectRoot), "utf8"),
    readFile(new URL("worker/index.ts", projectRoot), "utf8"),
    ...[
      "app/calendar/route.ts",
      "app/events/calendar.ics/route.ts",
      "app/events/events.csv/route.ts",
      "app/events/[slug]/calendar.ics/route.ts",
      "app/api/calendar/private/[token]/route.ts",
    ].map((path) => readFile(new URL(path, projectRoot), "utf8")),
  ]);

  assert.match(
    environment,
    /^PUBLIC_SITE_URL=https:\/\/vancouvercuriosityclub\.com$/mu,
  );
  assert.match(worker, /PUBLIC_SITE_URL\?:\s*string/u);
  assert.match(
    worker,
    /canonicalPublicRedirectTarget\(\s*url,\s*env\.PUBLIC_SITE_URL,?\s*\)/u,
  );
  assert.match(
    worker,
    /trustedPublicRequestOrigin\(url, env\.PUBLIC_SITE_URL\)/u,
  );
  assert.match(origin, /export async function getPublicRequestOrigin/u);
  assert.match(origin, /await getTrustedRequestOrigin\(\)/u);
  for (const route of absoluteRoutes) {
    assert.match(route, /getPublicRequestOrigin/u);
    assert.doesNotMatch(route, /trustedPublicRequestOrigin/u);
  }
});
