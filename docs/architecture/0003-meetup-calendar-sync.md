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
available here. Generalized runtime scraping, passwords, guessed URLs, and
write-back are excluded. The later owner-directed curated public-page
enrichment amendment below does not change the request-time iCalendar adapter
or introduce a generalized runtime scraper.

## Decision

- Use the exact official HTTPS group iCalendar export URL as the read adapter.
- Keep the integration one-way. Import title, schedule, explicit status,
  sequence/last-modified provenance, and canonical official event URL only.
- Do not persist or publish raw feed description or location fields because
  they can contain private meeting details. Venue publication and organizer
  attribution remain controlled by the existing allowlisted projection.
- Store one active `meetup_ics` source per club while allowing multiple clubs
  and distinct feeds in the same organization. Enforce both organization/club
  uniqueness and organization/source-URL uniqueness.
- Cross-posted gatherings receive distinct group-specific source identities.
  If two configured feeds would reserve the same time, the Phase 4 overlap
  guard fails closed rather than silently merging by title/time or showing
  duplicate reservations. Until an explicit owner-reviewed cross-post alias
  model exists, operators must connect only the non-overlapping feed coverage
  they intend to show.
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
- Fetch with no-store semantics, a 12-second timeout, bounded UTF-8 streaming,
  exact content type, a maximum of three manually validated same-group
  redirects, and strict official-URL validation.
- Parse bounded iCalendar input, including `VTIMEZONE`, TZID-aware timed events,
  UID plus normalized recurrence identity, explicit calendar/event
  cancellation, and safe rejection of unexpanded recurrence.
- Process one source and at most two calendar rows per request. Persist a
  snapshot hash, pending generation ID, and cursor for resumable partial
  imports. Stage public-safe facts in an isolated pending generation; its rows
  and counters may change until finalization. Published snapshots are immutable
  through the supported runtime path. This keeps both the successful and
  conflict-rejection paths at or below D1's documented 50-query Free Worker
  invocation ceiling.
- Derive the resumable snapshot hash from the normalized work items that can
  affect identity, ordering, provenance, reconciliation, or publication—not
  raw iCalendar bytes. Meetup can vary ignored calendar decoration,
  descriptions, or locations between requests; those private/unused changes
  must not strand a pending cursor.
- Use conditional ETag/Last-Modified fetches after complete snapshots. Refetch
  the body while a partial snapshot is pending so the cursor can resume only
  against the same hash.
- Refresh on explicit Owner/Administrator request or opportunistically on a
  public view. A complete source waits at least 15 minutes; a partial snapshot
  may resume on the next request. Do not claim scheduled or background sync.
- Record import batches, sanitized row facts, immutable event revisions,
  source links, and content-free audit entries. Audit terminal sync records
  distinguish manual from refresh-on-view triggers.
- Publish only completed snapshot rows whose generation ID exactly matches the
  source's active generation. Finalization atomically advances that pointer,
  records absence revisions and audit facts, soft-retires missing future rows,
  and stores the exact removed count. The prior active generation remains
  public throughout a partial or error state, and published snapshots are not
  mutated by the supported runtime path.

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
- Production data remains empty until `INITIAL_OWNER_EMAIL` is configured in
  Sites runtime settings and the owner supplies exact official feed URLs
  through the authenticated organizer workspace.

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
  views. The UI labels that cadence explicitly.
- Meetup's official iCalendar export supplies no approved poster-image field.
  The Owner explicitly approved importing local copies of the 11 posters on
  the current public Meetup listings. A curated manifest binds each bundled
  file to its exact numeric Meetup event ID and retains the original
  `meetupstatic.com` URL only as provenance; public pages never hotlink it.
  Newly synced events use separately approved website media or controlled
  category artwork until their poster is deliberately added. The request-time
  sync does not scrape Meetup pages.
- No Meetup OAuth/API credential, Meetup Pro plan, password, scraper, external
  queue, alternate database, or alternate host is introduced.

## 2026-08-06 curated public-event enrichment amendment

The Owner later directed the site to use the attendee-visible public Meetup
description, venue, and sharp poster for current events. This amendment is
separate from the official iCalendar synchronization above:

- Feed description and location fields remain untrusted, unused, and excluded
  from the normalized synchronization hash.
- An owner-invoked source-maintenance tool reads only exact public event pages
  from the three confirmed group slugs and requires the expected numeric Meetup
  event ID on every page. It is not invoked by a public request and does not
  write to Meetup or hosted D1.
- The current candidate contains 13 explicit group-slug/event-ID records. That
  source inventory does not activate a blocked source or make an event public;
  the existing completed-generation, publication, receipt, legal, privacy, and
  public-projection checks remain authoritative.
- The generator normalizes public descriptions to safe text, removes URLs,
  rejects email addresses and meeting credentials, and retains only venue facts
  visible to an ordinary attendee. Existing owner-authored public summary,
  description, venue, and approved artwork always take precedence.
- Each exact poster source must use the allowlisted secure Meetup image host and
  pass MIME, byte-size, natural-dimension, and aspect-ratio validation. The
  generator produces local 480px, 960px, and up-to-1600px variants without
  upscaling; public HTML never hotlinks Meetup.
- This is a bounded, owner-reviewed, source-controlled reconciliation, not a
  guaranteed daily scheduler, generalized scraper, alternate importer, OAuth
  integration, or write-back path.

## Primary references

- Meetup Help, “Exporting an event to your calendar”:
  https://help.meetup.com/hc/en-us/articles/39237118960013-Exporting-an-event-to-your-calendar
- Meetup Help, “How can I get access to Meetup's API?”:
  https://help.meetup.com/hc/en-us/articles/41453576628749-How-can-I-get-access-to-Meetup-s-API
- Meetup GraphQL guide:
  https://www.meetup.com/graphql/guide/
- Cloudflare D1 limits:
  https://developers.cloudflare.com/d1/platform/limits/
