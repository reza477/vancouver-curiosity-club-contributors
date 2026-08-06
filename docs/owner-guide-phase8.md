# Owner guide — Phase 8 hardening

Phase 8 changed the safety and verification envelope around the completed
Phase 1–7 product. Phase 9 first deployed that exact saved candidate as
owner-only Sites version 14. The Owner later authorized the calendar-first
releases and public visitor access; exact version 16 is now live while the
organizer workspace remains protected.

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

## Phase 9 production boundary

The concise Owner smoke-test card and its status are maintained in
`BUILD_STATUS.md`. Local synthetic checks do not constitute Owner approval.
The production engineering pass verified representative Owner routes, the
public/organizer access boundary, private response headers, responsive/reflow
behavior, and safe downloads. It also created one clearly labelled private
production-smoke Draft, verified that it never appeared publicly, and then
archived and moved it to deleted items through the normal Owner workflow. Its
immutable audit trace remains; no synthetic event was published.

Approved-real-artwork review and the Owner's own five-minute smoke remain
**Awaiting owner smoke test**. Hosted D1 now contains real source-backed Meetup
events, and an individual event/poster/Meetup-link smoke passed for live version
16. Hosted second-identity verification and the external calendar-client check
remain unavailable.

Live version 16 is available to public visitors at
`https://vancouver-curiosity-club.reza5777.chatgpt.site` under the explicitly
authorized public access policy. Organizer access still requires Sign in with
ChatGPT and current server-side authorization. Do not alter access or create
synthetic production data merely to complete a pending check.

The newer mathematical-icon, fuller-About, and curated Meetup enrichment work
is an unsaved and undeployed source candidate. Review it only after its final
exact-source verification and Sites readback are recorded in `BUILD_STATUS.md`.
