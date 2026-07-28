import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import {
  DATABASE_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/invariants.ts";
import {
  productionMigrationFragments,
} from "../../scripts/d1-migration-batches.mjs";

const MAX_D1_BINDINGS = 100;
const MAX_D1_STATEMENT_BYTES = 100_000;

const workerScript = `
export default {
  async fetch(request, env) {
    const input = await request.json();
    try {
      let statement = env.DB.prepare(input.sql);
      if (input.bindings.length > 0) {
        statement = statement.bind(...input.bindings);
      }
      const result =
        input.mode === "run"
          ? await statement.run()
          : await statement.all();
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  },
};
`;

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export async function assertRecordedD1ShapesCompile(
  shapes,
  { expectedCount, label },
) {
  const sourceSummary = new Map();
  for (const shape of shapes) {
    for (const source of shape.sources ?? []) {
      const match =
        source.match(/(?:lib\/server|tests)\/[^:)]+/u)?.[0] ?? source;
      sourceSummary.set(match, (sourceSummary.get(match) ?? 0) + 1);
    }
  }
  assert.equal(
    shapes.length,
    expectedCount,
    `${label} recorded ${shapes.length} SQL shapes; expected ${expectedCount}; sources ${JSON.stringify(Object.fromEntries(sourceSummary))}`,
  );
  const miniflare = new Miniflare({
    d1Databases: { DB: randomUUID() },
    modules: true,
    script: workerScript,
  });
  try {
    const request = async (sql, bindings = [], mode = "all") => {
      const response = await miniflare.dispatchFetch("http://d1.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bindings, mode, sql }),
      });
      const body = await response.json();
      assert.equal(body.ok, true, `${label}: ${body.error}\n${sql}`);
      return body.result;
    };
    for (
      const name of (await readdir(join(process.cwd(), "drizzle")))
        .filter((candidate) => candidate.endsWith(".sql"))
        .sort()
    ) {
      const sql = await readFile(join(process.cwd(), "drizzle", name), "utf8");
      for (const statement of productionMigrationFragments(sql)) {
        await request(statement, [], "run");
      }
    }
    for (const sql of DATABASE_INVARIANT_TRIGGER_STATEMENTS) {
      await request(sql, [], "run");
    }
    for (const { bindings, sql } of shapes) {
      assert.ok(
        byteLength(sql) < MAX_D1_STATEMENT_BYTES,
        `${label} statement is ${byteLength(sql)} bytes`,
      );
      assert.ok(
        bindings.length < MAX_D1_BINDINGS,
        `${label} statement uses ${bindings.length} bindings`,
      );
      await request(`EXPLAIN ${sql}`, bindings);
    }
  } finally {
    await miniflare.dispose();
  }
}
