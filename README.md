# Vancouver Curiosity Club

> A social calendar with a brain.

This is the isolated ChatGPT Sites project for Vancouver Curiosity Club and
its organizer portal. The umbrella working name is Vancouver Curiosity and
Education Society. No legal-status or charity claim is approved for
publication.

## Current state

The audited Phase 1 foundation is complete. A narrow, separately authorized
follow-up adds:

- an original futuristic-and-timeless brand mark across the wordmark, favicon,
  app icons, manifest, and social card;
- a public `/calendar` backed only by official Meetup group iCalendar feeds;
- an Owner/Administrator connection and manual-refresh workspace at
  `/organizer/meetup`;
- truthful not-connected, pending, partial, current, stale, disabled, and error
  states.

This follow-up does not start Phase 2 or expose schedule-reserving event tools.
No Site version is publicly deployed.

## Meetup connection

The integration is one-way: Meetup is the source for imported title, schedule,
explicit status/cancellation, and the official event RSVP URL. It never writes
to Meetup and does not scrape pages, use passwords, or claim email delivery.

To connect production data:

1. Put `INITIAL_OWNER_EMAIL` in Sites runtime settings and sign in as the
   Owner.
2. Copy the official group calendar export/subscription URL supplied by Meetup.
   The accepted canonical form is
   `https://www.meetup.com/<group-slug>/events/ical/`.
3. Open `/organizer/meetup`, select the matching approved program, save the
   feed, and repeat for each official Meetup group. The server verifies that
   the selected organization-owned club matches the feed's normalized group
   slug; connection order never chooses a destination.
4. Choose **Refresh now**. A request handles one feed and at most three calendar
   rows. If it reports **partial**, refresh again; later public calendar views
   can also continue the same snapshot.

`INITIAL_OWNER_EMAIL` is stored only as a secret Sites runtime setting and
becomes active only with a future owner-authorized deployment. Official feed
addresses remain operator-entered D1 configuration and are never committed.
No hosted feed connection or deployment is claimed, so production imported
data remains intentionally empty.

### Synchronization contract

- Completed feeds wait at least 15 minutes before refresh-on-view checks them
  again. Each public view checks at most one feed.
- Partial snapshots can resume immediately in another bounded request.
- The resumable generation hash covers normalized, validated import facts
  rather than raw calendar decoration. Meetup may change ignored export bytes
  between requests; those changes cannot restart a cursor, while any title,
  schedule, status, identity, RSVP, sequence, or last-modified change still
  creates a new generation identity.
- Imported rows are staged in an isolated pending generation. Staged rows and
  progress counters may change while that generation is pending; once a
  generation is published, the supported runtime does not mutate its snapshot
  rows. The public calendar continues to read the last fully published
  generation during a partial or failed refresh, so an update, addition, or
  cancellation cannot leak before finalization.
- The general/manual event projection excludes every canonical event with
  Meetup source-link history, including a retired link. Source-backed facts can
  publish only through the completed active-generation Meetup projection; a
  manually managed event remains eligible for the general projection.
- Sites does not guarantee a scheduler here, so no background cadence is
  claimed.
- Only a cursor-complete, successfully finalized feed snapshot can reconcile
  absence. A previously mapped future event missing from that complete
  source-scoped snapshot is cancelled, unpublished, and soft-retired; partial
  or failed snapshots never remove it. A later reappearance is imported again.
- Explicit Meetup cancellation remains distinct import provenance and is
  excluded from upcoming public listings.
- Disappearance reconciliation does not retire a shared canonical event while
  another source's active snapshot still reserves it as confirmed or tentative.
- UID plus recurrence identity is source-scoped, so the same UID in two club
  feeds cannot collide.
- The exact program catalog is resolved idempotently inside the authenticated
  organization. A connect request must carry one of those club IDs, and the
  server rejects a cross-organization, unsupported, or group-mismatched club
  before creating a source.
- Source sequence and last-modified fields are monotonic; stale replays cannot
  resurrect a newer cancellation.
- Raw feed descriptions and locations are not persisted or published because
  they may contain private meeting details. Public location and organizer
  attribution remain separately approved data.
- Non-cancelled all-day feed rows are rejected in this follow-up. They remain
  unsupported until the conflict engine can normalize reserving all-day
  intervals without converting calendar dates to midnight UTC.

The adapter follows Meetup's supported calendar export and does not use the
Meetup GraphQL API. Meetup currently requires an active Meetup Pro subscription
and approval for a new OAuth consumer, neither of which is available or needed
for this read-only feed path.

## Platform

- ChatGPT Sites-managed hosting
- Strict TypeScript and the official vinext Cloudflare Worker structure
- Sites-managed D1 through logical binding `DB`
- Sites-managed R2 through logical binding `MEDIA`
- Platform-owned Sign in with ChatGPT
- Server-side D1 membership and role authorization
- Central validation, safe errors, explicit public projections, and
  D1/SQLite-compatible tests

No alternative host, external database, external authentication provider,
email service, custom domain, paid account, or billing detail is required.

The high-resolution brand source is preserved under `design-assets/`; only
optimized favicon, app-icon, and social-card consumers are emitted from
`public/`.

## Local development

Requires Node.js `>=22.13.0` and the starter's locked npm package manager.

```powershell
npm.cmd ci
npm.cmd run db:apply:local
npm.cmd run db:apply:preview
npm.cmd run dev
```

`db:apply:local` exercises the generated migration chain in an isolated
D1-compatible proof database. `db:apply:preview` applies the same chain
idempotently to the Sites local preview D1. The preview is served at
`http://localhost:3000/`.

## Verification

```powershell
npm.cmd run db:generate
npm.cmd run db:apply:local
npm.cmd run db:apply:preview
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:rendered
npm.cmd audit --omit=dev --audit-level=low
npm.cmd audit --audit-level=low
```

`test:rendered` executes the built Cloudflare Worker inside Miniflare, including
the freshly migrated calendar, icon, manifest, CSP, and private-route checks.
Missing owner values are never committed; see `OWNER_INPUTS.md`.

`BUILD_STATUS.md` is the authoritative ledger, `MASTER_BUILD_SPEC.md` is the
unchanged canonical multi-phase reference, and `docs/architecture/` contains
the accepted architecture decisions.
