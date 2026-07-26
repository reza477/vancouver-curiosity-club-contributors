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

The deployed Phase 2 pre-production chain is normalized into four retry-safe
files, each with at most 49 single statements. Phase 3 and Phase 4 then add
tokenizer-safe, retryable migrations without trigger bodies, destructive
rebuilds, `ALTER`, `PRAGMA`, or rename grammar. The current Phase 4 schema has
52 tables and 117 explicit indexes.

Before the Worker dispatches any application request, a server-only D1
initializer installs every reservation, public-integrity, membership,
ownership, organizer, and Phase 4 conflict/source-activation guard as one
complete prepared statement per trigger. A persistent version/fingerprint
marker, exact `sqlite_master` comparison, and combined integrity probes must
all pass before the request can proceed. Healthy, cold-install, ordinary
repair, and bounded fail-closed repair paths stay within D1's 50-statement
limit. Failure returns a private-detail-free, no-store/noindex 503.

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

## Phase 3 private organizer workspace

Phase 3 adds a separate, server-protected organizer application:

- `/organizer` dashboard
- `/organizer/calendar`
- `/organizer/events`, `/organizer/events/new`, and private event details
- `/organizer/team`
- `/organizer/clubs`
- `/organizer/notifications`
- `/organizer/profile`
- `/organizer/settings`
- the existing `/organizer/meetup` workspace
- `/accept-invitation`

Sign in with ChatGPT supplies identity only. Every page and action revalidates
the active D1 organization membership, role, and required club assignment.
Organizer pages and APIs are private, no-store, noindex, and separate from the
public header, footer, metadata, sitemap, and structured data.

The Phase 3 manual-event service has separate planning, publication, and
schedule fields. It can write only private Ideas and Drafts. An Idea can be
unscheduled; a Draft must have a valid timed or all-day schedule. Timed records
store UTC instants plus the original IANA timezone, while all-day records keep
exclusive calendar-date bounds. Optimistic content versions are separate from
future conflict schedule versions.

Every successful event mutation writes an immutable revision and append-only
audit record in the same bounded D1 batch. Source-controlled Meetup records,
legacy reserving records, and published records are visible for coordination
but remain read-only. Phase 3 has no hold, confirmation, cancellation,
reservation, conflict, publication, CMS, media, import, export, email, or
public-form action.

Owners can create Administrator or Organizer invitations; Administrators can
create Organizer invitations. Tokens are random, hashed at rest, email-bound,
expiring, revocable, one-time, and accepted atomically with membership and
required club assignment. The product never claims that an invitation email
was sent. Persistent D1 rate limits apply to creation and acceptance.

Workspace display-name, biography, and attribution-consent edits are staged in
the private `organizer_profile_preferences` sidecar. Phase 2 continues reading
only canonical public profile fields, so a Phase 3 profile save cannot rename,
add, or remove a host on a published page.

The private calendar reports the exact database match count, distinguishes the
loaded bounded slice, and provides a validated cumulative load path. The
private event index applies search and lifecycle filters in parameterized D1
queries and exposes deterministic 200-record pages, including recoverable
soft-deleted records.

Phase 3 introduced runtime invariant version 3 with 30 guards. Phase 4
advances the active initializer to version 4 and verifies or repairs the full
set of 48 database guards before application dispatch. Both additive
migrations remain tokenizer-safe after the immutable deployed version-8
chain.

See:

- `docs/architecture/0007-phase-3-organizer-workspace.md`
- `docs/owner-guide-phase3.md`
- `docs/organizer-guide-phase3.md`

The existing owner-only live URL continues to serve the deployed Phase 2
version 8. Phase 3 is not live unless a later turn explicitly authorizes its
deployment.

## Phase 4 authoritative private scheduling

Phase 4 keeps `organizer_events` as the sole writable manual-event record and
adds one server-only scheduling service for:

- timed and all-day Draft warnings;
- tentative holds with exact D1-time expiry;
- private confirmed events;
- organizer/co-organizer, private venue, buffer, and organization-wide
  conflicts;
- Warn-with-reason, Administrator-approval, and Block policies;
- version-bound incidents, reviews, decisions, and overrides;
- cancellation, completion, archive, safe restore, and hold reconciliation;
- an accessible private conflict centre and venue/policy settings.

The final save never trusts the advisory preview. It submits the complete
normalized proposal and both optimistic versions to one bounded D1 batch.
Runtime triggers revalidate the actor, membership, role, club, event ownership,
policy version, complete organizer scope, interval, venue, buffers, hold
expiry, and every current conflict before allowing a reservation. Concurrent
Worker requests therefore cannot both claim one empty slot under Block, and a
Warn overlap cannot commit without its exact written review.

Intervals are half-open. Direct actual overlap takes priority over a
buffer-only collision, and every relevant organization, organizer, and venue
resource is retained for explanation. All-day conflict bounds use local
midnight in the event's original IANA timezone, including Vancouver DST
boundaries.

Read-only legacy reservations and only enabled, completed active Meetup
generations participate in coordination. Pending, failed, disabled, or deleted
sources remain invisible. Changing the active generation, re-enabling a source
that already has one, or restoring a source is guarded. Generation-specific
parity proves exact staging integrity, while a generation-independent
reservation-semantic fingerprint distinguishes harmless content refreshes from
schedule or resource changes. Changed semantics atomically close stale
incidents, reviews, and overrides; semantically identical refreshes retain
valid coordination state. A refused activation keeps the previous completed
generation authoritative.

Every Phase 4 manual record remains `publication_status = private`.
`organizer_events` is still absent from the Phase 2 public projection, so even
a confirmed private record cannot appear on Home, Events, a club page,
metadata, structured data, sitemap output, or a guessed public slug. Public
preview and publication remain Phase 5.

See:

- `docs/architecture/0008-phase-4-conflict-engine.md`
- `docs/owner-guide-phase4.md`
- `docs/organizer-guide-phase4.md`

The existing owner-only live URL continues to serve version 8. Phase 4 is saved
only as an unpublished Sites version unless a later turn explicitly authorizes
deployment.
