# ADR 0014: Bounded public read hot paths

## Status

Accepted.

## Decision

Public performance work stays inside explicit request and materialization
boundaries. It does not broadly remove dynamic rendering, force speculative
prefetch, or add shared HTML cache directives.

- Public links disable speculative prefetch for Home, Calendar, Events, and
  Clubs route families. Cheap editorial destinations keep framework-managed
  automatic prefetch. This prevents a pending Vinext prefetch and a click from
  launching duplicate RSC renders for the expensive destination.
- Event, club, Program, redirect, organization, and site reads share their
  exact D1 promise inside one Vinext request. The cache is keyed by the D1
  binding and route identity and is discarded after that request.
- The protected daily updater projects public events once and atomically
  promotes three bounded rows: Home's reserve, the Events calendar/card
  dataset, and public event details. Related events and the bounded
  Club/Program Upcoming/Past rails are derived from one indexed detail row, so
  older history outside the calendar window remains available. Event pages
  use that row directly for both metadata and rendering. A missing, expired,
  corrupt, or slug-missing detail row fails closed; it never falls back to the
  unified live projection. Visitor reads never write or run the updater-owned
  projection.
- Existing Home and Events envelope versions remain compatible during rollout.
  Event detail becomes available after the protected updater promotes the
  coherent detail row. Publication, edit, cancellation, and unpublication
  changes therefore reach this public surface through that protected rebuild
  boundary rather than through visitor-time projection work.
- Anonymous public GET/HEAD invariant preflight reads one exact certified
  version/fingerprint marker. Organizer, identity, API, maintenance, write, and
  private RSC boundaries still verify the full `sqlite_master` definitions.
  Background maintenance requested after a public response repeats the full
  verification immediately before any maintenance write.
  Missing or stale certification enters the existing bounded fail-closed
  repair path before application dispatch.

## Bounds and failure behavior

The updater rejects more than 512 public detail DTOs, any detail row over one
megabyte, omitted or card-mismatched details, rows lost during final identity
revalidation, any invalid allowlisted DTO, or any partial three-row promotion.
A delayed older refresh cannot replace a newer three-row set. The previous
complete rows remain active after projection, validation, or atomic write
failure. Club and Program rails return at most six events per direction;
related events return at most three.

Completed public invariant results are not cached between requests. A public
marker check uses one D1 statement, protected verification uses two when
healthy, and repair reserves the preceding marker statement under the existing
50-statement ceiling.

## Verification contract

Tests must prove request-local duplicate reads collapse to one and reset on the
next request; expensive pending prefetch plus navigation produces one RSC
request; warmed event/club/program views use one indexed read and zero writes;
the updater remains below 50 statements; protected invariant checks cannot
reuse weaker public verification; and p95/p99 measurements report both the
sequential warm path and bounded concurrent waves.
