import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  charityBenefitClaimSql,
  containsCharityBenefitClaim,
  containsProtectedLegalClaim,
  containsProvincialStatusClaim,
  protectedLegalClaimSql,
  provincialStatusClaimSql,
} from "../../lib/validation/protected-legal-claims.ts";

const SAFE_PROSE = [
  "Loaner binoculars are available at the gift shop. See the Official planning page before visiting.",
  "What part of modern society feels like a bad game with bad incentives? Meet at the library in Vancouver, BC.",
];

const PROTECTED_CLAIMS = [
  "We issue official receipts for gifts.",
  "We are a BC society.",
  "We are a registered society.",
  "Our society registration status is confirmed.",
];

test("protected legal claims distinguish legal wording from ordinary event prose", () => {
  for (const value of SAFE_PROSE) {
    assert.equal(containsProtectedLegalClaim(value), false, value);
  }
  for (const value of PROTECTED_CLAIMS) {
    assert.equal(containsProtectedLegalClaim(value), true, value);
  }
  assert.equal(containsCharityBenefitClaim(SAFE_PROSE[0]), false);
  assert.equal(containsCharityBenefitClaim(PROTECTED_CLAIMS[0]), true);
  assert.equal(containsProvincialStatusClaim(SAFE_PROSE[1]), false);
  for (const value of PROTECTED_CLAIMS.slice(1)) {
    assert.equal(containsProvincialStatusClaim(value), true, value);
  }
});

test("D1 protected legal-claim filtering matches JavaScript for the regressions", async (t) => {
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
  });
  t.after(async () => {
    await miniflare.dispose();
  });
  const database = await miniflare.getD1Database("DB");
  for (const [javascriptClassifier, sqlClassifier, values] of [
    [
      containsProtectedLegalClaim,
      protectedLegalClaimSql,
      [...SAFE_PROSE, ...PROTECTED_CLAIMS],
    ],
    [
      containsCharityBenefitClaim,
      charityBenefitClaimSql,
      [SAFE_PROSE[0], PROTECTED_CLAIMS[0]],
    ],
    [
      containsProvincialStatusClaim,
      provincialStatusClaimSql,
      [SAFE_PROSE[1], ...PROTECTED_CLAIMS.slice(1)],
    ],
  ]) {
    const sql = `SELECT CASE
      WHEN ${sqlClassifier(["?"])} THEN 1 ELSE 0
    END AS protected_claim`;
    for (const value of values) {
      const row = await database.prepare(sql).bind(value).first();
      assert.equal(
        Number(row?.protected_claim),
        javascriptClassifier(value) ? 1 : 0,
        value,
      );
    }
  }
});
