# ADR 0007: Phase 3 private organizer workspace

Date: 2026-07-25
Status: Accepted for Phase 3

## Context

Phase 2 publishes a read-only public website from allowlisted D1 projections.
It also preserves completed Meetup generations and database-enforced schedule
and public-catalog invariants. Phase 3 needs a private organizer workspace, but
it is not authorized to reserve schedule time or publish website content.

The legacy `events.status` and `events.visibility` columns combine planning,
publication, schedule, source, and historical concerns. Extending those
columns as another manual write surface would make it possible to reach a
reserving or public state before the Phase 4 and Phase 5 gates.

## Decision

### Canonical private lifecycle

Migration `0012_phase3_organizer_foundation.sql` adds one authoritative
Phase 3 manual-event store:

- `planning_status` supports the complete canonical vocabulary, while every
  Phase 3 write is database- and service-limited to `idea` or `draft`;
- `publication_status` is separate and every Phase 3 write is limited to
  `private`;
- `schedule_shape` is `unscheduled`, `timed`, or `all_day`;
- only an Idea can be unscheduled;
- timed schedules store UTC instants plus the original IANA timezone;
- all-day schedules store an inclusive start date and exclusive end date;
- `content_version` is the optimistic editor version and remains distinct from
  `schedule_version`, which is reserved for later conflict authorization.

The migration is additive, data-preserving, retry-safe, and compatible with
the Sites production semicolon tokenizer. It contains no trigger body,
destructive rebuild, `ALTER`, `PRAGMA`, or migration reset.

Eligible legacy private Ideas and Drafts are adopted only when the complete
active organizer set, club, taxonomy, venue, and updater references satisfy
the final organization and assignment rules. The canonical
`organizer_scope_json` set must exactly match the normalized primary and
co-organizer association set, and the creator must have same-organization
membership. Adoption is all-or-nothing.
Ineligible records remain intact as read-only legacy calendar records, so no
organizer association is silently discarded. Existing source-controlled,
reserving, or published records stay in their established stores and remain
read-only.

Phase 3 workspace display-name, biography, and public-attribution-consent
drafts live only in the private profile-preference sidecar. Public projections
continue to read the canonical profile columns, preserving the deployed
Phase 2 host output until a later authorized publication workflow.

### Persistent database invariants

The server-only invariant initializer advances to durable version 3 and
installs the complete set of 30 exact D1 triggers as prepared statements:

- the existing two schedule-reservation guards;
- the existing seven public organization-integrity guards;
- Phase 3 owner, transfer-lock, membership/profile identity, manual-event,
  organizer-association, immutable revision/audit, profile-preference, and
  persistent rate-limit guards.

The marker is written only after the expected normalized `sqlite_master`
definitions and integrity probes pass. Healthy requests use three inspection
statements. Repairs stay below the 50-statement D1 batch limit and fail closed:
the Worker returns a private, no-store/noindex 503 and dispatches the
application only on a subsequent request that verifies the persistent state.

### Authorization and private routing

Sign in with ChatGPT supplies identity only. Each private page and action
revalidates the dispatcher-owned identity against an active, non-suspended
organization membership and any required club assignment. Client bodies never
supply the actor, role, email, or organization.

`/organizer` uses a separate responsive shell and emits no public canonical,
Open Graph, JSON-LD, or footer/header chrome. Every organizer, invitation, and
organizer API response is `no-store` and `noindex, nofollow, noarchive`.
Signed-out traffic uses the Sites-owned sign-in route. Authenticated
non-members receive an actual HTTP 403 through a page-level vinext access
boundary.

Invitation tokens are 256-bit random values whose SHA-256 hashes are stored in
D1. The Worker captures a valid token into a short-lived, path-scoped,
HttpOnly, SameSite cookie and redirects to a clean URL before rendering.
Acceptance is email-bound, one-time, expiring, revocable, rate-limited in D1,
and atomic with membership, club assignment, notification, and audit writes.

### Mutation and history model

Manual event create, edit, duplicate, soft delete, and restore operations use
bounded prepared D1 batches. A successful mutation writes the current record,
an immutable revision snapshot, and an append-only audit entry together.
Optimistic compare-and-swap failures return `409 stale_edit` without partial
revision or audit residue.

Owner and Administrator can manage organization-wide Phase 3 records.
Organizer writes remain constrained to assigned clubs and records they own or
co-organize. Membership changes cannot orphan active private Ideas or Drafts.
Ownership transfer uses a database-guarded atomic lock and preserves exactly
one active Owner whose profile is active and not deleted. Membership identity
fields are immutable, and profile suspension, deletion, or identity mutation
cannot bypass the single-owner proof.

Notifications use an explicit type and payload allowlist. They contain only
minimum record identifiers and safe display text; they never contain email,
SIWC identifiers, invitation values, private feed URLs, runtime values, or
full private notes.

### Calendar reads

The private calendar deliberately combines:

- Phase 3 manual Ideas and Drafts;
- existing legacy records as read-only;
- only completed active Meetup snapshots as read-only.

It never reads pending Meetup facts. Candidate reads are paged and bounded,
with an exact total, explicit loaded count, and validated cumulative load
path. The private Events index applies search and lifecycle filters server-side
and exposes deterministic 200-record pages, including recoverable deleted
records. Filters include the complete primary and co-organizer set. All-day
date-range comparisons convert exclusive local-date bounds using the event's
IANA timezone. Unscheduled Ideas are returned in a separate Ideas collection
and never receive a synthetic date.

Club updates and archive operations repeat the actor's active-profile,
membership, and role proof in the committing batch. Archive is blocked while
any recoverable organizer event, visible legacy event, retained Meetup source,
active program, pending invitation, or active assignment still belongs to the
club. Meetup source connection repeats the same active-club and actor proof at
commit time.

## Consequences

- Phase 3 cannot publish, reserve, hold, confirm, cancel, archive, or complete
  a manual record, even through a crafted request or direct D1 write that
  passes through the installed guards.
- Phase 2 public SQL and Meetup generation publication remain unchanged; new
  private records are absent from public HTML, metadata, sitemap, JSON-LD, and
  guessed public slugs.
- The private workspace can be saved as an unpublished Sites version without
  changing the existing owner-only version-8 deployment.
- Conflict decisions remain Phase 4, public event publishing remains Phase 5,
  and public CMS/media remains Phase 6.
