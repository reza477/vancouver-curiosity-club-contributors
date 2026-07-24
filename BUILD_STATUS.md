# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-23 (America/Vancouver)

## Active phase and authorized scope

- Active phase: Phase 1 — Sites foundation.
- Authorized scope: Phase 1 packet only, including the six required independent-audit fixes, the production CSP hardening evaluation, and the final club-authorization/public-attribution read-only audit corrections.
- Overall truth label: **Completed and verified** in the supported local Sites/Miniflare environment.
- Owner-controlled hosted identity smoke test: **Awaiting owner smoke test**.
- Phase 2 and all later product surfaces: **Not started**.

## Completed and verified

### Isolation, project control, and design

- **Completed and verified** — The target directory was empty before initialization.
- **Completed and verified** — One isolated copy of the official Sites vinext starter was initialized in this directory. No prior Site, repository, project ID, source, design, content, data, storage, or configuration was inspected or reused.
- **Completed and verified** — One fresh Sites project was created exactly once. `.openai/hosting.json` contains only the returned opaque `project_id` and logical bindings `DB` (D1) and `MEDIA` (R2).
- **Completed and verified** — `MASTER_BUILD_SPEC.md` is unchanged from the canonical reference. Both SHA-256 values are `46036D0DBD6DBD81E05AE4EB40412F1C7BB211592D76840AC7B62332324E51A1`.
- **Completed and verified** — The required three substantive directions were prepared from shared content: Field Notes, Bookshop Board, and Poster Press. Reza selected **Field Notes**.
- **Completed and verified** — The Field Notes foundation is responsive, mobile-first, keyboard-visible, reduced-motion aware, and clearly labels all fictional development event content. It makes no fabricated legal, charity, attendance, award, organizer, testimonial, URL, or historical claim.
- **Completed and verified** — Durable control files, architecture records, names-only `.env.example`, local instructions, and owner-input ledger are current.

### D1 schema and migrations

- **Completed and verified** — The normalized D1/SQLite schema defines 31 product tables, including every Phase 1 foundation entity required by the packet, with organization scope, foreign keys, indexes, unique slugs, timestamps, actor references, soft deletion where appropriate, and optimistic schedule versions.
- **Completed and verified** — Database access remains behind a server-only helper, uses prepared statements, and uses `DB.batch()` for related atomic writes.
- **Completed and verified** — Generated migrations `0000_remarkable_mordo.sql` and `0001_outgoing_madelyne_pryor.sql` apply from an empty local D1-compatible database and reapply idempotently.
- **Completed and verified** — Migration SHA-256 values are:
  - `0000`: `55DC59F954F0BD5988BF694421A3012E14D2DCE7B1201EFA20028B8774F25367`
  - `0001`: `6A0DE4962CB1C32AE55E10C454699563D4A835A05DCFB3305EE216D45B698BAF`
- **Completed and verified** — Only clearly labeled development/test data exists. No fake production statistics, organizers, testimonials, URLs, awards, legal claims, or event history are published.

### Authentication and authorization

- **Completed and verified** — Public routes remain available while `/organizer`, organizer APIs, invitation routes, and private actions require Sites-owned Sign in with ChatGPT identity plus server-side D1 authorization.
- **Completed and verified** — SIWC is treated as identity only. Client-provided email, role, organization, membership, club assignment, and identity headers are not trusted.
- **Completed and verified** — Email normalization, active/non-suspended organization membership, Owner/Administrator/Organizer roles, and club assignment are enforced server-side.
- **Completed and verified** — Whenever a central authorization request supplies a `clubId`, that club must exist, remain active, and belong to the authenticated membership’s organization for every role. Owner and Administrator retain organization-wide semantics only after that ownership check; Organizer additionally requires an active assignment.
- **Completed and verified** — An authenticated but uninvited identity is denied in automated tests.
- **Completed and verified** — `INITIAL_OWNER_EMAIL` exists only as an environment-variable name. A fresh migrated database can atomically establish the first working organization and Owner without manual data seeding, only when no Owner exists and the authenticated normalized email matches the runtime value.
- **Completed and verified** — Two concurrent bootstrap attempts create exactly one Owner; rejected/failed attempts leave no organization, profile, membership, or bootstrap residue.
- **Completed and verified** — Invitation tokens contain 256 bits of cryptographic randomness; only SHA-256 hashes are stored. Invitations bind normalized target email, intended role, organization, creator, expiry, revoked state, and used state. Acceptance requires matching SIWC identity and atomically consumes the invitation with membership creation.
- **Completed and verified** — Invitation creation and acceptance reject a club belonging to another organization, with no invitation or membership residue.
- **Completed and verified** — Invitations are copyable links only. No email-delivery claim is made.

### Public/private projection and validation

- **Completed and verified** — Public event responses use an explicit allowlisted SQL/DTO projection; they do not fetch full private records and hide fields in presentation.
- **Completed and verified** — Drafts, holds, conflict data, override reasons, private notes, private venue/meeting details, organizer emails, invitations, audit history, account identifiers, raw identity, submissions, and other private fields are absent from public responses.
- **Completed and verified** — Public organizer attribution requires both profile-level `public_attribution_consent`, default false, and per-event `is_publicly_listed`. The leakage suite explicitly exercises the complete 2 × 2 matrix: yes/yes includes the name; yes/no, no/yes, and no/no exclude it.
- **Completed and verified** — Centralized server validation and safe errors cover malformed inputs without returning private content.
- **Completed and verified** — Structured logs exclude secrets, raw identity, invitation tokens, private content, and submitted values.

### Timezone foundation

- **Completed and verified** — The default IANA zone is `America/Vancouver`.
- **Completed and verified** — Timed events store UTC instants with their original IANA timezone; all-day events use calendar dates rather than midnight UTC.
- **Completed and verified** — Automated tests cover Vancouver DST changes, overnight and multi-day events, all-day dates, Intl-recognized zones, invalid zones, end-before-start, and zero-duration events.

### Atomic D1 conflict-write proof and six audit fixes

- **Completed and verified** — Generated SQLite `BEFORE INSERT` and `BEFORE UPDATE` triggers enforce the reserving-write invariant on the production-compatible D1 path. The application never relies on a separate `SELECT` followed later by a reserving mutation.
- **Completed and verified** — A reserving create/update, immutable revision, normalized organizer associations, assertion, and content-free audit record execute in one `DB.batch()`. A trigger abort or zero affected rows is failure, never success.
- **Completed and verified** — A synchronized concurrent-save integration test against the same empty slot proves at most one unreviewed reserving write succeeds.
- **Completed and verified** — Audit blocker 1 fixed: a genuinely empty migrated D1 can bootstrap the first organization and Owner atomically, including concurrent bootstrap coverage.
- **Completed and verified** — Audit blocker 2 fixed: cross-organization club IDs are rejected for authorization, invitation creation, and invitation acceptance with no residue.
- **Completed and verified** — Audit blocker 3 fixed: `schedule_review_state` cannot bypass the guard. Reviewed/overridden reserving events remain visible to future conflicts; Phase 1 exposes no generic override bypass.
- **Completed and verified** — Audit blocker 4 fixed: `hold_expires_at` is persisted. An active hold blocks, an expired hold does not, and equality at the database-time boundary is expired without a scheduler.
- **Completed and verified** — Audit blocker 5 fixed: public organizer names require both profile-level opt-in and per-event selection.
- **Completed and verified** — Audit blocker 6 fixed: direct buffered overlaps block across the whole organization, including different clubs, different venues, and different organizers. A regression test proves exactly one competing write succeeds in that case.
- **Completed and verified** — Final read-only audit finding fixed: the central `authorizeMembership()` primitive rejects nonexistent and cross-organization supplied clubs for Owner, Administrator, and Organizer. Valid same-organization clubs retain Owner/Administrator organization-wide access, while Organizer still requires its assignment.
- **Completed and verified** — Final documentation/test gap fixed: all four public-attribution consent/listing combinations are now explicit regression cases rather than an untested ledger claim.
- **Completed and verified** — Venue, primary/co-organizer scope, buffers, reserving statuses, and the complete normalized interval remain available for deterministic private conflict reasoning.
- **Completed and verified** — No schedule-reserving UI or API is exposed in Phase 1.

### Security, build, and visual validation

- **Completed and verified** — Production CSP no longer contains generic `script-src 'unsafe-inline'` or `'unsafe-eval'`. Each production request receives a cryptographically random 128-bit nonce; vinext propagates it to every rendered script, and two requests receive different nonces.
- **Completed and verified** — The Worker overwrites untrusted incoming CSP/nonces, removes report-only injection, sets `script-src-attr 'none'`, and preserves the relaxed inline/eval policy only for local HMR.
- **Completed and verified** — The built Worker regression suite confirms all rendered scripts carry the response nonce, the bootstrap remains functional, same-origin assets resolve, private routes remain noindex, and built output leaks no local filesystem path.
- **Completed and verified** — Practical security headers, CSP, central error boundaries, accessible landmarks/focus states, mobile-first base styles, and reduced-motion handling are installed.
- **Completed and verified** — Desktop and 390 × 844 mobile previews rendered without runtime errors or horizontal overflow. Signed-out `/organizer` redirected to the SIWC entry route and remained noindex.
- **Completed and verified** — No development credential, production mock state, alternate hosting/database/auth provider, custom domain, billing detail, or secret was introduced.

## Exact commands, tests, and results

- Empty-directory check: `Get-ChildItem -Force` — passed; `0` items before initialization.
- Official initializer compatibility: the bundled initializer was Bash-only and Bash/WSL was unavailable on this Windows host. Its supported starter operations were applied once with PowerShell: copy the untouched official starter, initialize local Git on `main`, and run its locked npm install. No second initialization occurred.
- Initial dependency install: `npm.cmd ci --ignore-scripts --prefer-offline --no-audit --no-fund` — passed; `503` packages installed from the starter lockfile. Phase 1 direct test/validation dependencies brought the final installed total to `504`.
- Lockfile verification: `npm.cmd install --package-lock-only --ignore-scripts` — passed.
- Canonical-spec integrity: PowerShell SHA-256 comparison — passed; source and destination hashes match exactly.
- Migration generation: `npm.cmd run db:generate` — passed; Drizzle reported `31 tables` and `No schema changes, nothing to migrate`.
- Local migration application: `npm.cmd run db:apply:local` — passed and idempotent; `2` migrations, `33` total SQLite tables including migration metadata, and `2` conflict-guard triggers.
- Type checking: `npm.cmd run typecheck` — passed with strict TypeScript.
- Linting: `npm.cmd run lint` — passed without blanket suppression.
- Full unit/integration suite after the final read-only audit fixes: `npm.cmd test` — passed, `41/41` tests.
- Production build: `npm.cmd run build` — passed; built routes `/`, `/api/organizer/session`, and `/organizer`.
- Built Worker/Miniflare integration suite: `npm.cmd run test:rendered` — passed, `4/4` tests after the final production build.
- Browser preview: supported `npm.cmd run dev` flow — healthy at `http://localhost:3000/`; desktop and 390 × 844 checks passed, signed-out organizer redirect/noindex passed, and no hydration/runtime error remained after a clean preview restart.
- Sites source push: commit `1d6a525c5fe332780ef9407deba24927a0ac5271` — passed to the fresh project’s configured `main` source branch.
- Sites version save and provenance read-back — passed; validated saved version **1** records source commit `1d6a525c5fe332780ef9407deba24927a0ac5271`. Saving did not deploy it.
- Production dependency audit: `npm.cmd audit --omit=dev --audit-level=low` — ran and returned findings, not a clean pass: `3 high` findings in the production dependency tree (`next`, transitive `postcss`, and `sharp`).
- Full dependency audit: `npm.cmd audit --audit-level=low` — ran and returned `17` findings: `1 low`, `4 moderate`, and `12 high`.
- Audit disposition: no finding was hidden or force-resolved. The pinned Sites starter dependency graph has no verified safe in-range resolution for all findings; a forced framework/runtime upgrade would be an unverified platform change. The saved artifact contains the built Worker, not `node_modules`. Re-evaluate against the supported Sites starter/runtime during hardening.

## Implemented but not externally verified

- **Implemented but not externally verified** — Sites-managed D1 (`DB`) and R2 (`MEDIA`) are declared and exercised through the production-compatible local Worker/Miniflare path, but managed remote bindings are not exercised because Phase 1 intentionally has no deployment.
- **Implemented but not externally verified** — Hosted SIWC identity headers, first-owner bootstrap, and persistent organizer access are implemented and locally/integration tested, but cannot be externally smoked until Reza supplies `INITIAL_OWNER_EMAIL` in Sites runtime settings and opens an owner-only hosted version or equivalent supported identity preview.
- **Implemented but not externally verified** — R2 is configured as the logical `MEDIA` binding; upload product surfaces are later-phase work and no production file was uploaded.

## Not implemented

- **Not implemented** — Phase 2 and all later product surfaces.
- **Not implemented** — Schedule-reserving event UI/API, full conflict explanation UI, and version-bound intentional-overlap approval flow.
- **Not implemented** — Invitation email delivery. Phase 1 invitations are intentionally copyable links.
- **Not implemented** — Publication of unapproved legal details, charity status, Meetup URLs, real RSVP URLs, organizer biographies, photographs, or participant identities.
- **Not implemented** — Public deployment. Phase 1 explicitly forbids making the Site public.

## Not run

- **Not run** — Hosted SIWC owner smoke test and managed D1 membership persistence test. Exact reason: `INITIAL_OWNER_EMAIL` is owner-controlled and has not been supplied in Sites runtime settings, and no hosted version is deployed.
- **Not run** — Second-real-identity denial smoke test. Exact reason: a second authenticated ChatGPT test identity was not supplied. The equivalent authenticated-but-uninvited integration test passed.
- **Not run** — Managed R2 upload smoke test. Exact reason: Phase 1 configures the binding but does not expose an upload product surface.

## Blocked

- **Blocked** — None for the safe Phase 1 implementation and local completion gate.
- Missing owner inputs block hosted owner verification and production-content approval only; they do not block safe Phase 1 foundation work.

## Missing owner inputs

See `OWNER_INPUTS.md`. No missing value has been guessed:

- `INITIAL_OWNER_EMAIL`
- approved BC legal identity/status/footer/charity wording
- exact Meetup group and discussion URLs
- real event RSVP URLs
- approved public copy
- real photographs with rights, credit, and participant-consent state
- approved organizer names/biographies plus both public-attribution consent gates

## Authorized cuts

- None.

## Sites project, version, and deployment state

- Sites project: created exactly once and isolated to this new local project.
- Project ID: `appgprj_6a62eaf79c4881919bb8e47998af851a`.
- Logical D1 binding: `DB`.
- Logical R2 binding: `MEDIA`.
- Validated saved version: **Version 1**, sourced from commit `1d6a525c5fe332780ef9407deba24927a0ac5271`; provenance was read back successfully.
- Production deployment: none.
- Public access: not enabled.
- Credentials or runtime values committed: none.

## Owner smoke test

- **Awaiting owner smoke test**.

1. Open the preview or owner-only hosted version.
2. Confirm signed-out `/organizer` requires Sign in with ChatGPT and is noindex.
3. After `INITIAL_OWNER_EMAIL` is supplied in runtime settings, sign in as Reza.
4. Refresh and confirm owner access persists.
5. Confirm an authenticated but uninvited test identity cannot enter, when a second test identity is available.

## Exact next phase

- Phase 2 — **Not started**.
