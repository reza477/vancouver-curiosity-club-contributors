import {
  DATABASE_INVARIANT_VERSION,
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import { PHASE4_INVARIANT_COUNT_SQL } from "../../lib/server/conflicts/organizer-invariant-sql.ts";
import { PHASE3_INVARIANT_COUNT_SQL } from "../../lib/server/organizer/invariant-sql.ts";

/**
 * Simulates successive fail-closed Worker requests until the durable marker
 * and exact invariant definitions are ready for application dispatch.
 */
export async function ensureDatabaseInvariantsReady(
  database,
  maxAttempts = 8,
) {
  const statuses = [];
  const underlyingErrors = [];
  const statementInner = new WeakMap();
  const wrapStatement = (statement, sql) => {
    const wrapped = {
      bind(...values) {
        return wrapStatement(statement.bind(...values), sql);
      },
      async first(...args) {
        try {
          return await statement.first(...args);
        } catch (error) {
          underlyingErrors.push(
            `first:${sql.slice(0, 80)}:${error?.message ?? error}`,
          );
          throw error;
        }
      },
      async all() {
        try {
          return await statement.all();
        } catch (error) {
          underlyingErrors.push(
            `all:${sql.slice(0, 80)}:${error?.message ?? error}`,
          );
          throw error;
        }
      },
      async run() {
        try {
          return await statement.run();
        } catch (error) {
          underlyingErrors.push(
            `run:${sql.slice(0, 80)}:${error?.message ?? error}`,
          );
          throw error;
        }
      },
    };
    statementInner.set(wrapped, statement);
    return wrapped;
  };
  const binding = {
    prepare(sql) {
      return wrapStatement(database.prepare(sql), sql);
    },
    async batch(statements) {
      try {
        return await database.batch(
          statements.map((statement) => statementInner.get(statement)),
        );
      } catch (error) {
        underlyingErrors.push(error?.message ?? String(error));
        throw error;
      }
    },
  };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let status;
    try {
      status = await ensureDatabaseInvariants(binding);
    } catch (error) {
      if (error?.name !== "DatabaseInvariantError") throw error;
      statuses.push("failed_closed");
      continue;
    }
    statuses.push(status);
    const marker = await database
      .prepare(
        `SELECT version
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'
         LIMIT 1`,
      )
      .first();
    if (
      status === "ready" &&
      marker?.version === DATABASE_INVARIANT_VERSION
    ) {
      return Object.freeze(statuses);
    }
  }
  const [marker, triggerCount] = await Promise.all([
    database
      .prepare(
        `SELECT version, trigger_fingerprint
         FROM database_invariant_state
         WHERE singleton_key = 'database-guards'
         LIMIT 1`,
      )
      .first(),
    database
      .prepare(
        `SELECT count(*) AS count
         FROM sqlite_master
         WHERE type = 'trigger'`,
      )
      .first(),
  ]);
  const violations = [];
  for (const [group, queries] of [
    ["phase3", PHASE3_INVARIANT_COUNT_SQL],
    ["phase4", PHASE4_INVARIANT_COUNT_SQL],
  ]) {
    for (let index = 0; index < queries.length; index += 1) {
      try {
        const result = await database.prepare(queries[index]).first();
        if (Number(result?.violation_count ?? 0) !== 0) {
          violations.push(
            `${group}[${index}]=${result?.violation_count ?? "unknown"}`,
          );
        }
      } catch (error) {
        violations.push(`${group}[${index}]=error:${error?.message ?? error}`);
      }
    }
  }
  throw new Error(
    `Database invariants did not converge within the test bound ` +
      `(statuses=${statuses.join(",")}; marker=${marker?.version ?? "none"}; ` +
      `triggers=${triggerCount?.count ?? "unknown"}; ` +
      `violations=${violations.join(",") || "none"}; ` +
      `underlyingErrors=${underlyingErrors.join(",") || "none"}).`,
  );
}
