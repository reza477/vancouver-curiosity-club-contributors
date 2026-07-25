# Vancouver Curiosity Club

> A social calendar with a brain.

This is the isolated ChatGPT Sites project for Vancouver Curiosity Club. It
uses the existing Field Notes identity and Sites-managed D1/R2, Sign in with
ChatGPT, and vinext Worker runtime. No legal-status, Society-registration, or
charity claim is approved for public use.

## Phase 2 public website

The public website is now implemented at:

- `/`
- `/events` and `/events/[slug]`
- `/clubs` and `/clubs/[slug]`
- `/community`
- `/about`
- `/get-involved`
- `/host-an-event`
- `/contact`
- `/conduct`
- `/accessibility`
- `/privacy`
- a custom public 404, public-only sitemap, and restrictive robots rules

`/events` is the canonical event hub. `/calendar` is a permanent,
non-indexable redirect to it.

All public catalog copy, lanes, clubs, community links, and event facts are
D1-backed. The authorized idempotent catalog seed creates four lanes, three
published clubs with their confirmed clean Meetup group URLs, and two
inaccessible draft clubs. Public GET requests never create production data.

The review database deliberately contains no fake production events. Home and
Events therefore render a truthful empty state until a real manual event is
published or a completed Meetup generation becomes active.

A missing catalog is a valid review state and remains a truthful HTTP 200.
An actual D1/public-service exception on Home or Events instead uses the
App Router's server HTTP fallback: the built Worker returns 503, `no-store`,
and `X-Robots-Tag: noindex, nofollow, noarchive` with an accessible,
non-invented failure surface. The root layout intentionally emits no explicit
healthy-page robots directive, so the fallback cannot inherit a contradictory
`index` meta; healthy public pages remain indexable by default or by their
route-level metadata.

## Unified event publication

One server-only, parameterized read service supplies Home, Events, event
detail, club detail, related events, filter options, and sitemap slugs.

- Manually managed events must be public, published, undeleted, attached to a
  published club, and in a supported public status.
- Any canonical event with Meetup source-link history is excluded from the
  manual branch.
- Meetup facts come only from the immutable snapshot selected by the source's
  completed active generation. Pending or failed titles, times, additions, and
  cancellations cannot appear on any public surface.
- Public DTOs are explicit allowlists. Private notes, private meeting or venue
  details, identities, source configuration, generation IDs, and audit data are
  never selected for public responses.
- Keyword, date range, club, lane, category, format, state, page, and page-size
  inputs are centrally validated and bounded before prepared D1 queries run.
- Previously published cancelled event pages remain available with an explicit
  cancellation notice while default Upcoming results exclude them.
- Database-enforced D1 guards require every public club profile to match both
  its club and primary lane organization, and every public event detail to
  match its event organization. Parent-side organization changes are guarded
  too.

See
`docs/architecture/0004-unified-phase-2-public-projection.md` and
`docs/architecture/0005-phase-2-release-guards.md` for the full decisions.

## Sites-compatible database guards

Sites production tokenizes packaged SQL migrations at semicolons. SQLite
trigger bodies necessarily contain internal semicolons, so trigger DDL is not
safe in that packaging path.

The pre-production migration chain is therefore normalized into four
retry-safe files, each with at most 49 single statements. It recreates the
final 37-table/75-index schema without trigger, `ALTER`, `PRAGMA`, or rebuild
grammar. Before the Worker dispatches any application request, a server-only
D1 initializer atomically installs all two reservation guards and seven public
organization-integrity guards as nine complete prepared statements. A
persistent version/fingerprint marker, exact `sqlite_master` comparison, and
two integrity probes must all pass before the request can proceed. Failure
returns a private-detail-free, no-store/noindex 503.

The destructive reset is a one-time pre-production recovery only: Sites
version 7 failed before any Worker URL existed, so no hosted user writes were
possible. It must never be reused after real hosted data exists.

See `docs/architecture/0006-sites-d1-trigger-compatibility.md`.

## Meetup synchronization

Meetup remains a one-way source for imported title, schedule, explicit
status/cancellation, and official RSVP destination. The integration uses the
official group iCalendar export, never scraping, passwords, GraphQL
credentials, or write-back.

To connect hosted production data after a separately authorized deployment:

1. Sign in as the configured initial Owner.
2. Open `/organizer/meetup`.
3. Select the exact organization-owned club and enter its official Meetup
   calendar subscription URL.
4. Choose **Refresh now** until the bounded generation completes.

Feed addresses remain private operator-entered D1 configuration. They are not
committed, rendered, logged, placed in metadata, or derived from public group
links. Sites does not guarantee a scheduler, so the application labels its
manual and bounded refresh-on-view behavior honestly.

## Platform

- ChatGPT Sites-managed hosting
- Strict TypeScript and the vinext Cloudflare Worker structure
- Sites-managed D1 through logical binding `DB`
- Sites-managed R2 through logical binding `MEDIA`
- Platform-owned Sign in with ChatGPT
- Server-side membership and role authorization
- Zod validation, safe errors, structured content-free logs, Vitest-equivalent
  Node integration tests, CSP/security headers, and accessible responsive
  styles

No alternate host, database, authentication provider, email service, custom
domain, or external repository is used.

The high-resolution brand source remains under `design-assets/`; only optimized
consumer icons and the social card ship from `public/`.

## Local development

Requires Node.js `>=22.13.0` and the locked npm package manager.

```powershell
npm.cmd ci
npm.cmd run db:apply:local
npm.cmd run db:apply:preview
npm.cmd run dev
```

The local preview is served at `http://localhost:3000/`. The local and preview
D1 stores are generated artifacts and must never be committed.

## Verification

```powershell
npm.cmd run db:generate
npm.cmd run db:apply:local
npm.cmd run db:apply:preview
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd run test:rendered
npm.cmd audit --omit=dev --json
npm.cmd audit --json
git diff --check
```

`npm.cmd run test:rendered` executes the built Cloudflare Worker in Miniflare
against a fresh generated migration chain. It verifies public HTML, metadata,
structured data, CSP, redirects, empty and cancelled states, 404 behavior,
private-route protection, private-field exclusion, and real 503/noindex
behavior when the public D1 service cannot be read.

`BUILD_STATUS.md` is the authoritative evidence ledger,
`OWNER_INPUTS.md` records missing factual approvals without inventing them, and
`MASTER_BUILD_SPEC.md` remains the unchanged multi-phase reference.
