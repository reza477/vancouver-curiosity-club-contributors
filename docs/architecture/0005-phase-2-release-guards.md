# ADR 0005: Phase 2 release guards

- Status: Accepted
- Date: 2026-07-25
- Decision owner: Reza

The seven organization-integrity invariants remain accepted. Their original
installation in migration 0007 is superseded by the tokenizer-compatible,
persistently verified runtime installation in ADR 0006.

## Context

Two release-gate findings remained after Phase 2 version 6:

1. Home and Events converted genuine public D1/service exceptions into
   indexable HTTP 200 in-page states.
2. The independent foreign keys created in migration 0006 did not themselves
   require a public club profile or event detail to agree with its related
   record's organization.

The correction must preserve healthy indexing, filtered Events noindex,
populated version-6 data, existing conflict triggers, and the pinned
Sites/vinext runtime.

## Decision

### Service failures

- Keep a legitimately uninitialized/missing public catalog as a truthful HTTP
  200 review state.
- On a caught public D1/service exception, log only allowlisted operational
  metadata and throw the pinned App Router HTTP fallback digest for status 503.
- Do not use an ordinary route error boundary for this condition: vinext
  0.0.50 renders ordinary error boundaries with status 200.
- Reuse the public not-found boundary as a path-aware, accessible failure
  surface for exact Home and Events requests.
- Let the Worker apply the authoritative
  `X-Robots-Tag: noindex, nofollow, noarchive` to every error response and add
  `Cache-Control: no-store` to 5xx responses.
- Omit an explicit healthy-page robots directive from the root layout.
  Healthy public pages remain indexable by default or through route metadata,
  while the status fallback cannot inherit a contradictory `index` meta.
- Do not issue a second D1 query from metadata or buffer healthy HTML to infer
  failure state.

### Organization integrity

- Preserve the seven SQLite/D1 trigger definitions originally introduced by
  migrations 0006/0007:

  - child INSERT and relevant-key UPDATE guards for
    `club_public_profiles`;
  - child INSERT and relevant-key UPDATE guards for `event_public_details`;
  - parent organization-update guards for `clubs`, `event_lanes`, and
    `events`.

- Run the same two validation updates in the atomic runtime installation
  batch. They affect zero valid rows; a malformed pre-existing row activates
  the child guard and aborts the entire batch instead of being silently
  grandfathered.
- Preserve the original foreign keys and both reservation conflict triggers.

## Consequences

- Healthy `/` and canonical `/events` remain indexable.
- Healthy filtered Events remains non-indexable.
- Genuine Home or Events service failure is a truthful, accessible 503 and
  cannot be indexed or cached.
- Cross-organization public catalog rows are rejected before a later editor
  exists, regardless of whether the inconsistency is attempted from the child
  or parent side.
- Phase 3 remains untouched.

## Verification

- Built-Worker tests use a separate empty Miniflare D1 to force Home and Events
  service failures and assert status, headers, truthful copy, absence of
  private or database-error details, and absence of any contradictory HTML
  `index` directive.
- Migration/runtime tests cover fresh valid/mismatched inserts and updates,
  parent-side changes, malformed-data atomic rejection, unchanged reservation
  triggers, the durable marker/exact trigger set, and
  `PRAGMA foreign_key_check`.
