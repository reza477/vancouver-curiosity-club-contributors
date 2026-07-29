# Owner guide — Phase 8 hardening

Phase 8 changes the safety and verification envelope around the completed
Phase 1–7 product. It does not add a new public workflow and it does not deploy
the unpublished candidate.

## What the Owner should expect

- Sign in with ChatGPT still establishes identity; every protected read and
  write rechecks the current active Owner membership and organization.
- A role, membership, assignment, publication, receipt, media-rights, or token
  change during a request fails closed. Reload the page and review current
  state instead of assuming the earlier response still applies.
- Private organizer pages, previews, downloads, backups, calendar feeds, and
  errors remain `no-store` and non-indexable.
- Public HTML, metadata, feeds, CSV, ICS, sitemap, errors, and media use
  explicit public allowlists. Private D1 rows and R2 object keys are not public
  download inputs.
- The Owner backup and media routine remain manual, sensitive product-data
  exports. They are not an automatic infrastructure backup or an automatic
  restore.
- The private calendar subscription remains read-only. Revoke a token
  immediately if its one-time URL is exposed.

## Safe review after a fail-closed response

1. Reload the protected page.
2. Confirm the current organization and role shown by the organizer shell.
3. Reopen the affected record from its list rather than reusing a stale URL.
4. Review any new conflict, publication, assignment, media, or receipt state.
5. Repeat the action only when the current page presents it as available.

Do not copy SQL errors, private URLs, tokens, form content, source-feed
addresses, or R2 keys into support messages or screenshots.

## Phase 8 Owner smoke boundary

The concise Owner smoke-test card and its status are maintained in
`BUILD_STATUS.md`. Local synthetic checks do not constitute Owner approval.
Hosted, approved-real-artwork, second-identity, and external calendar-client
checks remain pending until their factual prerequisites and a separately
authorized deployment exist.

Live owner-only version 8 is unchanged. Phase 9 deployment has not started.
