# Examples

These files are isolated framework examples, not production Vancouver Curiosity
Club code. In particular, `examples/d1/` is a small generic D1 notes example;
it does not use the application's schema, migrations, local database path, or
authorization model.

Do not copy it into production routes or use it to infer the app's data model.
For real database work, start with `db/schema.ts`, `drizzle/`, and
`DEVELOPMENT.md`.
