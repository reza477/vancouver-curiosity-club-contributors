# Phase 8 known limitations and authorized cuts

## Verification and hosting limits

- Phase 8 hardening uses local synthetic `.invalid` identities and data. The
  exact committed-source verification and save status is recorded only in
  `BUILD_STATUS.md`; neither local evidence nor an unpublished candidate
  authorizes deployment.
- The live owner-only URL continues to serve version 8. A saved unpublished
  candidate is not visible at that URL and is not a preview deployment.
- Hosted Owner, second-identity, approved-real-artwork, and external
  calendar-client smoke checks remain **Awaiting owner smoke test** or
  **Not run** until their factual and deployment prerequisites exist.
- The current Sites access policy has one Owner and no groups. A real
  second-identity role/suspension/reassignment check cannot be performed
  against hosted state without a separately authorized access change.
- No approved production photography or replacement artwork has been
  supplied. Synthetic artwork can verify rendering, media authorization, and
  responsive behavior but cannot establish rights, consent, credit, or Owner
  approval.
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
- A saved Sites version is an immutable candidate, not a deployment, data
  backup, uptime promise, or rollback of hosted D1/R2.

## Backup, restore, and dependency limits

- Owner backup remains an explicit, sensitive product-data export plus media
  manifest/download routine. It is not automatic, scheduled, or a complete
  infrastructure backup.
- Restore is documented for a disposable nonproduction database. There is no
  one-click or automatic in-application restore, and no production restore is
  performed during Phase 8.
- Dependency audits distinguish production-reachable packages from build/test
  tooling. Any compatible remediation and any residual advisory must be
  recorded with exact counts and reachability in `BUILD_STATUS.md`; this file
  does not predeclare a final audit result.
- Local Lighthouse and accessibility measurements do not prove Internet
  latency, hosted multi-user behavior, or third-party calendar-client
  behavior. Exact local measurements and limitations belong in
  `BUILD_STATUS.md`.

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
