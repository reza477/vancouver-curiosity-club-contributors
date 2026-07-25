# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-25 (America/Vancouver)

## Active phase and authorized scope

- **Phase 2 — Public website only: Completed and verified locally.**
- The complete public route, D1 catalog, unified public event projection,
  Field Notes responsive system, SEO, privacy, security, and test work
  authorized by the Phase 2 packet is implemented.
- Phase 1 authorization, public-projection, conflict-guard, Meetup
  generation-isolation, consent, timezone, and project-isolation guarantees
  remain covered by the full regression suite.
- No Phase 3 surface was started.
- No preview or production deployment was created.
- Unpublished Sites version save: **Pending final Git/package handoff**. This
  ledger will receive a provenance-only update after Sites readback.
- Exact next phase: **Phase 3 — Not started**.

## Completed and verified

### Isolated Sites project and platform state

- The existing isolated project remains at
  `C:\Users\user\Documents\Website`; no prior project source, data, asset, ID,
  or configuration was copied.
- `.openai/hosting.json` still contains only the original opaque project ID and
  logical `DB`/`MEDIA` bindings.
- The existing Sites project is active. Pre-save readback reported latest
  version 5, no preview URL, no live URL, and no deployment.
- Sites runtime revision 1 contains only `INITIAL_OWNER_EMAIL` as a redacted
  secret. Its value was not printed into source or documentation.
- No GitHub, Supabase, PostgreSQL, Firebase, Vercel, Netlify, Resend, SMTP,
  custom domain, alternate identity provider, or alternate host was created.

### Complete Phase 2 public website

- Implemented `/`, `/events`, `/events/[slug]`, `/clubs`,
  `/clubs/[slug]`, `/community`, `/about`, `/get-involved`,
  `/host-an-event`, `/contact`, `/conduct`, `/accessibility`, `/privacy`,
  custom 404, `robots.txt`, and public-only XML sitemap.
- `/events` is canonical. `/calendar` is a permanent 308, non-indexable
  redirect and cannot create duplicate indexed content.
- One responsive header/footer supplies the required navigation, confirmed
  external links, current year, location, and restrained D1-backed mission
  copy. Unconfirmed legal, charity, Society, sponsor, statistic, history,
  organizer, and testimonial claims are absent.
- The selected Field Notes identity remains warm, editorial, responsive, and
  photography-free. Original category artwork and the original optimized mark
  ship without implying real attendees.
- Home reads its next events from the unified service and renders a truthful
  empty state when none exist. It includes all four exact lanes, the three
  confirmed featured clubs, honest attendance copy, community links, and
  organizer login.
- Events supplies Upcoming/Past, keyword, date range, club, lane, category,
  attendance-mode filters, result count, clear filters, bounded pagination,
  validated shareable query strings, and truthful empty/error/staleness
  states.
- Public event detail displays only facts that exist, clearly marks cancelled
  pages, uses Vancouver-local schedule wording, hides absent RSVP controls,
  distinguishes unpublished location details from genuinely undecided
  locations, and attributes Event structured data to the event's confirmed
  public club.
- Both draft program slugs and every draft, idea, hold, private, unpublished,
  deleted, or guessed event slug return 404.

### D1 catalog and migration

- Added one additive generated migration,
  `drizzle/0006_amusing_roughhouse.sql`, for:

  - `club_public_profiles`
  - `event_public_details`
  - four bounded public-query indexes

- Migration 0006 contains six D1 statements and no destructive data rewrite.
- The shared authoritative catalog defines exactly:

  - Think
  - Reset & Make
  - Explore
  - Eat & Play
  - Vancouver Curiosity Club — published/featured
  - Vancouver Literature and Film — published/featured
  - Vancouver Fantasy & Sci-Fi Group — published/featured
  - Off-Radar Eats — draft/inaccessible
  - Contemplative Meditation + Journaling Circle — draft/inaccessible

- Catalog creation is idempotent, organization-scoped, and available only
  after server-side Owner/Administrator authorization. It preserves later D1
  editorial changes and never runs from a public GET.
- The populated-version-5 upgrade regression preserves membership, private
  feed configuration, active/pending generation pointers, snapshots, removal
  counters, event/private fields, foreign keys, and both conflict triggers.

### Unified public event projection

- Home, Events, detail, club detail, related events, categories, and sitemap
  use one parameterized server-only service.
- Manual publication requires supported status, public visibility,
  `published_at`, no deletion, and a published club. Every canonical event
  with Meetup source-link history is excluded from this branch.
- Meetup publication reads only the immutable completed snapshot selected by
  `active_generation_id`. Pending and failed titles, times, additions,
  cancellations, club changes, and RSVP destinations cannot leak through any
  public surface.
- DTOs allowlist public fields. No feed address/token, source ID, generation
  ID, account identifier, organizer email, private note, private meeting
  detail, private venue detail, invitation, audit row, or submission enters a
  public DTO.
- Venue publication requires both the event and venue public gates. Cards and
  detail pages say that location details are not published rather than
  pretending a private venue is undecided.
- Filters, dates, slugs, state, page, and page size are validated and bounded.
  Query-plan tests prove the manual and active-snapshot projection indexes are
  used.

### SEO, security, privacy, and accessibility

- Public pages have unique titles/descriptions, request-origin-derived
  canonical/Open Graph URLs, the original social image, semantic breadcrumbs,
  and fact-bounded Organization/Event/Breadcrumb JSON-LD.
- The Worker overwrites untrusted origin/path context, applies a per-request
  production nonce with strict-dynamic CSP, rejects inline script attributes,
  and applies HSTS, frame, content-type, referrer, permissions, opener, and
  resource policies. Local unsafe-inline/unsafe-eval is restricted to Vite HMR.
- Unknown, error, organizer, identity, API, preview, `/calendar`, and filtered
  query routes are noindex through metadata and/or response headers.
- Privacy copy accurately describes public browsing, future organizer SIWC
  identity sharing, Sites/D1/R2, and the absence of a public submission form.
  It marks legal review as still required.
- Skip link, landmarks, semantic headings, visible focus, mobile body text at
  16 px, 44 px interactive targets, safe-area padding, reduced-motion
  overrides, and horizontal-overflow guards are implemented.

## Exact verification evidence

All commands below were run from
`C:\Users\user\Documents\Website` on 2026-07-25.

- `npm.cmd ci` — **exit 0**; 503 packages installed from `package-lock.json`.
- `npm.cmd run db:generate` — **exit 0**; 36 schema tables recognized; no
  schema drift and no additional migration generated.
- `npm.cmd run db:apply:local` — **exit 0**; 7 migrations, 38 SQLite tables
  including migration bookkeeping, 2 conflict triggers, 0 foreign-key
  violations.
- `npm.cmd run db:apply:preview` — **exit 0**; the same 7 migrations, 38
  tables, 2 triggers, and 0 foreign-key violations in the Sites local preview
  D1.
- `npm.cmd run typecheck` — **exit 0** under strict TypeScript.
- `npm.cmd run lint` — **exit 0** before build.
- `npm.cmd test` — **exit 0; 93/93 passed**, 0 failed, 0 skipped.
- `npm.cmd run build` — **exit 0**; vinext production build completed and
  emitted every authorized public route plus the preserved private Phase 1
  routes/APIs.
- Exact documented `npm.cmd run lint` after build and retained ignored
  `work/**` artifacts — **exit 0**.
- `npm.cmd run test:rendered` — **exit 0; 11/11 passed**, 0 failed, 0 skipped.
  This applies the generated chain to a fresh Miniflare/D1 database and checks
  built HTML, CSP, canonical metadata, public pages, empty Events, a synthetic
  cancelled detail, accurate Event/Breadcrumb JSON-LD, robots/sitemap,
  `/calendar`, custom 404, optimized assets, SIWC redirect, and private API
  behavior.
- `git diff --check` — **exit 0**.
- Exact public Meetup group destinations — **3/3 returned HTTP 200** without a
  redirect to a different URL during the final link check.
- Client-output scan — **0 hits** for feed-path, source URL, normalized email,
  private-note, private-meeting, runtime owner variable, Gmail-address,
  private-sentinel, or Windows-user-path patterns.
- Built-server concrete-value scan — **0 hits** for any of the three official
  feed paths, Gmail addresses, or Sites bypass-token labels. Generic
  server-only iCalendar parsing and private schema column names are expected
  and remain non-public.

### Dependency audit

- `npm.cmd audit --omit=dev --json` — **exit 1** with 3 high, 0 critical
  production findings (`next`, transitive `postcss`, transitive `sharp`).
- `npm.cmd audit --json` — **exit 1** with 18 total findings: 1 low,
  4 moderate, 13 high, 0 critical.
- No forced or unverified dependency upgrade was applied to the pinned Sites
  starter runtime. Patch candidates exist, but compatibility must be
  revalidated before any future public deployment.

## Browser QA

Completed against the local Sites/vinext preview with the approved catalog and
zero fake events:

- 320 × 800: no horizontal overflow; mobile menu and truthful Home state fit.
- 390 × 844: 16 px/24 px body copy, original mark legible at about 30 px,
  mobile menu opens, combined Events filters produce a shareable URL, and
  Clear Filters returns to the canonical state.
- 768 × 1024: public club page shows the exact confirmed group URL, no draft
  club, truthful event states, and no overflow.
- 1280 × 900: Community, Privacy, and custom 404 checked; exact external
  destinations, no discussion CTA/form, correct 404 title/noindex, and no
  overflow.
- 1440 × 900: complete desktop navigation visible, mobile menu hidden, no
  overflow, no fake event links, and no interactive target below 44 px.
- DevTools 200% reflow simulation (1280 physical width represented by a
  640-CSS-pixel viewport): responsive menu engaged, no overflow, and no target
  below 44 px.
- Reduced-motion emulation matched and reduced animation/transition duration
  to effectively zero.
- Visible focus was verified with the 3 px coral outline. Semantic keyboard
  controls are present; the in-app CUA Tab event itself was unreliable and is
  not claimed as a complete manual keyboard traversal.
- Browser console contained Vite development messages only: **0 error and
  0 warning entries; no hydration error**.

## Implemented but not externally verified

- The exact production archive and unpublished Sites version are not yet
  saved at this pre-provenance ledger checkpoint.
- Hosted D1 catalog creation, hosted feed refresh, hosted sitemap/event data,
  and SIWC owner persistence are implemented but cannot be externally verified
  without a deployment.
- Remote D1/R2 state is unchanged. D1 migration behavior is verified in the
  supported local/preview-compatible environments; MEDIA is bound but unused
  in Phase 2.

## Not implemented

- Phase 3 invitations/team management, event editor, organizer settings, CMS
  editing/revision restore, R2 media upload UI, conflict review/override UI,
  public-to-private publishing workflows, and submission inbox.
- Public forms, email, payments, donations, internal RSVP, attendee accounts,
  comments, chat, forums, QR downloads, calendar export, and notifications.
- No dead controls for those deferred features are shown.

## Not run

- Real interactive event browser smoke: **Not run** because the review D1
  contains no real published event and fake production events are forbidden.
  Service tests and the built synthetic cancelled-detail test cover the flow.
- Hosted SIWC/Owner persistence and uninvited second-identity smoke:
  **Not run** because no deployment is authorized.
- Hosted Meetup import and hosted D1 migration: **Not run** because no
  deployment is authorized; production imported data remains empty.
- R2 upload/read: **Not run** because media upload is out of Phase 2 scope.
- Lighthouse/Core Web Vitals measurement: **Not run**; no stable hosted URL
  exists.
- Automated axe audit: **Not run** because axe is not part of the pinned
  starter. Built semantic regressions and measured browser checks were run
  instead.

## Blocked

- Public deployment is blocked by this packet's explicit no-deploy gate.
- Stable-origin QR downloads are blocked until an actual production Sites URL
  exists.
- A clean dependency audit is blocked on a separately validated Sites-runtime
  patch update; no unsafe forced upgrade was made.

## Missing owner inputs

- Exact public Meetup discussion URL.
- Real event RSVP URLs for a later hosted smoke test.
- Exact BC legal name, legal form/status wording, registration number,
  effective date, approved legal footer, and charity wording/status.
- Final approved public copy.
- Real photographs with rights, credits, and participant-consent state.
- Approved organizer names/biographies and both attribution-consent gates.
- Confirmed public contact email, if one should be published.
- Per-event venue and accessibility facts.
- Stable production origin.

## Sites version and deployment state

- Existing versions 1–5 remain preserved and unpublished.
- Version 3 remains superseded and must not be deployed.
- Version 5 remains the latest saved version at this checkpoint, sourced from
  `cb51a5969370e4bed39ce83adac8532f2900d3d7`.
- New Phase 2 unpublished version: **Pending exact commit, package, save, and
  readback**.
- Preview deployment: **None**.
- Production deployment: **None**.
- Public URL: **None claimed**.

## Awaiting owner smoke test

Status: **Awaiting owner smoke test**. No owner action is marked passed by the
builder.

Five-minute phone card, after a future owner-authorized preview or deployment
is available:

1. Open Home at phone width; confirm the mark, menu, tagline, four lanes, three
   featured clubs, and truthful event state are readable without sideways
   scrolling.
2. Open Events; combine two filters, confirm the URL changes, then use Clear
   Filters.
3. Open one genuinely published event when available; confirm Vancouver-local
   time, truthful location wording, and that `RSVP on Meetup` appears only with
   a real destination.
4. Open each public club plus Community, Conduct, Accessibility, and Privacy;
   confirm only the three approved Meetup group links appear and no legal,
   discussion, contact-form, or organizer claim has been invented.
5. Open Organizer Login signed out; confirm Sign in with ChatGPT is required.
   After owner runtime activation, refresh as Reza and confirm access persists;
   if a second identity is available, confirm an authenticated uninvited user
   is denied.

## Next phase

**Phase 3 — Not started. Stop for owner review.**
