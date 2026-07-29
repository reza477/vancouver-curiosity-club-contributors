import { DatabaseSync } from "node:sqlite";

let activeStatementRecorder = null;

export function startSqliteD1StatementRecording({
  sourceIncludes,
} = {}) {
  assertRecorderIdle();
  const sourceNeedles = Array.isArray(sourceIncludes)
    ? sourceIncludes
    : sourceIncludes
      ? [sourceIncludes]
      : [];
  const shapes = new Map();
  activeStatementRecorder = {
    matches(stack) {
      const normalizedStack = stack.replaceAll("\\", "/");
      return (
        sourceNeedles.length === 0 ||
        sourceNeedles.some((needle) =>
          normalizedStack.includes(needle.replaceAll("\\", "/")),
        )
      );
    },
    record(sql, bindings, source) {
      const normalizedSql = sql.trim().replaceAll(/\s+/gu, " ");
      const key = `${normalizedSql}\u0000${bindings.length}`;
      if (!shapes.has(key)) {
        shapes.set(key, {
          bindings: bindings.map(normalizeRecordedBinding),
          sources: new Set(),
          sql,
        });
      }
      if (source) shapes.get(key).sources.add(source);
    },
  };
  return {
    snapshot() {
      return recordedShapeSnapshot(shapes);
    },
    stop() {
      const snapshot = recordedShapeSnapshot(shapes);
      if (activeStatementRecorder !== null) {
        activeStatementRecorder = null;
      }
      return snapshot;
    },
  };
}

function recordedShapeSnapshot(shapes) {
  return [...shapes.values()].map(({ bindings, sources, sql }) => ({
    bindings,
    sources: [...sources].sort(),
    sql,
  }));
}

function assertRecorderIdle() {
  if (activeStatementRecorder !== null) {
    throw new Error("A D1 statement recorder is already active.");
  }
}

function normalizeRecordedBinding(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return null;
}

function activeRecorderSource() {
  if (activeStatementRecorder === null) return null;
  const stack = (new Error().stack ?? "").replaceAll("\\", "/");
  if (!activeStatementRecorder.matches(stack)) return null;
  const lines = stack.split("\n");
  return (
    lines.find((line) => line.includes("/lib/server/"))?.trim() ??
    lines.find(
      (line) =>
        !line.includes("/tests/auth/sqlite-d1.mjs") &&
        line.includes("/tests/"),
    )?.trim() ??
    "unknown"
  );
}

export class SqliteD1TestDatabase {
  constructor(schemaSql) {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec(schemaSql);
  }

  prepare(sql) {
    const recordSource = activeRecorderSource();
    if (
      recordSource !== null &&
      activeStatementRecorder !== null &&
      !sql.includes("?")
    ) {
      activeStatementRecorder.record(sql, [], recordSource);
    }
    return new SqliteD1TestStatement(
      this,
      sql,
      [],
      recordSource,
    );
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        if (
          !(statement instanceof SqliteD1TestStatement) ||
          statement.database !== this
        ) {
          throw new TypeError("The batch contains a foreign statement.");
        }
        return statement.runSynchronously();
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql) {
    this.sqlite.exec(sql);
  }

  close() {
    this.sqlite.close();
  }
}

class SqliteD1TestStatement {
  constructor(database, sql, bindings, recordSource) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
    this.recordSource = recordSource;
  }

  bind(...values) {
    const recordSource = this.recordSource ?? activeRecorderSource();
    if (recordSource !== null && activeStatementRecorder !== null) {
      activeStatementRecorder.record(this.sql, values, recordSource);
    }
    return new SqliteD1TestStatement(
      this.database,
      this.sql,
      values,
      recordSource,
    );
  }

  async first(columnName) {
    this.recordExecution();
    const row = this.database.sqlite
      .prepare(this.sql)
      .get(...this.bindings);
    if (row === undefined) return null;
    return columnName === undefined ? row : (row[columnName] ?? null);
  }

  async all() {
    this.recordExecution();
    const results = this.database.sqlite
      .prepare(this.sql)
      .all(...this.bindings);
    return { success: true, results };
  }

  async run() {
    return this.runSynchronously();
  }

  runSynchronously() {
    this.recordExecution();
    const statement = this.database.sqlite.prepare(this.sql);
    if (statement.columns().length > 0) {
      return {
        success: true,
        results: statement.all(...this.bindings),
        meta: {
          changes: 0,
        },
      };
    }
    const result = statement.run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
      },
    };
  }

  recordExecution() {
    if (this.recordSource !== null && activeStatementRecorder !== null) {
      activeStatementRecorder.record(
        this.sql,
        this.bindings,
        this.recordSource,
      );
    }
  }
}
