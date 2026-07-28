# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-27 (America/Vancouver)

## Active phase and release state

- **Phase 6 — Structured content, media, taxonomy, and public attribution.**
- Phase 6 is **terminally complete for the authorized scope**. Its migration,
  runtime-invariant, SQL-compatibility, CMS, catalog, media, publication,
  browser, package, and privacy gates are green.
- The first-run Meetup Program/Club catalog seed uses seven set-based
  statements and one live server authorization. The largest measured
  whole-route invocation is 43 D1 statements, leaving seven statements of
  headroom. The clean deterministic full suite is 592/592.
- Exact source commit
  `402880972fae5ed185a781888a6a5c6d9d167070` was pushed to the existing
  short-lived Sites source repository and saved exactly once as unpublished
  Sites version 12. It was not deployed.
- **Phase 7 — Not started.**
- Authorized cuts:

  - Editor role — **Not implemented — authorized cut**
  - Viewer role — **Not implemented — authorized cut**
  - Realtime subscriptions — **Not implemented — authorized cut**

- Approved-real-artwork browser smoke — **Awaiting owner / not run**.
  Synthetic local non-person artwork verifies mechanics only.
- No awards are claimed.
- No deployment or access change is authorized. The owner-only live deployment
  remains version 8 with one allowed owner and zero groups.

## Implemented Phase 6 scope

### CMS, preview, and public materialization

- Owners and Administrators can create, save, preview, publish, unpublish,
  restore, reorder, archive, and safely delete supported structured content
  within the exact server-authorized lifecycle for pages, clubs, recurring
  Programs, Community destinations, navigation, Site Identity, and legal
  status.
- Required system pages retain their canonical slugs and required structure.
  Resources is an optional unpublished page with a no-code draft-creation
  path and protected `/resources` slug.
- Private preview is authenticated, no-store, noindex, revision-specific, and
  uses the same entity renderers, layout, responsive media, palette, typography,
  and current public facts as production. It does not create a share token.
- Immutable revisions, publication states, receipts, exact projection parity,
  write intents, audits, redirects, and media usages form one fail-closed
  materialization contract. Direct projection tampering and missing or
  unrelated media usage fail closed.
- Page, Club, Program, Community, navigation, Site Identity, legal, and public
  event reads require the exact current or intentionally retained archived
  materialization. Stale and crafted projections are suppressed.

### Media and public attribution

- D1 is authoritative for media metadata, opaque R2 keys, upload state,
  responsive WebP variants, dimensions, focal point, rights, consent, credit,
  alt text, caption inheritance, hashes, exact usages, deletion, and durable
  cleanup retry.
- Public media serves only normalized `webp_480`, `webp_960`, and
  `webp_1600` variants through the exact organization, entity, revision, and
  usage relationship. Originals remain authenticated and no-store; Organizers
  cannot fetch originals.
- Upload and finalization races await every R2 operation and preserve a
  deterministic cleanup manifest. Failed upload and deletion cleanup remain
  discoverable and idempotently retryable without exposing object keys.
- Media required for event artwork, Open Graph, logo, cover, thumbnail, and
  profile-photo uses requires useful alt text even when an asset is marked
  decorative. Inline genuinely decorative media may retain empty alt.
- Organizer public attribution uses a separate private draft and immutable
  confirmed/adopted receipt. Public output requires profile consent and
  event-level host display; revocation removes output immediately. Public DTOs
  allow only display name, bounded biography, and approved photo metadata and
  never expose email, role, assignments, auth identifiers, private drafts, or
  raw object keys.

### Taxonomy, clubs, Programs, and events

- Owners and Administrators manage event lanes and categories through bounded
  intent, base-row, companion-state, audit, and completion envelopes.
- The four canonical lane slugs remain immutable:

  - `think`
  - `reset-and-make`
  - `explore`
  - `eat-and-play`

- Canonical labels, descriptions, and order are fill-only during adoption so
  owner edits are not overwritten. Direct base-table or companion-state
  protocol bypasses, cross-organization writes, history forks, reference
  destruction, and incomplete envelopes are rejected or detected.
- Existing events may preserve their exact archived lane/category on ordinary
  edits. New events and reassignment may select only active values.
- First-class recurring Programs use the existing Program/event relationship
  with CMS profile, publication, order, feature, archive, history, media,
  resources, and public route support. Top-level Club identities remain
  distinct from recurring Programs.
- Archived Club and Program details retain truthful historical public detail,
  exact published media, and eligible Past events while leaving active
  directories and future discovery. Upcoming events block archive; retained
  history blocks destructive safe-delete.
- Unified public events keep exact Club/Program receipt tokens across list,
  detail, editorial, related, sitemap, and private-selection paths.
  Publication, edit, tamper, cross-source collision, and split-read races fail
  closed.

### Branding, navigation, legal, metadata, and accessibility

- Published Site Identity drives brand name, title/site name, palette,
  typography, logo, global Open Graph fallback, root icons, and dynamic
  manifest output. Rebranding never silently retains contradictory VCC social
  artwork.
- Page, event, Club, and Program metadata uses exact approved media with real
  dimensions and canonical alt, falling back only to a current approved Site
  Identity selection or a truthful static default.
- Required navigation targets survive maximum optional ordering; duplicate
  placement-and-target pairs are rejected. The responsive menu changes before
  a maximum validated navigation row can overflow.
- Legal claims are blocked across public CMS, event, media, metadata,
  structured-data, and feed surfaces unless exact coherent wording comes
  through the Owner-confirmed legal projection. Administrators may prepare a
  legal draft but cannot confirm, revoke, publish, or unpublish it.
- Organizer identity emails are denied from public content in both directions:
  public publication rejects historical/current organizer emails, and later
  organizer activation or email mutation rejects a collision with still
  resolvable public content.
- Palette validation covers actual text/background, inverse, caption, alert,
  focus, border, chip, and status-indicator pairings. Public soft text derives
  from the validated foreground token.
- Shared public and preview renderers preserve one main landmark, a valid skip
  target, structured breadcrumbs, route-specific composition, responsive
  image source sets built from real deduplicated widths, and mobile target
  sizes.

## Frozen migration and schema evidence

- Exactly one Phase 6 migration exists:
  `drizzle/0015_phase6_cms_media.sql`. There is no `0016`.
- Migration chain is exactly `0008` through `0015`; prior `0008` through
  `0014` remain unchanged.
- Frozen hashes:

  - `0015_phase6_cms_media.sql` SHA-256:
    `53f13344db9a8f37c34e2c4b9c2fefb0fd6184b842be8a69583f9c2165448091`
    (58,180 bytes)
  - `drizzle/meta/0015_snapshot.json` SHA-256:
    `3255a27f8704f3c54ace3c6a216d4008b17ea061adb47a8d666bc76a9fa195ca`
    (485,823 bytes)
  - `drizzle/meta/_journal.json` SHA-256:
    `660131356c9d3e505b63b23eb1736a7e694bd545f44e2e2dd579e6adccd91911`
    (1,272 bytes)

- Measured schema/package/snapshot signature:

  - 78 tables
  - 194 checks
  - 273 foreign keys
  - 184 explicit indexes
  - 73 unique indexes
  - 0 packaged triggers

- Phase 6 contains 73 retry-safe idempotent CREATE fragments. DDL batches are
  48 plus 25 statements; request statement counts are 48 plus 26 because the
  migration ledger is written only in the final successful batch.
- All 74 interruption cuts, followed by two complete retries, converge to the
  exact schema with zero foreign-key violations.
- Local and preview migration application each verified 8 migrations,
  78 tables, all 213 runtime triggers, bounded repair followed by `ready`, and
  zero `PRAGMA foreign_key_check` violations.
- Real D1 accepts valid non-null Club and Program theme colors and rejects
  invalid colors through the short length/substr/negative-GLOB check. The
  platform witness confirms a 50-byte GLOB pattern succeeds and a 51-byte
  pattern fails.

## Runtime invariants, SQL, and request budgets

- Current runtime invariant evidence:

  - 213 exact global triggers
  - 135 Phase 6 triggers
  - 61 Phase 6 count statements
  - 23 combined invariant count groups
  - every current invariant count equals zero at readiness
  - empty convergence: 9 bounded requests
  - 12-profile legacy-attribution plus taxonomy convergence: 23 bounded
    requests
  - worst repair request: 48 D1 statements

- All 213 trigger definitions and 132 distinct table/operation activation
  families compile on fresh Miniflare D1. The maximum audited Phase 6 trigger
  is 43,345 bytes; the maximum combined probe is 74,743 bytes.
- Stable production D1-shape evidence:

  - Events: 47/47; 35 shapes; max 87,259 bytes / 19 binds
  - Catalog/sitemap: 7/7; 14 shapes; max 59,988 bytes / 5 binds
  - CMS: 22/22; 118 shapes; max 31,803 bytes / 58 binds
  - Media: 23/23; 55 shapes; max 43,913 bytes / 14 binds
  - Profiles: 18/18; 28 shapes; max 18,664 bytes / 17 binds
  - Taxonomy: 4/4; 45 shapes; max 2,535 bytes / 21 binds
  - Publication: 105/105

- No audited production SQL shape reaches the D1 100,000-byte statement limit
  or 100-bind limit. Audited global maxima are 87,259 bytes and 58 binds.
- Administrator-approved immediate publication uses 49 statements with a
  largest batch of 15. The hardest due-publication path uses 31 statements
  with a largest batch of 16. Both remain below the 50-statement request cap.
- Home peak D1 concurrency is 5, below the six-connection Worker-invocation
  limit.
- Public-catalog accounting at `lib/server/public/catalog.ts` SHA-256
  `5f88a0bd9b465d4cb846bb94aae6b15ee6a4477b7acc73c2b86dc59b9e145676`
  uses seven set-based fill-only catalog statements and one live
  server-authorized actor. The actor-taking core is private rather than an
  externally forgeable authorization seam.
- The taxonomy protocol still accepts only the exact known first-result `N` or
  `N+1`, requires every other result to equal `N`, and verifies the exact
  durable taxonomy envelope after the batch.
- Full Worker-invocation request traces, including invariant preflight,
  request maintenance, both organizer GET context loads, route reads, live
  authorization, catalog maintenance, and response work, are:

  - Meetup GET: 23 healthy, 37 existing-owner fresh catalog, and 43
    first-owner fresh catalog
  - Meetup connect POST: 14 healthy with a new source, 28 existing-owner fresh
    catalog with a new source, 34 first-owner fresh catalog with a new source,
    and 11 for an exact-source retry

- The maximum is 43, leaving seven statements below the 50-statement request
  cap. Failure, retry, concurrent initialization, marker deletion/repair
  interleavings, and exact durable postconditions are covered without blind
  retries.

## Verification already completed

- Clean `npm.cmd ci` completed from the tracked lockfile: 503 packages.
- Current accepted dependency audit state:

  - production: 3 high, 0 critical
  - complete tree: 18 total — 1 low, 4 moderate, 13 high, 0 critical

  No unsafe forced upgrade of the pinned Sites/Next runtime was applied.
- Focused migration/runtime compatibility gate after the theme-color repair:
  **11/11 passed**.
- Site Identity canonical adoption and CMS/adoption gate:
  **25/25 passed**; all 119 captured CMS/adoption D1 shapes compile, with
  maximum 31,803 bytes and 58 binds.
- Public-catalog and whole-route focused real-Miniflare gate: **30/30 passed**.
- Catalog, Meetup, invariant, and request-budget affected gate:
  **93/93 passed**.
- The clean deterministic serial repository suite is **592/592 passed**.
- Strict typecheck, zero-warning lint before build, production build,
  zero-warning lint after build, and `git diff --check` are green on the final
  source.
- The fresh rendered Worker integration is **23/23 passed**.
- `drizzle-kit check` reports `Everything's fine`.
- Fresh local and preview migration application each reached `ready` with
  8 migrations, 78 tables, 213/213 runtime triggers, and zero foreign-key
  violations.
- The retained final `dist` contains **141 files / 8,711,691 bytes**. Its
  hosting metadata, migration 0015, snapshot, and journal are byte-identical
  to source, and its forbidden-artifact count is zero.
- Final package/privacy scans report zero raw R2 identifiers, private identity
  columns, fixture `.test` emails, private Meetup iCal URLs, private-key
  material, common secret-token shapes, or literal initial-owner email
  assignments.
- After the final CMS trailing-space correction, the affected CMS and real-D1
  compatibility rerun passed **24/24**, followed by a fresh production build,
  zero-warning post-build lint, rendered Worker **23/23**, and this repeated
  package/privacy inventory.

## Final browser and accessibility evidence

- Local Cloudflare-backed browser QA covered:

  - desktop 1440×900
  - tablet 1024×768
  - mobile 390×844

- Home, Community, and Club pages retained one main landmark, header/footer,
  valid breadcrumbs where applicable, and no horizontal overflow.
- The responsive menu is a native keyboard-focusable `details`/`summary`
  control. At mobile width the wordmark and menu control are at least 44px,
  and all six open-menu destinations plus Organizer Login are 48px high.
- The skip link targets an existing focusable `#page-content`.
- The Club accessibility tree had one main, one banner, one contentinfo, and
  no unnamed links or buttons.
- The narrow Program-card action regression was corrected: the mobile
  “Read the Program note” link measures 175px wide by 44px high and no longer
  collapses into a one-word grid column.
- In-app keyboard event simulation could not reliably exercise browser-native
  Tab/Enter defaults. Semantic controls, focus targets, visible focus styles,
  target sizes, and source/render contracts were verified; no literal
  end-to-end keyboard-keypress claim is made.
- The final Cloudflare-backed browser pass measured exact 1440×900, 1024×768,
  and 390×844 viewports. Each had one main, one header, one footer, a valid
  skip target, zero horizontal overflow, and a 92×44 menu control.
- The final Home render showed the canonical Site Identity, substantive
  required content, exact canonical lane descriptions, featured Clubs, and
  confirmed Community destinations.
- The local Worker and its workerd child were stopped after the pass; port
  3000 is free and the temporary browser logs were removed.

## Final Phase 6 release actions completed

All authorized implementation, verification, build, rendered, browser,
migration, package, privacy, source-provenance, and version-save gates are
green:

1. The exact verified source was committed and pushed at
   `402880972fae5ed185a781888a6a5c6d9d167070`.
2. The official Sites helper packaged the exact pushed state. Archive
   inspection found 141 files, 8,711,691 uncompressed file bytes, zero unsafe
   paths, zero forbidden artifacts, and exact hosting/migration/snapshot/
   journal parity.
3. Exactly one new **unpublished** Sites version 12 was saved and read back
   with the exact source SHA, 141 files, 8,826,880 stored bytes, null
   screenshot/preview state, and content hash recorded below.
4. The live owner-only version 8, access policy, bindings, runtime, domains,
   and preview state remain unchanged.

No deployment or access mutation was performed.

## Not implemented

- Editor role — **Not implemented — authorized cut**
- Viewer role — **Not implemented — authorized cut**
- Realtime subscriptions — **Not implemented — authorized cut**
- Phase 6 adds no import/export workflow, public form, submission inbox,
  attendee account, internal RSVP system, payment, donation, email, comment,
  message, forum, chat, automatic Meetup write-back, or on-site social feature.
- Phase 7 imports, exports, public forms, and submissions are not implemented.

## Awaiting owner / not run

- Approved-real-artwork browser smoke — **Awaiting owner / not run**.
- Hosted Phase 6 CMS/media/publication smoke — not run because Phase 6 is not
  deployed and no deployment is authorized.
- Hosted second-human identity verification — not run because current access
  permits one owner and zero groups.
- Real-event end-to-end publication smoke — not run because no approved real
  event/artwork fixture is authorized for production use.
- No award submission or award claim was made.

## Sites project and live-state preservation

- Sites project:
  `appgprj_6a62eaf79c4881919bb8e47998af851a`.
- Logical bindings remain D1 `DB` and R2 `MEDIA`.
- Runtime remains revision 1 with only the redacted
  `INITIAL_OWNER_EMAIL` secret.
- Access remains custom: exactly one allowed owner and zero groups.
- Custom domains: none.
- Preview deployment: none.
- Public/shared access: disabled.
- Existing live deployment remains owner-only version 8 at
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`.
- Live deployment ID remains
  `appgdep_6a654533aee481918098af58b5a4f861` on saved version
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_eed88ec7d02c8191a865045cd32c940e`.
- Preserved unpublished Phase 5 version 11:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_c698ee1802e08191b7ac4cde79e6afe5`.
  Its readback source is
  `8d33f124d6e6b55a8eea5b6af64baa7982484b3f`, content hash is
  `sha256:fd1b49bd5439694e460f998c0562a4d25eca189d1b5c5518d7e7b3ebd76cda02`,
  and preview state is null.
- Unpublished Phase 6 version 12:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_09b2e58e86708191bad24f520ea2d21e`.
  Its exact readback reports:

  - version number 12
  - source commit `402880972fae5ed185a781888a6a5c6d9d167070`
  - content hash
    `sha256:93b7fac9a7646b0a0943fb41cdba1ea7c7f845562b2478a5403faae2927b3e65`
  - 141 files
  - 8,826,880 stored bytes
  - screenshot URL null

- Current preview URL remains null. Version 12 was saved but not deployed.
- No Phase 6 deployment, preview deployment, access-policy change,
  custom-domain change, binding change, or runtime change has occurred.

## Exact next action and next phase

Stop for independent coordinator audit. Do not deploy or begin Phase 7 without
new authorization.

**Phase 7 — Not started.**
