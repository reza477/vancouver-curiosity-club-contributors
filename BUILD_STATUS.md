# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-25 (America/Vancouver)

## Active phase and authorized scope

- **Phase 4 — Authoritative conflict engine and reserving writes.**
- Phase 4 application work is implemented and verified in isolated local,
  preview-D1, source-test, built-Worker, and browser seams.
- Phase 5 public preview/publication work is not authorized and has not
  started.
- Authorized cuts: **none**.
- The owner-only live deployment remains version 8. Phase 4 has not been
  deployed.

## Completed and verified

### Authoritative private scheduling

- `organizer_events` remains the only writable manual-event record.
- Every schedule-affecting create, edit, lifecycle, duplicate, delete, and
  restore path uses the same server-only scheduling protocol. The legacy
  `events` conflict proof is not an organizer write path.
- Timed and all-day Drafts, tentative holds, and confirmed private events use
  separate content and schedule versions. Unscheduled Ideas retain no invented
  date.
- Tentative holds and confirmed records reserve. Drafts are informational.
  Cancelled, completed, archived, deleted, and D1-time-expired holds do not
  reserve.
- Held and confirmed records can be rescheduled by an authorized actor. Time,
  timezone, club, venue, buffer, primary organizer, and co-organizer changes
  receive a complete atomic recheck.
- Completion is rejected before the canonical event end and succeeds at the
  exact D1-time boundary or later. Restore returns to a safe non-reserving
  Draft.
- Every successful mutation commits the canonical row, exact organizer set,
  normalized reservation state, version-bound incident/review/override facts,
  immutable revision, audit entry, and allowlisted notifications in one
  bounded `DB.batch()` transaction.
- Zero-row, stale-content, stale-schedule, conflict, expired-hold,
  authorization, and invariant failures are treated as failure and roll back
  all residue.

### Conflict semantics and policy

- Direct overlap uses half-open intervals. A 6:00 PM end and 6:00 PM start do
  not overlap when both buffers are zero.
- Buffer-only overlap uses both records' setup and cleanup/travel expansion.
  Direct overlap takes priority while every relevant organization, organizer,
  co-organizer, and venue fact remains available for explanation.
- Conflicts are organization-wide across clubs. All-day bounds are normalized
  at local midnight in the original IANA timezone, including Vancouver
  spring-forward and fall-back behavior.
- One active D1 policy supports:

  - `warn_reason`;
  - `require_admin_approval`;
  - `block`.

- Default hold duration is 72 hours; nearing-expiry threshold is 24 hours.
- Warn overlaps require an exact bounded reason stored atomically with both
  event versions, policy version, and conflict facts.
- Administrator-approval requests remain non-reserving Drafts. An
  Administrator cannot self-approve but may reject or withdraw their own
  request. An Owner may self-approve.
- Policy or schedule/resource changes atomically close stale pending reviews,
  overrides, and incident presentation state. Rejected or invalidated reviews
  may be requested again without uniqueness collisions.
- Authoritative candidate reads fail closed rather than authorize a truncated
  set.

### Read-only source coordination

- Active read-only legacy reservations and enabled completed active Meetup
  generations participate in the same conflict model without becoming
  writable.
- Pending, failed, disabled, or deleted Meetup sources remain invisible.
- Timed and IANA-normalized all-day Meetup facts stage with exact immutable
  snapshot parity and normalized interval/resource parity.
- A separate generation-independent reservation-semantic fingerprint permits
  an identical or content-only refresh while detecting schedule, resource, or
  reserving-state changes.
- Changing `active_generation_id`, re-enabling a source with an active
  generation, or restoring that source runs the same database activation
  guard.
- Changed external reservation semantics atomically close manual incidents,
  pending reviews, and overrides bound to the old external facts. If
  activation fails, those closures roll back with it.
- A genuinely new source overlap fails closed. The prior completed generation
  remains active, the staged generation is retained with a redacted actionable
  schedule-conflict state, and the documented resolution is to move/release
  the manual reservation and refresh again.
- Saved feed addresses, tokens, raw feed bodies, descriptions, and private
  locations remain absent from client DTOs, public output, logs, and artifacts.

### Private organizer experience

- Added protected `/organizer/conflicts`, conflict preview and review APIs,
  lifecycle-action API, private venue APIs, and conflict-policy settings.
- Desktop and mobile organizer navigation expose Calendar, Add Event,
  Conflicts, Team, and More/Settings without Phase 5 controls.
- The event editor presents schedule, timezone, people, venue, buffers, and
  lifecycle in one accessible workflow. The preview is debounced,
  cancellable, stale-response-safe, and explicitly advisory.
- Conflict Center groups Open, Pending approval, Approved, Rejected,
  Invalidated, Resolved, and informational Draft warnings.
- Conflict actions are emitted only for a manual side the actor can actually
  edit. Legacy and Meetup sources use honest read-only destinations or labels.
- Event detail loads a real organization-scoped conflict summary; unrelated
  reasons and private source facts are not disclosed.
- Calendar has a real Conflict-only filter, visible counts, Clear Filters,
  bounded-load disclosure, and a distinct unscheduled Ideas area.
- Owner/Administrator can manage private venues and policy. Organizer
  permissions remain assigned-club and owned/co-organized-event scoped.
- D1-time reconciliation creates at most one nearing-expiry and one expiry
  notification per event schedule version and affected recipient.
- Conflict, review, decision, hold, confirmation, cancellation, and material
  schedule notifications use bounded allowlisted payloads and durable
  deduplication. No email, digest, cron, scheduler, or realtime claim exists.

### Migration and persistent invariants

- Existing migrations `0008` through `0012` remain unchanged.
- Additive migration `0013_phase4_conflict_engine.sql` contains **37 complete
  single statements**, including **9 tables** and **27 indexes**. It contains
  no trigger body, destructive rebuild, `ALTER`, `DROP`, rename, reset, or
  `PRAGMA` mutation.
- Migration 0013 is retry-safe against clean, populated-version-8, repeated,
  and every partial production-tokenizer prefix tested.
- Current schema evidence:

  - 52 tables;
  - 117 explicit indexes;
  - 44 unique indexes;
  - 177 foreign keys;
  - 91 checks;
  - zero `PRAGMA foreign_key_check` violations.

- Runtime invariant version is **4**, with **48 exact triggers** and fingerprint
  `0cd660044b22630341bde84ef8d48951842797c2b48c8b60450abb2f66f86f49`.
- The fail-closed initializer verifies normalized `sqlite_master` definitions,
  exact trigger count, durable marker, and organization/policy/reservation/
  incident/review/override/source integrity before application dispatch.
- Cold, healthy, ordinary repair, bounded full-repair, manual adoption, and
  external adoption paths remain within the 50-statement D1 invocation limit.
- Concurrent-isolate initialization is idempotent. Malformed existing data
  writes no false readiness marker or partial trusted guard set.

### Public/private separation

- Every Phase 4 manual record keeps `publication_status = 'private'`.
- Phase 2 public projections do not read `organizer_events`.
- Private holds, confirmations, reasons, notes, venues, organizer identity,
  notifications, audit history, invitations, and source configuration remain
  absent from Home, Events, event/club detail, metadata, JSON-LD, sitemap,
  guessed public slugs, and public error surfaces.
- Existing active-generation Meetup publication isolation remains unchanged.
- Organizer routes and APIs remain trusted-context protected, `no-store`, and
  `noindex, nofollow, noarchive`.

## Exact verification evidence

Commands ran from `C:\Users\user\Documents\Website` on 2026-07-25.

- `npm.cmd ci` — exit 0; 503 packages installed from the existing lockfile.
  Deprecation notices and seven packages with pending install scripts were
  reported; the pinned Sites runtime was not force-upgraded.
- `npm.cmd run db:generate` — exit 0; 52 tables; no schema drift and no new
  migration generated.
- Fresh local migration proof — exit 0 after preserving an ignored
  in-progress local D1 backup; six migrations, 52 tables, 48/48 triggers,
  bounded `repaired` then `ready`, zero foreign-key violations.
- Fresh preview-D1 migration proof — exit 0 with the same six migrations, 52
  tables, 48/48 triggers, bounded repair convergence, and zero violations.
- Final `npm.cmd run db:apply:local` — exit 0; all six migrations recorded,
  invariant status `ready`, 52 tables, 48/48 triggers, zero violations.
- Final `npm.cmd run db:apply:preview` — exit 0 with the same result against the
  Sites local preview D1.
- `npm.cmd run typecheck` — exit 0 under strict TypeScript.
- Exact `npm.cmd run lint` before build — exit 0.
- `npm.cmd test` — exit 0; **246/246 passed**, 0 failed, 0 skipped.
- `npm.cmd run build` — exit 0; vinext built the full public and protected
  Worker route set.
- Exact `npm.cmd run lint` after retained build artifacts — exit 0.
- `npm.cmd run test:rendered` — exit 0; **21/21 passed**, 0 failed, 0 skipped.
  The built Worker applies packaged migrations, installs the version-4 guard
  set, renders protected flows, commits a real private hold and reviewed Warn
  overlap, rejects unreviewed conflict, and preserves public isolation.
- Focused migration/invariant/conflict/concurrency/security/public-leakage gate
  — exit 0; **157/157 passed**, 0 failed, 0 skipped.
- Administrator self-rejection with no notification recipient — exact D1
  regression passed: review rejected, one audit, zero notices.
- Source-activation regressions passed for timed/all-day staging, mapped
  resources, identical generation refresh, content-only change, schedule
  change, new conflict refusal, stale-artifact invalidation, rollback,
  re-enable guard, deactivation, disappearance/reappearance, and statement
  budget.
- `git diff --check` — exit 0; only expected Windows line-ending notices.
- Built-output audit — `dist` contains **106 files / 5,759,354 bytes**.
- Source/package Drizzle comparison — **13/13 resources byte-identical**.
- Source and built privacy scans — zero concrete private Meetup feed URLs,
  zero email-like values in `dist`, zero credential/private-key/Bearer-token
  patterns, and zero environment, local-D1, test, fixture, work, or log files
  in `dist`.
- `npm.cmd audit --omit=dev --json` — **Not run to a usable result**. The npm
  advisory endpoint returned malformed gzip bytes and npm exit 1.
- `npm.cmd audit --json` — **Not run to a usable result** for the same external
  registry response. The last reproducible version-9 baseline remains 3 high /
  0 critical production advisories and 18 total advisories (1 low, 4 moderate,
  13 high, 0 critical); it is retained as historical evidence, not claimed as
  a current rerun.

### Failures encountered and resolved

- An ignored local D1 recorded an earlier hash of the in-progress migration
  0013. It was preserved as a timestamped ignored backup; only disposable
  local/preview stores were re-created. Hosted D1 was never reset or changed.
- The local migration harness initially stopped after one bounded invariant
  repair request. Both supported local and preview harnesses now continue
  bounded repair calls until the durable status is `ready`.
- One direct Node test command omitted the project `tsx` loader and failed ESM
  resolution. The supported loader command and the complete project runner
  passed.
- Final red-team reproduction found that an Administrator self-rejection with
  no other notification recipient could abort after the successful review
  mutation. Audit/sentinel gating now follows the review/incident mutation
  rather than optional notification count; the regression and full suite pass.
- Notification-page starter copy described only Phase 3 categories. It now
  truthfully includes schedule, conflict-review, and hold changes.

## Browser and accessibility evidence

- Authenticated browser QA used an isolated synthetic `.invalid` identity,
  ignored local D1, and a local trusted-header proxy. No production auth seam
  or hosted data was changed; the local secret file was removed afterward.
- A private unscheduled Idea was created through the UI and retained no date.
  Scheduled Draft fixtures were created through the protected local API
  because browser automation could not reliably set the native date control.
- A real 4:00–6:00 PM hold was placed through the UI. A 5:00–7:00 PM
  overlapping Draft showed the exact 5:00–6:00 PM organization/organizer
  conflict. Confirm with a bounded Warn reason succeeded, persisted as
  `confirmed`, and appeared in Conflict Center as Approved with the exact
  private reason.
- Conflict-only filtering returned zero matching records from two total, and
  Clear Filters restored both. The unscheduled Idea remained in the Ideas area.
- Widths checked: 320×800, 390×844, 768×1024, 1280×800, and 1440×900. No
  essential horizontal overflow was observed; mobile body text remained 16px.
- A 720px viewport provided a 1440-at-200%-equivalent reflow check with no
  horizontal overflow. Exact browser zoom measurement was not run.
- Visible keyboard focus was verified on the editor. Skip link, landmarks,
  headings, text-plus-color states, and mobile navigation were inspected.
- Public Home and Events contained none of the isolated private fixture titles,
  identity, or source values. Events rendered a truthful empty review state.
- Completed-flow console logs contained no application, hydration, or
  accessibility warning. An earlier expected 403 diagnostic occurred while
  establishing the isolated authentication seam.
- Browser reduced-motion emulation was blocked by the browser security policy
  and was not retried. Reduced-motion CSS and source-contract tests pass.

## Implemented but not externally verified

- Phase 4 is not deployed; hosted Phase 4 behavior remains unverified.
- Hosted D1 schema/table/index/trigger introspection is unavailable through the
  current Sites capability. Local, preview, source, and built-Worker D1 provide
  the evidence above.
- Hosted second-identity invitation and role/club authorization cannot be
  tested while Sites access remains exactly one owner and zero groups.
- R2 remains bound as `MEDIA` and unchanged. Phase 4 has no media workflow.
- Automatic background hold or Meetup work is not claimed. Reconciliation and
  refresh are request-driven.

## Not implemented

- Public event preview, scheduled publication, publish/unpublish, public CMS,
  Community editing, R2 upload, CSV/ICS file import, export, public forms,
  email/digests, QR downloads, payments, donations, internal RSVP, attendee
  accounts, comments, messaging, forums, and chat.
- No Phase 5 or later dead control is present.

## Not run

- Hosted Phase 4 owner smoke test — no Phase 4 version is deployed.
- Hosted second human identity — current Sites policy permits one owner and
  zero groups.
- Hosted D1 schema introspection — current Sites tools expose migration
  application status but not direct SQL introspection.
- Hosted real Meetup conflict/activation smoke — private production feed
  configuration is not printed or copied into this review.
- Automated Axe, Lighthouse, and Core Web Vitals — unavailable in the pinned
  toolchain; no score is claimed.
- Exact 200% browser zoom and a complete keyboard-only scheduled-Draft flow —
  browser automation limitations are recorded above.
- Browser reduced-motion emulation — blocked by the browser security policy;
  static behavior is covered instead.
- R2 workflow — out of Phase 4 scope.

## Blocked

- Hosted second-identity verification requires a separately authorized Sites
  access-policy change.
- Remaining factual owner inputs:

  - exact BC legal name, legal form/status wording, registration number,
    effective date, approved legal footer, and charity status;
  - exact public Meetup discussion URL;
  - owner-selected hosted RSVP URLs for a real-event smoke test;
  - approved final copy and confirmed public contact;
  - real photographs with rights, credit, and participant-consent state;
  - approved public organizer names, biographies, and both consent gates;
  - event-specific venue and accessibility facts.

## Sites project, bindings, version, and deployment state

- Sites project:
  `appgprj_6a62eaf79c4881919bb8e47998af851a`.
- Logical bindings remain D1 `DB` and R2 `MEDIA`.
- Runtime revision remains 1 with only redacted `INITIAL_OWNER_EMAIL`.
- Existing live deployment remains owner-only version 8 at
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`.
- Access remains custom: exactly one allowed owner and zero groups.
- Custom domains: none. Preview deployment: none. Public/shared access: not
  enabled.
- Phase 3 source commit:
  `0071fbf1fb2fc11a2cdb68d19f71c0ac4a69886c`.
- Unpublished Phase 3 Sites version 9 remains preserved:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_3b9448669e5c8191ba6dad4b9e7a6c31`.
- Phase 4 source commit: **Pending final intentional commit.**
- Phase 4 unpublished Sites version: **Pending final save and readback.**
- No Phase 4 deployment is authorized.

## Awaiting a future private deployment

Status: **Awaiting a future private deployment.**

Five-minute owner smoke card for a later explicitly authorized private
deployment of this Phase 4-or-later source:

1. Sign in with the matching owner account.
2. Create a private 4:00–6:00 PM tentative hold.
3. Propose a 5:00–7:00 PM event and confirm the exact overlap appears.
4. With zero buffers, confirm a second event starting at 6:00 PM does not
   conflict.
5. Add a 30-minute cleanup buffer and confirm a 6:15 PM start produces a buffer
   warning.
6. Under Block mode, confirm an unreviewed reserving save is refused.
7. Return to Warn-and-require-reason, save one intentional overlap with a
   written reason, and inspect it in Conflicts.
8. Refresh and confirm the hold, review, and conflict state persist.
9. Confirm both records remain absent from public Events, Home, club pages,
   sitemap, metadata, structured data, and guessed public slugs.

## Exact next phase

**Phase 5 — Not started.**
