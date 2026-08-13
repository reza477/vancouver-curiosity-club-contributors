# Phase 8 local hardening and verification

> **Historical Phase 8 procedure.** It is preserved as release evidence and is
> not current onboarding. Use [DEVELOPMENT.md](../DEVELOPMENT.md) for the active
> setup and validation workflow.

Run every command from the repository root on Node 22.13 or newer. On Windows,
use the `.cmd` npm entry point so PowerShell execution policy does not
intercept the package-manager shim.

This guide defines the procedure. It does not claim that a command passed.
Measured pass/fail/skip/not-run counts, Lighthouse and accessibility results,
source hashes, and Sites readback belong in `BUILD_STATUS.md` only after the
final exact-source run.

## Clean dependency and static gates

Start the final attestation from the lockfile, not from a reused dependency
tree:

```powershell
npm.cmd ci
npm.cmd ls --omit=dev --all --json
npm.cmd ls --all --json
npm.cmd audit signatures
npm.cmd run typecheck
npm.cmd run lint
git diff --check
```

Inspect both dependency scopes:

```powershell
npm.cmd audit --omit=dev --json
npm.cmd audit --json
```

Do not use `npm audit fix --force`, blanket dependency overrides, disabled
checks, or misleading severity labels. Record each residual package and
advisory, whether it is production-reachable, why a safe compatible upgrade is
or is not available, and the exact audit exit code.

## Focused Phase 8 gates

Run the hardening contracts serially:

```powershell
node --import tsx --test --test-concurrency=1 tests/security/phase8-interface-hardening.test.mjs
node --import tsx --test --test-concurrency=1 tests/security/invitation-token-cookie.test.mjs
node --import tsx --test --test-concurrency=1 tests/media/private-route-security.test.mjs
node --import tsx --test --test-concurrency=1 tests/media/route-contract.test.mjs
node --import tsx --test --test-concurrency=1 tests/media/storage.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/phase7/request-pathname.test.mjs
node --import tsx --test --test-concurrency=1 tests/phase7/export-route-contract.test.mjs
node --import tsx --test --test-concurrency=1 tests/public/d1-public-event-compatibility.test.mjs
node --import tsx --test --test-concurrency=1 tests/public/unified-events.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/organizer/auth-team.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/organizer/events.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/organizer/event-conflicts.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/organizer/phase5-publication.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/organizer/phase6-cms.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/phase7/calendar-and-private-exports.integration.test.mjs
node --import tsx --test --test-concurrency=1 tests/phase7/public-forms-submissions.integration.test.mjs
```

These tests cover canonical encoded-path classification, private cache/robots
headers, exact-actor and assignment revalidation, crafted-ID isolation,
invitation and calendar token boundaries, public-projection races, media
authorization before and after R2 reads, download allowlists, privacy-safe
errors, and complete-route D1 budgets. Keep production authorization intact;
tests may use only the established local synthetic identity seam.

## Migration and invariant gate

Phase 8 has no schema migration. The chain must still end at:

```text
drizzle/0016_phase7_import_export_forms.sql
```

There must be no `0017`. Verify the existing schema, migration, packaged
resources, runtime guards, clean application, populated-prior-phase
application, retry seams, and foreign keys:

```powershell
npx.cmd drizzle-kit check
npm.cmd run db:apply:local
npm.cmd run db:apply:preview
node --import tsx --test --test-concurrency=1 tests/migrations/phase7-import-export-forms.test.mjs
node --import tsx --test --test-concurrency=1 tests/migrations/sites-production-contract.test.mjs
node --import tsx --test --test-concurrency=1 tests/database/invariants.test.mjs
node --import tsx --test --test-concurrency=1 tests/database/phase7-import-export-forms-invariants.test.mjs
```

Do not run `npm.cmd run db:generate` directly into the real `drizzle`
directory. The journal already ends at index 16, so direct generation can
create an unintended `0017`. If a schema change ever becomes unavoidable,
stop the no-schema Phase 8 gate and follow the established disposable-output
snapshot procedure before touching the real migration metadata.

Every prepared statement remains one SQL statement. Audit emitted SQL for the
D1 statement-byte, bind, expression-depth, function-arity, row/value, and
compound-select limits. Measure the whole Worker invocation, including the
healthy invariant preflight, request maintenance, layout/page reads, service
work, audit, and final exact-state seal. Every path must stay below 50 D1
statements.

## Complete exact-source gate

Finish all source, test, and documentation edits before the final source
freeze. Commit the substantive source so the revision embedded by the build
identifies those exact bytes; do not build a dirty tree that reports an older
Git revision. Then run the tracked full suite deterministically:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd run test:rendered
node --import tsx --test --test-concurrency=1 tests/security/phase8-artifact-leakage.test.mjs
git diff --check
```

The build has to come from the exact source revision recorded in the artifact.
The artifact-leakage test is deliberately post-build and must report zero
skips; a missing or stale `dist` is not evidence.
If any tracked byte changes afterward, rebuild and repeat post-build lint,
rendered-Worker, artifact, migration/package, accessibility, performance, and
browser checks.

After the build:

- compare source, schema snapshot, migration, journal, and packaged migration
  resources;
- inventory the archive file count and bytes;
- prove there is exactly one `0016` and no `0017`;
- scan source and `dist` for environment files, local databases, logs, source
  maps, raw tokens, token hashes, runtime values, private Meetup feed URLs, R2
  keys, identity headers, local paths, `.invalid` fixture identities,
  submission/import sentinels, and debug or mock routes; and
- crawl every internal route, navigation/footer link, button, redirect,
  download, and public slug.

Do not copy a private value into a scan command or its output. Use distinctive
synthetic sentinels in an isolated local database and verify only that the
sentinel is absent from public and packaged surfaces.

## Accessibility and keyboard gate

Run an automated WCAG-oriented scan against the built Worker on essential
public and organizer routes. Record the tool and version, routes, violation
counts by impact, and any incomplete/manual rules. Serious and critical
violations must be zero before completion.

The recorded Phase 8 procedure serves the packaged Worker through a disposable
fresh Miniflare D1, opens that local origin in an isolated Chrome profile,
injects the exact checked-in `node_modules/axe-core/axe.min.js` text through
the browser automation API, and evaluates `axe.run(document)`. Do not point
axe at the development server or a stale `dist`. Test Home, Events, one
published event detail, Contact, organizer Events, event create, Imports, and
Submissions at 390px; repeat the three public routes at desktop width. Retain
the complete violation and incomplete/manual-rule counts in
`BUILD_STATUS.md`.

Then verify the central workflows manually by keyboard:

1. skip link, public navigation, event browse/detail, and the real Meetup
   destination;
2. the Sign in with ChatGPT boundary without a production identity bypass;
3. organizer agenda and calendar event names in title, date/time, organizer,
   club, status, conflict order;
4. event create/edit, validation summary, conflict review or override,
   save/cancel, and focus restoration;
5. all four public forms, including errors and post-commit success focus;
6. imports, responsive row detail, selection, approval, resume, and download;
7. submissions, assignment, status, notes, and destructive Owner redaction;
8. CMS, taxonomy, media, exports, backup confirmation, and private-calendar
   token creation/revocation; and
9. dialogs, destructive confirmations, downloads, and all visible controls.

Verify one `main`, logical headings, explicit labels, required/error semantics,
live announcements, non-color status cues, useful image text alternatives,
visible focus and focus order, modal focus trap/restoration, reduced motion,
no hover-only action, useful touch targets, and usability at 200% zoom.

## Responsive browser gate

Use the built Worker and synthetic `.invalid` identities/data. Verify exactly
320, 390, 768, 1280, and 1440 CSS pixels. At 320 and 390 complete:

- browse Events, open one event, and reach its confirmed Meetup URL;
- reach the sign-in boundary;
- view the organizer agenda;
- create and edit an event;
- review a conflict;
- save or cancel; and
- read and recover from validation errors.

At every width inspect navigation, filters, cards, image crops, long text,
tables and mobile row alternatives, dialogs, sticky controls, imports,
submissions, CMS/media, exports, and downloads. Confirm at least 16-pixel
mobile body text, approximately 44 by 44 pixel touch targets, safe-area
behavior, no essential horizontal scrolling, no clipped focus, and no
hydration, application, or accessibility console errors.

Approved-real-artwork smoke remains **Awaiting owner smoke test**. Synthetic
local artwork verifies mechanics only.

## Local production performance gate

Measure the built Worker, not the development server. Use a clean browser
profile, disable extensions, keep the test machine and network conditions
stable, and record:

- browser and audit-tool versions;
- machine/OS and local Worker mode;
- exact page and viewport;
- mobile/desktop throttling settings;
- number of runs and the median selected;
- Performance, Accessibility, Best Practices, and SEO scores; and
- LCP, CLS, and any other measured web vitals.

Audit at least `/`, `/events`, and one synthetic published event detail on
mobile and desktop. Inspect public JavaScript and asset weight, responsive and
lazy images, fonts/layout shift, code splitting, SSR behavior, D1 indexes,
bounded pagination, query/statement counts, connection concurrency, N+1
patterns, and public/private cache boundaries.

With the disposable packaged-Worker origin already running, use the pinned
audit version and write one JSON file per route/form factor:

```powershell
npx.cmd --yes lighthouse@13.4.1 http://127.0.0.1:<port>/ --output=json --output-path="$env:TEMP\vcc-phase8-home-mobile.json" --chrome-flags="--headless=new --disable-extensions --incognito"
npx.cmd --yes lighthouse@13.4.1 http://127.0.0.1:<port>/ --preset=desktop --output=json --output-path="$env:TEMP\vcc-phase8-home-desktop.json" --chrome-flags="--headless=new --disable-extensions --incognito"
```

Repeat those commands for `/events` and the seeded published-event detail.
Inspect the JSON rather than trusting only the process summary: on Windows,
Chrome temporary-profile cleanup can fail after a complete report is written.
The final gate requires a complete report and records every command's real exit
code; do not silently retry or relabel a cleanup failure.

The specification's performance numbers are optimization goals. Report misses
honestly; never hide a failed run or substitute a source assertion for a
measurement.

## Backup, package, and hosted boundary

The Owner JSON export, media manifest, and authenticated media download form a
manual product-data backup routine. They do not include infrastructure,
secrets, identity-provider records, raw R2 keys, private tokens, form content,
or an automatic restore. Saved Sites versions are not automatic backups.

Phase 8 does not authorize deployment. Before any allowed unpublished save,
read the existing project, versions, live deployment, access, domains,
bindings, runtime values, and preview state. Save at most one unpublished
candidate only after every final gate is green, then read those states again.
Do not deploy, create a preview deployment, widen access, alter domains or
bindings, or mutate hosted D1/R2 to perform verification.

Hosted second-identity, external calendar-client, approved-real-artwork, and
Owner smoke checks remain **Awaiting owner smoke test** or **Not run** until
their real prerequisites and a separately authorized deployment exist.
