# ADR 0002: D1 atomic reservation guard

- Status: Accepted for Phase 1
- Date: 2026-07-23
- Scope: Architecture proof only; no schedule-reserving UI

## Context

Two organizers can attempt to reserve the same empty interval at nearly the same time. An application-level read followed by a later write can race on D1, so Phase 1 must prove the invariant in the database-compatible write path.

The invariant also needs to survive crafted review states, cross-club writes, different venues and organizers, expiring holds, buffers, co-organizers, and stale optimistic versions.

## Decision

- Keep the canonical timezone-normalized timed interval, buffers, venue, primary organizer, and complete organizer scope on the `events` row used by the guard.
- Use SQLite `BEFORE INSERT` and `BEFORE UPDATE` triggers installed and
  persistently verified before Worker application dispatch. The original
  generated-migration installation mechanism is superseded by ADR 0006; the
  database-enforced trigger definitions and invariant are unchanged.
- Treat `hold`, `tentative`, and `confirmed` as reserving statuses.
- Block direct buffered overlap across the entire organization, including across clubs and when venue and organizer differ.
- Emit deterministic database abort categories for shared venue, shared organizer scope, and otherwise organization-wide overlap. Every category blocks under the Phase 1 policy.
- Never use `schedule_review_state` as a bypass. Reviewed or overridden reserving rows remain visible to later writes. A future intentional-overlap path must provide a valid version-bound override in the same transaction; Phase 1 conservatively blocks instead.
- Persist `hold_expires_at`. A hold reserves only while its expiry is strictly later than SQLite's current subsecond timestamp; equality is expired. Holds require an expiry and non-holds must not carry one.
- Use a version-qualified mutation and `DB.batch()` for the event, immutable revision, normalized organizer associations, assertion, and content-free audit record.
- Treat a trigger abort or zero changed event rows as conflict/stale failure, never success.

## Verification contract

The Miniflare D1 integration suite applies the normalized shipped migrations,
runs the persistent invariant initializer, confirms the installed trigger SQL
matches the source constants, and proves:

- two synchronized competing writes commit at most one reservation;
- the same result holds across different clubs, venues, and organizers;
- reviewed/overridden writes cannot bypass the guard and remain visible later;
- primary and co-organizer scope is canonical and buffers affect the interval;
- active holds block, expired holds do not, and the exact expiry boundary is expired;
- stale updates and rejected writes leave no partial association, revision, or audit residue.

## Consequences

- Phase 1 proves database-enforced atomicity but intentionally exposes no reserving event form or API.
- Draft-warning UX, conflict explanation queries, approved version-bound overrides, and policy UI remain later-phase work.
- The current blocking policy is stricter than a future approved intentional-overlap policy and cannot silently weaken the invariant.
