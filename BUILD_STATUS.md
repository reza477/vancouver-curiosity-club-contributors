# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-25 (America/Vancouver)

## Active phase and authorized scope

- **Phase 2 production-migration compatibility correction — Completed and
  verified locally; Sites save/deployment pending.**
- Phase 1 and Phase 2 product behavior is unchanged. This correction is
  limited to the Sites/D1 migration boundary, durable database-guard
  initialization, its tests, and release evidence.
- **Phase 3 — Not started.**
- Public deployment is prohibited. The only authorized deployment is through
  the Sites capability that verifies the current owner is the sole viewer.

## Completed and verified

### Root cause and version-7 evidence

- Immutable Sites version 7 remains preserved and must not be retried or
  deployed.
- Its owner-only deployment
  `appgdep_6a65376e5b3881918d5653d913c5d447` failed before publication with
  `incomplete input: SQLITE_ERROR`; Sites returned no URL.
- The exact version-7 archive was intact:
  SHA-256
  `d259059221780c65df4f0958c14a59a541b42c85c662c98724734eb64cdc9493`,
  1,668,409 bytes, 87 archive entries, and 72 regular files.
- All eight packaged SQL files and migration metadata matched source.
  Applying each Drizzle breakpoint chunk as one prepared statement succeeded.
- A semicolon tokenizer reproduced the exact first failure inside
  `events_reservation_guard_before_insert` in packaged migration 0000.
  Removing only the eleven historical `CREATE TRIGGER` chunks made every
  remaining fragment across migrations 0000–0007 apply successfully.
- The defect is therefore the Sites production tokenizer crossing SQLite
  trigger-body semicolons, not corrupt packaging, table/index syntax, PRAGMA,
  the 0007 validation updates, or SQLite trigger semantics.
- Sites exposes no hosted D1 query, migration ledger, reset, or reprovision
  capability. Version 7 never returned a Worker URL, so hosted user writes
  were impossible. Its failed migration may still have left schema objects
  before the first trigger.

### Retry-safe pre-production migration normalization

- Historical migrations 0000–0007 remain preserved in Git and immutable Sites
  versions but are absent from the corrected package.
- The new monotonic chain uses:

  - `0008_preproduction_reset.sql` — 49 idempotent child-first drops for the
    nine known triggers, three rebuild remnants, and 37 final tables.
  - `0009_sites_compatible_baseline.sql` — 37 retry-safe table creates.
  - `0010_sites_compatible_indexes_a.sql` — 38 retry-safe index creates.
  - `0011_sites_compatible_indexes_b.sql` — 37 retry-safe index creates.

- Every file contains at most 49 single statements. No packaged migration
  contains `CREATE TRIGGER`, `ALTER TABLE`, `PRAGMA`, a rename/rebuild
  sequence, or a trigger body.
- The final generated schema has 37 application tables, 75 explicit indexes
  including 32 unique indexes, 102 foreign keys, and 40 checks.
- `npm.cmd run db:generate` reports those 37 tables, no schema drift, and no
  new migration.
- Exhaustive regression coverage retries every cut point in the reset and
  baseline/index chains. It also recovers a representative failed-version-7
  prefix and all three known `__new_*` rebuild remnants.
- A malformed/truncated packaged statement fails with `incomplete input`
  rather than being accepted.
- This destructive reset is authorized only because no production Worker or
  hosted user data ever existed. It must never be reused after the first
  successful deployment.

### Persistent database-enforced guard installation

- `database_invariant_state` stores a persistent singleton version,
  64-character trigger fingerprint, and verification time.
- Before any application dispatch in each Worker isolate, the server-only D1
  initializer verifies:

  - marker version and fingerprint;
  - the exact normalized `sqlite_master` definitions and names of all nine
    expected triggers;
  - zero cross-organization public-club-profile violations;
  - zero cross-organization public-event-detail violations.

- A missing or mismatched state is repaired in one atomic prepared D1 batch:
  marker delete, nine trigger drops, nine complete trigger creates, two
  aborting integrity probes, and one guarded marker upsert.
- Only successful per-binding promises are cached. Separate Worker isolates
  still verify the persistent marker and database definitions.
- Concurrent isolate-style initialization is idempotent and ends with one
  marker and the exact nine-trigger set.
- Malformed pre-existing public rows abort the entire batch, leaving no marker
  and no partial trigger installation. After repair, initialization succeeds.
- The two current organization-wide reservation triggers and seven
  public-organization-integrity triggers remain database-enforced. Conflict
  status, hold expiry, venue/organizer/buffer reasoning, organization-wide
  overlap, public consent, and cross-organization integrity guarantees were
  not weakened.
- If initialization fails, the Worker does not call the application handler.
  It logs only the allowlisted operational code and returns a no-store,
  noindex 503 without SQL, identity, or private-content details.

### Verification evidence

Commands were run from `C:\Users\user\Documents\Website` on 2026-07-25.

- `npm.cmd ci` — first attempt exited 1 because two completed local Miniflare
  reproducer processes retained a Windows lock on the workspace
  `workerd.exe`. The exact workspace processes were stopped. The unchanged
  command then exited 0: 503 packages installed from `package-lock.json`.
- `npm.cmd run db:generate` — exit 0; 37 tables; no drift and no generated
  migration.
- One non-operative command typo, `npm.cmd run db:migrate:local`, exited 1
  because that script does not exist; it changed no state. The supported
  `db:apply:local` and `db:apply:preview` commands below both passed.
- First normalized `npm.cmd run db:apply:local` — exit 0; migrations applied as
  49, 37, 38, and 37 statements.
- Final `npm.cmd run db:apply:local` — exit 0; four migrations already applied;
  37 application tables, nine exact invariant triggers, zero foreign-key
  violations.
- First and final `npm.cmd run db:apply:preview` — exit 0 with the same
  statement counts and final 37-table/nine-trigger/zero-violation signature in
  the Sites local preview D1.
- `npm.cmd run typecheck` — exit 0 under strict TypeScript.
- Exact `npm.cmd run lint` before and after retained build/work artifacts —
  exit 0; no lint rule was disabled.
- `npm.cmd test` — exit 0; **103/103 passed**, 0 failed, 0 skipped.
- `npm.cmd run build` — exit 0; vinext produced the complete Phase 2 Worker and
  route set.
- `npm.cmd run test:rendered` — exit 0; **13/13 passed**, 0 failed, 0 skipped.
  It applies the exact `dist/.openai/drizzle` files through semicolon
  tokenization, proves zero migration-installed triggers, initializes and
  fingerprints all nine runtime guards, exercises conflict/public-integrity
  rejection, checks 37 tables/75 indexes/zero FK violations, rejects truncated
  packaged SQL, and reruns public/private/security/error behavior.
- `git diff --check` — exit 0.
- Source and built privacy scan — zero exact official private feed URLs, Gmail
  addresses, client iCalendar paths, `source_url`, `normalized_email`,
  `INITIAL_OWNER_EMAIL`, private sentinels, Windows user paths, or packaged
  master artwork.
- `npm.cmd audit --omit=dev --json` — exit 1 with 3 high, 0 critical
  production advisories.
- `npm.cmd audit --json` — exit 1 with 18 advisories: 1 low, 4 moderate, 13
  high, 0 critical.
- No forced dependency upgrade was applied to the pinned Sites runtime.

### Changed source

- Schema/migrations: `db/schema.ts`, `drizzle/0008_*` through `0011_*`, and
  aligned Drizzle journal/snapshots.
- Runtime: `lib/server/database/invariants.ts`,
  `lib/server/conflicts/guard-sql.ts`, and `worker/index.ts`.
- Migration harness: `package.json`, local/preview migration scripts.
- Regression coverage: database invariant, conflict, Meetup,
  public-integrity, public catalog/projection, production-tokenizer,
  partial-retry, and rendered-Worker tests.
- Documentation: `README.md` and ADR
  `docs/architecture/0006-sites-d1-trigger-compatibility.md`.

## Implemented but not externally verified

- The corrected hosted migration and persistent nine-trigger marker are
  implemented and production-contract tested but not externally verified
  until the next owner-only Sites deployment succeeds.
- Hosted Home, Events, sitemap, Meetup refresh, SIWC owner persistence, and
  hosted D1/R2 bindings retain their Phase 2 implementation but await the same
  deployment.
- The failed version-7 D1 state cannot be inspected. Migrations 0008–0011 are
  deliberately idempotent and reset only the known unservable pre-production
  application schema.

## Not implemented

- Phase 3 invitations/team/event-editor/settings/CMS/media workflows.
- Conflict review/override UI, public submission forms, email, payments,
  donations, internal RSVP, attendee accounts, comments, chat, forums, QR
  downloads, or calendar export.
- No Phase 3 code or dead controls were added.

## Not run

- Corrected hosted browser checks — not run until the corrected Sites version
  is saved and deployed owner-only.
- Real interactive event smoke — not run because the review database has no
  real published event and fake production events are prohibited.
- Second authenticated identity denial — not run because the custom outer
  access policy allows only the owner.
- R2 upload/read — not run because upload UI is outside Phase 2.
- Lighthouse/Core Web Vitals and automated axe — not run; no corrected hosted
  URL exists yet and axe is not part of the pinned starter.

## Blocked

- Direct remote D1 inspection/reset is unavailable in the Sites capability.
  The corrected monotonic, retry-safe pre-production baseline is the safe
  recovery path authorized for this no-data project.
- Remaining factual owner inputs: exact BC legal identity/status/footer and
  charity wording; exact Meetup discussion URL; approved final copy; approved
  organizer names/biographies; real photos with rights/credit/consent;
  event-specific venue/accessibility facts.

## Sites version and deployment state

- Existing Sites versions 1–7 remain preserved.
- Version 7 is unpublished, failed before publication, and superseded for
  deployment.
- Corrected source commit/archive/new Sites version: pending the final clean
  source freeze and provenance audit.
- Access remains custom owner-only: one allowed account and zero groups.
- Runtime revision remains 1 with only `INITIAL_OWNER_EMAIL` stored as a
  redacted secret.
- Custom domains: none.
- Preview URL: none.
- Live URL: none.
- Public access: not enabled.

## Awaiting owner smoke test

Status: **Awaiting owner smoke test — pending corrected owner-only deployment.**

Five-minute owner card after a URL is returned:

1. Open Home and Events; confirm both render without a migration/database
   error and the event state is truthful.
2. At phone width, confirm the mark, menu, four lanes, three featured clubs,
   filters, and Clear Filters work without sideways scrolling.
3. Open Organizer Login signed out; confirm Sites-owned Sign in with ChatGPT is
   required and the route is noindex.
4. Sign in as Reza; refresh and confirm owner access persists.
5. If a second allowed test identity later exists, confirm an authenticated
   but uninvited identity is denied.

## Next phase

**Phase 3 — Not started. Stop after the owner-only deployment handoff.**
