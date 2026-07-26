import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import {
  DATABASE_INVARIANT_TRIGGER_NAMES,
  ensureDatabaseInvariants,
} from "../lib/server/database/invariants.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrationsDirectory = resolve(projectRoot, "drizzle");
// This matches the Cloudflare Vite plugin's verified local D1 persistence
// directory for the Sites starter. It is project-local and ignored by Git.
const persistenceDirectory = resolve(
  projectRoot,
  ".wrangler",
  "state",
  "v3",
  "d1",
);
const previewDatabaseId = "00000000-0000-4000-8000-000000000000";
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

async function ensureDatabaseInvariantsReady(database, maxAttempts = 8) {
  const statuses = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await ensureDatabaseInvariants(database);
    statuses.push(status);
    if (status === "ready") return statuses;
  }
  throw new Error(
    `Database invariants did not converge within ${maxAttempts} attempts ` +
      `(statuses=${statuses.join(",")}).`,
  );
}

if (migrationFiles.length === 0) {
  console.error("No generated SQL migrations were found.");
  process.exit(2);
}

const miniflare = new Miniflare({
  d1Databases: { DB: previewDatabaseId },
  d1Persist: persistenceDirectory,
  modules: true,
  script: "",
});

try {
  const database = await miniflare.getD1Database("DB");
  await database
    .prepare(
      `CREATE TABLE IF NOT EXISTS _preview_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        sha256 TEXT NOT NULL,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )`,
    )
    .run();

  for (const name of migrationFiles) {
    const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const existing = await database
      .prepare(
        "SELECT sha256 FROM _preview_migrations WHERE name = ? LIMIT 1",
      )
      .bind(name)
      .first();

    if (existing) {
      if (existing.sha256 !== sha256) {
        throw new Error(
          `Applied preview migration ${name} no longer matches its recorded hash.`,
        );
      }
      console.log(`already applied to preview: ${name}`);
      continue;
    }

    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));
    statements.push(
      database
        .prepare(
          "INSERT INTO _preview_migrations (name, sha256) VALUES (?, ?)",
        )
        .bind(name, sha256),
    );

    const results = await database.batch(statements);
    if (results.some((result) => !result.success)) {
      throw new Error(
        `Preview D1 rejected one or more statements in ${name}.`,
      );
    }
    console.log(
      `applied to preview: ${name} (${statements.length - 1} statements)`,
    );
  }

  const invariantStatuses =
    await ensureDatabaseInvariantsReady(database);

  const tableCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
         AND name <> '_preview_migrations'`,
    )
    .first("count");
  const triggerCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM sqlite_master
       WHERE type = 'trigger'`,
    )
    .first("count");
  const foreignKeyCheck = await database
    .prepare("PRAGMA foreign_key_check")
    .all();
  if (Number(triggerCount) !== DATABASE_INVARIANT_TRIGGER_NAMES.length) {
    throw new Error("The complete database invariant trigger set is missing.");
  }
  if ((foreignKeyCheck.results ?? []).length > 0) {
    throw new Error("Preview migrations left foreign-key violations.");
  }

  console.log(
    JSON.stringify({
      migrations: migrationFiles.length,
      tables: Number(tableCount),
      databaseInvariantTriggers: Number(triggerCount),
      expectedDatabaseInvariantTriggers:
        DATABASE_INVARIANT_TRIGGER_NAMES.length,
      invariantStatuses,
      foreignKeyViolations: 0,
      target: "Sites local preview D1",
    }),
  );
} finally {
  await miniflare.dispose();
}
