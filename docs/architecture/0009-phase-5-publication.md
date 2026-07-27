# ADR 0009: Phase 5 private-to-public publication

Date: 2026-07-27
Status: Accepted for Phase 5

## Context

Phase 2 established an allowlisted public event projection. Phase 4 established
`organizer_events` as the sole writable manual-event record and made every
schedule-affecting transition pass through one database-enforced scheduling
intent. Phase 5 must connect those two systems without copying an organizer
event into the legacy `events` table or creating a second writable lifecycle.

ChatGPT Sites does not promise a cron service. Packaged D1 migrations are also
tokenized at semicolons, so trigger bodies cannot safely ship in migration SQL.
Public reads must remain immediately correct after publish, cancellation, or
unpublish, even when cache invalidation and background work are unavailable.

## Decision

### One canonical event

`organizer_events` remains the canonical title, stable slug, club, taxonomy,
schedule, timezone, organizer scope, lifecycle, content version, and schedule
version for a manual event. Phase 5 never mirrors it into legacy `events`,
Meetup snapshots, static JSON, or page content.

The additive `0014_phase5_publication.sql` migration adds organization-scoped
sidecars for:

- approved public presentation details;
- explicit eligible public-host selections;
- publication history;
- one version-bound pending publication job per event;
- the narrow Organizer self-publish policy;
- transaction-bound publication write intents.

The sidecars contain no private notes, private venue fallback, private meeting
details, email, SIWC subject, membership claims, conflict reasons, feed
addresses, tokens, or runtime values. R2 remains bound but Phase 5 adds no
upload or media workflow.

### One authoritative mutation envelope

Immediate publish, scheduled publish, reconciliation, cancellation,
unpublish, and edits to scheduled, published, or unpublished events extend the
existing Phase 4 scheduling service. A bounded D1 batch contains:

1. the complete Phase 4 schedule intent and current conflict-policy
   authorization;
2. when a version-bound Warn or Administrator approval is needed, invalidation
   of the prior active override, recomputation of the exact current incidents
   as `open` facts bound to the new schedule intent, and creation of matching
   new overrides;
3. the Phase 5 publication intent bound to the same event, actor, expected
   versions, proposed versions, state, and exact pending job when applicable;
4. old-job terminalization or new-job creation;
5. publication-history and public-detail changes;
6. the single canonical event mutation and reservation-state recheck;
7. transition of the current intent's conflict incidents to `approved`;
8. immutable revision, append-only audit, and allowlisted notifications;
9. publication-intent and scheduling-intent completion seals.

Runtime D1 guards require the exact open intent pair and recheck organization,
actor, role, club/event scope, versions, lifecycle, schedule, public
readiness, host eligibility, RSVP confirmation, public club, slug uniqueness,
and pending-job state. Phase 4 remains authoritative for overlaps: Block
refuses, Warn requires the exact existing version-bound reason, and
Administrator approval requires the exact approved review. UI readiness is
advisory; every action and due execution repeats the authoritative check.

A zero-row conditional mutation, stale version, missing intent, malformed
sidecar, invalid conflict authorization, or job mismatch fails the whole
batch. The service never retries an uncertain write automatically.

The publication intent is inserted only when the immediately preceding
current-incident/override materialization changed the exact expected number of
rows. The later reservation guard independently scans canonical D1 state.
Consequently, a conflict appearing between advisory preparation and commit
aborts the batch, while a disappearing conflict cannot produce a committed
publication followed by a false client-side failure.

### Authentication and authorization

Sign in with ChatGPT remains identity only. Every preview and publication
request derives the actor from trusted server context, then revalidates the
active profile, active organization membership, role, club assignment, and
event ownership or co-organization. Owner and Administrator may publish
eligible organization events. Organizer publication additionally requires the
narrow D1 policy and the existing assigned-club event relationship.

The client never supplies an authoritative actor, email, role, organization,
membership, policy, or publication-job identity. Cross-organization and
inaccessible event identifiers use private-safe failures. Every private route
and response remains dynamic, no-store, noindex, and free of public metadata.

### Readiness and RSVP honesty

Publication requires a confirmed, undeleted, scheduled event in an active
published club, bounded public summary and description, and an explicit
in-person, online, or hybrid attendance mode with the corresponding approved
public destination. `location_undecided` is a safe private draft default, not
a publishable state.

`meetup` RSVP mode requires an organizer-confirmed canonical HTTPS individual
Meetup event URL. Group-home URLs are rejected. Changing the canonical Meetup
URL clears confirmation and changes the public RSVP mode to the honest
coming-soon state; neither the old nor the unconfirmed new URL can render.
The application never claims network verification or Meetup write-back.

When public hosts are enabled, at least one explicitly selected host must
remain an active same-organization primary/co-organizer with canonical public
display consent. Private profile-preference drafts never become public
fallback values.

### Unified public projection and preview

The Phase 2 unified relation gains one explicit organizer-event branch. It
selects only source-free, undeleted, actually published canonical records with
valid sidecars and a published club. Scheduled, private, unpublished, Idea,
Draft, Hold, archived, and deleted records remain absent. Legacy manual and
completed-active-Meetup branches retain their existing semantics.

Live public pages and the protected organizer preview use the same allowlisted
DTO mapper and detail renderer. Preview first revalidates SIWC identity,
active membership, event/club edit scope, and exact projection eligibility. It
is dynamic, private, no-store, noindex, absent from sitemap and metadata
discovery, and has no share token.

Public event reads remain dynamic and conservative. This avoids serving a
stale page after an unpublish or cancellation and keeps authenticated preview
data out of public caches.

### Scheduled publication without cron

A scheduled event is not public. Its one pending job stores the UTC execution
instant, original IANA timezone, authorizing profile, and exact content and
schedule versions.

Relevant public and organizer requests run a bounded reconciler. It inspects
and processes at most one due job per invocation so every success,
deterministic invalidation, and transient-failure path remains below D1's
50-statement envelope.

Execution uses compare-and-swap and the complete authoritative publishing
service. Two simultaneous requests can execute at most once. A deterministic
version, readiness, authorization, or conflict failure invalidates the exact
job and keeps the event nonpublic; a transient runtime failure leaves it
pending. A current Owner or Administrator may safely invalidate a job whose
original authorizer is no longer eligible. The original authorizer remains
immutable history and is not treated as the recovery actor.

The product states that publication happens on the first relevant request at
or after the chosen time. It does not promise exact-to-the-second background
execution.

### Cancellation and restoration

- Cancelling a published event keeps its stable public detail page, records a
  public cancellation timestamp, and removes it from Upcoming.
- Cancelling a scheduled event terminalizes its job and leaves it unpublished.
- Archiving or soft-deleting a scheduled or published event unpublishes it.
- A previously published completed event may remain in Past.
- Restore always returns to an unpublished state and never silently republishes.
- Unpublish removes every public discovery surface while preserving the slug
  and publication history.

These transitions use the same Phase 4/Phase 5 intent pair; there is no
parallel lifecycle route.

### Sites migration compatibility

Migration 0014 is additive and contains only complete tokenizer-safe SQL
statements. It contains no trigger body, destructive rebuild, rename, reset,
`ALTER`, or `PRAGMA` mutation. Phase 5 trigger definitions are installed as
complete prepared D1 statements by the persistent fail-closed runtime
initializer. The durable version/fingerprint marker is written only after the
exact trigger set and every integrity scan pass.

## Consequences

- A published organizer event appears automatically on the existing public
  Home, Events, detail, club, metadata, structured-data, and sitemap reads.
- Private fields never enter the public relation or preview DTO.
- Scheduling remains request-driven and honestly described.
- Existing legacy and Meetup publication behavior is preserved.
- General CMS, community editing, media, imports/exports, public forms, email,
  QR, payments, attendee accounts, and Meetup write-back remain outside
  Phase 5.
- Phase 5 is saved only as an unpublished Sites version. The owner-only live
  version 8 remains unchanged until a separate deployment authorization.
