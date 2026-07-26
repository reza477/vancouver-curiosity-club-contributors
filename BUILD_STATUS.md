# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-25 (America/Vancouver)

## Active phase and authorized scope

- **Phase 3 — Organizer portal, non-reserving workflow.**
- Phase 3 implementation is complete and verified in local, preview-D1,
  source-test, built-Worker, and browser test seams.
- Saving one new **unpublished** ChatGPT Sites version is pending the final
  source commit and exact-archive audit.
- Phase 4 conflict/reserving work is not authorized and has not started.
- The existing owner-only live deployment remains version 8. No Phase 3 source
  has been deployed.

## Completed and verified

### Private organizer workspace

- Added the separate private organizer shell and routes:

  - `/organizer`
  - `/organizer/calendar`
  - `/organizer/events`
  - `/organizer/events/new`
  - `/organizer/events/[id]`
  - `/organizer/team`
  - `/organizer/clubs`
  - `/organizer/notifications`
  - `/organizer/profile`
  - `/organizer/settings`
  - existing `/organizer/meetup`
  - `/accept-invitation`

- Organizer pages do not use public header/footer chrome or emit public
  canonical, Open Graph, JSON-LD, or sitemap data.
- Organizer pages, invitation surfaces, and organizer APIs are server
  protected, `no-store`, and `noindex, nofollow, noarchive`.
- Desktop sidebar and compact mobile navigation expose only Phase 3 actions.
  There is no dead Conflicts, publishing, media, export, email, or later-phase
  control.

### Authentication, invitations, team, and ownership

- Sign in with ChatGPT remains identity only. Every protected request derives
  the actor and organization from trusted server context, then revalidates
  active profile, active membership, role, and required club assignment.
- Authenticated but uninvited identities are denied in source and rendered
  Worker tests.
- Owners can create Administrator or Organizer invitations. Administrators can
  create Organizer invitations only. Organizer invitations require an active
  same-organization club.
- Invitation tokens are 256-bit random, stored only as hashes, email-bound,
  organization-bound, one-time, expiring, revocable, and D1-rate-limited.
  Copyable links are shown only on creation; no email-sent claim is made.
- Acceptance captures the token into a short-lived path-scoped HttpOnly cookie,
  cleans the browser URL, requires the matching ChatGPT email, and atomically
  creates membership, club assignment, notification, and audit records.
- Team reads restrict email to Owner/Administrator management views.
  Organizer writes remain assigned-club and owned/co-organized-event scoped.
- Membership changes recheck active and soft-deleted restorable event blockers
  inside the committing batch.
- Ownership transfer is atomic. Durable guards preserve exactly one active
  Owner with an active, nondeleted profile under concurrent and crafted
  attempts. Membership organization/profile/email identity is immutable.

### Canonical lifecycle and private event workflow

- Additive migration `0012_phase3_organizer_foundation.sql` establishes one
  authoritative private event model:

  - planning: `idea`, `draft`, `tentative_hold`, `confirmed`, `cancelled`,
    `completed`, `archived`;
  - publication: `private`, `scheduled`, `published`, `unpublished`;
  - schedule: `unscheduled`, `timed`, `all_day`.

- Every Phase 3 manual mutation is service- and database-limited to private
  Ideas or Drafts. Only Ideas may be unscheduled. Timed and all-day shape
  rules are enforced without invented dates or UTC offsets.
- Manual create, edit, duplicate, soft delete, and restore use optimistic
  `content_version` compare-and-swap. `schedule_version` remains distinct for
  future Phase 4 authorization.
- Each successful mutation writes the current row, immutable revision, and
  append-only audit entry in one bounded D1 batch. Stale edits return
  `409 stale_edit` without partial residue.
- Ordinary editor updates preserve adopted venue and private meeting details;
  title-only edits do not spuriously increment `schedule_version`.
- Moving a Draft between clubs removes stale organizer selections while
  preserving any still-valid organization-wide assignment.
- Duplicate records are source-free and private. Source-controlled, reserving,
  public, or unsupported legacy records remain read-only.
- Legacy publication mapping labels a record Published only when visibility is
  public and `published_at` is present.

### Migration adoption and persistent D1 invariants

- Existing migrations `0008`–`0011` remain byte-for-byte unchanged.
- Migration `0012` is additive, retry-safe, and Sites-tokenizer compatible:
  24 complete statements, no packaged trigger body, `ALTER`, `PRAGMA`, rename,
  reset, or destructive rebuild.
- Legacy adoption is all-or-nothing. It requires:

  - exact valid and unique equality between canonical
    `organizer_scope_json` and normalized active primary/co-organizer rows;
  - valid same-organization references and assignments;
  - same-organization creator membership;
  - valid updater and schedule/lifecycle shape.

- Divergent records remain intact and read-only; no co-organizer is silently
  discarded.
- Phase 3 editable display name, biography, and attribution-consent values are
  staged in `organizer_profile_preferences`. Migration and snapshot contain
  nullable `workspace_display_name` and
  `public_attribution_consent_draft`; migrated-column contract tests prepare
  those exact fields.
- Public Phase 2 host projection still reads canonical `profiles` fields only.
  Private profile edits cannot rename, add, or remove a published host.
- Runtime invariant state is version **3** with fingerprint
  `0d89f16aa0a5a462b73a34c8ecb98cd011527bc50124697a90bffcbd095e5621`.
- The initializer verifies and repairs **30 exact triggers** before
  application dispatch while retaining the existing two reservation and seven
  public-integrity guards.
- The new guards cover private lifecycle/organization integrity, organizer
  associations, immutable revisions/audits, rate limits, ownership transfer,
  membership identity, and sole usable Owner profile state.
- Concurrent isolate installation is idempotent. Invalid existing data leaves
  no false durable marker or partial guard set.

### Calendar, events index, clubs, profiles, notifications, and history

- Private calendar combines private manual records, read-only legacy records,
  and completed active Meetup snapshots only. Pending Meetup generation facts
  remain invisible.
- Agenda, Day, Week, Month, and unscheduled Ideas surfaces render timed,
  all-day, overnight, multi-day, leap-date, and Vancouver DST cases.
- Calendar returns the exact D1 match count, an explicit bounded loaded count,
  and validated cumulative `take` links up to 5,000 records. Client-side filter
  copy states that filters apply to the loaded records.
- Events index applies search and lifecycle filters in parameterized D1
  queries and provides deterministic 200-record pages. Older and soft-deleted
  restorable records remain reachable.
- Club update and archive repeat active Owner/Administrator authorization in
  the committing batch.
- Club archive is blocked by any organizer event including soft-deleted
  records, any nondeleted legacy event, retained or active/pending Meetup
  source, active program, pending invitation, active assignment, or public
  profile. Blocker details are bounded and actionable.
- Meetup source connection revalidates the actor and active same-organization
  club in the commit, preventing archive/configuration races without returning
  a saved feed address.
- Profile drafts remain private/inert for public attribution. Settings change
  only private workspace name and default IANA timezone.
- Notifications use a server allowlist and minimum safe payloads. Read/unread,
  mark-all, and preference modes are D1-backed. Activity history is append-only
  and organization-scoped.

### Phase 2 preservation

- Public Home, Events, event details, clubs, metadata, sitemap, structured
  data, and error behavior remain on explicit allowlisted projections.
- New Phase 3 Ideas, Drafts, notes, invitations, notifications, audit data,
  identities, and private Meetup configuration are absent from public list,
  detail, guessed slug, metadata, JSON-LD, sitemap, and built-Worker surfaces.
- Existing completed-generation Meetup publication isolation remains intact.
- Owner/Administrator may still configure and manually refresh Meetup;
  Organizer access remains read-only. Saved feed addresses never render.

## Exact verification evidence

Commands ran from `C:\Users\user\Documents\Website` on 2026-07-25.

- `npm.cmd ci` — exit 0; 503 packages installed from `package-lock.json`, 504
  packages audited.
- `npm.cmd run db:generate` — exit 0; 43 tables; no schema changes and no
  generated migration.
- `npm.cmd run db:apply:local` — final exit 0; five migrations applied as 49,
  37, 38, 37, and 24 statements; 43 tables, 30 exact runtime triggers, zero
  foreign-key violations.
- `npm.cmd run db:apply:preview` — final exit 0 with the same five-migration,
  43-table, 30-trigger, zero-violation result against the Sites local preview
  D1.
- `npm.cmd run typecheck` — exit 0 under strict TypeScript.
- Exact `npm.cmd run lint` before build — exit 0.
- `npm.cmd test` — final exit 0; **167/167 passed**, 0 failed, 0 skipped.
- `npm.cmd run build` — exit 0; vinext produced the complete public and private
  Worker route set.
- Exact `npm.cmd run lint` after retained build artifacts — exit 0.
- `npm.cmd run test:rendered` — final exit 0; **19/19 passed**, 0 failed, 0
  skipped. The built Worker applies packaged migrations, verifies the exact
  version-3/30-trigger fingerprint, enforces private/public boundaries, renders
  authenticated owner flows, rejects uninvited access, validates organizer
  filters, and exercises invitation and mutation safety.
- Migration/invariant focused gate — 20/20 passed, including clean and
  populated-version-8 adoption, every partial production-tokenizer prefix,
  malformed SQL rejection, invariant repair/concurrency, identity, usable
  Owner, and creator integrity.
- Organizer correction gate — 43/43 passed, including event data
  round-tripping, club reassignment, profile/public isolation, archive races,
  pagination, lifecycle, ownership, and UI contracts.
- Independent final read-only red-team — 71/71 focused migration, invariant,
  Meetup, auth/team, event/calendar, and UI checks passed; no release blocker
  found across the complete audit correction set.
- `git diff --check` — exit 0.
- Built-output audit — `dist` contains 100 files / 4,865,389 bytes.
  Source and packaged migrations 0008–0012 are byte-identical.
- Source and built privacy scans — zero exact official private Meetup feed
  URLs; zero email-like values in `dist`; zero credentials, bearer tokens,
  local paths, private fixture sentinels, environment files, local databases,
  work artifacts, logs, or unoptimized design master in `dist`. Client assets
  contain no source URL, token-hash, or identity-header names.
- `npm.cmd audit --omit=dev --json` — exit 1 with 3 high, 0 critical
  production advisories.
- `npm.cmd audit --json` — exit 1 with 18 advisories: 1 low, 4 moderate, 13
  high, 0 critical.
- No forced upgrade was applied to the pinned Sites runtime.

Interim evidence retained honestly:

- The first local migration replay rejected a recorded hash from an ignored
  in-progress local `0012`. Both local D1 directories were preserved as
  timestamped ignored backups, then fresh local and preview stores passed.
  No hosted D1 or deployed version was changed.
- One direct Node test invocation without the project `tsx` loader failed on
  TypeScript ESM resolution; the supported loader invocation passed 16/16.
- Initial full-suite and rendered-Worker runs exposed stale expected
  schema/test contracts after the final audit corrections. Assertions were
  updated to the real stronger schema and private-shell boundary; the complete
  suites then passed without disabling a rule or weakening public leakage
  checks.

### Browser and accessibility QA

- Authenticated local browser QA used an isolated synthetic `.invalid` owner
  fixture and ignored local D1 only.
- Public Home, Events, private-slug 404, dashboard, Calendar, Events, new/edit
  event, Team, Clubs, Notifications, Profile, Settings, Meetup, and invitation
  flows were exercised.
- Widths checked: 320×800, 390×844, tablet 768px, 1280px, and 1440px. No page
  overflow was observed.
- Create/edit persistence, Agenda/Week/Month, filters, unscheduled Ideas,
  invitation create/reset/revoke, noindex/private chrome, and mobile
  navigation were verified.
- Reduced-motion media produced near-zero transition/animation durations.
  Skip-link/landmark structure and visible focus styles are present.
- Browser console showed no application, hydration, or accessibility warning;
  the only warning was the expected authorization-denied diagnostic.

## Implemented but not externally verified

- Phase 3 is not deployed. All Phase 3 hosted behavior remains unverified until
  a later owner-authorized private deployment.
- Hosted second-identity invitation acceptance cannot be tested while Sites
  access remains exactly one allowed owner and zero groups.
- Hosted D1 table/index/trigger counts are not directly queryable through the
  current Sites capability. Local, preview, and built-Worker D1 verify 43
  tables, 90 explicit indexes, 38 unique indexes, 125 foreign keys, 51 checks,
  30 triggers, and zero foreign-key violations.
- R2 remains bound as `MEDIA` and unchanged; Phase 3 has no authorized media
  workflow.

## Not implemented

- Tentative holds, confirmed-event mutation, schedule reservation, conflict
  preview/review/policies/overrides, public event preview, scheduled
  publication, publish/unpublish, public CMS, community-link editing, R2
  upload, CSV/ICS file import, export, public forms, email/digests, QR,
  payments, donations, internal RSVP, attendee accounts, comments, messaging,
  forums, or chat.
- No disabled or dead control for those later phases is present.

## Not run

- Hosted Phase 3 owner smoke test — no Phase 3 version is deployed.
- Hosted second human identity — current Sites policy permits one owner and
  zero groups.
- Automated axe and Lighthouse/Core Web Vitals — not available in the pinned
  toolchain; no score or performance claim is made.
- A complete keyboard-only create/edit browser flow and 200% zoom measurement
  were not captured. Keyboard semantics, focus styling, responsive reflow,
  source contracts, and rendered flows were checked, but are not represented
  as those unrun measurements.
- Real hosted Meetup import and R2 behavior — no Phase 3 deployment or
  authorized media workflow exists.

## Blocked

- Hosted second-identity testing is blocked by the unchanged one-owner Sites
  access policy.
- Remaining factual owner inputs: exact BC legal identity/status/footer and
  charity wording; exact Meetup discussion URL; approved final copy; approved
  public organizer names/biographies; real photos with rights, credit, and
  participant consent; event-specific venue/accessibility facts; a hosted
  second invited test identity.

## Sites project, version, bindings, and deployment state

- Sites project:
  `appgprj_6a62eaf79c4881919bb8e47998af851a`.
- Logical bindings remain D1 `DB` and R2 `MEDIA`.
- Runtime revision remains 1 with only redacted `INITIAL_OWNER_EMAIL`.
- Existing live deployment remains owner-only version 8 at
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`.
- Access remains custom: exactly one allowed owner and zero groups.
- Custom domains: none. Preview URL: none. Public/shared access: not enabled.
- Phase 3 source commit: **Pending final verified commit.**
- Phase 3 Sites version: **Pending one unpublished save.**
- No Phase 3 deployment is authorized.

## Awaiting a future private deployment

Status: **Awaiting a future private deployment.**

Five-minute owner smoke card for a later explicitly authorized private
deployment of this Phase 3-or-later source:

1. Sign in with the matching ChatGPT owner account.
2. Create one unscheduled private Idea and one scheduled private Draft.
3. Refresh, sign out, and sign back in; confirm both persist.
4. Open Calendar and Ideas; confirm the Draft appears on its date and the
   unscheduled Idea has no fake date.
5. Confirm neither record appears on public Events, a guessed public slug, or
   public search/filter results.
6. Create a copyable Organizer invitation, confirm there is no email-sent
   claim, then revoke it.
7. If a second invited identity becomes allowed in a later authorized policy
   change, confirm it can edit only its assigned-club owned/co-organized
   records and cannot edit another organizer's Draft.
8. Confirm Meetup remains Owner/Administrator configurable and Organizer
   read-only.

## Exact next phase

**Phase 4 — Not started.**
