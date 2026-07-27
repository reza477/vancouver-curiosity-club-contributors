# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-27 (America/Vancouver)

## Active phase and authorized scope

- **Phase 5 — Private-to-public publishing connection.**
- Phase 5 is implemented and verified in local D1, preview D1, source tests,
  production build, rendered Worker, and local browser seams.
- Phase 6 has not started.
- Authorized cuts: **none**.
- No Phase 5 deployment is authorized. The owner-only live deployment remains
  version 8.

## Completed and verified

### Canonical publishing workflow

- `organizer_events` remains the only writable canonical manual-event record.
  Publication metadata lives in organization-scoped sidecars; no organizer
  event is copied into legacy `events`, Meetup snapshots, static JSON, or page
  content.
- Protected organizer workflows now support:

  - saving explicitly public event details;
  - eligible host selection with active membership, consent, organizer-scope,
    and safe-name checks;
  - protected preview through the same allowlisted public DTO and event-detail
    renderer used by the public route;
  - immediate website publication;
  - future website publication scheduling;
  - cancellation of a pending publication;
  - bounded request-driven due-job reconciliation;
  - unpublication;
  - published cancellation, scheduled cancellation, completion, archive,
    soft-delete, and restore behavior;
  - a narrow Owner/Administrator policy for Organizer self-publication.

- Every publication-affecting action revalidates trusted Sites identity,
  active profile/membership, role, organization, club assignment, event scope,
  content version, schedule version, current policy, public readiness, public
  slug uniqueness, and the Phase 4 conflict contract inside the authoritative
  committing path.
- Publication uses the existing Phase 4 schedule-intent envelope. Exact current
  conflict incidents and required reason/approved-review overrides are rebound
  to the publication intent, checked by D1, finalized, and completed in the
  same bounded batch. The database guard was not weakened.
- Stale, unauthorized, unready, conflicting, or zero-row mutations fail
  without partial event, job, sidecar, revision, audit, notification,
  incident, or override residue.
- Immediate and concurrent publication are idempotent at the canonical state:
  one transition and one publication audit can commit.

### Publication readiness and lifecycle

- Publication requires a confirmed, scheduled, undeleted, unarchived event
  with a stable title/slug, public summary and description, a published club,
  an explicit in-person/online/hybrid attendance mode, matching approved public
  location/online facts, and a valid RSVP choice.
- `location_undecided` remains a private draft/preview value and blocks Publish
  and Schedule publication.
- `meetup` RSVP mode accepts only a canonical HTTPS
  `www.meetup.com/<group>/events/<event-id>/` event destination. Group-home
  URLs are rejected. Changing the saved URL clears confirmation and falls back
  to honest “RSVP information coming soon” behavior until reconfirmed.
- Public host display requires event-level enablement plus a selected current
  organizer with active membership/profile, canonical consent, and a safe
  canonical display name. Later consent, membership, or name ineligibility
  suppresses attribution without making the whole site fail closed.
- Immediate publication cancels any older pending job atomically.
- Scheduled publication stores UTC plus the original IANA timezone, binds the
  exact content/schedule versions, and remains absent from all public surfaces
  until successful reconciliation.
- At most one due job is processed per request, keeping all measured success,
  deterministic invalidation, and transient paths below the Sites D1
  50-statement limit. No cron, realtime, or exact-to-the-second promise is
  made.
- A stale/ineligible scheduled job is invalidated safely even if its original
  authorizer is removed, suspended, demoted, reassigned, or no longer eligible
  under the self-publish policy. Current Owner/Administrator recovery remains
  organization/job/version bound.
- Published cancellation retains the stable public detail page with a clear
  cancellation state and removes the event from Upcoming. Scheduled
  cancellation terminalizes the job and leaves the event unpublished.
  Completion may remain in Past. Archive and soft-delete unpublish. Restore
  never silently republishes.
- Editing a scheduled event invalidates the stale job unless explicitly
  rescheduled. Editing a published event updates the same canonical public
  page and reports that truthfully in the organizer UI.

### Unified public projection and privacy

- The Phase 2 unified public projection now has an explicit, allowlisted
  `organizer_events` branch in addition to the unchanged legacy-manual and
  completed-active-Meetup branches.
- Organizer events appear only when canonically `published`, attached to an
  active published club, publication-ready, organization-consistent,
  source-free, and in a supported planning state.
- Scheduled, private, unpublished, draft, hold, archived, soft-deleted, and
  guessed-slug records remain absent from Home, Events, club pages, event
  detail, metadata, JSON-LD, sitemap, and public errors.
- Pending, partial, failed, and older Meetup generations remain invisible.
  Existing active-generation publication isolation is unchanged.
- Public slug collision checks use one shared semantic contract across
  service readiness and D1 enforcement, including organizer, eligible legacy,
  and completed-active Meetup candidates without counting Meetup mirrors
  twice.
- Preview is authenticated, authorization-scoped, dynamic, `no-store`, and
  `noindex, nofollow, noarchive`. It uses the exact public DTO without exposing
  private notes, private meeting details, conflicts/reasons, overrides,
  emails, memberships, invitations, revisions, audits, source configuration,
  runtime values, or identity headers.
- A D1 production-compatibility issue in the public-host aggregate was fixed by
  using a ranked host CTE and joined JSON window aggregate. The primary-first,
  maximum-24, consent/safe-name/privacy contract is unchanged.

### Organizer experience

- The existing Field Notes organizer shell now includes an accessible Website
  publication panel, readiness checklist, public details editor, host
  selection, protected Preview, immediate/scheduled publication actions,
  cancellation, unpublication, and accurate success/error copy.
- A fresh confirmed event can open the panel with safe default draft values;
  Preview appears only when the exact server projection can render it.
- Owner and Administrator may publish eligible events. Organizer publication
  remains disabled by default and requires the narrow organization policy plus
  existing assigned-club and owned/co-organized scope.
- Viewer, unassigned Organizer, cross-organization, suspended, deleted, and
  uninvited identities cannot gain edit, preview, schedule, or publish access.
- Settings exposes only the narrow self-publish policy. No Phase 6 CMS,
  Community, branding, legal, or media controls were added.
- Notification and audit allowlists cover publication scheduled, published,
  failed/invalidated, public cancellation, and material public time changes
  without email, tokens, private notes, feed URLs, conflict reasons, or raw
  identity data.

### Migration and persistent invariants

- Existing migrations `0008` through `0013` remain byte-for-byte preserved.
- Exactly one additive migration was added:
  `0014_phase5_publication.sql`.
- Migration 0014 contains **20 complete tokenizer-safe statements** and adds
  five tables plus bounded indexes. It contains no packaged trigger body,
  `ALTER`, `DROP`, destructive rebuild, reset, rename, or `PRAGMA` mutation.
- There is no migration 0015. Drizzle schema, migration, snapshot, and journal
  are aligned, including `update_unpublished`.
- Current verified D1 shape:

  - 7 migrations (`0008` through `0014`);
  - 58 tables;
  - 131 explicit indexes;
  - 74 exact runtime-installed triggers;
  - runtime invariant version 5;
  - invariant fingerprint
    `f4d5e707058f628c1a0dcaf908bd7a4c918b3bb099c6dd4ff6183a0c4850f356`;
  - durable status converges through bounded `repaired` requests to `ready`;
  - zero `PRAGMA foreign_key_check` violations.

- Runtime installation remains phase-aware during historical migration/adoption
  tests and fail closed once the Phase 5 schema is expected.
- Healthy, repair, repeat, partial-prefix, concurrent-isolate, malformed-data,
  and populated upgrade paths were exercised. No invalid or partial
  installation writes a false ready marker.

## Exact verification evidence

Commands ran from `C:\Users\user\Documents\Website` on 2026-07-27.

- `npm.cmd ci` — exit 0; 503 packages added and 504 audited from the preserved
  lockfile.
- `npm.cmd run db:generate` — exit 0; 58 tables; no schema drift and no
  unexpected migration generated.
- `npm.cmd run db:apply:local` — exit 0; 7 migrations, migration 0014 applied
  in 20 statements, 58 tables, 74/74 triggers, bounded
  `repaired`/`repaired`/`ready`, zero foreign-key violations.
- `npm.cmd run db:apply:preview` — exit 0 with the same migration, table,
  trigger, readiness, and foreign-key result.
- `npm.cmd run typecheck` — exit 0 under strict TypeScript.
- Exact `npm.cmd run lint` before build — exit 0 with **zero warnings**.
- `npm.cmd test` — exit 0; **318/318 passed**, 0 failed, 0 skipped, 0 todo.
- Focused migration/invariant/Phase 5/public gate — exit 0;
  **119/119 passed**, 0 failed, 0 skipped.
- Focused Phase 5/public/invariant audit subsets also reported **93/93
  passed**.
- `npm.cmd run build` — exit 0; vinext produced the complete public and
  protected Worker route set.
- Exact `npm.cmd run lint` after retained build artifacts — exit 0 with
  **zero warnings**.
- `npm.cmd run test:rendered` — exit 0; **22/22 passed**, 0 failed, 0 skipped.
  The built Worker applies the packaged migration set, installs/verifies
  invariant v5 and 74 triggers, denies unauthorized organizer access, executes
  protected preview and immediate/scheduled publication, reconciles a due job,
  renders Home/Events/detail/club/metadata/JSON-LD/sitemap, handles
  cancellation/unpublication, and passes public/private sentinel scans.
- Focused migration/snapshot/invariant contract — **28/28 passed**.
- Measured conflict-publication D1 paths:

  - Warn immediate publish: 42 statements, largest batch 12;
  - Warn schedule: 43 statements, largest batch 13;
  - Administrator-approved immediate publish: 42 statements, largest batch
    12;
  - Administrator-approved due reconciliation: 25 statements, largest batch
    13.

- `git diff --check` — exit 0; only expected Windows line-ending notices.
- Current `dist` audit before source freeze — 112 files / 6,433,186 bytes;
  hosting metadata present; 15 Drizzle resources byte-identical to source; no
  environment file, local D1, log, test/fixture/work artifact, unoptimized
  design master, email-like value, private sentinel, supplied private Meetup
  feed URL, credential, private key, or Bearer-token pattern.
- Generic `events/ical/` parser text exists as required to recognize official
  operator input; no owner feed address is embedded.
- Exact commit archive hash, compressed size, entry count, and Sites v11
  provenance are pending the source freeze and will be added in the
  provenance-only ledger commit.

### Dependency audit

- `npm.cmd audit --omit=dev --json` ran and exited 1 because findings exist:
  **3 high, 0 critical** production advisories.
- `npm.cmd audit --json` ran and exited 1 because findings exist:
  **18 total** — 1 low, 4 moderate, 13 high, 0 critical.
- Seven packages report pending install scripts. No unsafe forced upgrade was
  applied to the pinned Sites runtime.

### Failures encountered and resolved

- Phase 5 trigger and publication-intent ordering, historical-intent
  validation, stale-authorizer invalidation, scheduled lifecycle bridging,
  notification recipients, host eligibility, preview permission parity, RSVP
  confirmation, slug parity, conflict authorization, D1 statement budget,
  migration snapshot, and rendered-harness drift were each reproduced and
  fixed with executed regression coverage.
- Rendered production D1 rejected a nested correlated public-host aggregate
  even though local SQLite accepted it. The D1-compatible ranked CTE/window
  implementation now passes the complete rendered Worker suite.
- The final stabilized source gate is green; no failing test was suppressed,
  weakened, skipped, or cast away.

## Browser and accessibility evidence

- Local browser QA used the normal localhost preview with the fresh isolated
  review D1. No production auth, runtime value, access policy, or hosted data
  was changed.
- Widths checked:

  - 320×800 Home;
  - 390×844 Events;
  - 768×1024 About route;
  - 1280×800 Home;
  - 1440×900 Events;
  - 720×900 as a 1440-at-200%-equivalent reflow check.

- Every measured page retained 16px body text, a main landmark, and no
  essential horizontal overflow.
- At 320px the mark, wordmark, compact navigation, hero, and footer remained
  readable. Visible `:focus-visible` keyboard focus was verified on the mobile
  navigation summary with a 3px outline; its six destinations were inspected.
- Events filters were keyboard/focus inspectable, showed a truthful zero-result
  state, produced a shareable validated query URL, and Clear Filters returned
  to the canonical state.
- The guessed public route rendered the custom “This trail ends here.” 404 at
  390px without overflow.
- Signed-out `/organizer` redirected to
  `/signin-with-chatgpt?return_to=%2Forganizer`. The standalone local preview
  does not provide the Sites dispatcher-owned sign-in UI, so that destination
  rendered the local 404; rendered Worker authorization/header tests cover the
  production contract.
- The fresh local review D1 has no initialized public page catalog, so the
  About route rendered the truthful custom 404 and no real organizer event was
  available for an end-to-end browser publication smoke. The isolated built
  Worker exercises that complete flow.
- Browser console capture contained **0 errors and 0 warnings** during the
  final checks.
- Static reduced-motion, landmark, focus, target-size, no-overflow, private
  route, and safe-error contracts pass automated tests.

## Implemented but not externally verified

- Phase 5 is not deployed. Hosted Phase 5 publication, scheduled
  reconciliation, and preview behavior remain externally unverified.
- Hosted D1 schema/table/index/trigger introspection is unavailable through the
  current Sites capability. Local, preview, source, and rendered Worker D1
  provide the evidence above.
- Hosted second-identity role and invitation checks remain unavailable while
  access is one owner and zero groups.
- Scheduled publication is request-driven: the first relevant public or
  authenticated request at or after the due instant processes at most one job.
  No background scheduler is claimed.
- R2 remains bound as `MEDIA` and unchanged. Phase 5 adds no media workflow.

## Not implemented

- General CMS/page editing, Community/navigation/footer/branding/legal
  controls, R2 media library/upload, CSV/ICS import, export, public forms and
  submissions inbox, QR downloads, email/digests, automatic Meetup write-back,
  payments, donations, internal RSVP, attendee accounts, comments, messaging,
  forums, and chat.
- No Phase 6 or later dead control was added.

## Not run

- Hosted Phase 5 owner smoke test — no Phase 5 deployment is authorized.
- Real-event local browser publication/cancellation/unpublication flow — the
  fresh review D1 has no real confirmed event and no owner-approved event RSVP
  input. The isolated rendered Worker flow passed.
- Hosted second human identity — current Sites access permits one owner and
  zero groups.
- Hosted D1 direct SQL introspection — not exposed by current Sites tools.
- Automated Axe, Lighthouse, and Core Web Vitals — unavailable in the pinned
  local toolchain; no score is claimed.
- Exact browser zoom and reduced-motion emulation — the 720px reflow equivalent
  and static reduced-motion tests passed, but native zoom/emulation was not
  available.

## Blocked

- Hosted Phase 5 smoke testing requires a later explicitly authorized private
  deployment.
- Hosted second-identity verification requires a separately authorized Sites
  access-policy change.
- Remaining factual owner inputs:

  - exact BC legal name, legal form/status wording, registration number,
    effective date, approved legal footer, and charity status;
  - exact public Meetup discussion URL;
  - one real confirmed event and its exact individual Meetup event URL for the
    future hosted publication smoke;
  - event-specific approved public summary/description, attendance mode,
    location/online facts, access notes, and verified accessibility facts;
  - approved final public copy and confirmed public contact;
  - real photographs with rights, credit, and participant-consent state;
  - approved public organizer names/biographies and both host-consent gates.

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
- Phase 4 source commit:
  `61db32cbe42acfd3b6edbb288305066a2a377ba1`.
- Unpublished Phase 4 Sites version 10 remains preserved:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_6356519315688191a6df7f457a116d2d`.
- Phase 5 source commit: **Pending exact source freeze**.
- Phase 5 Sites version 11: **Pending one unpublished save**.
- No Phase 5 deployment is authorized.

## Awaiting a future private deployment

Status: **Awaiting a future private deployment.**

Five-minute owner smoke card for the next explicitly authorized private
deployment of this Phase 5-or-later source:

1. Sign in with the matching ChatGPT owner account.
2. Open one real confirmed event with its exact Meetup event page.
3. Confirm the event is absent from public Home, Events, club, and guessed slug
   before publication.
4. Complete public fields and confirm the Meetup link points to the individual
   event, not the group home.
5. Open protected Preview and confirm internal notes and conflict details are
   absent.
6. Publish to Website.
7. Confirm it appears on Home, Events, its public detail page, and the correct
   club.
8. Open **RSVP on Meetup** and confirm the destination.
9. Cancel the event; confirm its public detail page shows a prominent
   cancellation banner and it disappears from Upcoming.
10. Unpublish it; confirm its public page and discovery entries disappear.
11. For scheduled publication, schedule a real eligible event shortly ahead,
    open a relevant page after the due time, and confirm it publishes once
    without pretending an exact background scheduler exists.

Do not create or publish a fabricated production event for this test.

## Exact next phase

**Phase 6 — Not started.**
