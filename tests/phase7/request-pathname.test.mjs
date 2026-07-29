import assert from "node:assert/strict";
import test from "node:test";
import {
  isCanonicalTrustedRequestPathname,
  MAX_TRUSTED_REQUEST_PATHNAME_LENGTH,
  normalizeEncodedRequestPathname,
} from "../../lib/request-pathname.ts";

test("request pathname normalization uses one strict canonical trust contract", () => {
  assert.equal(MAX_TRUSTED_REQUEST_PATHNAME_LENGTH, 2_048);
  assert.equal(normalizeEncodedRequestPathname("/"), "/");
  assert.equal(
    normalizeEncodedRequestPathname("/org%61nizer/events"),
    "/organizer/events",
  );
  assert.equal(
    normalizeEncodedRequestPathname("/cafe%CC%81"),
    "/caf\u00e9",
    "decomposed UTF-8 must be normalized to NFC once",
  );
  assert.equal(
    normalizeEncodedRequestPathname(
      `/${"a".repeat(MAX_TRUSTED_REQUEST_PATHNAME_LENGTH - 1)}`,
    )?.length,
    MAX_TRUSTED_REQUEST_PATHNAME_LENGTH,
  );

  for (const pathname of [
    "",
    "organizer",
    "//organizer",
    "/organizer//events",
    "/organizer/%",
    "/organizer/%2f/events",
    "/organizer/%5c/events",
    "/organizer/%3f/events",
    "/organizer/%23/events",
    "/org%2561nizer",
    "/%252e%252e/organizer",
    "/./organizer",
    "/../organizer",
    `/${"a".repeat(MAX_TRUSTED_REQUEST_PATHNAME_LENGTH)}`,
  ]) {
    assert.equal(
      normalizeEncodedRequestPathname(pathname),
      null,
      `${pathname.slice(0, 80)} must fail closed`,
    );
  }
});
test("trusted path headers accept only the canonical normalized representation", () => {
  assert.equal(isCanonicalTrustedRequestPathname("/organizer/events"), true);
  assert.equal(isCanonicalTrustedRequestPathname("/caf\u00e9"), true);
  for (const value of [
    null,
    "",
    "//organizer",
    "/organizer//events",
    "/org%61nizer",
    "/organizer?role=public",
    "/organizer#public",
    "/organizer\\events",
    "/cafe\u0301",
    `/${"a".repeat(MAX_TRUSTED_REQUEST_PATHNAME_LENGTH)}`,
  ]) {
    assert.equal(isCanonicalTrustedRequestPathname(value), false);
  }
});
