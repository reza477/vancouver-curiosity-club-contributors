# Developer handoff

This is the current starting point for anyone maintaining Vancouver Curiosity
Club. Read it before the historical phase documents.

## What you are working on

- Production: [vancouvercuriosityclub.com](https://vancouvercuriosityclub.com)
- Supported source baseline: Version 1.0 (`v1.0.0`)
- Application: React 19 with Next.js App Router APIs, compiled by vinext
- Runtime: Cloudflare Worker managed by ChatGPT Sites
- Data/media: Sites-managed D1 and R2 bindings named `DB` and `MEDIA`
- Authentication: Sign in with ChatGPT plus server-side membership and roles
- Event source: one-way Meetup synchronization, refreshed by the protected
  manual GitHub Actions workflow or an authorized organizer action; ordinary
  visitor requests only read the last completed publication

GitHub CI validates source, tests, and the built Worker. It does **not** deploy
production. Production access, settings, data, media, and Sites releases remain
owner-controlled.

## First 15 minutes

This is the public contributor repository. Anyone may inspect or fork it;
direct branch access is limited to collaborators. Authenticate GitHub HTTPS or
SSH before pushing. `"private": true` in `package.json` prevents accidental npm
publication and does not describe GitHub visibility. Production credentials,
data, publishing access, and release operations remain owner-controlled.

Install Git, Node.js matching [.nvmrc](.nvmrc), and npm. Then:

Node 22.16.0 is the minimum because the integration harness uses the built-in
SQLite statement metadata and synchronous module-hook APIs introduced in that
release line. Earlier Node 22 versions can install and build the app but cannot
run the complete test suite.

```bash
git clone https://github.com/reza477/vancouver-curiosity-club-contributors.git
cd vancouver-curiosity-club-contributors
npm ci
npm run db:apply:preview
npm run dev
```

Vite prints the local URL (normally `http://localhost:5173`). Windows
PowerShell users can replace `npm` with `npm.cmd` if execution policy blocks
`npm.ps1`. The preview migration command prepares the same ignored local D1
path used by Vite. `db:apply:local` is a separate migration-proof database and
is not the ordinary dev-server setup command.

Fresh local D1 contains schema, not a copy of production content. Empty states
are expected and there is currently no reusable synthetic dev seed. Never copy
production data into local development. Most public work needs no secret.
`INITIAL_OWNER_EMAIL` participates in bootstrap logic, but ordinary local Vite
cannot reproduce Sites-owned identity dispatch by itself; use the existing
auth/integration fixtures for organizer work unless the owner provides an
authorized Sites test environment. Never commit a real identity.

## Architecture at a glance

```text
request
  -> worker/index.ts (security, database invariants, request maintenance)
  -> vinext route in app/
  -> service in lib/server/
  -> private model or public-safe DTO/projection
  -> shared renderer in app/_components/
  -> hardened response
```

Important boundaries:

1. `worker/index.ts` is the outer security boundary. Preserve its invariant,
   maintenance, CSP, and response-hardening flow.
2. `lib/server/organizer/` owns private workflows. Authorization is derived
   server-side on every operation; UI state is never authority.
3. `lib/server/public/` owns privacy-safe public projections used by pages,
   feeds, metadata, and structured data.
4. `lib/server/public/request-cache.ts` deduplicates only within one request.
   Event/club route identity and the exact D1 binding are part of that boundary;
   never turn it into a process-wide publication cache.
5. `db/schema.ts` plus ordered `drizzle/` files are the data contract.
   Migrations are additive, retry-safe, and never rewritten after release.
6. CMS content is generally data-backed; do not create a second route-specific
   copy of owner-editable content. A few product-owned pages intentionally use
   hard-coded visitor copy, so inspect the route and its content contracts
   before deciding the source of truth.
7. Meetup sync is one-way and fail-closed. Preserve IDs, schedules, links,
   provenance, and the last completed snapshot.

## Where changes belong

| Change                | Start here                                                       |
| --------------------- | ---------------------------------------------------------------- |
| Public route/metadata | `app/`, `app/_components/`, `lib/server/public/`                 |
| Responsive styling    | `app/styles/` plus shared components in `app/_components/`       |
| Organizer workflow    | `app/_organizer/`, `app/api/organizer/`, `lib/server/organizer/` |
| Authentication        | `lib/server/auth/` and organizer service boundaries              |
| Meetup import/sync    | `lib/server/meetup/`                                             |
| Forms/submissions     | `lib/server/phase7/`, `app/api/forms/`                           |
| Database              | `db/schema.ts`, next `drizzle/*.sql`, invariant tests            |
| Media                 | `lib/server/media/` and public usage/rights contracts            |
| Worker/security       | `worker/index.ts`, security and rendered-Worker tests            |

See [docs/architecture](docs/architecture/) for decisions. The large
[BUILD_STATUS.md](BUILD_STATUS.md), [OWNER_INPUTS.md](OWNER_INPUTS.md), and
phase-named guides are historical audit ledgers. Their version numbers and
pending items may be superseded; they are not the current backlog.
The root `MASTER_BUILD_SPEC.md` is likewise the historical initial-build brief,
not an instruction to rebuild the application. `examples/` contains isolated
framework samples and is not a source of production architecture.

For visual work, read [docs/UI_UX_HANDOFF.md](docs/UI_UX_HANDOFF.md). It maps
the token, layout, component, route, artwork, responsive, and accessibility
boundaries that are intentionally easy to miss when starting from a single
page.

### Event data flow

`lib/server/public/events.ts` unifies three read branches: legacy/manual
canonical rows, the last completed Meetup snapshots, and published
`organizer_events`. New manual organizer edits write to `organizer_events`;
the legacy `events` table is not the current editor write model. Fix the owning
branch rather than patching the final union or mutating the wrong table.

## Safe change workflow

1. Pull current `main`; create a focused branch. Never push directly to `main`.
2. Reproduce the problem and find the owning service/shared renderer.
3. Add or update the smallest behavioral regression test.
4. Change only that boundary; run focused tests while iterating.
5. Run the release gates below and open a pull request against `main`.
6. Wait for CI and maintainer review; do not merge or deploy your own change.
7. Leave content, media, migration, and deployment effects for owner approval.

Keep these rules fixed:

- Never invent events, locations, accessibility facts, attendance, reviews,
  legal claims, or response-time promises.
- Never put submissions, attendee information, credentials, invitation links,
  production exports, or real organizer data in fixtures, issues, or commits.
- Media requires confirmed rights, public usage, and credit.
- Preserve exact Meetup schedule, source, RSVP link, and provenance unless the
  owner explicitly changes them.
- Public metadata, JSON-LD, CSV, ICS, and pages must not expose private fields.
- Preserve keyboard access, focus, reduced motion, responsive layout, and
  non-color status cues.

## Tests and release gates

Focused test:

```bash
node --import tsx --test --test-concurrency=1 tests/path/to/test.mjs
```

Before requesting merge:

```bash
npm run typecheck
npm run lint
npm audit --omit=dev
npm test
git diff --check
```

The full suite is deliberately serialized and commonly takes 12-15 minutes.
Do not start overlapping runs. The production build embeds the exact Git
revision and refuses tracked or untracked source changes. Commit the reviewed
tree, then run:

```bash
npm run build
npm run test:rendered
```

CI runs every gate above on pull requests to `main`.

The production-dependency audit must remain clean. A full development audit
may also report upstream build-tool advisories. Handle those through a focused,
reviewed dependency update with all release gates; never use
`npm audit fix --force` as a substitute for compatibility review.

## Database and content changes

- Never modify an already released migration; add the next numbered one.
- The checked-in chain currently runs from `0008` through `0022`. Do not run
  `npm run db:generate` casually or accept an unrelated generated rewrite.
- Keep every statement D1-compatible, additive, and retry-safe.
- Update schema, invariants, query budgets, and integration tests together.
- Apply changes only to a disposable local database during development.
- Never treat local success as authorization to mutate hosted D1.
- Public-copy upgrades must preserve unknown/owner-edited content and only
  reconcile an exact known legacy state.

## Production release boundary

Only an owner or explicitly authorized release maintainer should deploy:

1. Merge and identify the exact clean commit.
2. Run full source checks, build, and the rendered-Worker suite.
3. Push that exact commit to the configured Sites source repository.
4. Save/deploy an immutable Sites version from the same commit and archive.
5. Wait for success; verify the `.com` route, responsive behavior, logs, and
   the changed visitor/organizer flow.

Do not put Sites tokens or production secrets in GitHub Actions.
`.openai/hosting.json` contains the Sites project identifier and logical
binding names, but no credentials or secrets.

For the exact release, rollback, and source-recovery process, see
[docs/RELEASE_AND_ROLLBACK.md](docs/RELEASE_AND_ROLLBACK.md).

### Production maintenance workflow

`.github/workflows/daily-meetup-refresh.yml` schedules queued organizer-form
email delivery once daily at 00:17 America/Vancouver. Meetup synchronization
does not run on that schedule; it requires an intentional manual workflow
dispatch. Both jobs are restricted to the canonical production repository, so
copies in the contributor repository or forks remain inert. Each request is
timestamped, replay-protected, and signed with
`DAILY_MEETUP_REFRESH_SECRET`, which must exist independently in the GitHub
repository secret store and the Sites runtime secret store. Never put that
value in source, an issue, a log, or a local environment template.

The endpoint advances exactly one two-event import slice per Worker request;
the workflow repeats fresh signed requests until every source is current. The
terminal request atomically promotes last-known-good Home, Events/club-card,
event-detail, related-event, and compact Club/Program rail materializations.
Visitor routes read one bounded, generation-certified row for the requested
event or club surface: they do not fetch or parse a Meetup group page and
cannot advance synchronization. Public HTML remains `no-store` to preserve its
per-response CSP nonce; that browser-facing policy is separate from these
request-local and updater-owned read caches.
GitHub Actions supplies the success/failure record and a counts-only summary.
The organizer Meetup screen retains the manual refresh for urgent changes.

## Current intentional limits

- no public visitor accounts, on-site RSVP, ticketing, payments, chat, or DMs;
- form submissions live in the private organizer inbox and eligible
  submissions queue one private organizer email to the configured recipient;
  visitors do not receive an automatic email confirmation;
- no automatic Meetup write-back or two-way calendar sync;
- not every event has approved art or venue-specific accessibility facts;
- contributors receive no production dataset or production credentials.

If work conflicts with these limits, open an issue and get an owner product or
data decision before implementing it.

## Pull-request handoff checklist

- [ ] Scope and visitor/organizer impact are clear.
- [ ] Focused regression coverage exists.
- [ ] Type-check, lint, full tests, clean diff, build, and rendered tests pass.
- [ ] Visual changes were checked on phone and desktop.
- [ ] Security, privacy, accessibility, data, migration, media, and content
      effects are stated.
- [ ] No secret, personal data, local DB, export, or unapproved asset was added.
- [ ] Deployment remains owner-controlled unless explicitly authorized.
