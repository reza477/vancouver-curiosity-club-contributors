# Vancouver Curiosity Club

> A social calendar with a brain.

This is the isolated ChatGPT Sites project for Vancouver Curiosity Club. It
uses the existing Field Notes identity and Sites-managed D1/R2, Sign in with
ChatGPT, and vinext Worker runtime. No legal-status, Society-registration, or
charity claim is approved for public use.

## Production

The exact Phase 8 candidate is privately deployed as Sites version 14 at:

- https://vancouver-curiosity-club.reza5777.chatgpt.site

Deployment
`appgdep_6a6a8ade7fa08191a6c1a21cf7d1f0b9` completed successfully from source
`aaeb6a648e93a7dd2e41f329085b611b8b7d10b1`. Access remains custom
owner-only with one allowed owner and zero groups. There is no public/shared
access, preview deployment, or custom domain. The logical `DB` and `MEDIA`
bindings and runtime revision 1 are unchanged.

Phase 9 production verification covered the owner gate, canonical public and
private routes, exact-host metadata/sitemap output, security and private-cache
headers, the three confirmed Meetup group destinations, representative Owner
workspaces, responsive/reduced-motion behavior, and public download/form
boundaries. One clearly labelled private production-smoke Draft was created,
verified absent from every checked public projection, archived, and moved to
deleted items through the normal workflow; its immutable audit trace remains.
No submission, import, media asset, invitation, notification, calendar token,
Meetup source, or public event was created. Exact evidence and remaining Owner
actions are recorded in `BUILD_STATUS.md`.

## Calendar-first public website

The public website keeps the visitor path deliberately short:

- Home gives a brief introduction and immediately shows the next events.
- Calendar is the primary destination, with a month-at-a-glance grid and a
  detailed day panel on hover, focus, or tap.
- Every public event can open Google Calendar or download a standards-compliant
  `.ics` file for Apple Calendar and other calendar clients.
- The application does not create visitor accounts. Organizer authentication
  remains a separate private workspace. The current Sites deployment still
  has an owner-only platform gate, so anonymous visitors cannot reach these
  routes until a separate access-policy change is explicitly authorized.

The public routes include:

- `/`
- `/calendar`
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

`/calendar` is the primary month view. `/events` remains the detailed list,
filter, and download view.

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
files, each with at most 49 single statements. Phases 3 through 6 then add
tokenizer-safe, retryable migrations without trigger bodies, destructive
rebuilds, `ALTER`, `PRAGMA`, or rename grammar.

Before the Worker dispatches any application request, a server-only D1
initializer installs every reservation, public-integrity, membership,
ownership, organizer, Phase 4 conflict/source-activation, and Phase 5
publication guard as one complete prepared statement per trigger. A
persistent version/fingerprint marker, exact `sqlite_master` comparison, and
combined integrity probes must all pass before the request can proceed.
Healthy, cold-install, ordinary repair, and bounded fail-closed repair paths
stay within D1's 50-statement limit. Failure returns a private-detail-free,
no-store/noindex 503.

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

When the same gathering is cross-posted into several Meetup groups, each group
feed supplies a different source identity. The overlap guard therefore fails
closed instead of silently merging or duplicating the gathering. Connect only
the non-overlapping feed coverage you intend to show until an explicit
owner-reviewed cross-post alias model is added.

Feed addresses remain private operator-entered D1 configuration. They are not
committed, rendered, logged, placed in metadata, or derived from public group
links. Sites does not guarantee a scheduler, so the application labels its
manual and bounded refresh-on-view behavior honestly.

Meetup's official iCalendar export contains event titles, times, statuses, and
event URLs, but it does not contain an approved poster-image field. Imported
events therefore use rights-approved website artwork when one exists and the
site's category artwork otherwise. The application does not scrape Meetup
posters or claim a guaranteed daily background job.

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
domain, or separately provisioned/GitHub repository is used. The established
Sites source repository is used only to save exact Sites candidates; Phase 9
deployed the already-saved version 14 through Sites.

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

Do not run `db:generate` directly into the real `drizzle` directory after the
Phase 7 migration exists: the real journal already ends at index 16 and a
direct generation can create an unintended `0017`. A Phase 7 snapshot-only
refresh uses a disposable output directory seeded with the real
`0015_snapshot.json` and a temporary journal ending at index 15. Only the
generated `0016_snapshot.json` is copied back. The real
`0016_phase7_import_export_forms.sql` and real journal must remain
byte-for-byte unchanged across that procedure, followed by
`drizzle-kit check`.

`npm.cmd run test:rendered` executes the built Cloudflare Worker in Miniflare
against a fresh generated migration chain. It verifies public HTML, metadata,
structured data, CSP, redirects, empty and cancelled states, 404 behavior,
private-route protection, private-field exclusion, and real 503/noindex
behavior when the public D1 service cannot be read.

`BUILD_STATUS.md` is the authoritative evidence ledger,
`OWNER_INPUTS.md` records missing factual approvals without inventing them, and
`MASTER_BUILD_SPEC.md` remains the unchanged multi-phase reference.

Phase-specific verification procedures:

- `docs/phase6-local-testing.md`
- `docs/phase7-local-testing.md`
- `docs/phase8-local-testing.md`

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

Phase 3 introduced runtime invariant version 3 with 30 guards, Phase 4
introduced version 4 for the conflict engine, and Phase 5 introduced version 5
for publication. Phase 6 advances the active fail-closed initializer to
version 6 while retaining the exact prior definitions and phase-aware
migration-adoption behavior. Every additive migration remains tokenizer-safe
after the immutable deployed version-8 chain.

See:

- `docs/architecture/0007-phase-3-organizer-workspace.md`
- `docs/owner-guide-phase3.md`
- `docs/organizer-guide-phase3.md`

At the Phase 3 checkpoint, the owner-only live URL still served Phase 2
version 8 and Phase 3 remained unpublished. Phase 9 later deployed the exact
Phase 8 candidate containing the completed Phase 1–8 work.

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

At the Phase 4 checkpoint, the owner-only live URL still served version 8 and
Phase 4 existed only in an unpublished Sites version. Phase 9 later deployed
the exact completed Phase 8 candidate.

## Phase 5 private-to-public publication

Phase 5 connects the canonical private organizer event to the existing public
website without copying it into a legacy event table:

- protected, no-store preview through the exact public DTO and renderer;
- approved public presentation details and consented host selections;
- immediate publication and unpublication;
- version-bound scheduled publication;
- published cancellation, completion, archive, soft-delete, and safe restore
  behavior;
- one narrow Organizer self-publish policy;
- the existing Home, Events, event detail, club, metadata, structured-data,
  and sitemap projection.

Every publication mutation extends the same Phase 4 scheduling intent. The D1
batch rechecks current identity, role, club/event scope, content and schedule
versions, conflict policy and version-bound authorization, public readiness,
RSVP confirmation, host eligibility, slug uniqueness, and pending-job state.
There is no application-only conflict bypass and no second event lifecycle.

The official Meetup event URL mode accepts only an HTTPS individual event
destination. A group homepage is rejected. Changing the canonical URL clears
its confirmation and returns the display to the honest coming-soon state; no
unconfirmed URL can appear publicly. Website publication never writes back to
Meetup.

Scheduled publication is request-driven because Sites does not guarantee
cron. A relevant public or organizer request processes at most one due job.
Concurrent requests use compare-and-swap, so one job publishes at most once.
A deterministic stale, authorization, readiness, slug, or conflict failure
invalidates that exact job and keeps the event nonpublic. A transient runtime
failure leaves it pending for a later request.

Published cancellation retains the stable public detail page with a prominent
notice while removing it from Upcoming. Cancelling a scheduled event,
archiving, or soft-deleting terminalizes any pending job and leaves the event
unpublished. Restore never silently republishes.

Phase 5 does not add general CMS, Community editing, media upload, import,
export, public forms, email, QR, payments, attendee accounts, comments,
messaging, or Meetup publishing.

See:

- `docs/architecture/0009-phase-5-publication.md`
- `docs/owner-guide-phase5.md`
- `docs/organizer-guide-phase5.md`

Phase 5 was saved as exactly one unpublished Sites version 11. At that
checkpoint, owner-only live version 8 remained unchanged. Phase 9 later
deployed exact version 14.

## Phase 6 structured content and media

Phase 6 keeps the existing public projection tables and adds private immutable
revisions around them. Owners and Administrators can prepare structured page,
club, recurring Program, Community, navigation, site-identity, and legal-status
drafts; preview the exact revision through the public Field Notes shell and
entity renderer; publish or unpublish eligible content; and restore history as
a new private draft. The preview is authenticated, no-store, noindex, has one
keyboard skip target and main landmark, and never creates a share token.

Pages accept only bounded allowlisted blocks. They do not accept arbitrary
HTML, scripts, iframes, CSS, executable Markdown, protected routes, or
unconfirmed external destinations. Dynamic selections resolve current
published events, clubs, Community links, and approved media in bounded bulk
queries into one render context used by both preview and production. Home,
Events, generic editorial pages, and club details consume the same validated
published revision data rather than a separate preview-only approximation. A
draft never changes public HTML, metadata, navigation, structured data, or
sitemap output.

Home and the required system pages keep their canonical paths. They can be
edited and republished, but generic CMS actions cannot rename or unpublish
them. Resources is the one optional system page: an Owner or Administrator can
create its private draft without code, but `/resources` is non-renamable and
stays absent until explicitly published. Permanent page and club redirects
resolve only to a current, same-organization published target, so unpublishing
never creates a redirect to a 404.

Published navigation preserves the validated labels and order while retaining
every required header, footer, policy, and Organizer Login destination.
Organizer Login cannot be renamed, removed, or repointed. Duplicate
placement-and-target pairs are rejected, and optional-item limits reserve room
for all required links.

The existing `MEDIA` R2 binding now stores immutable image bytes. D1 remains
authoritative for metadata, opaque object keys, responsive WebP variants,
rights, consent, credit, alt text, usage, upload state, and deterministic
cleanup. Public routes serve only approved 480, 960, and 1600 pixel WebP
variants with a current published usage. Original uploads and private metadata
remain Owner/Administrator-only and no-store. Interrupted cleanup remains in
an authorized retry queue rather than becoming an orphaned public asset.
Public image DTOs carry their real variant dimensions, canonical live alt
text, credit, caption inheritance, and focal point; metadata does not invent a
1600-by-900 crop. Event and club SEO fields and approved Open Graph selections
are materialized with the same public-ready, same-organization media checks,
with the published site identity as the safe fallback.

Owners and Administrators manage event lanes and categories through one
versioned, audited taxonomy workflow. The four canonical lane identities keep
their stable slugs while labels, descriptions, and order remain editable.
Archive and safe-delete recheck event, club, Program, and immutable CMS history
references inside the committing D1 protocol. New or reassigned events can use
only active taxonomy; an existing event may retain its exact archived value
without switching to another archived value.

Organizer public attribution is a separate explicit self-service publication
workflow. Saving display name, biography, approved profile photo, and consent
creates only a private draft. Publishing creates an immutable receipt and
public projection; revocation removes that attribution output immediately.
An event must separately enable public hosts and select that organizer. Public
reads never expose email, role, assignments, auth identifiers, private profile
fields, raw object keys, or a newer private attribution draft.

Site identity colors are constrained to the actual public text, background,
accent, border, and focus pairings. Publishing a club theme checks it against
the current site palette, and publishing a new site palette rechecks every
published club theme in the committing operation. Invalid combinations are
rejected rather than emitted as unsafe CSS.

Legal wording has a separate Owner-only confirmation and publication gate.
Administrators may prepare a private draft but cannot confirm, revoke, or
publish it. Provincial registration and CRA charity status are never inferred
or conflated. The shared protected-claim validator also covers ordinary page,
club, site, Community, and public event copy, including event SEO and access,
cost, location, and preparation fields. Runtime database guards and public
projection filters keep crafted or raced legal, charity, registration,
tax-deductibility, or nonprofit claims out of public HTML, metadata,
structured data, and feeds unless they come through the exact confirmed legal
projection.

The only Phase 6 migration is
`0015_phase6_cms_media.sql`. It is additive, retry-safe, partial-prefix safe,
and Sites tokenizer-compatible. Runtime guards remain fail-closed and healthy
verification is consolidated so complete Worker routes stay within D1's
50-statement invocation limit. Request-driven scheduled publication and Meetup
refresh use bounded redirect-before-render maintenance invocations rather than
sharing the database budget with a full public render. There is no cron or
realtime claim.

See:

- `docs/architecture/0010-phase-6-cms-media.md`
- `docs/owner-guide-phase6.md`
- `docs/organizer-guide-phase6.md`
- `docs/known-limitations-phase6.md`
- `docs/phase6-local-testing.md`

Phase 6 status cuts are explicit:

- Editor role — **Not implemented — authorized cut**
- Viewer role — **Not implemented — authorized cut**
- Realtime subscriptions — **Not implemented — authorized cut**

Phase 6 also adds no import, export, public form, submission inbox, email,
automatic Meetup publishing, public account, RSVP system, payment, comment,
message, forum, or chat feature.

Publishing a CMS revision changes D1-backed public content. Saving a Sites
version records an immutable source/build candidate. Deploying a saved version
changes what the live URL serves. These are separate actions: the Phase 6
candidate was not deployed during Phase 6, so live owner-only version 8
remained unchanged at that checkpoint. Phase 9 later deployed exact version
14.

## Phase 7 imports, exports, calendars, and public intake

Phase 7 is completed and verified for its authorized local scope. It adds a
versioned, resumable CSV
event-import workflow that stores a fingerprinted non-authoritative preview and
applies approved rows through the Phase 4 conflict service. Imports create only
private events, never overwrite a source-linked event, and never publish.

Public event downloads include one-event ICS plus bounded filtered ICS and CSV.
Owner/Administrator operations add an allowlisted event CSV; Owner-only
operations add the versioned JSON product-data backup, safe media manifest, and
authenticated media download. Active organizer members may create and revoke
only their own read-only private calendar subscription.

Contact, Volunteer, Host an Event, and Venue or Community Partnership forms
store bounded plain-text submissions in the private organizer inbox. The
workflow supports assignment, canonical statuses, append-only notes, retention
review, and Owner-only irreversible personal-content redaction. It sends no
email or marketing enrollment.

Phase 7 uses one additive migration,
`0016_phase7_import_export_forms.sql`, while runtime triggers continue through
the established bounded invariant installer. Exact migration, full-suite,
build, rendered, browser, package, and Sites-version evidence is recorded only
after verification in `BUILD_STATUS.md`.

Phase 7 guides:

- `docs/architecture/0011-phase-7-imports-exports-forms.md`
- `docs/phase7-csv-field-guide.md`
- `docs/phase7-exports-calendar-backup.md`
- `docs/phase7-public-forms-submissions.md`
- `docs/phase7-local-testing.md`
- `docs/owner-guide-phase7.md`
- `docs/organizer-guide-phase7.md`
- `docs/known-limitations-phase7.md`

**ICS file import — Not implemented — authorized cut.** This does not affect
ICS downloads, the read-only private calendar subscription, or the established
Meetup iCalendar source workflow.

Phase 7 completed as an unpublished checkpoint. Its implementation and local
verification remain preserved in the deployed Phase 8 candidate; exact
provenance is recorded in `BUILD_STATUS.md`.

## Phase 8 security and release hardening

Phase 8 audits and hardens the existing Phase 1 through 7 product; it does not
start deployment. Its accepted architecture covers:

- canonical, single-decode pathname classification before routing, trusted
  request context, invitation-token capture, maintenance, cache, robots,
  referrer, and error handling;
- a practical nonce-based production CSP plus framing, MIME-sniffing,
  permissions, referrer, opener/resource, transport, private-cache, and robots
  protections;
- exact current membership, role, club, assignment, ownership, receipt,
  projection, media, and token seals immediately before protected data is
  returned or a conditional action commits;
- explicit public/download allowlists and strict D1, R2, bearer-token,
  identity, safe-error, audit, and structured-log boundaries;
- complete-route D1 accounting under the 50-statement invocation limit;
- automated and manual WCAG 2.2 AA-oriented checks, exact-width browser
  verification, local-production performance measurement, dependency review,
  artifact leakage scans, and internal-link/content review; and
- exact-source build/package verification without a schema change. The
  migration chain remains `0016_phase7_import_export_forms.sql` with no
  `0017`.

Phase 8 evidence is not inferred from this overview. Exact commands, measured
results, hashes, counts, performance/accessibility data, and any unpublished
Sites-version readback are recorded in `BUILD_STATUS.md` only after the final
exact-source gate.

See:

- `docs/architecture/0012-phase-8-hardening.md`
- `docs/phase8-local-testing.md`
- `docs/known-limitations-phase8.md`
- `docs/owner-guide-phase8.md`
- `docs/organizer-guide-phase8.md`

Phase 8 itself did not deploy or change live version 8, access, domains,
bindings, runtime values, or hosted D1/R2. Separately authorized Phase 9 later
deployed the exact saved version 14 while preserving the owner-only boundary.

The Phase 8 implementation, exact committed-source build, local hardening
matrix, and saved-candidate readback are complete. Their measured
accessibility and performance numbers remain local exact-artifact evidence.

## Phase 9 private deployment and production verification

Phase 9 deployed exact saved Sites version 14 to the existing owner-only
production URL. The terminal deployment succeeded without creating another
version, preview, domain, access change, binding change, runtime-value change,
or alternate host.

Production checks verified the Sites owner gate; Sign in with ChatGPT
boundary; expected private-cache, robots, and referrer behavior; canonical,
Open Graph, JSON-LD, sitemap, redirects, public downloads, and guessed-resource
denials; 14 canonical routes; 48 internal links; all three confirmed Meetup
group destinations; representative Owner workspaces; and responsive,
200%-reflow, reduced-motion, and console behavior. Hosted public content
contains no approved real individual event or artwork, so those factual checks
remain **Not run — no approved real published event** and
**Awaiting owner smoke test**, respectively.

Public form instances were verified without submitting production content.
External anonymous form use is unavailable while Sites remains owner-only.
External private-calendar client behavior remains **Implemented but not
externally verified**. The Owner backup restore rehearsal remains **Not run**.
This is the final planned build phase; no Phase 10 is started or authorized.
