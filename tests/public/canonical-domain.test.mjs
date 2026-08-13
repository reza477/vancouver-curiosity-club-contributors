import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PUBLIC_ORIGIN,
  canonicalPublicRedirectTarget,
  trustedPublicRequestOrigin,
} from "../../lib/public-domain.ts";

test("alternate public hosts permanently redirect to the apex .com", () => {
  for (const sourceOrigin of [
    "https://www.vancouvercuriosityclub.com",
    "https://vancouvercuriosityclub.ca",
    "https://www.vancouvercuriosityclub.ca",
    "https://vancouver-curiosity-club.reza5777.chatgpt.site",
  ]) {
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

test("canonical host stays put while alias mutations and ports canonicalize", () => {
  const canonical = new URL(
    "/contact?topic=feedback",
    CANONICAL_PUBLIC_ORIGIN,
  );
  assert.equal(canonicalPublicRedirectTarget(canonical), null);
  assert.equal(
    canonicalPublicRedirectTarget(
      new URL(
        canonical.pathname,
        "http://www.vancouvercuriosityclub.com:8080",
      ),
    )?.toString(),
    "https://vancouvercuriosityclub.com/contact",
  );
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
    "https://www.vancouvercuriosityclub.com",
    "https://vancouvercuriosityclub.ca",
    "https://www.vancouvercuriosityclub.ca",
    "https://vancouver-curiosity-club.reza5777.chatgpt.site",
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
