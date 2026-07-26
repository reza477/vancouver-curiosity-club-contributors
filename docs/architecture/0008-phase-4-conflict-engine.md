# ADR 0008: Phase 4 authoritative conflict engine

Date: 2026-07-25
Status: Accepted for Phase 4

## Context

Phase 3 established `organizer_events` as the sole writable manual-event store,
with separate planning, publication, and schedule states. It intentionally
allowed only private Ideas and Drafts. The legacy `events` conflict triggers
remain a useful Phase 1 architecture proof, but their foreign keys and write
service target the legacy store and therefore cannot authorize Phase 4
organizer scheduling.

Phase 4 must add tentative holds and confirmed private events without creating
a second writable event model. It must also coordinate with read-only legacy
reservations and only completed active Meetup generations. A normal
application read followed by a later unguarded update is not sufficient: two
Worker isolates can observe the same empty slot.

Sites production tokenizes packaged migration SQL at semicolons. Trigger bodies
therefore remain runtime-installed, complete prepared D1 statements and never
appear in a packaged migration.

## Decision

### Canonical record and normalized conflict projections

`organizer_events` remains the canonical manual-event record.
`0013_phase4_conflict_engine.sql` adds only normalized, organization-scoped
sidecars:

- one active conflict policy and monotonically increasing policy version per
  organization;
- complete schedule write intents containing only bounded identifiers and
  normalized scheduling facts;
- one normalized reservation state for each scheduled manual event;
- normalized read-only intervals for legacy and immutable Meetup snapshot
  candidates;
- version-bound incidents, reviews, and overrides;
- durable hold-notification receipts.

The sidecars are conflict projections, not independently editable event
records. They contain no email, SIWC subject, feed URL, token, private note,
meeting link, or full form body. Organizer scope JSON is valid, bounded,
uniquely sorted, and deterministic.

Every manual Phase 4 record keeps `publication_status = 'private'`. Phase 2
public SQL continues to ignore `organizer_events`, so a private confirmed event
cannot appear on Home, Events, a club page, metadata, structured data, the
sitemap, or a guessed public slug.

### Interval semantics

All comparisons use half-open intervals:

`proposedStart < existingEnd AND proposedEnd > existingStart`

Actual interval overlap is classified as direct. Only when actual intervals do
not overlap may expanded setup/cleanup intervals produce a buffer conflict.
Organization overlap is always recorded, even across different clubs,
organizers, and venues. The complete fact set also records a shared venue,
shared primary organizer, and each shared co-organizer.

Timed records keep UTC instants and their original IANA timezone. All-day
records retain inclusive start and exclusive end dates. Their conflict
boundaries are derived as local midnight in the original IANA timezone, so
Vancouver spring-forward and fall-back days remain 23 and 25 hours rather than
being approximated as midnight UTC.

Tentative holds and confirmed events reserve. A hold stops reserving exactly
when `hold_expires_at <= D1 current time`, without relying on cron. Drafts
produce informational warnings. Cancelled, completed, archived, deleted, and
expired-hold records do not reserve.

### Authoritative write protocol

Every schedule-affecting organizer action uses one server-only scheduling
service and one bounded `DB.batch()` transaction:

1. Insert a complete write intent through an `INSERT ... SELECT` that rechecks
   the actor's active profile, membership, role, club assignment, event
   ownership/co-organization, expected content version, expected schedule
   version, references, and current policy.
2. Materialize the exact proposed normalized interval, buffers, venue,
   organizer scope, hold expiry, and next schedule version.
3. Record the deterministic conflict incidents and any exact version-bound
   review or override facts required by the policy.
4. Apply one conditional canonical event mutation.
5. Replace organizer associations with the proposed final set.
6. Write the immutable revision, append-only audit entry, and allowlisted
   notifications.
7. Finalize the intent only after the canonical record, normalized projection,
   and association set match exactly.

Runtime D1 triggers repeat the authoritative conflict and actor checks against
the complete proposed state. A zero-row conditional mutation, missing intent,
stale version, mismatched scope, invalid review, expired hold, or conflict
guard abort rolls back every statement. The service never treats zero changed
rows as success and never retries an uncertain write automatically.

Content-only edits increment `content_version`. Any schedule, lifecycle,
organizer, venue, buffer, club, expiry, deletion, or restore change that
affects reservation semantics also increments `schedule_version`. Review and
override validity is bound to both event versions, the policy version, exact
interval, organizer scope, venue, buffers, hold expiry, and conflict facts.

### Policy behavior

The initial organization policy is:

- `warn_reason`;
- 72-hour default hold duration;
- 24-hour nearing-expiry threshold.

Under `warn_reason`, every conflicting candidate pair needs the authorized
editor's bounded written reason in the same atomic write. Under
`require_admin_approval`, the request remains a non-reserving private Draft
until an Owner or Administrator approves; an Administrator cannot approve
their own request, while the Owner may approve their own request to avoid a
single-owner deadlock. Approval reruns the authoritative write. Under `block`,
no reason, client flag, or stored stale review can bypass a current overlap.

Only Owner and Administrator can change policy or hold defaults. Each change
increments the policy version and creates an audit entry.

### Read-only coordination sources

Legacy reserving rows and completed active Meetup snapshots are normalized into
the same conflict-candidate shape while remaining read-only. Source-linked
canonical `events` rows are deliberately non-reserving Draft anchors for
stable content and relationships; source-native planning status lives only in
the immutable snapshot. Those anchors are excluded from the legacy candidate
set, so the active normalized snapshot is the one authoritative source
reservation and is never double-counted through the Phase 1 proof triggers.

Meetup snapshot intervals are staged with their immutable generation. Pending,
failed, disabled, and deleted sources remain invisible. One fingerprint binds
the exact generation-specific snapshot, normalized interval, resource, and
state parity. A separate generation-independent reservation-semantic
fingerprint intentionally excludes generation IDs and content-only facts.

A runtime guard protects `sync_sources.active_generation_id`, `enabled`, and
`deleted_at`. It runs when a completed generation becomes active, when a
disabled source with an active generation is re-enabled, and when such a
source is restored. Activation requires complete parity and rejects a newly
introduced unreviewed reservation conflict. A rejected activation leaves the
last completed active generation public and reserving, retains the staged
generation for a safe retry, and records only a redacted schedule-conflict
state for the organizer workspace. Once the conflicting manual reservation is
released, cancelled, or rescheduled through the authoritative write path, a
manual refresh can retry the retained generation.

When activation changes reservation semantics, the same atomic trigger closes
manual incidents, pending reviews, and active overrides bound to the old
external facts before installing the new source state. If activation later
fails, the transaction rolls back those closures. A semantically identical
refresh across a new generation preserves still-valid coordination state.
Successful activation also clears the redacted source error.

Existing all-day candidates require Worker-side IANA normalization. The
runtime initializer repairs them in bounded, fail-closed work: it withholds the
durable readiness marker and dispatches no application query until the
normalized coordination index and exact trigger set are verified.

### Runtime guards and statement budget

Migration 0013 contains no trigger body, `ALTER`, `DROP`, rename, reset, or
`PRAGMA` mutation. Each fragment is a complete retry-safe statement.

The persistent runtime invariant is version 4 with 48 exact triggers and
fingerprint
`0cd660044b22630341bde84ef8d48951842797c2b48c8b60450abb2f66f86f49`.
It verifies normalized `sqlite_master` definitions, integrity counts, and the
durable marker. The additive Phase 4 schema totals 52 tables and 117 explicit
indexes; migration 0013 contains 37 complete statements, including 9 tables
and 27 indexes, with no packaged trigger body.
Existing public, ownership, membership, invitation, profile, club, revision,
audit, and Phase 1 guards remain. Phase 3 event guards are replaced only where
the Phase 4 lifecycle and intent protocol require it. Cold, healthy, ordinary
repair, and bounded corruption-repair paths remain within D1's 50-statement
limit and fail closed before application dispatch.

### Hold reconciliation and notifications

Expiry is derived from D1 time on every reservation read/write, so no scheduler
is claimed. Authenticated organizer loads, refresh-on-focus, and explicit
refresh reconcile at most one nearing-expiry and one expired notification per
event schedule version and recipient. Unique D1 receipts provide durable
deduplication across Worker isolates.

Notification payloads remain allowlisted and contain only minimum IDs and safe
display text. Conflict reasons stay private and never enter public HTML, JSON,
metadata, structured data, sitemap, logs, or client bundles.

## Consequences

- Every Phase 4 reserving mutation and source-generation activation has a
  database-enforced atomic guard.
- The private conflict preview is advisory; the final write always evaluates
  current canonical D1 state again.
- Expired holds stop reserving without cron, while history remains immutable.
- The private conflict centre can explain every resource fact without exposing
  unrelated private notes or identities.
- Public preview and publication remain Phase 5 and are not implemented here.
- The existing owner-only version-8 deployment remains unchanged; Phase 4 is
  saved only as a new unpublished Sites version.
