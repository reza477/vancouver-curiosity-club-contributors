# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-24 (America/Vancouver)

## Active phase and authorized scope

- Phase 1 Sites foundation and its independent audit gate:
  **Completed and verified**.
- Current authorized work: a narrow post-Phase-1 follow-up replacing the brand
  icon and adding an official, one-way Meetup calendar synchronization path.
- Current follow-up implementation: **Completed and verified** in the supported
  local Sites/Miniflare environment.
- New unpublished Sites version: pending the final verified source commit and
  source push; no save or deployment has occurred during this follow-up yet.
- Live production Meetup connection: **Blocked** by both missing
  `INITIAL_OWNER_EMAIL` in Sites runtime settings and missing owner-supplied
  official group feed URL(s); production imported data is intentionally empty.
- Hosted identity and owner persistence: **Awaiting owner smoke test**.
- Phase 2 and all later master-spec product surfaces: **Not started**.

## Completed and verified

### Project isolation and Sites state

- The project remains isolated in the fresh directory and uses the single Sites
  project created during Phase 1. No prior project, asset, source, data, ID,
  design, or configuration was reused.
- `.openai/hosting.json` contains only the returned opaque project ID and logical
  `DB`/`MEDIA` bindings. Runtime values and feed configuration are not stored
  there.
- `MASTER_BUILD_SPEC.md` remains unchanged from the canonical reference. Its
  SHA-256 is
  `46036D0DBD6DBD81E05AE4EB40412F1C7BB211592D76840AC7B62332324E51A1`.
- No public deployment exists and public access is not enabled.

### Futuristic-and-timeless brand icon

- **Completed and verified** — A genuinely new original abstract mark replaces
  the disliked icon. It uses an aperture/interlocking-orbit form around a coral
  focal point, remains distinct at favicon size, and avoids skyline, maple-leaf,
  attendee-face, and generic AI-sparkle clichés.
- **Completed and verified** — The mark is integrated into the public wordmark,
  16/32/48/64 favicons, 180 Apple touch icon, 192/512 app icons, 512 maskable
  icon, web manifest, and 1200×630 social card.
- **Completed and verified** — PNG signatures, exact declared dimensions,
  metadata references, and manifest declarations are automated regression
  checks.
- **Completed and verified** — In the live browser the mark remains visible and
  legible at approximately 30 px in the 390×844 header and 40 px on desktop.

### Official Meetup calendar synchronization

- **Completed and verified** — Current primary Meetup documentation was checked
  before selecting the adapter. Meetup officially supports calendar export;
  new API OAuth consumers currently require an active Meetup Pro subscription
  and approval. The implementation therefore uses the official group
  iCalendar feed, not scraping, passwords, guessed URLs, GraphQL credentials,
  or write-back.
- **Completed and verified** — The integration is one-way. Meetup is
  authoritative for imported title, schedule, explicit status/cancellation,
  monotonic sequence/last-modified provenance, and official event RSVP URL.
- **Completed and verified** — Multiple official feeds are supported for this
  multi-club organization. The schema allows one active Meetup feed per club
  and multiple distinct feeds per organization, while preventing the same
  canonical feed from being attached twice.
- **Completed and verified** — Identical Meetup UIDs from different club feeds
  remain source-scoped and cannot collide.
- **Completed and verified** — Same-source configuration is idempotent. Source
  replacement gets a new source identity; old links cannot masquerade as the
  current source.
- **Completed and verified** — The fetcher enforces exact official HTTPS URLs,
  no query/hash/credentials, same-group redirect validation, no-store requests,
  conditional ETag/Last-Modified checks, a 12-second timeout, strict calendar
  content type, bounded streamed UTF-8, and maximum redirect/body limits.
- **Completed and verified** — The bounded parser safely handles `VTIMEZONE`,
  TZID-aware timed schedules, DST conversion, UID plus recurrence identity,
  explicit event/calendar cancellation, and safe rejection of unexpanded
  recurrence.
- **Completed and verified** — Isolated publication generations prevent chunk
  leakage. A pending generation stages title, status, schedule, and RSVP facts
  while the prior fully published generation remains byte-for-byte public
  through partial and error states. Pending rows and counters may change until
  finalization; published snapshots are immutable through the supported runtime
  path.
- **Completed and verified** — Pending source updates do not clear owner-managed
  summaries/descriptions or change visibility/publication state. Regression
  coverage proves an enriched public event and a hidden/unpublished event remain
  byte-for-byte stable through a later partial generation and failed
  continuation.
- **Completed and verified** — Only a cursor-complete successful finalization
  advances the active generation pointer. An unsolicited `304`, failed later
  chunk, stale lease, or incomplete cursor cannot publish staged rows.
- **Completed and verified** — Cursor-complete source-scoped reconciliation
  cancels, unpublishes, and soft-retires previously mapped future events absent
  from the completed snapshot. It never runs on a partial/error generation,
  another source, or a manually managed event; exact `removed` counts are
  returned and audited, and a later reappearance is importable again.
- **Completed and verified** — Explicit Meetup cancellations remain durable
  and excluded from the upcoming public projection. Stale source revisions
  cannot undo a newer cancellation.
- **Completed and verified** — Raw source description and location values are
  neither persisted nor published. They can contain private meeting details.
  Imported organizer names are not invented; existing public attribution still
  requires both consent gates.
- **Completed and verified** — Every accepted or mapped event row uses the
  Phase 1 database conflict trigger, immutable event revision, source link,
  sanitized import facts, and content-free audit record in atomic D1 batches.
  Parser, duplicate, all-day, and conflict rejections instead store sanitized
  rejected-row and audit evidence without inventing an event revision or source
  link.
- **Completed and verified** — Both successful and worst-case conflict-rejection
  paths process at most three calendar rows and remain at or below D1's
  documented 50-query Free Worker invocation ceiling.
- **Completed and verified** — Imports are resumable by snapshot hash and cursor.
  A request handles one source; partial snapshots continue in later manual or
  view requests without claiming or exposing a complete refresh.
- **Completed and verified** — Completed feeds wait at least 15 minutes before
  refresh-on-view. No background scheduler or guaranteed cadence is claimed.
- **Completed and verified** — Audit terminal records distinguish manual from
  refresh-on-view triggers.

### Organizer and public boundaries

- **Completed and verified** — `/organizer/meetup` requires Sites-owned Sign in
  with ChatGPT plus active server-side membership. Owner and Administrator may
  connect/refresh; Organizer has a coarse read-only state.
- **Completed and verified** — Mutation routes derive identity and role
  server-side, require exact same-origin requests, cap streamed request bodies,
  return private/no-store responses, and remain noindex.
- **Completed and verified** — Feed URLs, URL tokens, source IDs, organization
  IDs, raw upstream errors, and internal error codes are stripped from client
  and public DTOs.
- **Completed and verified** — Structured-log token validation drops URL/token
  shaped values. Leakage tests prove feed URLs and sentinel tokens are absent
  from public state, client state, safe errors, and structured logs.
- **Completed and verified** — `/calendar` uses an explicit public SQL allowlist
  and only publishes confirmed rows from the completed generation that exactly
  matches an enabled source's active pointer. Mutable pending-generation rows
  and source configuration values are not selected. It never fetches a private
  record and never hides fields in CSS.
- **Completed and verified** — The public page exposes honest not-connected,
  pending, partial, current, stale, disabled, and error states. Production is
  currently empty/not-connected rather than populated with invented events.

### Foundation guarantees preserved

- SIWC remains identity only; active D1 membership, role, suspension state, and
  validated club scope remain authoritative.
- First-owner bootstrap, invitation hashing/atomic acceptance, cross-organization
  club rejection, public attribution consent, timezone utilities, and the D1
  atomic conflict invariant remain covered by the full regression suite.
- Production CSP uses request nonces and has no generic production
  `script-src 'unsafe-inline'` or `'unsafe-eval'`. Private/identity paths remain
  noindex.
- No alternate host, external database, custom OAuth, email provider, paid
  account, custom domain, credential, or production mock state was introduced.

## Generated migrations

The D1/SQLite schema now contains 34 product tables. Six generated migrations
apply from an empty D1-compatible database:

- `0000_remarkable_mordo.sql` —
  `55DC59F954F0BD5988BF694421A3012E14D2DCE7B1201EFA20028B8774F25367`
- `0001_outgoing_madelyne_pryor.sql` —
  `6A0DE4962CB1C32AE55E10C454699563D4A835A05DCFB3305EE216D45B698BAF`
- `0002_warm_yellowjacket.sql` —
  `6924C403E9893F470FC6CB7A7251A1A809132B69FE0C3CAC49DA653C6E3F5A36`
- `0003_amusing_pyro.sql` —
  `95985D5BDD3E0228D60020542C4C4C2AF5DB820A40AC86873639C7D8B9EBC89F`
- `0004_milky_fallen_one.sql` —
  `6F13CFD528505ACC9CB73A24F7A1F37416371D32B99DEF81B3FC7C3C534654D9`
- `0005_dashing_ronan.sql` —
  `A0E975B2BEBE9B641ACFF1E8B26D02EF70DC65324EB982BF27082E1E05339422`

The generated `0003` and `0005` table-rebuild copies were corrected to
initialize new cursor/generation fields as `NULL` instead of selecting
nonexistent old columns. A generated-migration regression upgrades a populated
legacy partial source, preserves its configuration, and safely clears the
unpublishable legacy cursor. Both migration runners report zero foreign-key
violations.

## Exact verification commands and results

- `npm.cmd ci` — **Completed and verified**; after stopping the active
  workspace preview that held a native CSS binary open, 503 locked packages
  installed cleanly from `package-lock.json`.
- `npm.cmd run db:generate` — **Completed and verified**; Drizzle read all 34
  product tables and reported no schema changes after the existing generated
  `0005` publication-generation migration.
- `npm.cmd run db:apply:local` — **Completed and verified** and idempotent; 6
  migrations, 36 total local tables including migration metadata, 2
  conflict-guard triggers, and 0 foreign-key violations.
- `npm.cmd run db:apply:preview` — **Completed and verified** and idempotent;
  the same 6 migrations, 36 total preview tables, 2 triggers, and 0
  foreign-key violations in the Sites local preview D1.
- `npm.cmd run typecheck` — **Completed and verified**; strict TypeScript passed.
- `npm.cmd run lint` — **Completed and verified**; passed without blanket
  suppression.
- `npm.cmd test` — **Completed and verified**; 73/73 unit and integration tests
  passed.
- `npm.cmd run build` — **Completed and verified**; routes `/`, `/calendar`,
  `/organizer`, `/organizer/meetup`, organizer APIs, and session API built.
- `npm.cmd run test:rendered` — **Completed and verified**; 5/5 built-Worker
  tests passed, including freshly migrated empty calendar, icon, manifest,
  nonce CSP, SIWC redirect/noindex, and private API behavior.
- Browser desktop and 390×844 verification — **Completed and verified**; zero
  horizontal overflow, zero fake event cards, zero exposed feed URLs, correct
  not-connected state, visible icon, correct SIWC redirect, no hydration error,
  and a fresh verification tab with no warning/error console entries.
- `npm.cmd audit --omit=dev --json` — **Not a clean pass**; 3 high
  findings in the pinned production tree (`next`, transitive `postcss`, and
  transitive `sharp`).
- `npm.cmd audit --json` — **Not a clean pass**; 18 findings: 1 low,
  4 moderate, and 13 high.
- Dependency-audit disposition — no finding was hidden or force-fixed. The
  pinned supported Sites starter has no verified safe in-range resolution for
  the complete tree; forcing framework/runtime upgrades would be an unverified
  platform change. The saved archive contains built output, not `node_modules`.

## Implemented but not externally verified

- **Implemented but not externally verified** — A real official feed fetch
  against Reza's Meetup group. Exact official feed URLs were not supplied, so
  no production URL was guessed and no production event was imported.
- **Implemented but not externally verified** — Sites-managed remote D1/R2 and
  hosted SIWC persistence. Local production-compatible D1/Worker paths pass,
  but no public deployment exists.
- **Implemented but not externally verified** — Owner connection/refresh
  controls with Reza's hosted identity. `INITIAL_OWNER_EMAIL` is missing from
  runtime settings.

## Not implemented

- **Not implemented** — Phase 2 or any later master-spec product surface.
- **Not implemented** — Meetup write-back, OAuth/GraphQL credentials, scraping,
  password access, or a guaranteed scheduler.
- **Not implemented** — Non-cancelled all-day Meetup reservation import. It is
  rejected safely until the conflict engine can normalize all-day reserving
  intervals without midnight-UTC substitution.
- **Not implemented** — Publication of unapproved legal details, charity
  status, photographs, organizer biographies, or private meeting content.
- **Not implemented** — Public deployment.

## Not run

- **Not run** — Live Meetup production smoke test. Exact reason: no official
  owner feed URL or real event RSVP fixture was supplied.
- **Not run** — Hosted SIWC owner persistence test. Exact reason:
  `INITIAL_OWNER_EMAIL` is not present in Sites runtime settings and no hosted
  version is deployed.
- **Not run** — Second-real-identity denial smoke test. Exact reason: no second
  authenticated ChatGPT test identity was supplied; the equivalent automated
  denial test passes.

## Blocked

- **Blocked** — Importing Reza's actual Meetup events through the protected
  organizer flow requires `INITIAL_OWNER_EMAIL` in Sites runtime settings and
  the exact official group calendar feed URL(s). Neither was guessed or
  committed. The adapter, persistence, synchronization flow, public projection,
  and organizer controls are complete and locally tested.
- No blocker remains for safe implementation, local verification, source push,
  or saving a new unpublished Sites version.

## Missing owner inputs

See `OWNER_INPUTS.md`. No value was invented:

- `INITIAL_OWNER_EMAIL`
- official Meetup group calendar export/feed URL(s) and desired club mapping
- exact public Meetup group/discussion URLs and real RSVP smoke-test URLs
- approved BC legal identity/status/footer/charity wording
- approved public copy
- real photographs with rights, credit, and participant consent
- approved organizer names/biographies plus both attribution consents

## Authorized cuts

- None. The all-day behavior above is an explicit conservative safety limit,
  not a silent platform substitution.

## Sites project, version, and deployment state

- Sites project ID: `appgprj_6a62eaf79c4881919bb8e47998af851a`
- Logical D1 binding: `DB`
- Logical R2 binding: `MEDIA`
- Existing unpublished versions: versions 1 and 2 remain intact.
- New follow-up source commit/version: pending final verification and save.
- Production deployment: none.
- Public access: not enabled.
- Credentials or runtime values committed: none.

## Owner smoke test

**Awaiting owner smoke test**

1. Open the preview or owner-only hosted version.
2. Confirm signed-out `/organizer` requires Sign in with ChatGPT and is noindex.
3. After `INITIAL_OWNER_EMAIL` is supplied in runtime settings, sign in as Reza.
4. Open `/organizer/meetup`, save each exact official group feed, and request
   refresh until no result is partial.
5. Refresh `/calendar`; confirm source status, Vancouver times, real titles, and
   each real **RSVP on Meetup** link.
6. Confirm an authenticated but uninvited test identity cannot enter, when a
   second test identity is available.

## Exact next phase

- Phase 2 — **Not started**.
