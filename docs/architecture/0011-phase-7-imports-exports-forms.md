# ADR 0011: Phase 7 imports, exports, calendars, and public intake

Status: Accepted and implemented; local verification completed

Date: 2026-07-28

## Context

Phase 7 adds CSV event import, allowlisted downloads and Owner backup, public
forms, a private submissions inbox, and revocable private calendar feeds. These
features handle private planning records and visitor-supplied personal
information while inheriting the Phase 4 scheduling conflict engine, the Phase
5 private-to-public workflow, and the Phase 6 fail-closed materialization
contract.

D1 limits each Worker invocation to 50 statements. Preview may contain up to
2,000 rows, so neither preview persistence nor duplicate/conflict discovery may
use one statement per row. An approved row must nevertheless remain atomic with
its event, scheduling, provenance, and import outcome.

## Decision

### Persisted preview is the approval boundary

The server parses an uploaded CSV using the versioned parser and template
contract. It stores only the file hash, bounded source label and namespace,
allowlisted mapped cells, normalized preview facts, warnings/errors, and
provenance. It does not retain the original file in D1 or R2.

Preview persistence uses byte-bounded set-based JSON statements. The canonical
preview fingerprint covers the parser/template versions, mapping, normalized
rows, defaults, matches, duplicate/conflict findings, and row-selection facts.
The browser never supplies an authoritative normalized event payload.

Approval requires current Owner or Administrator authorization, the expected
batch version, the exact persisted preview fingerprint, explicit selected row
IDs, and explicit duplicate/conflict decisions and reasons. Approval freezes
the certified preview facts. A later mapping, membership, taxonomy, venue,
duplicate, or conflict change is detected by the server-side revalidation.

### Source identity and duplicate handling

When a row supplies `external_id`, the batch must also supply a deterministic
non-null CSV namespace. Namespaces are one to 64 lowercase characters, start
with a letter or number, and then use only letters, numbers, dots, dashes, or
underscores. The CSV source type, namespace, and external ID form the
cross-batch source identity. This does not rely on SQLite uniqueness over a
nullable source identifier.

Hard duplicates are skipped and never overwrite an event. A semantic duplicate
defaults to Skip and may become Create Separate Event only with an explicit
Owner/Administrator reason. Import has no update, overwrite, or merge mode.

### Resumability and idempotency

Approval and application use optimistic batch versions, a single bounded runner
lease, a durable cursor, and one immutable application record per row. The row
idempotency key and source-link proof make a retry return the original durable
result rather than create another event. Terminal imported, skipped, and failed
facts cannot move backward.

The service applies one row, or another independently measured tiny bounded
number, per request. The advertised 25-to-50 row chunk is a maximum rather than
a target; the full Worker path, including invariant preflight and
authorization, must remain below 50 D1 statements. No route continues into
unbudgeted work after a maintenance response.

### Phase 4 conflict integration

Every selected row calls the authoritative Phase 4 scheduling-write service.
There is no import-specific reservation bypass.

- Ideas and Drafts use the existing non-reserving path.
- Holds and Confirmed events use the existing reservation intent and D1 guard.
- Warn-and-reason conflicts persist the exact version-bound reason before the
  guarded reserving transition in the same atomic row envelope.
- Administrator-approval conflicts leave only a private non-reserving Draft
  plus the normal pending review request. They do not reserve or publish.
- Blocking conflicts create no event.

Conflict review creation is set-based and bounded so a high-collision row cannot
exceed the request statement limit.

### Per-row atomicity

A successful imported row commits one D1 batch containing, as applicable:

1. the authoritative event and schedule mutation;
2. organizer and venue associations;
3. content and schedule revision;
4. conflict incidents, reason/override, or pending review;
5. exact CSV external-source link;
6. minimum-safe audit facts;
7. the immutable import application receipt;
8. row result and batch cursor/count advancement; and
9. a completion sentinel that aborts the batch if any conditional mutation did
   not occur.

D1 `batch()` success is not inferred from post-commit `meta.changes`. Stale or
unauthorized changes force a dependent statement to fail inside the same batch,
so an audit, notification, or cursor cannot commit without its action.

### Retention and redaction

Import source payload may be redacted only by a current Owner, only after the
terminal batch is at least 90 days old, and only through the audited redaction
envelope. Redaction removes allowed mapped source cells while retaining file
hash, parser/template and mapping versions, row fingerprints, decisions, result
codes, target event IDs, counts, and safe audit provenance.

Public form submissions receive a 365-day retention-review date. There is no
automatic deletion. Owner-only personal-content redaction replaces the base
payload, note bodies, and every completed workflow-intent payload copy with the
canonical irreversible marker and retains only the minimum nonpersonal
integrity receipt. Normal notes are append-only.

### Public/private boundaries

Public ICS and CSV read only exact verified public event projections. The
private subscription revalidates its hashed token and active membership on
every request. Operational CSV and Owner backup use explicit field allowlists;
they never serialize arbitrary D1 rows.

Form payloads, import rows, notes, source hashes, protection keys, rate
fingerprints, token hashes, private URLs, conflict reasons, identity/provider
facts, and R2 keys are excluded from public HTML, route data, metadata,
JSON-LD, sitemap, robots output, downloads, errors, logs, and client bundles.

The Owner backup uses export-local pseudonymous membership references. It is an
allowlisted product-data artifact, not an infrastructure backup and not an
automatic restore source.

## Consequences

- Preview and application require more durable companion records than an
  upload-and-loop design, but browser interruption and lost responses are safe.
- Import never publishes. Editors must use the normal Phase 5 workflow after
  reviewing the private event.
- Public forms store data in the private inbox and send no email confirmation.
- Calendar subscriptions are read-only. Hosted external-client behavior remains
  unverified until a later authorized deployment.
- ICS file import is not part of this architecture:
  **Not implemented — authorized cut.**
