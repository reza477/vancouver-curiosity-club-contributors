# Phase 7 local verification

Run from the repository root on Node 22.13 or newer. On Windows, use the
`.cmd` npm entry point so PowerShell execution policy does not intercept the
package-manager shim.

## Clean dependency and static gates

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
git diff --check
```

Do not reuse a partially installed dependency tree for the final gate.

## Focused Phase 7 gates

```powershell
node --import tsx --test tests/imports/csv-parser.test.mjs
node --import tsx --test tests/phase7/import-routes-ui.integration.test.mjs
node --import tsx --test tests/phase7/public-forms-submissions.integration.test.mjs
node --import tsx --test tests/phase7/public-form-route-ui.integration.test.mjs
node --import tsx --test tests/phase7/submissions-redaction.integration.test.mjs
node --import tsx --test tests/phase7/export-format.test.mjs
node --import tsx --test tests/phase7/calendar-and-private-exports.integration.test.mjs
node --import tsx --test tests/phase7/calendar-component-revisions.integration.test.mjs
node --import tsx --test tests/phase7/d1-export-calendar-compatibility.test.mjs
node --import tsx --test tests/phase7/export-route-contract.test.mjs
node --import tsx --test tests/phase7/request-pathname.test.mjs
node --import tsx --test tests/database/phase7-import-export-forms-invariants.test.mjs
node --import tsx --test tests/migrations/phase7-import-export-forms.test.mjs
```

The exact final test inventory may add a tracked submission-API authorization
matrix and a whole-Worker import-route budget gate. `BUILD_STATUS.md` must list
only tests that exist and were run on the frozen source.

## Migration and invariant gate

Phase 7 must retain one additive migration:

```text
drizzle/0016_phase7_import_export_forms.sql
```

There must be no `0017`. Regenerate the Phase 7 snapshot only after all schema
contracts are terminal, then verify:

```powershell
npm.cmd run db:generate
npm.cmd run db:apply:local
npm.cmd run db:apply:preview
npx.cmd drizzle-kit check
```

The final migration tests must cover a clean database, populated Phase 6,
idempotent reapply, every tokenizer/partial-prefix retry cut, exact packaged
resources, concurrent invariant installation, and zero foreign-key/invariant
violations. Every emitted SQL statement must remain within D1 byte, bind,
expression-depth, function-arity, and 50-statements-per-Worker-invocation
limits.

`db:generate` can create a later migration when the journal already contains
index 16. For a final snapshot-only refresh, use the established temporary
output procedure seeded with the exact prior snapshot/journal; do not generate
an unintended `0017` into the real `drizzle` directory.

## Full exact-source gate

Run the repository suite deterministically. Miniflare/workerd-heavy files are
kept serial by the tracked test runner to avoid Windows ephemeral-port
exhaustion; do not add semantic retry loops.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd run test:rendered
npm.cmd audit --omit=dev --json
npm.cmd audit --json
git diff --check
```

After the build, repeat the migration/package/snapshot equality check, archive
inventory, and source/dist privacy scans. The production build must contain the
exact frozen migration and no local databases, environment files, logs, raw
tokens, identity fixture values, private Meetup feed URLs, form/import
sentinels, R2 keys, or runtime secrets.

## Browser gate

Use a local Cloudflare-backed built Worker with synthetic `.invalid`
identities. Verify 320, 390, 768, 1280, and 1440 pixel widths:

- template download, mapping, preview, duplicate/error/conflict rows, approval,
  resume, and durable results;
- Contact, Volunteer, Host, and Partnership forms;
- post-commit success focus and accessible field-error summary;
- private submission list/detail, assignment, status, notes, and Owner
  redaction;
- one-event and filtered ICS/CSV;
- Owner backup confirmation and media manifest;
- private token creation, one-time copy, and revocation;
- keyboard paths, visible focus, exactly one `main`, no essential horizontal
  overflow, no hydration/application/accessibility console errors, and
  private noindex/no-store headers.

Approved-real-artwork smoke remains **Awaiting owner / not run** unless the
Owner supplies approved production artwork.

## Hosted boundary

Phase 7 remains unpublished during this gate. External calendar-client and
other hosted Phase 7 smoke items are **Awaiting a future authorized
deployment**. Do not change live version 8, access, domains, bindings, or
runtime values merely to verify them.
