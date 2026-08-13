# Phase 8 known limitations and authorized cuts

> **Historical Phase 8 snapshot.** Production has changed since this file was
> written. Use [DEVELOPMENT.md](../DEVELOPMENT.md) for current maintenance
> boundaries and re-verify any host, domain, version, or pending claim below.

## Verification and hosting limits

- Phase 8 hardening used local synthetic `.invalid` identities and data.
  Its axe, Lighthouse, exact-width, dependency, and full-suite measurements
  remain local exact-artifact evidence; they are not relabelled as production
  measurements.
- Phase 9 first deployed exact saved version 14 behind the existing owner-only
  policy. The Owner later authorized the calendar-first releases and public
  visitor access; exact version 16 is now live at
  `https://vancouver-curiosity-club.reza5777.chatgpt.site` under public access
  revision 2.
- There is no preview deployment, custom domain, or second production surface.
  Anonymous visitors may browse only the allowlisted public application
  routes. Organizer routes still require Sign in with ChatGPT plus current
  invitation, membership, role, organization, and suspension checks.
- Representative Owner views and production browser/header checks passed.
  The Owner's own five-minute smoke and approved-real-artwork review remain
  **Awaiting owner smoke test**.
- The current Sites access policy has one Owner and no groups. A real
  second-identity role/suspension/reassignment check cannot be performed
  against hosted state without a separately authorized access change.
- The live version contains local copies of the 11 posters belonging to its
  current source-backed Meetup events. The newer local-only source candidate
  holds 41 exact group-slug/event-ID enrichment records with sanitized
  attendee-visible description, public venue fallback, and verified local
  Meetup poster copies. Five smaller originals remain at their native width
  and are never enlarged. Those records remain gated by the ordinary
  publication projection and are not a claim that all 41 events are currently
  public.
- Hosted D1 contains real source-backed published Meetup events. Individual
  event, poster, and exact Meetup-link smoke passed for live version 16; the
  current navigation/Home/contribution/performance plus reconciliation
  candidate still requires its final exact-source and browser verification
  before any Sites save.
- Venue-specific accessibility facts are missing. The application can expose
  confirmed event accessibility information, but the Accessibility Statement
  must not promise facts that the Owner has not supplied.

## Platform and operational limits

- Sites is the only host. Public visitor access is enabled for allowlisted
  public application routes, while the organizer workspace remains protected.
  There is no custom domain, second host, preview deployment, external OAuth
  provider, email provider, or separate database/storage account.
- D1 does not provide row-level security. Server services and runtime triggers
  enforce membership, role, organization, assignment, ownership, and
  publication boundaries.
- A Worker invocation is limited to fewer than 50 D1 statements. Large
  operations remain set-based, paginated, or resumable rather than pretending
  to finish synchronously.
- Request-driven invariant, publication, and catalog maintenance can return a
  bounded retry or redirect after an actual maintenance attempt. Public routes
  only read the last completed Meetup snapshot; Meetup refresh is an explicit
  organizer or trusted-maintenance action. There is no cron or realtime claim.
- The production CSP retains inline styles because the current vinext
  framework/style path requires them. Production scripts use nonce-based
  execution and do not receive a blanket inline-script allowance.
- Private and public media correctness depends on the exact current D1
  metadata/usage proof plus the `MEDIA` object. R2 object keys are not public
  URLs and are never a supported download input.
- A saved Sites version is an immutable candidate, not a data backup, uptime
  promise, or rollback of hosted D1/R2. Phase 9 deployed version 14 through
  Sites; that deployment does not make it an infrastructure backup.

## Backup, restore, and dependency limits

- Owner backup remains an explicit, sensitive product-data export plus media
  manifest/download routine. It is not automatic, scheduled, or a complete
  infrastructure backup.
- Restore is documented for a disposable nonproduction database. There is no
  one-click or automatic in-application restore, and no production restore is
  performed during Phase 8.
- The final production dependency audit is zero. The full development/tooling
  audit retains 16 advisory nodes: 12 high and four moderate, all `dev: true`.
  The packaged Sites artifact excludes the affected toolchains; compatible
  remediation and reachability rationale are recorded in `BUILD_STATUS.md`.
- Local Lighthouse and accessibility measurements do not prove Internet
  latency, hosted multi-user behavior, or third-party calendar-client
  behavior. Exact local measurements and limitations belong in
  `BUILD_STATUS.md`.
- External private-calendar client behavior remains **Implemented but not
  externally verified**. The disposable Owner-backup restore rehearsal remains
  **Not run**.

## Preserved authorized cuts

- **ICS file import — Not implemented — authorized cut.**
- **Downloadable QR generation — Not implemented — authorized cut.**
- **Daily and weekly notification digests — Not implemented — authorized
  cut.**
- **Editor role — Not implemented — authorized cut.**
- **Viewer role — Not implemented — authorized cut.**
- **Realtime subscriptions — Not implemented — authorized cut.**

The following remain outside the first-release scope: public attendee
accounts, internal RSVP, ticketing, payments, donations, tax receipts, email
notifications, newsletter delivery, automatic Meetup publishing, remote URL
imports, two-way calendar sync, native apps, comments, direct messages, chat,
forums, on-site social networking, complicated analytics, another host, an
external OAuth provider, and a custom domain.

Community-link records remain guarded CMS data, but the simplified public
shell no longer renders a Community hub or tab. The legacy `/community` route
redirects to the contribution page; it is not an on-site forum or messaging
system.
