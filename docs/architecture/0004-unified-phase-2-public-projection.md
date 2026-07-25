# ADR 0004: Unified Phase 2 public projection

- Status: Accepted
- Date: 2026-07-25
- Decision owner: Reza

## Context

Phase 2 adds the complete public website without authorizing the private CMS,
event editor, conflict-review interface, submission forms, or any Phase 3
surface. Public pages need one truthful view of manually published events and
official Meetup imports while preserving the generation-isolation and privacy
guarantees established earlier.

The canonical `events` row is intentionally mutable during an import. It cannot
be a public source of truth for a Meetup-linked event while a later generation
is partial or failed. Public catalog content must also be durable and editable
in a later authorized CMS rather than embedded in route components.

## Decision

### Durable catalog

- Add `club_public_profiles` for publication state, featured state, primary
  lane, restrained description, and confirmed clean public group URL.
- Add `event_public_details` for the explicitly public attendance mode.
- Keep the shared exact lane/club/page/link definition in one module used by
  the existing Meetup program resolver and the Phase 2 seed.
- Run the idempotent seed only after server-side Owner or Administrator
  authorization. A public GET never creates production content.
- Treat the seed marker as a one-time foundation: later D1 editorial changes
  are preserved rather than overwritten.
- Require organization-matching joins in every read and validate organization
  ownership in every current write. Additive D1 `BEFORE INSERT/UPDATE` guards
  also require each public profile/detail to agree with its related club,
  lane, or event organization, including parent-side organization changes.

### Unified events

- Use one server-only service for Home, Events, event detail, club detail,
  related events, category filters, and event sitemap slugs.
- Build its public relation from two branches:

  1. Manual events that are published, public, undeleted, in a supported public
     status, and attached to a published club. Exclude every event with Meetup
     source-link history.
  2. Meetup snapshots whose generation exactly equals the source's active
     generation and whose source is enabled and successfully completed.

- Rank by stable event slug and keep only one public row, with the completed
  Meetup snapshot authoritative for any source-backed event.
- Select only allowlisted public fields. Private notes, meeting details,
  unpublished venue fields, account data, source configuration, audit history,
  and generation identifiers never enter the public DTO.
- Require both venue publication and event publication before exposing a venue.
  A missing venue DTO means location details are not published; it does not
  imply that organizers have not chosen a venue.
- Keep previously published cancelled detail routes available and clearly
  marked while excluding them from default Upcoming and Past collections.
- Attribute Event structured data to the event's confirmed public club, not
  automatically to the umbrella brand.

### Validation and query behavior

- Validate and bound state, keyword, dates, club, lane, category, attendance
  mode, page, and page size before preparing D1 queries.
- Use prepared statements and one count plus one bounded result query; do not
  fetch private records and filter them in application code.
- Use the existing manual projection index and active-snapshot timed/all-day
  indexes. Migration-backed query-plan tests exercise both public branches.
- Keep dynamic server rendering for D1-backed pages and avoid shared caching of
  authenticated responses.

### Origin, indexing, and structured data

- Derive canonical and structured-data URLs only from the Worker's validated
  request origin. Overwrite any client-supplied origin or pathname context
  before vinext dispatch.
- Index only unfiltered public routes and published detail slugs.
- Permanently redirect `/calendar` to `/events` and mark it non-indexable.
- Keep organizer, identity, API, preview, query-string, error, and unknown
  routes out of search indexes.
- Emit Organization, Event, and BreadcrumbList JSON-LD only when the required
  public facts and a validated origin exist.

## Consequences

- Home and Events can render an excellent truthful empty state without fake
  cards.
- A pending or failed Meetup generation cannot leak a changed title, time,
  addition, cancellation, club assignment, or RSVP URL through any public
  surface.
- Draft clubs and private event states return 404 even when a slug is guessed.
- The public site needs no client data-fetching framework and ships minimal
  public JavaScript.
- Hosted catalog creation and real-event behavior remain externally unverified
  until a future owner-authorized deployment and real feed connection.
- Public submission forms, organizer publishing tools, media upload, and CMS
  editing remain out of scope and absent.

## Verification

The generated migration is exercised from an empty Miniflare/D1 database and
through populated version-5 and version-6 upgrade regressions. Tests cover DTO
allowlists, all restricted statuses, cancelled detail behavior, filter bounds,
stable pagination, query-plan index use, active-generation isolation,
manual/Meetup deduplication, public club URLs, organization-integrity guards,
robots/sitemap behavior, custom 404 output, structured data, CSP, and
built-Worker private-field exclusion.
