const INNER_STATEMENT = Symbol("innerD1Statement");

export function interceptD1Statements(
  database,
  {
    after,
    before,
    hook,
  },
) {
  let armed = after === undefined;
  let fired = false;

  const wrappedDatabase = {
    batch(statements) {
      return database.batch(
        statements.map((statement) => statement[INNER_STATEMENT] ?? statement),
      );
    },
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return wrap(database.prepare(sql), sql);
    },
  };

  return Object.freeze({
    database: wrappedDatabase,
    fired: () => fired,
  });

  function wrap(statement, sql) {
    return {
      [INNER_STATEMENT]: statement,
      bind(...values) {
        return wrap(statement.bind(...values), sql);
      },
      async first(column) {
        await fireBefore(sql);
        const result = await statement.first(column);
        armAfter(sql);
        return result;
      },
      async all() {
        await fireBefore(sql);
        const result = await statement.all();
        armAfter(sql);
        return result;
      },
      async run() {
        await fireBefore(sql);
        const result = await statement.run();
        armAfter(sql);
        return result;
      },
    };
  }

  async function fireBefore(sql) {
    if (!fired && armed && before(sql)) {
      fired = true;
      await hook();
    }
  }

  function armAfter(sql) {
    if (!armed && after?.(sql)) armed = true;
  }
}

export function countD1Statements(database) {
  let statementCount = 0;

  const countedDatabase = {
    batch(statements) {
      statementCount += statements.length;
      return database.batch(
        statements.map((statement) => statement[INNER_STATEMENT] ?? statement),
      );
    },
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
  };

  return Object.freeze({
    count: () => statementCount,
    database: countedDatabase,
  });

  function wrap(statement) {
    return {
      [INNER_STATEMENT]: statement,
      bind(...values) {
        return wrap(statement.bind(...values));
      },
      first(column) {
        statementCount += 1;
        return statement.first(column);
      },
      all() {
        statementCount += 1;
        return statement.all();
      },
      run() {
        statementCount += 1;
        return statement.run();
      },
    };
  }
}
