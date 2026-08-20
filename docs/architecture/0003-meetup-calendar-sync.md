# ADR 0003: Official Meetup calendar synchronization

- Status: Accepted
- Date: 2026-07-24
- Decision owner: Reza

## Context

The owner authorized a one-way synchronization of the organization's real
Meetup events into the public calendar. The integration must use a current,
officially supported Meetup read surface, preserve the Phase 1 authorization,
privacy, timezone, conflict, and honesty boundaries, and work without a
guaranteed Sites scheduler.

Meetup's current help documentation supports exporting a group calendar as an
iCalendar subscription. Meetup's current API documentation says new OAuth
consumers require an active Meetup Pro subscription and approval, which are not
available here. Unbounded runtime scraping, passwords, guessed URLs, and
write-back are excluded. The 2026-08-06 complete-source amendment below
narrowly supersedes the truncated iCalendar read adapter with a fail-closed
parser for each exact configured group's canonical public events page.

## Decision

- Keep the exact official HTTPS group iCalendar export URL as private
  configuration and group-identity proof. Production refreshes derive its
  validated group slug, verify that group's canonical public `/events/` page,
  then read its complete fixed-cutoff event connection from Meetup's documented
  `https://api.meetup.com/gql-ext` endpoint. The iCalendar adapter remains for
  deterministic legacy compatibility tests.
- Keep the integration one-way. Import current title, schedule, explicit
  status, canonical official event URL, bounded public description structure,
  attendee-visible venue, and validated poster provenance from one source
  snapshot. Never write to Meetup.
- Do not persist raw page or feed bodies. Store only the normalized public-safe
  allowlist in the snapshot's one-to-one public-content sidecar. Additive
  migration `0017_bright_captain_america.sql` creates that table with
  `CREATE TABLE IF NOT EXISTS`, preserving the production partial-retry
  contract. Owner-authored CMS copy, venue data, and approved artwork retain
  atomic precedence.
- Store one active `meetup_ics` source per club while allowing multiple clubs
  and distinct feeds in the same organization. Enforce both organization/club
  uniqueness and organization/source-URL uniqueness.
- Cross-posted gatherings retain distinct group-specific source identities.
  Only the owner-reviewed exact-URL aliases recorded below may share one
  canonical event; title, UID, or schedule similarity never infers an alias.
  Distinct Meetup listings may occur simultaneously, while manual and legacy
  reservation conflicts continue to fail closed.
- Resolve the three owner-approved program clubs idempotently using their exact
  public names and stable organization-scoped records. The protected connection
  form submits an explicit club ID. Server authorization proves that club
  belongs to the actor's organization and the parsed, lowercase Meetup group
  slug must match the selected catalog program. Never infer a destination from
  connection order, a feed hash, or an unbound-club query.
- Scope external identities to the sync source so identical UIDs in different
  group feeds cannot collide.
- Exclude every canonical event with Meetup source-link history from the
  general/manual public query, even when that link is soft-deleted. A
  source-backed canonical row may publish only through a completed snapshot
  whose generation matches its source's active pointer. Any future conversion
  to a manually managed listing must create a deliberately approved manual
  canonical record instead of exposing imported mutable fields.
- Treat absence as no information until the adapter reaches the end of the
  exact fetched snapshot. On successful cursor-complete finalization only,
  reconcile previously mapped future events missing from that source by
  cancelling, unpublishing, and soft-retiring them. Never reconcile a partial
  or failed snapshot, another source, or a manually managed event. Preserve
  explicit Meetup cancellation as distinct import provenance. Do not retire a
  shared canonical event while another source's active snapshot still reserves
  it as `confirmed` or `tentative`.
- Reject stale sequence/last-modified replays, including attempted resurrection
  after a newer cancellation.
- Fetch with no-store semantics, a 12-second aggregate timeout, bounded UTF-8
  streaming, exact HTML/JSON content types, redirect rejection, and strict
  canonical group/event/image URL validation. Send no cookie or credential to
  the public GraphQL read.
- Parse the page's exact Apollo future-events connection as the group identity
  and fixed-cutoff bootstrap, then follow every bounded GraphQL cursor from the
  beginning. Require stable group identity, timezone, total count, unique event
  IDs and cursors, monotonic ordering, and `count === totalCount` at the terminal
  page. Any partial, drifting, malformed, redirected, oversized, or GraphQL-error
  response fails the whole source refresh. Validate event, venue, image,
  capacity, RSVP, and waitlist fields; reject raw HTML, email addresses, meeting
  credentials, and unsafe external destinations.
- Process one source and at most two calendar rows per request. Persist a
  snapshot hash, pending generation ID, and cursor for resumable partial
  imports. Stage public-safe facts in an isolated pending generation; its rows
  and counters may change until finalization. Published snapshots are immutable
  through the supported runtime path. This keeps both the successful and
  conflict-rejection paths at or below D1's documented 50-query Free Worker
  invocation ceiling.
- Derive the resumable snapshot hash from every normalized work item that can
  affect identity, ordering, reconciliation, publication, public description,
  venue output, or poster provenance—not raw page bytes. A changed importer or
  alias policy is part of the hash so an older pending generation cannot resume
  under new rules.
- Refetch the no-store page and cursor-complete GraphQL inventory while a
  partial database generation is pending so its row cursor resumes only when
  the complete normalized hash still matches. Conditional ETag/Last-Modified
  behavior remains confined to the legacy iCalendar adapter.
- Refresh on explicit Owner/Administrator request or through the protected
  daily maintenance endpoint. The scheduled caller signs each bounded request
  with a timestamp, UUID, and replay-protected HMAC. A complete source waits at
  least 15 minutes; a partial snapshot resumes in a later signed request.
  Public visitor requests only read the last completed generation and never
  fetch or parse a Meetup group page.
- Record import batches, sanitized row facts, immutable event revisions,
  source links, and content-free audit entries. Audit terminal sync records
  distinguish manual from scheduled triggers.
- Publish only completed snapshot rows whose generation ID exactly matches the
  source's active generation. Finalization atomically advances that pointer,
  records absence revisions and audit facts, soft-retires missing future rows,
  and stores the exact removed count. The prior active generation remains
  public throughout a partial or error state, and published snapshots are not
  mutated by the supported runtime path.

### Exact cross-post alias model

The following Vancouver Curiosity Club URLs are explicit aliases of the
corresponding Vancouver Literature and Film listings:

- `315511475` -> `315508432`
- `315511480` -> `315508537`
- `315675704` -> `315675534`
- `315772829` -> `315772811`
- `315823081` -> `315823022`
- `315976207` -> `315294587`
- `315511485` -> `315510842`
- `315851495` -> `315851485`
- `315776403` -> `315776148`
- `315511487` -> `315510890`
- `315777485` -> `315777434`
- `316159366` -> `316159440`
- `316050934` -> `316050915`
- Fantasy & Sci-Fi `315776566` -> Literature and Film `315776601`

Both sides are stored in source as exact canonical HTTPS Meetup event URLs and
must have numeric event IDs. Chains, cycles, same-group pairs, and duplicate
alias or target URLs are rejected during module initialization.

An alias can import only when exactly one different enabled source has its
target URL in an active, published, cursor-complete, rejection-free generation.
The alias schedule kind, timezone, and exact start/all-day date range must
match that published target snapshot. End time must also match except for the
Titanic pair `315511480` -> `315508537`, whose owner-reviewed source listings
differ by 30 minutes and have a pair-specific upper bound. Absence, ambiguity,
stale source revision, or other schedule drift fails the refresh without
advancing its active generation.

The alias receives its own source link, generation snapshot, reservation
normalization, and external interval, all referencing the target's existing
canonical `event_id`. It counts toward generation completion but never updates
the canonical event row or creates an event revision. Existing activation
invariants treat same-event intervals as one gathering while continuing to
reject unrelated overlaps. Public projections omit the alias URLs so the
specialized canonical listing is the single public card. This uses the existing
many-links-to-one-event schema and therefore requires no D1 migration.

## Authorization and disclosure

- `/organizer/meetup` requires Sites-owned Sign in with ChatGPT plus active
  server-side membership.
- Owner and Administrator may configure or refresh. Organizer may view only
  the coarse aggregate connection state.
- The Owner/Administrator connection form receives only safe club ID/name
  options and never receives a saved feed address or expected feed URL.
- Connection and refresh APIs enforce exact same-origin mutation requests and
  private/no-store responses.
- Public and client DTOs never contain a feed URL, token, source ID,
  organization ID, raw upstream error, or internal error code.
- Initial production data remained empty until `INITIAL_OWNER_EMAIL` was
  configured in Sites runtime settings and the owner supplied exact official
  feed URLs through the authenticated organizer workspace.

## Consequences and deliberate limits

- A partial cursor, parse/fetch failure, rejected continuation, or unsolicited
  `304` cannot advance publication or trigger disappearance reconciliation.
- Both public query families fail closed during partial/error work: the Meetup
  query stays on the prior active snapshot and the general/manual query
  excludes Meetup-linked canonical rows entirely.
- A completed snapshot can remove an upcoming listing that Meetup no longer
  exports. Its source link remains durable so a later reappearance can be
  imported again without touching manual events or another club/source.
- Non-cancelled all-day feed rows are rejected until the reserving conflict
  engine can normalize all-day intervals without midnight-UTC substitution.
- A feed larger than the parser limits fails safely rather than being truncated
  and misrepresented.
- With no guaranteed scheduler, freshness depends on owner refreshes and public
  views. Organizer tools show the operational cadence and diagnostics; public
  pages expose only the last safe published event projection.
- Poster provenance is never exposed in a public DTO. A first-party route
  revalidates the exact active published snapshot, fetches only the allowlisted
  secure Meetup image host, validates bytes/dimensions/aspect ratio, transforms
  exact 16:9 responsive representations whose bytes match the public width and
  height contract, and caches those WebP variants in R2.
- No Meetup OAuth/API credential, Meetup Pro plan, password, authenticated
  browser session, external queue, alternate database, or alternate host is
  introduced.

## 2026-08-06 complete-source and public-content amendment

The Owner directed the synchronization itself to use current attendee-visible
Meetup facts and to stop depending on a separate manual enrichment run.

- A read-only verification of the three exact canonical group pages returned
  30 + 10 + 2 current listings. It included Wednesday Night Reset
  (`316010049`), the current Poetry Night title, and numeric event identities
  for four recurring listings that redirect when opened individually.
- Eight owner-reviewed URL pairs are cross-post aliases, producing 34 canonical
  current listings before ordinary date/status filtering.
- Public descriptions normalize to a bounded semantic model of headings,
  paragraphs, ordered/unordered lists, emphasis, and allowlisted HTTPS links.
  Ticket links such as VIFF remain clickable. Plain text must exactly match the
  semantic structure before the snapshot is eligible.
- Public venue name/address and poster provenance live on the same immutable
  snapshot as title/schedule. A partial or failed refresh therefore cannot mix
  generations or leak new content.
- The organizer All-program action refreshes canonical Literature and Fantasy
  sources before the alias-dependent main group and automatically continues
  two-row chunks with a bounded request cap.
- The older curated manifest and local poster files remain a fallback for
  already-published snapshots. They are no longer the primary update path for
  a newly completed source generation.
- This is a bounded exact-group parser, not a general crawler or write-back
  integration. Failure preserves the previous active generation and exposes
  diagnostics only to authorized organizers.
- The canonical HTML page is an identity/bootstrap surface, not a complete
  inventory. Later occurrences must be followed to `hasNextPage: false` through
  the bounded public GraphQL connection before the generation may reconcile
  absence or publish.

## 2026-08-18 cursor-complete amendment

- The three official groups exposed 78 upcoming listings at the audit cutoff:
  69 Vancouver Curiosity Club, 1 Fantasy & Sci-Fi, and 8 Literature and Film.
  Eight exact cross-post pairs represented 70 gatherings; one listing was
  explicitly cancelled.
- The main canonical HTML page embedded 30 of its 69 listings and declared
  `hasNextPage: true`. Treating that page as complete could therefore retire or
  omit 39 valid later occurrences.
- Meetup's documented `gql-ext` endpoint returned the same public connection
  without cookies or authorization in this verified deployment. Anonymous
  public-query availability is not assumed to be permanent: rejection fails
  closed and preserves the prior active generation.
- Source capacity comes from positive `maxTickets`; zero remains the unlimited
  sentinel. Public waitlist/availability facts use the explicit RSVP state,
  RSVP counts, waitlist mode, and closure flag. Description-derived facts remain
  a fallback when those fields are absent from the HTML bootstrap.
- Adjacent Markdown emphasis may contain separator whitespace. The importer
  attaches that separator to a neighboring non-empty inline so its semantic
  plain text is preserved while the public validator never receives a
  whitespace-only node.

## Primary references

- Meetup Help, “Exporting an event to your calendar”:
  https://help.meetup.com/hc/en-us/articles/39237118960013-Exporting-an-event-to-your-calendar
- Meetup Help, “How can I get access to Meetup's API?”:
  https://help.meetup.com/hc/en-us/articles/41453576628749-How-can-I-get-access-to-Meetup-s-API
- Meetup GraphQL guide:
  https://www.meetup.com/graphql/guide/
- Cloudflare D1 limits:
  https://developers.cloudflare.com/d1/platform/limits/
