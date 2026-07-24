import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Database bindings are server-only.");
  }
}

/**
 * Returns the raw D1 binding for prepared statements and atomic DB.batch()
 * writes. Never expose this object through client components or public DTOs.
 */
export function getRawDb(): D1Database {
  assertServerRuntime();

  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return env.DB;
}

/** Returns the schema-aware Drizzle facade for server-side query code. */
export function getDb() {
  return drizzle(getRawDb(), { schema });
}
