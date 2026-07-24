import { DatabaseSync } from "node:sqlite";

export class SqliteD1TestDatabase {
  constructor(schemaSql) {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec(schemaSql);
  }

  prepare(sql) {
    return new SqliteD1TestStatement(this, sql, []);
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
  constructor(database, sql, bindings) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...values) {
    return new SqliteD1TestStatement(this.database, this.sql, values);
  }

  async first(columnName) {
    const row = this.database.sqlite
      .prepare(this.sql)
      .get(...this.bindings);
    if (row === undefined) return null;
    return columnName === undefined ? row : (row[columnName] ?? null);
  }

  async all() {
    const results = this.database.sqlite
      .prepare(this.sql)
      .all(...this.bindings);
    return { success: true, results };
  }

  async run() {
    return this.runSynchronously();
  }

  runSynchronously() {
    const result = this.database.sqlite
      .prepare(this.sql)
      .run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
      },
    };
  }
}
