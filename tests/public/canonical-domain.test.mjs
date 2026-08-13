import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PUBLIC_ORIGIN,
  canonicalPublicRedirectTarget,
  trustedPublicRequestOrigin,
} from "../../lib/public-domain.ts";

const ALTERNATE_PUBLIC_ORIGINS = [
  "https://www.vancouvercuriosityclub.com",
  "https://vancouvercuriosityclub.ca",
  "https://www.vancouvercuriosityclub.ca",
  "https://vancouver-curiosity-club.reza5777.chatgpt.site",
];

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
