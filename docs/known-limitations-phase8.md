# Phase 8 known limitations and authorized cuts

## Verification and hosting limits

- Phase 8 hardening used local synthetic `.invalid` identities and data.
  Its axe, Lighthouse, exact-width, dependency, and full-suite measurements
  remain local exact-artifact evidence; they are not relabelled as production
  measurements.
- Phase 9 deployed exact saved version 14 to
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`. The deployment
  succeeded and remains behind the existing custom owner-only policy.
- There is no preview deployment, custom domain, public/shared access, or
  second production surface. External anonymous visitors therefore see the
  Sites owner gate rather than the application public pages or forms.
- Representative Owner views and production browser/header checks passed.
  The Owner's own five-minute smoke and approved-real-artwork review remain
  **Awaiting owner smoke test**.
- The current Sites access policy has one Owner and no groups. A real
  second-identity role/suspension/reassignment check cannot be performed
  against hosted state without a separately authorized access change.
- No approved production photography or replacement artwork has been
  supplied. Synthetic artwork can verify rendering, media authorization, and
  responsive behavior but cannot establish rights, consent, credit, or Owner
  approval.
- There is no approved real individual published event in hosted D1. Live
  individual-event and individual Meetup-event-link smoke is
  **Not run — no approved real published event**.
- Venue-specific accessibility facts are missing. The application can expose
  confirmed event accessibility information, but the Accessibility Statement
  must not promise facts that the Owner has not supplied.

## Platform and operational limits

- Sites is the only host. There is no custom domain, second host, public/shared
  access, preview deployment, external OAuth provider, email provider, or
  separate database/storage account.
- D1 does not provide row-level security. Server services and runtime triggers
  enforce membership, role, organization, assignment, ownership, and
  publication boundaries.
- A Worker invocation is limited to fewer than 50 D1 statements. Large
  operations remain set-based, paginated, or resumable rather than pretending
  to finish synchronously.
- Request-driven invariant, publication, Meetup, and catalog maintenance can
  return a bounded retry or redirect. There is no cron or realtime claim.
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

The outbound Community hub remains editable and may link only to confirmed,
published destinations. It is not an on-site forum or messaging system.
