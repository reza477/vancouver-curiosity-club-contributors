import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPublicHomeData,
} from "../../lib/server/public/home.ts";

const NOW_UTC_MS = Date.parse("2026-07-27T12:00:00.000Z");
const SITE_IDENTITY = JSON.stringify({
  brandName: "Vancouver Curiosity Club",
  locationLabel: "Vancouver, British Columbia",
  mission: "A community organization for curious people.",
  tagline: "A social calendar with a brain.",
});

test("Home bounds peak D1 read concurrency at the catalog fan-out of five", async () => {
  let active = 0;
  let peak = 0;
  let statementCount = 0;

  const execute = async (sql, mode) => {
    statementCount += 1;
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (mode === "first") {
        if (sql.includes("AS identity_json")) {
          return {
            identity_json: SITE_IDENTITY,
            legal_json: null,
          };
        }
        if (sql.includes("AS total_count")) {
          return {
            public_slug_collision_count: 0,
            total_count: 0,
          };
        }
        return null;
      }
      if (sql.includes("FROM pages AS page")) {
        return {
          results: [
            {
              meta_description: "A home page.",
              og_media_asset_id: null,
              section_key: null,
              section_type: null,
              seo_title: "Vancouver Curiosity Club",
              slug: "home",
              title: "Vancouver Curiosity Club",
            },
          ],
          success: true,
        };
      }
      return { results: [], success: true };
    } finally {
      active -= 1;
    }
  };

  const database = {
    prepare(sql) {
      return {
        bind() {
          return {
            all: () => execute(sql, "all"),
            first: () => execute(sql, "first"),
          };
        },
      };
    },
  };

  const result = await loadPublicHomeData(database, {
    nowUtcMs: NOW_UTC_MS,
    organizationId: "org-public",
  });

  assert.equal(result?.page.slug, "home");
  assert.deepEqual(result?.events, []);
  assert.equal(statementCount, 8);
  assert.equal(
    peak,
    5,
    "Home must finish the five-read catalog before starting page/event reads",
  );
});
