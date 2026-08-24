# ADR 0014: Bounded public read hot paths

## Status

Accepted.

## Decision

Public performance work stays inside explicit request and materialization
boundaries. It does not broadly remove dynamic rendering, force speculative
prefetch, or add shared HTML cache directives.

- Public links disable speculative prefetch for Home, Calendar, Events, Clubs,
  and For Organizations route families. Cheap editorial destinations keep
  framework-managed automatic prefetch. This prevents a pending Vinext
  prefetch and a click from launching duplicate RSC renders for the expensive
  destination.
- Event, club, Program, redirect, organization, and site reads share their
  exact D1 promise inside one Vinext request. The cache is keyed by the D1
  binding and route identity and is discarded after that request.
- The protected daily updater projects public events once and atomically
  promotes three bounded fallback rows, one compact-generation certificate,
  16 compact event-view shards, and eight compact Club/Program rail shards.
  Event pages read one deterministic
  shard containing the detail DTO and at most six related cards. Club and
  Program pages read one shard containing at most 12 cards per direction and
  bounded totals. The Club directory reads only the few rail shards selected
  by its at-most-12 normalized Club slugs. Every compact read joins the exact
  current detail-generation marker, so a rolling legacy updater invalidates
  stale compact rows instead of serving them. Missing, expired, corrupt, or
generation-mismatched compact rows fall back only to the coherent durable
  detail row; they never run the unified live projection. Visitor reads never
  write or run the updater-owned projection.
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
- Public HTML keeps `Cache-Control: no-store, must-revalidate` because every
  response carries a fresh CSP nonce and some public forms carry fresh private
  tokens. This header does not disable the request-local promise cache or the
  updater-owned D1 materializations above. Anonymous public HTML and RSC
  responses expose only aggregate response-preparation timing as
  `Server-Timing: app;dur=N`; identity-bearing and private responses expose no
  timing header, and raw framework timing is removed.

## Bounds and failure behavior

The updater rejects more than 512 public detail DTOs, any row over one
megabyte, more than 1,024 distinct Club/Program rails, omitted or
card-mismatched details, rows lost during final identity revalidation, any
invalid allowlisted DTO, or any partial 28-row promotion. A delayed older
refresh cannot replace a newer generation. The previous complete rows remain
active after projection, validation, or atomic write failure. Stored Club and
Program rails contain at most 12 cards per direction and stored related views
contain at most six; current routes render at most six and three respectively.
The materializer itself retains at least 18 D1 statements of headroom for the
signed request, invariant gate, and terminal Meetup-state reads.

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
sequential warm path and bounded concurrent waves. The benchmark must fail on
warm-up errors, non-2xx routes, visitor-visible service states, missing or
malformed aggregate timing, timeouts, cancellations, and any 5xx response.
Release evidence must add one currently published event-detail URL and one
Club-detail URL with repeated `--route` arguments; the stable default route
set is only the broad public smoke set.
