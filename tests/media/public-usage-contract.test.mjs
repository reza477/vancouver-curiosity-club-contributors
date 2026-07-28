import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  currentPublishedMediaUsageTargetSql,
  mediaUsageRequiresUsefulAltSql,
  missingCurrentPublishedMediaUsageCountSql,
} from "../../lib/server/media/public-usage-contract.ts";

test("anonymous serving and database invariants share one exact public-media SQL contract", () => {
  const sql = currentPublishedMediaUsageTargetSql("candidate_usage");
  for (const branch of [
    "entity_type = 'page'",
    "entity_type = 'club_public_profile'",
    "entity_type = 'program_public_profile'",
    "entity_type = 'organizer_event'",
    "entity_type IN ('site_logo', 'site_og')",
  ]) {
    assert.equal(sql.includes(branch), true, branch);
  }
  assert.equal(
    [...sql.matchAll(/cms_public_materialization_receipts/gu)].length,
    4,
    "each CMS-backed page, club, Program, and site branch must bind the immutable current-public receipt",
  );
  assert.match(sql, /page_public_metadata/u);
  assert.match(sql, /page_sections/u);
  assert.match(sql, /club_public_profile_details/u);
  assert.match(sql, /program_public_profile_details/u);
  assert.match(sql, /site_settings/u);
  assert.match(sql, /candidate_usage\.asset_id/u);
  assert.match(
    sql,
    /workflow_status IN \('published', 'archived'\)/u,
    "Club and Program history keeps its exact archived materialization usable",
  );
  assert.doesNotMatch(sql, /\busage\.(?:asset_id|entity_id|revision_id)/u);

  const completenessSql = missingCurrentPublishedMediaUsageCountSql();
  assert.match(completenessSql, /WITH expected_public_media AS/u);
  assert.match(completenessSql, /FROM expected_public_media AS expected/u);
  assert.match(completenessSql, /usage_kind = expected\.usage_kind/u);
  assert.match(completenessSql, /usage\.deleted_at IS NULL/u);

  const requiredAlt = mediaUsageRequiresUsefulAltSql("candidate_usage");
  for (const usageKind of [
    "event_artwork",
    "open_graph",
    "cover",
    "thumbnail",
  ]) {
    assert.match(requiredAlt, new RegExp(usageKind, "u"));
  }

  const storageSource = readFileSync(
    "lib/server/media/storage.ts",
    "utf8",
  );
  const invariantSource = readFileSync(
    "lib/server/database/phase6-invariant-sql.ts",
    "utf8",
  );
  const renderingSource = readFileSync(
    "lib/server/media/usage.ts",
    "utf8",
  );
  for (const source of [storageSource, invariantSource, renderingSource]) {
    assert.match(
      source,
      /from ["'].+media\/public-usage-contract|from ["']\.\/public-usage-contract/u,
    );
    assert.match(source, /currentPublishedMediaUsageTargetSql\(/u);
  }
  assert.doesNotMatch(
    storageSource,
    /const CURRENT_PUBLISHED_MEDIA_USAGE_SQL/u,
  );
  assert.doesNotMatch(
    invariantSource,
    /function currentPublishedMediaUsageTargetSql/u,
  );
});
