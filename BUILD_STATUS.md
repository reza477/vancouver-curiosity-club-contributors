# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-24 (America/Vancouver)

## Active phase and authorized scope

- Phase 1 Sites foundation and its independent audit gate:
  **Completed and verified**.
- Current authorized work: the narrow owner-input continuation that maps three
  supplied official Meetup groups to three exact program records, configures
  the existing Sites owner identity as the bootstrap secret, and proves the
  live feeds through an isolated production-compatible local D1.
- Current owner-input continuation: **Completed and verified** in the supported
  local Sites/Miniflare environment.
- Unpublished Sites version 3: **Superseded** by the post-save publication
  audit. It remains unpublished and must not be deployed.
- Corrected unpublished Sites version 4: **Saved and provenance-verified** from
  exact source commit `c3cd5811833c3a61f8f2b4ce5d8f0c7fa8fcbe28`;
  no preview or production deployment occurred.
- `INITIAL_OWNER_EMAIL`: **Configured** as a secret in Sites runtime revision 1
  from the existing project access metadata without printing or committing the
  value. It remains inactive until a future deployment.
- Hosted Meetup connection: **Not run** because this packet forbids deployment.
  The supplied feeds were exercised only in an isolated local D1; hosted
  production imported data remains intentionally empty.
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
- **Completed and verified** — The 934,997-byte master artwork is preserved in
  `design-assets/` rather than `public/`. Only optimized consumer assets ship;
  the rebuilt `dist/client` is 1,459,683 bytes and the master asset returns 404.

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
- **Completed and verified** — The protected Owner/Administrator form requires
  an explicit accessible program selector. The API and domain service validate
  the selected club ID against the actor's organization and verify that the
  normalized feed group slug matches the exact program record before writing.
  No connection-order, unbound-club, or hash-derived fallback remains.
- **Completed and verified** — All six connection orders preserve these exact
  mappings:

  - Vancouver Curiosity Club — https://www.meetup.com/vancouver-meetup-group/
  - Vancouver Literature and Film —
    https://www.meetup.com/vancouver-literature-and-film/
  - Vancouver Fantasy & Sci-Fi Group —
    https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/

  These clean public group pages are confirmed Phase 2 inputs only. No public
  per-program URL field or page was implemented in this packet.
- **Completed and verified** — Mismatched, nonexistent, and
  cross-organization club selections are rejected before creating a sync
  source or configuration audit record. Regression tests also prove the exact
  safe `{id, name}` selector payload contains no feed/source/organization data.
- **Completed and verified** — A real smoke import fetched all three supplied
  official calendars through the production domain/fetch path into an isolated
  in-memory migrated D1. The feeds completed in 4, 4, and 1 bounded requests.
  The time-sensitive snapshot contained 23 source rows: 13 accepted active
  snapshots and 10 safely stored `conflict_rejected` rows under the existing
  organization-wide reservation policy. All 13 accepted rows were available
  through the public Meetup projection.
- **Completed and verified** — The live smoke checked each club identity plus
  real title, time, status, and official RSVP link; raw descriptions and
  locations were neither persisted nor published. Source isolation held, and
  a deliberately incomplete later generation left the prior public result
  byte-for-byte unchanged. No fetched body or local D1 file was retained.
- **Completed and verified** — Meetup changed ignored raw iCalendar bytes
  between requests while parsed import facts stayed identical. Generation
  identity now hashes the normalized validated facts that affect import,
  ordering, reconciliation, or publication. A regression proves ignored
  calendar decoration and discarded descriptions/locations cannot restart a
  cursor, while meaningful event changes still alter the generation identity.
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
- **Completed and verified** — The general/manual public projection excludes
  every canonical event with Meetup source-link history, including a
  soft-deleted link. Source-backed rows can publish only through the completed
  active-generation Meetup projection. A dual-projection regression proves a
  changed/new partial generation and failed continuation expose neither staged
  titles nor rows, while an unrelated manual public event remains available.
- **Completed and verified** — Only a cursor-complete successful finalization
  advances the active generation pointer. An unsolicited `304`, failed later
  chunk, stale lease, or incomplete cursor cannot publish staged rows. Tests
  assert active/pending pointers plus staging/published state before, during,
  and after finalization.
- **Completed and verified** — Cursor-complete source-scoped reconciliation
  cancels, unpublishes, and soft-retires previously mapped future events absent
  from the completed snapshot. It never runs on a partial/error generation,
  another source, or a manually managed event; exact `removed` counts are
  returned and audited, and a later reappearance is importable again.
- **Completed and verified** — Reconciliation preserves a shared canonical
  event while another source's active snapshot remains `confirmed` or
  `tentative`. Regression coverage also removes two absent events in one
  finalization and proves both returned and persisted `removed_count` equal 2.
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
- **Completed and verified** — The separate general/manual SQL allowlist cannot
  expose canonical Meetup rows from a first, partial, failed, disabled, retired,
  or later generation; it excludes any Meetup source-link history independently
  of source state.
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
- Focused Meetup/auth command (`node --import tsx --test` over
  `tests/auth/*.test.mjs` and `tests/meetup/*.test.mjs`) — **Completed and
  verified**; 40/40 tests passed.
- `npm.cmd test` — **Completed and verified**; 78/78 unit and integration tests
  passed.
- `npm.cmd run build` — **Completed and verified**; routes `/`, `/calendar`,
  `/organizer`, `/organizer/meetup`, organizer APIs, and session API built.
- `npm.cmd run test:rendered` — **Completed and verified**; 6/6 built-Worker
  tests passed, including freshly migrated empty calendar, icon, manifest,
  unoptimized-source exclusion, nonce CSP, SIWC redirect/noindex, and private
  API behavior.
- Browser desktop and 390×844 verification — **Completed and verified**; zero
  horizontal overflow, zero fake event cards, zero exposed feed URLs, correct
  not-connected state, visible icon, correct SIWC redirect, no hydration error,
  and a fresh verification tab with no warning/error console entries.
- Source/build secret and feed scan — **Completed and verified**; no runtime
  owner value, concrete official iCal URL, private token, Sites credential, or
  bypass token appears in tracked/intended source, `dist/client`, or
  `dist/server`. Older concrete iCal test literals were replaced with
  runtime-composed examples; the final source/build scans report zero matches.
- `git diff --check` — **Completed and verified**; clean apart from Git's
  informational LF-to-CRLF working-copy warnings.
- `npm.cmd audit --omit=dev --json` — **Not a clean pass**; 3 high
  findings in the pinned production tree (`next`, transitive `postcss`, and
  transitive `sharp`).
- `npm.cmd audit --json` — **Not a clean pass**; 18 findings: 1 low,
  4 moderate, and 13 high.
- Dependency-audit disposition — no finding was hidden or force-fixed. The
  pinned supported Sites starter has no verified safe in-range resolution for
  the complete tree; forcing framework/runtime upgrades would be an unverified
  platform change. The saved archive contains built output, not `node_modules`.
- Historical version 3 source handoff — exact tested source
  commit `cf083cdbfa6e746d7edf3f2ff2ea81c43230fd5f` was pushed to the configured
  Sites source branch before that version save.
- Historical version 3 provenance — unpublished version 3 points to that
  commit. Its saved archive reports SHA-256
  `6526bf36c67667b97b3f4974e2e4174df45ed6fd1a1a74866eff7e40af9d9df4`,
  4,884,480 bytes, and 67 files. The version is superseded and was never
  deployed.
- Corrected version 4 source handoff — exact tested source commit
  `c3cd5811833c3a61f8f2b4ce5d8f0c7fa8fcbe28` was pushed to the configured
  Sites source branch before the version save.
- Exact pre-save archive audit — the archive contained exactly the 66 files in
  the verified `dist` tree, including the Sites entrypoint, hosting metadata,
  and migrations. It contained no `node_modules`, `.git`, `.env`,
  `design-assets`, master icon, private feed material, or credential pattern.
  The uploaded gzip was 1,616,557 bytes with local SHA-256
  `df48a76f93c9e23eb833721894b94fdab917c07cb6d9a0e1f96bf10df62601b3`.
- Sites version 4 provenance readback — unpublished version 4 points to exact
  commit `c3cd5811833c3a61f8f2b4ce5d8f0c7fa8fcbe28`. Sites reports archive
  content SHA-256
  `36e4be0461cb7374c5e721c427eee1b9925c385f36e904a4d26e2f5fe7258d44`,
  3,942,400 bytes, and 66 files. Project readback reports version 4 as latest
  with both preview and live URLs unset.

## Implemented but not externally verified

- **Implemented but not externally verified** — Sites-managed remote D1/R2 and
  hosted SIWC persistence. Local production-compatible D1/Worker paths pass,
  but no public deployment exists.
- **Implemented but not externally verified** — Owner connection/refresh
  controls with Reza's hosted identity. The secret runtime value is configured
  but cannot become active until a future owner-authorized deployment.

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

- **Not run** — Hosted Sites-managed D1 import. Exact reason: this packet
  forbids deployment, so the runtime secret is not active and the private feeds
  were not entered into hosted D1. The equivalent real-feed import completed
  successfully against isolated production-compatible local D1.
- **Not run** — Hosted SIWC owner persistence test. Exact reason:
  `INITIAL_OWNER_EMAIL` is configured as a secret but no hosted version is
  deployed.
- **Not run** — Second-real-identity denial smoke test. Exact reason: no second
  authenticated ChatGPT test identity was supplied; the equivalent automated
  denial test passes.

## Blocked

- **Blocked** — Runtime activation and hosted owner/feed smoke testing require
  a deployment, which this packet explicitly forbids. No deployment was made
  merely to activate the secret.
- No blocker remains for the completed implementation, local verification,
  exact source push, archive inspection, or the next unpublished version save.

## Missing owner inputs

See `OWNER_INPUTS.md`. No value was invented:

- exact public Meetup discussion URL
- owner-selected real RSVP URLs for a later hosted smoke test
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
- Superseded unpublished version 3 source commit:
  `cf083cdbfa6e746d7edf3f2ff2ea81c43230fd5f`
- Superseded unpublished version: version 3; never deployed.
- Corrected source commit:
  `c3cd5811833c3a61f8f2b4ce5d8f0c7fa8fcbe28`
- Corrected unpublished version: version 4; provenance verified and not
  deployed.
- Latest saved version: version 4.
- Current Sites preview URL: none.
- Current Sites live URL: none.
- Production deployment: none.
- Public access: not enabled.
- Credentials or runtime values committed: none.

## Owner smoke test

**Awaiting owner smoke test**

1. Open the preview or owner-only hosted version.
2. Confirm signed-out `/organizer` requires Sign in with ChatGPT and is noindex.
3. After a future deployment activates the configured
   `INITIAL_OWNER_EMAIL` runtime secret, sign in as Reza.
4. Open `/organizer/meetup`, save each exact official group feed, and request
   refresh until no result is partial.
5. Refresh `/calendar`; confirm source status, Vancouver times, real titles, and
   each real **RSVP on Meetup** link.
6. Confirm an authenticated but uninvited test identity cannot enter, when a
   second test identity is available.

## Exact next phase

- Phase 2 — **Not started**.
