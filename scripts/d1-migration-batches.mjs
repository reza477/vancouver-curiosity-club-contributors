export const MAX_D1_MIGRATION_STATEMENTS_PER_BATCH = 48;
export const MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER = 49;

export function productionMigrationFragments(source) {
  if (typeof source !== "string") {
    throw new TypeError("Migration SQL must be a string.");
  }
  return source
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function migrationStatementBatches(statements) {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new TypeError("A migration must contain at least one SQL statement.");
  }

  const batches = [];
  for (
    let offset = 0;
    offset < statements.length;
    offset += MAX_D1_MIGRATION_STATEMENTS_PER_BATCH
  ) {
    batches.push(
      statements.slice(
        offset,
        offset + MAX_D1_MIGRATION_STATEMENTS_PER_BATCH,
      ),
    );
  }
  return batches;
}

export async function applyD1MigrationBatches({
  database,
  statements,
  finalStatement,
  failureMessage,
}) {
  const batches = migrationStatementBatches(statements);
  const batchStatementCounts = [];

  for (const [index, migrationBatch] of batches.entries()) {
    const isFinalBatch = index === batches.length - 1;
    const prepared = migrationBatch.map((statement) =>
      typeof statement === "string" ? database.prepare(statement) : statement,
    );
    if (isFinalBatch && finalStatement) {
      prepared.push(finalStatement);
    }
    if (
      prepared.length >
      MAX_D1_MIGRATION_BATCH_STATEMENTS_WITH_LEDGER
    ) {
      throw new Error(
        "A prepared migration batch exceeds the bounded D1 statement limit.",
      );
    }

    const results = await database.batch(prepared);
    if (results.some((result) => result.success === false)) {
      throw new Error(
        failureMessage ?? "D1 rejected one or more migration statements.",
      );
    }
    batchStatementCounts.push(prepared.length);
  }

  return Object.freeze({
    migrationStatementCount: statements.length,
    batchStatementCounts: Object.freeze(batchStatementCounts),
  });
}
