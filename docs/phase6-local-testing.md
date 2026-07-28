# Phase 6 local CMS and media testing

Use only the isolated local and preview stores. Do not enter real feed URLs,
identity values, legal facts, or private photographs into a committed fixture.

## Database and source checks

From `C:\Users\user\Documents\Website` in PowerShell:

```powershell
npm.cmd ci
npm.cmd run db:apply:local
npm.cmd run db:apply:preview
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd run test:rendered
git diff --check
```

The repository's full test runner intentionally executes the collected Node
test files with `--test-concurrency=1`. Keep that deterministic serial setting:
seven suites use Miniflare/workerd, and concurrent file execution can exhaust the
Windows ephemeral loopback range and produce `EADDRINUSE` without a product
failure. Do not add blind retries. If a prior stress run leaves a large
`TIME_WAIT` population, let the ports drain and then run one pristine full
suite to a terminal result.

Do not run `npm.cmd run db:generate` directly against the real `drizzle`
directory after `0015` exists. The real journal already ends at index 15, so a
direct run can create an unintended `0016`.

For the final Phase 6 snapshot only:

1. hash the real `0015_phase6_cms_media.sql` and `meta/_journal.json`;
2. generate into a disposable output directory seeded with the real
   `0014_snapshot.json` and a temporary journal ending at index 14;
3. copy only the generated `meta/0015_snapshot.json` into the real metadata;
4. prove the real 0015 SQL and journal hashes did not change; and
5. run `npm.cmd exec -- drizzle-kit check`.

Schema verification must retain exactly one Phase 6 migration,
`0015_phase6_cms_media.sql`, with a matching snapshot and journal entry. It
must not create `0016`. Inspect every complete Sites tokenizer fragment and
every partial-prefix/retry path against both a clean database and populated
Phase 5 data. Source and packaged migration bytes must match.

Focused suites can be run with the repository's TypeScript loader:

```powershell
node --import tsx --test tests/migrations/phase6-cms-media.test.mjs
node --import tsx --test tests/database/phase6-media-invariants.test.mjs
node --import tsx --test tests/database/phase6-taxonomy-invariants.test.mjs
node --import tsx --test tests/database/phase6-cms-lane-reference-invariants.test.mjs
node --import tsx --test tests/database/request-maintenance-budget.test.mjs
node --import tsx --test tests/organizer/phase6-cms-validation.test.mjs
node --import tsx --test tests/organizer/phase6-cms-adoption.integration.test.mjs
node --import tsx --test tests/organizer/phase6-cms.integration.test.mjs
node --import tsx --test tests/organizer/phase6-cms-route-contract.test.mjs
node --import tsx --test tests/organizer/phase6-cms-ui-contract.test.mjs
node --import tsx --test tests/organizer/phase6-taxonomy-service.integration.test.mjs
node --import tsx --test tests/media/*.test.mjs
node --import tsx --test tests/public/d1-public-catalog-compatibility.test.mjs
node --import tsx --test tests/public/unified-events.integration.test.mjs
node --import tsx --test tests/public/organizer-attribution-bounds.test.mjs
node --import tsx --test tests/public/phase6-brand-metadata.test.mjs
node --import tsx --test tests/public/phase6-media-rendering.test.mjs
node --import tsx --test tests/meetup/organizer-route-budget.test.mjs
```

The focused matrix must cover, without changing production authorization:

- idempotent and concurrent adoption with no partial marker;
- draft/public separation, immutable restore, stale and concurrent actions,
  redirect suppression, and system-page lifecycle protection;
- exact navigation labels/order, required-link survival at the optional-item
  cap, and duplicate destination rejection;
- page, club, event, and site SEO/Open Graph projection with live approved
  media dimensions and fallback;
- maximum 24-block production and preview rendering through one bulk
  materialized context rather than per-block reads;
- taxonomy create/edit/reorder/archive/safe-delete, stale and lost-response
  behavior, direct-write guards, archived-reference preservation, and
  symmetric CMS-revision races;
- private organizer-attribution draft, explicit publish/revoke, legacy
  adoption, immutable receipt, concurrent retry, rich host rendering, and
  private-field suppression;
- the complete Worker request budget, including invariant preflight,
  maintenance, route authorization, mutation, notifications, and response
  reads; the public-catalog and organizer-route budget suites above are
  required regression gates for the first-run and healthy Meetup GET/connect
  compositions;
- protected legal-claim application, trigger, integrity, race, and public-
  projection behavior;
- R2 put failure, finalization rollback, failed-cleanup restart/retry, current
  authorization before byte reads, and public-original denial;
- media usage exact-revision binding, public-use metadata regression blockers,
  historical preview, event-artwork lifecycle retirement, and cross-
  organization direct-write rejection.

## Browser workflow

Use the local automation seam only. Never add a production route, query
parameter, cookie, or browser-storage value that grants identity.

The Sites dispatcher does not run in standalone localhost. For an authenticated
local browser check, use a disposable local-only browser automation context
whose requests carry
`oai-authenticated-user-email: phase6-browser-owner@example.invalid`, with a
matching ignored local `INITIAL_OWNER_EMAIL` runtime value. The header must be
set by the automation context, never by application code or a visible form.
Delete the disposable runtime file and local D1/R2/browser state after QA.
Ordinary manual localhost browsing remains signed out and should redirect
private routes to the dispatcher-owned sign-in path.

1. Start the local server with `npm.cmd run dev`.
2. Open `/organizer/content` through the disposable authenticated automation
   context. Check `/organizer/profile`, `/organizer/settings`,
   `/organizer/media`, and one page, club, Program, Community, navigation, and
   revision editor route.
3. Save a page draft and confirm the signed-out public page does not change.
4. Preview the exact revision and confirm the public header, footer, palette,
   typography, responsive blocks, metadata-visible content, and entity
   renderer match production. Use the skip link and confirm it focuses the one
   main landmark.
5. Publish, unpublish, and restore as a new draft.
6. Create an unpublished Resources draft and confirm `/resources` stays 404
   until explicit publication. Confirm its slug cannot be changed.
7. Add an unconfirmed Community destination and confirm it remains absent
   publicly. Confirm Meetup destination types reject a mismatched URL shape.
8. Upload only a synthetic non-person image excluded from committed artifacts.
   Verify metadata, responsive variants, selection, blocked in-use deletion,
   and cleanup retry.
9. Confirm legal settings begin blank and private; never use invented legal
   facts outside an isolated disposable fixture. Confirm protected wording is
   also rejected in ordinary page, club, site, Community, and event fields.
10. Change navigation labels and order with the keyboard controls. Confirm
    required links and Organizer Login remain present and that optional items
    do not crowd or overflow the tablet header.
11. Change page, club, event, and site Open Graph selections. Confirm real
    portrait/square dimensions and alt text are used, and revoking the media
    suppresses or safely falls back instead of emitting a broken URL.
12. Change a club theme and site palette in both directions. Confirm invalid
    cross-entity contrast is blocked without a partial public change.
13. Change a generic page or club slug, then unpublish and republish the
    target. Confirm the old-slug redirect never points to a missing page.
14. Check 320×800, 390×844, tablet, 1280, 1440, 200% reflow, reduced motion,
    keyboard-only operation, focus restoration, error summaries, touch
    targets, and dialogs.

Synthetic media bytes, local R2 objects, D1 files, browser captures, logs, and
test identities are work artifacts. They must be absent from the source commit
and Sites archive.

Before packaging, scan source, `dist`, client bundles, and the archive for
draft snapshots, legal drafts, private media notes, original filenames, R2
object keys, actor/profile IDs, organizer email or identity headers,
invitations, conflict reasons, private event details, runtime values,
credentials, local paths, test identities, and fixtures. Inspect the archive
inventory and reject traversal paths, environment files, local databases,
logs, test artifacts, and local R2 objects.

## Package and privacy inventory

Build and package only the exact validated, pushed source revision. Use the
official Sites `package-site.sh` helper; do not hand-assemble a different
archive. The archive root must be exactly `dist/` and contain:

- `dist/server/index.js`;
- emitted public/client assets;
- `dist/.openai/hosting.json`, byte-identical to the source file; and
- the complete `dist/.openai/drizzle/` chain through the sole
  `0015_phase6_cms_media.sql`, including snapshot and journal metadata.

The archive must not contain source tests, fixtures, `node_modules`, `.env*`,
`.dev.vars*`, local D1/SQLite files, local R2 objects, `.wrangler`, logs,
coverage, `work`, temporary snapshot-generation directories, credentials, or
absolute/traversal paths.

Use a file-shape gate before saving a Sites version:

```powershell
$distRoot = (Resolve-Path .\dist).Path
$forbidden = Get-ChildItem -LiteralPath $distRoot -Recurse -File |
  Where-Object {
    $_.Name -match '(^\.env|^\.dev\.vars|\.db$|\.sqlite3?$|\.log$|\.pem$|\.key$|\.pfx$)' -or
    $_.FullName -match '(\\tests?\\|\\fixtures?\\|\\node_modules\\|\\work\\|\\\.wrangler\\)'
  }
if ($forbidden) {
  $forbidden | Select-Object FullName, Length
  throw 'Forbidden build artifact found.'
}
```

After packaging, list every tar entry, reject absolute paths and any `..`
segment, extract to a new disposable directory, repeat the file-shape gate,
compare every packaged migration and hosting-metadata hash with source, and
record:

- archive SHA-256 and compressed byte count;
- regular-file count and uncompressed byte count;
- source commit SHA used to build it;
- complete migration inventory;
- zero forbidden-path and private-value findings; and
- Sites readback file count, stored bytes, content hash, source SHA, and null
  preview/screenshot state.

Value scans must target actual production values and synthetic test sentinels,
not merely server-only schema or validator field names. Scan the client bundle,
server bundle, extracted archive, public HTML/metadata/JSON-LD/sitemap/feed
responses, and captured logs for real or synthetic draft copy, organizer
emails, invitations, private event notes/meeting URLs, conflict reasons,
rights/consent notes, original filenames, object-key values, legal drafts,
runtime secrets, private feed destinations, credentials, local paths, and test
identities. A generic parser string such as `events/ical/` is not a private
feed leak; a concrete supplied feed destination is.
