# ADR 0006: Sites-compatible D1 trigger installation

- Status: Accepted for the pre-production Phase 2 deployment correction
- Date: 2026-07-25
- Decision owner: Reza

## Context

Saved Sites version 7 failed its first owner-only deployment before
publication with `incomplete input: SQLITE_ERROR`. The exact archive was
intact. All eight packaged migrations applied when each Drizzle breakpoint
chunk was prepared as one SQLite statement. A production-style semicolon
tokenizer instead reproduced the exact failure at the first internal semicolon
of `events_reservation_guard_before_insert`.

All non-trigger fragments from the same archive applied successfully under
that tokenizer. The incompatible grammar was isolated to eleven historical
`CREATE TRIGGER` chunks: two in migration 0000, two replacements in 0001, and
seven public-integrity guards in 0007.

Sites exposes no hosted D1 query, migration-ledger, reset, or reprovision
capability. The failed attempt returned no URL and never published a Worker, so
hosted user writes were impossible. It could nevertheless have left schema
objects from the prefix before the first trigger.

## Decision

Use the explicitly authorized one-time pre-production normalization:

- Remove the historical 0000–0007 chain from the new package while preserving
  it in Git and immutable Sites versions.
- Use monotonic migrations 0008–0011 so any unrecorded partial version-7
  objects are handled by a new migration identity.
- Migration 0008 contains 49 child-first, idempotent drops for the nine known
  triggers, three known rebuild remnants, and 37 final application tables.
- Migration 0009 recreates 37 final tables.
- Migrations 0010 and 0011 recreate the 75 final indexes in bounded halves.
- Every create is `IF NOT EXISTS`, so a partially applied normalized file can
  be retried. No packaged migration contains `CREATE TRIGGER`, `ALTER TABLE`,
  `PRAGMA`, a rename/rebuild sequence, or more than 49 statements.
- Keep the final generated Drizzle snapshot and journal aligned; an immediate
  generation run must report no drift.

Install database guards at Worker startup, before application dispatch:

1. Read the durable `database_invariant_state` marker, all `sqlite_master`
   trigger definitions, and both cross-organization integrity probes.
2. If version, fingerprint, the exact nine normalized definitions, and both
   probes match, proceed.
3. Otherwise submit one atomic prepared D1 batch containing the marker delete,
   nine trigger drops, nine complete trigger creates, two validation probes,
   and one guarded marker upsert.
4. Require one marker write, then read back the marker, definitions, and probes
   before dispatch.
5. Cache only a successful promise per D1 binding as an isolate-local
   optimization. Every new Worker isolate still verifies the persistent
   database state.
6. On any failure, do not call the application handler. Emit only the
   allowlisted operational code and return a no-store/noindex 503 without SQL,
   identity, or private-content details.

The runtime statements are the same two organization-wide reservation guards
and seven public organization-integrity guards already accepted for Phase 1
and Phase 2. Enforcement remains inside SQLite; it is not downgraded to an
application-level check.

## Verification contract

Automated tests must:

- apply exact source and packaged migrations through semicolon tokenization;
- assert 37 application tables, 75 explicit indexes, 32 unique indexes, 102
  foreign keys, 40 checks, zero migration-installed triggers, and zero foreign
  key violations;
- retry every normalized partial prefix and representative version-7/rebuild
  remnants;
- reject malformed/truncated packaged SQL;
- concurrently initialize through distinct isolate-style bindings;
- verify the durable marker and exact normalized `sqlite_master` SQL;
- repair missing or mismatched guards;
- reject malformed pre-existing public rows with no marker or partial trigger
  installation;
- rerun conflict, public-integrity, authentication, Meetup, projection, full
  Worker, and privacy regressions.

## Consequences

- The normalized reset is safe only because no production Worker or user data
  ever existed. This decision is not a general migration strategy and must
  never be repeated after the first successful hosted deployment.
- The database guard set is checked before every application entry into a new
  Worker isolate. An unavailable or malformed database fails closed.
- A successful hosted application response is evidence that the persistent
  marker, exact nine triggers, and both integrity probes passed on that
  isolate.
- If the corrected owner-only deployment still fails, the new evidence must
  drive another narrow compatibility correction. Phase 3 remains out of
  scope.
