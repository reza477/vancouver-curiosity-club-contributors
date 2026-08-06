# Vancouver Curiosity Club — Build Status

Last updated: 2026-08-06 (America/Vancouver)

## Active phase and release state

- Workspace: `C:\Users\user\Documents\Website`
- **Active phase: Phase 9 — Private Sites deployment and production
  verification.**
- Phase 6 is **Completed and verified** for its authorized scope.
- Phase 7 implementation and the complete local repository, migration,
  production-build, rendered-Worker, browser, archive, source-readback, and
  unpublished Sites-version matrix are **Completed and verified**.
- Phase 8 is **Completed and verified** for its authorized scope. Its
  security, dependency, migration, D1-budget, accessibility, responsive,
  performance, link/content, complete repository, exact-source build,
  archive, pushed-source, and unpublished Sites-version gates are green.
- Phase 9 is **Completed and verified** for its authorized private-deployment
  and production-verification scope.
- Exact saved version 16 is now the active, terminally succeeded deployment at
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`.
- Access is now public by explicit Owner authorization, at access-policy
  revision 2. The Owner remains the sole project owner and there are zero
  groups. There is no custom domain or preview deployment. The `DB` and
  `MEDIA` logical bindings and runtime revision 1 remain unchanged.
- Phase 9 did not create another version, preview, domain, access policy,
  binding, runtime value, host, or deployment surface.

## Owner-directed calendar-first update (post-Phase 9)

Status at this source checkpoint: **Completed and verified.** Exact Sites
version 16 is live. This is an Owner-directed refinement of the completed
product, not a new numbered phase.

- Home now gives a short introduction and immediately shows the next four
  published events. Existing owner-edited Home CMS sections remain functional
  below the calendar-first content.
- `/calendar` is a real month-at-a-glance view rather than a redirect. Hover,
  keyboard focus, and tap/click select a day and reveal the event title,
  schedule, approved artwork or controlled category fallback, public location,
  event detail link, and confirmed external signup link.
- Each public event offers a Google Calendar action and an RFC-compliant
  `.ics` download for Apple Calendar and other calendar clients.
- The public header is intentionally reduced to Calendar, About, and Community.
  Organizer Login remains in the footer and at `/organizer`.
- The application does not create public visitor accounts. Anonymous visitors
  can now browse the public routes without signing in. Organizer routes remain
  protected by Sign in with ChatGPT plus current invitation, membership, role,
  organization, and suspension checks.
- All three official Meetup iCalendar feeds were entered through the
  authenticated production portal. Completed Literature and Fantasy feeds
  currently contribute 11 real source-backed events. Activation of the main
  Vancouver Curiosity Club feed failed closed because the same gatherings are
  cross-posted under different Meetup source identities; the two completed
  snapshots remain visible and no conflict guard was weakened.
- Meetup remains one-way and request/manual-refresh driven; Sites does not
  guarantee a daily scheduler. The official iCalendar feeds contain no
  poster-image field. At the Owner's direction, exact local copies of the 11
  current public Meetup event posters are now matched by numeric Meetup event
  ID and rendered across cards, details, metadata, and calendar day panels.
  New events retain the controlled category fallback until an approved poster
  is deliberately added. Public requests never scrape or hotlink Meetup.
- `/events` now renders the same canonical month calendar as `/calendar`, so
  older bookmarks never reopen the retired search form. When no month is
  selected, the calendar opens the nearest month containing a published
  upcoming event; an explicitly selected month is always preserved. Desktop
  and tablet month cells show event titles at a glance, and hover/focus/tap
  opens the rich day panel.
- Per-event signup is currently the exact confirmed Meetup event URL. Exact
  Eventbrite, Flock, and Instagram destinations have not been supplied and are
  not invented; confirmed global destinations can be added through Community,
  while event-specific multi-platform signup would need a later additive data
  model.

Verification at this checkpoint:

- final complete repository suite: 862/862 passed, 0 failed, 0 skipped;
- final focused calendar, route, and CMS source contracts: 26/26 passed;
- strict TypeScript: passed;
- zero-warning lint: passed;
- `git diff --check`: passed;
- exact source commit:
  `27f6d319544e430aeae1c4367528b30c54fbd6a4`;
- fresh exact-commit production build: passed;
- rendered Worker: 25/25 passed;
- final artifact, poster, and documentation matrix: 13/13 passed;
- production dependency audit: 0 findings;
- exact deployed Sites version:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_a0313813e8d481918a8d9d309560edc8`
  (version 16);
- version content hash:
  `sha256:e7b247f6e44cec2a448620f7148373ef4fdf29f4e2fd834b9dde25e055e6e795`;
- version readback: 181 files / 10,977,280 stored bytes / screenshot available /
  no preview URL;
- deployment:
  `appgdep_6a6c4cf1f870819189cc2cb3d7803064`, terminal `succeeded`;
- live browser verification confirmed the simplified Home, 11 source-backed
  events, the August month calendar, titles in 1280px and 768px month cells,
  hover/click/tap day detail, exact Meetup event links, Google Calendar, and
  Apple Calendar / `.ics` actions;
- production browser checks at 1280, 768, 390, and 320 CSS pixels found no
  horizontal overflow or console errors. Phone cells use readable dots/counts
  and expose the full title, poster, time, Meetup, and calendar actions after a
  tap. All tested poster images loaded with nonzero natural dimensions.

The deployment originally preserved custom access revision 1. After the Owner
explicitly continued with public launch, Sites access revision 2 changed only
the visitor access mode to `public`. Version 16, its source/content hash,
runtime revision 1, the one project Owner, zero groups, no custom domain, no
preview URL, and the existing `DB` / `MEDIA` bindings remain unchanged.
Anonymous checks returned `200` for Home, Calendar, Events, robots, and sitemap;
one real event detail returned its exact Meetup destination plus Google and
Apple/ICS calendar actions; `/organizer` still redirected to Sign in with
ChatGPT, the organizer API returned `401`, and a guessed private-calendar token
returned `404` with private/no-store/noindex protections.

## Owner-directed calendar-as-home refinement (unpublished Sites version 17)

Status: **Implemented and locally verified; not deployed.** The live public
site remains exact Sites version 16 until a later explicitly authorized public
deployment.

- `/` now renders the month-at-a-glance calendar as the first substantive
  content instead of the former introduction and four-event preview.
- The visible month and year are the page's single `h1`; the redundant large
  `Calendar` masthead is removed.
- Month navigation, event titles, hover/focus/tap day detail, posters, Meetup
  signup, and per-event calendar actions remain unchanged.
- Calendar downloads and a short truthful club introduction follow the month
  view instead of blocking it.
- The header's Calendar destination is marked current on `/`. Public browsing
  remains anonymous; Organizer Login and every organizer/API authorization
  boundary remain unchanged.
- Root brand metadata and Organization structured data remain present.

Verification at this source checkpoint:

- complete repository suite: 862/862 passed, 0 failed, 0 skipped;
- focused calendar, foundation, and CMS contracts: 32/32 passed;
- strict TypeScript: passed;
- zero-warning lint: passed;
- fresh production build: passed;
- rendered Worker: 25/25 passed;
- `git diff --check`: passed;
- saved source commit:
  `8b368500db2cf65875dffc39918889bc906fe546`;
- unpublished Sites version 17:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_0f5c6d1f80688191b7f8a26d52ec9293`;
- version 17 content hash:
  `sha256:b5b73a715290612a1ac97b4a6f046eb03f47688baa7379a7dcdcbc0e216f546f`;
- version 17 readback: 181 files / 10,977,280 stored bytes / screenshot
  unavailable;
- production deployment: **Not run**;
- live version 16: unchanged.

## Previous-phase preservation

Phase 6 remains the verified prerequisite for this work:

- saved source commit:
  `402880972fae5ed185a781888a6a5c6d9d167070`;
- unpublished Sites version 12:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_09b2e58e86708191bad24f520ea2d21e`;
- version 12 content hash:
  `sha256:93b7fac9a7646b0a0943fb41cdba1ea7c7f845562b2478a5403faae2927b3e65`;
- 141 stored files / 8,826,880 stored bytes / null screenshot state;
- the clean deterministic Phase 6 suite passed 592/592;
- strict typecheck, zero-warning lint, production build, rendered Worker 23/23,
  migration/package parity, privacy scans, and local browser verification were
  green on that exact Phase 6 source;
- the live deployment remained owner-only version 8 and version 12 was not
  deployed.

Phase 7 preserves:

- Sign in with ChatGPT and invitation-only membership;
- live server authorization and role revalidation;
- Phase 4 scheduling conflict, intent, optimistic-version, atomic-batch, and D1
  reservation guards;
- Phase 5 private-to-public publishing and public projection boundaries;
- Phase 6 CMS receipts, legal confirmation, taxonomy, Community, Program,
  organizer-attribution, and exact R2 media-usage rules;
- completed-generation Meetup snapshot publication and source-scoped identity;
- the existing private Meetup feed addresses and exact public Meetup URLs.

No award is claimed.

## Phase 9 private deployment and production verification

### Exact deployment and unchanged Sites boundary

- Production URL:
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`
- Deployment ID:
  `appgdep_6a6a8ade7fa08191a6c1a21cf7d1f0b9`
- Deployment result: **Completed and verified**; terminal status `succeeded`.
- Active version:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_69aafba5ef148191b00042bce388a678`
  (version 14).
- Deployed source commit:
  `aaeb6a648e93a7dd2e41f329085b611b8b7d10b1`
- Version content hash:
  `sha256:0b65ec790f59acd1ceb1d8ac62350e8914352c6b251aa78ecefbf743c81505d1`
- Version readback: 168 files / 10,311,680 stored bytes / `tar` archive /
  null screenshot / no preview URL.
- At the Phase 9 deployment checkpoint, the custom access policy remained
  exactly one allowed owner and zero groups; public/shared access was disabled.
- There are no custom domains and no preview deployment. Runtime revision 1
  still contains only the redacted `INITIAL_OWNER_EMAIL` setting. Logical
  bindings remain `DB` and `MEDIA`.
- No rollback, additional Sites version, second deployment, access/domain
  change, binding change, runtime-value change, alternate host, or external
  service was created.

Normal bounded first-run hosted effects were limited to the existing migration
and invariant repair path, Owner/organization/public-catalog bootstrap, the
exact-match legacy CMS copy upgrade, and form-protection key/cookie checks. No
fabricated event, submission, import, media asset, invitation, notification,
private-calendar token, or Meetup source was committed.

### Hosted route, authentication, privacy, and content checks

- Without the Sites authorization boundary, `/`, `/organizer`, an organizer
  API path, and a guessed private-calendar token path each returned the
  platform's `401 Sign in required` boundary.
- Through the Sites-authorized application boundary without an organizer
  identity, `/organizer` returned the expected `307` Sign in with ChatGPT
  redirect, the session endpoint returned `401`, and the guessed private token
  returned `404`.
- Private responses retained `no-store`, `noindex`, and `no-referrer`.
  Encoded private-equivalent paths remained private, and invitation-token
  capture retained its safe boundary.
- `robots.txt` reached `200` after bounded invariant convergence. The hosted
  application exposes no raw schema or foreign-key introspection endpoint;
  86 tables, 249 runtime triggers, and zero known foreign-key violations are
  exact source/package provenance, not a claim of direct hosted SQL
  enumeration.
- Owner sign-in completed the organization/catalog bootstrap. Fourteen
  canonical public routes returned `200` after bounded one-time CMS
  maintenance. The sitemap contained 17 exact-host locations and no private
  path.
- Forty-eight internal links were checked with zero dead links. The calendar
  redirect behaved as designed. A guessed event ICS URL returned `404`;
  empty public ICS and CSV downloads contained no private data.
- Home canonical and Open Graph URLs used the exact Sites production origin.
  JSON-LD used the exact site URL and only the three verified Meetup group
  destinations as external `sameAs` links.
- All three confirmed Meetup group URLs resolved to their intended live group
  pages. Individual event-detail and real individual Meetup-link verification
  is **Not run — no approved real published event**.

### Owner view-only and production browser checks

- Representative Owner-authenticated views were healthy for Dashboard,
  Events, Calendar, Conflicts, Clubs, Imports, Submissions, Exports, Content,
  Media, Meetup, Profile, Settings, Notifications, and Team.
- Those workspaces initially contained no events, imports, submissions,
  uploaded media, invitations, notifications, or Meetup source. An
  intentionally invalid private-event submission showed an accessible error
  summary and field errors and persisted no data.
- After Owner sign-in, one clearly labelled private production-smoke Draft was
  created through the normal event workflow. Its title was absent from Home,
  Events, sitemap, public ICS, public CSV, guessed public detail, and guessed
  event ICS. It was never published, confirmed, placed on hold, linked to
  Meetup, or given public copy. It was then archived and moved to deleted
  items through the normal Owner workflow. The active organizer Events list
  returned to zero records; the deleted record and its immutable
  create/archive/delete audit history remain as the truthful production-smoke
  trace.
- Production browser checks covered 320px Home, Events, Contact, and organizer
  Calendar; 390px Home and organizer Calendar; 1280px Home; and a 640
  CSS-pixel 200%-zoom reflow equivalent. Tested pages had no horizontal
  overflow and measured 16px body text where applicable.
- Reduced-motion mode was honored with effective transition durations of
  `0.00001s`. The browser console reported zero warnings or errors.
- Focused production axe-core runs on Home, Contact, and Owner Calendar found
  zero accessibility violations (21, 30, and 22 passing rules). Home and
  Calendar each retained one manual/incomplete contrast review; Calendar's
  incomplete item covered 38 nodes and is not reported as a passed automated
  contrast assertion. No production Lighthouse score was taken.
- All four public form-instance endpoints returned `200` with private
  protection headers. No public form POST or production submission mutation
  was performed at that checkpoint. Following the later Owner-authorized
  public-access change, anonymous visitors can reach the forms; no production
  form submission was made while changing access.
- No approved production artwork exists; the Media workspace reports no
  uploaded artwork. Approved-real-artwork review remains
  **Awaiting owner smoke test**.

The broader Phase 8 axe matrix and all Phase 8 Lighthouse numbers below are
local exact-artifact evidence, not production reruns. External private
calendar-client behavior remains **Implemented but not externally verified**.
Hosted second-identity role/suspension/reassignment remains **Not run**
because the access policy has one owner and zero groups. The Owner backup
restore rehearsal remains **Not run**.

## Phase 8 hardening status

### Important fixed decisions

- Phase 8 hardened the completed Phase 1–7 product; it added no Phase 9
  deployment behavior.
- Sites remains the only host. The existing `DB` and `MEDIA` logical bindings,
  platform-owned Sign in with ChatGPT, access policy, domains, runtime values,
  and hosted D1/R2 boundaries remain unchanged. At the Phase 8 checkpoint,
  live version 8 was still active; Phase 9 later deployed exact version 14
  within the same owner-only boundary.
- Phase 8 changes no D1 schema. The migration chain still ends at the sole
  `0016_phase7_import_export_forms.sql`; there is no `0017`.
- The Worker canonicalizes the request pathname once before routing, trusted
  request context, invitation-token capture, maintenance, shell selection,
  cache/robots/referrer policy, and safe diagnostics. Malformed, residual,
  double-encoded, delimiter, slash/backslash, dot-segment, Unicode, and
  overlength ambiguity fails closed.
- Production uses a practical nonce-based CSP and explicit framing,
  MIME-sniffing, referrer, permissions, opener/resource, HTTPS, private-cache,
  and robots headers. Inline styles remain allowed because the current
  vinext-generated style path requires them; production scripts do not receive
  a blanket inline-script allowance.
- Protected multi-read responses and conditional writes carry or revalidate
  the exact current actor, role, organization, assignment, club, event,
  publication, revision, receipt, media, token, or lease facts immediately
  before return/commit. A concurrent access or state change fails closed.
- Public HTML, metadata, JSON-LD, sitemap, errors, ICS, CSV, redirects, media,
  and anonymous APIs use explicit allowlists. D1 application rows and R2
  object keys are never generic public serializers or download inputs.
- Dependency remediation uses compatible releases only. No force upgrade,
  blanket override, audit suppression, or incompatible Next/ESLint/Drizzle
  downgrade is accepted merely to change an audit count.

### Security, privacy, R2, token, and error review

**Completed and verified locally.**

- Crafted-route and direct-service coverage verifies current active profile,
  membership, role, organization, club, assignment, and entity ownership for
  organizer pages, events, conflicts, publication, CMS, settings, team,
  invitations, notifications, imports, submissions, exports, private
  calendars, Meetup, and media.
- Encoded organizer/API/private-calendar/invitation paths receive the same
  private classification as the router or are rejected before dispatch.
  Private calendar bearer paths are recorded only as
  `/api/calendar/private/[token]`.
- CSRF/same-origin, bounded body/input, parameterized D1, safe error, atomic
  sentinel, idempotency, durable rate-limit, and audit-privacy contracts remain
  intact.
- Public media requires exact current public usage and safety proof. Private
  original/variant reads require current authorized membership and role. Both
  revalidate after `MEDIA.get()` and before returning bytes.
- Raw invitation/calendar tokens, token hashes, private Meetup feed addresses,
  identity headers, runtime values, R2 keys, notes, submissions, import source
  rows, and conflict reasons remain excluded from logs, errors, audits,
  downloads, public output, and browser bundles.
- Source and built-artifact tests cover nested sentinels, environment/local
  paths, source maps, local databases/logs, fixtures, mock/debug routes,
  identity values, form/import facts, private feeds, token material, and R2
  keys.
- Public/private cache and indexing behavior is verified through rendered
  Worker and route tests. Private, identity, preview, error, and token
  responses are no-store and non-indexable.

### Whole-Worker D1 statement budgets

All measured paths remain below the 50-statement invocation ceiling. Counts
include the invariant fast path and request maintenance where the real fixture
can enter a ready runtime; the deliberately invalid media fixture adds the
established two-statement invariant fast path explicitly.

- Meetup page GET: 26 healthy, 40 fresh catalog, 46 first Owner + fresh
  catalog.
- Meetup connect: 15 healthy/new source, 29 fresh catalog, 35 first Owner +
  fresh catalog, 12 exact-source retry.
- Manual Meetup refresh: 38.
- Organizer calendar: 42 healthy, 46 with 5,000 candidates and a due hold
  notice.
- Public filtered ICS: 10; one-event ICS: 10; public CSV: 7.
- Operational CSV: 6; Owner JSON backup: 23; media manifest/original: 6/6.
- Private-calendar token create/feed/revoke: 7/8/8.
- Public form instance: 5; legitimate form submit maximum: 16; invalid form:
  9.
- Submission routes: list 7, detail 8, note 12, status 16, assignment 17,
  Owner redaction 18.
- Import apply maximum: 48.
- Ordinary event create/edit/place-hold: 28/34/36.
- Settings workspace read/update: 4/5; conflict-policy read/update: 4/10.
- Media upload/edit/delete/cleanup: 21/10/10/7.
- 24-block CMS page publication: 27.
- Max-host event detail/publication: 43; conflict-authorized publication: 46;
  Administrator-approved immediate publication: 49; due reconciliation: 31.

### Accessibility and keyboard verification

Target: WCAG 2.2 AA.

- axe-core 4.12.1 with Chrome 150 completed 15 exact-artifact runs: 12
  representative public/private pages at 390 CSS pixels plus Home, Events, and
  one synthetic published event detail at 1280. It reported zero violations:
  zero critical, serious, moderate, or minor.
- The original diagnostic detail page exposed one serious 1.01:1 selector
  collision. The public detail article now restores `var(--ink)` and a
  1rem base size; the rebuilt rerun reports zero violations. A source contract
  pins the fix.
- The 161 axe incomplete/manual contrast nodes remain a manual-review category
  rather than being relabelled as passes. Sampled nodes were pseudo-element
  background indeterminacy or non-text arrows; manual computed-style and
  rendered checks found no remaining text or functional-control contrast
  failure in the tested routes.
- Keyboard checks verified the first Tab reaches “Skip to main content” and
  Enter moves focus to `#page-content`; event-card navigation opens the exact
  detail; the calendar download is reachable; public-form and organizer-event
  validation focus their error summaries and exact invalid fields; genuine
  form success focuses the exact no-email confirmation; and Submissions
  assignment/status/note, Imports, CMS, Media, and Export controls remain
  operable by keyboard.
- Calendar roving focus supports arrows, Home/End, and Page Up/Down. Error
  summaries, row-local import errors, destructive confirmations, form success,
  and dialog restoration retain explicit focus behavior.
- Reduced-motion mode resolves to automatic scrolling and effectively zero
  transition duration. Statuses and outside-month dates retain non-color cues.

### Responsive and browser verification

Synthetic `.invalid` identities/data only:

- Twelve pages—Home, Events, published event detail, Contact, organizer
  Events, event create, Imports, Submissions, Content, Media, Calendar, and
  Exports—passed at exactly 320, 390, 768, 1280, and 1440 CSS pixels: 60/60
  combinations with zero essential horizontal overflow, 16px body text, and
  one main/H1.
- All 12 pages passed the 200%-zoom reflow equivalent with zero overflow.
  The only raw control below 44px was a 20px native checkbox whose associated
  clickable label measured 309x59px.
- Keyboard browser flows cover the public browse/detail/download path, public
  validation, organizer sign-in boundary, organizer event create/validation,
  and safe error recovery. The remaining real Owner, approved-artwork, and
  hosted second-identity checks stay Owner-gated below.
- A 14-page crawl covered 284 visible links and 26 unique internal targets:
  25 returned 200 and `/organizer` returned the expected 307 Sign in with
  ChatGPT redirect. Filtered ICS, public CSV, one-event ICS, the CSV template,
  and the field guide returned their correct content types and nonzero bytes.
- Visible Meetup destinations are exactly the three confirmed group URLs.
  Separate read-only network verification resolved all three to their intended
  Meetup group pages on 2026-07-29.
- Public same-origin console auditing on Home, Events, and detail found zero
  runtime exceptions, console logs, HTTP errors, or load failures. Deliberate
  malformed/denial probes remain expected negative cases.

### Local production performance

Environment: Windows 10/11 x64, Node 24.18.0, Lighthouse 13.4.1, Headless
Chrome 150.0.0.0, disposable synthetic Miniflare D1, one rebuilt-artifact run per
route/form factor. Mobile uses Lighthouse simulated throttling (150ms RTT,
1,638.4 Kbps, 4x CPU, 412x823); desktop uses 40ms RTT, 10,240 Kbps, 1x CPU,
1350x940.

Scores are Performance / Accessibility / Best Practices / SEO:

- Home mobile: exit 0; 98/100/100/100; FCP/LCP/Speed Index 1,958.8ms;
  TBT 0ms; CLS 0; TTFB 165ms; 180,061 bytes / 19 requests.
- Home desktop: valid report, cleanup exit 1; 100/100/100/100;
  FCP/LCP/Speed Index 448.1ms; TBT 0ms; CLS 0; TTFB 159ms;
  180,061 bytes / 19 requests.
- Events mobile: valid report, cleanup exit 1; 98/100/100/100;
  FCP/LCP/Speed Index 1,808.4ms; TBT 0ms; CLS 0; TTFB 120ms;
  179,522 bytes / 20 requests.
- Events desktop: exit 0; 100/100/100/100; FCP/LCP/Speed Index 447.1ms;
  TBT 0ms; CLS 0; TTFB 122ms; 170,377 bytes / 18 requests.
- Published event detail mobile: valid report, cleanup exit 1;
  98/100/100/100; FCP/LCP/Speed Index 1,811.1ms; TBT 0ms; CLS 0;
  TTFB 169ms; 180,923 bytes / 20 requests.
- Published event detail desktop: valid report, cleanup exit 1;
  100/100/100/100; FCP/LCP/Speed Index 409.3ms; TBT 0ms; CLS 0;
  TTFB 127ms; 180,923 bytes / 20 requests.

All six Lighthouse audits completed and wrote valid hash-verified JSON before
process exit. Two commands exited 0; four returned exit 1 only when Windows
blocked Lighthouse's post-report temporary-profile removal with `EPERM`.
No retry was used, no metric was inferred, and no Lighthouse/headless Chrome
process or audit helper remained.

### Dependency and supply-chain result

- Clean lockfile install: exit 0.
- `npm ls --omit=dev --all` and full `npm ls --all`: exit 0 with no missing,
  invalid, or extraneous packages.
- Production audit: exit 0, zero low/moderate/high/critical findings; four
  direct production packages and seven production nodes.
- Full audit: exit 1, 16 development/build-tool package nodes: 12 high, four
  moderate, zero low or critical. All 16 are `dev: true`; optional `sharp` is
  not packaged.
- Six underlying advisory families: brace-expansion OOM through ESLint;
  esbuild development-server cross-origin response read through drizzle-kit;
  three PostCSS stringify/source-map file-disclosure families through Next;
  and sharp/libvips through optional Next image tooling.
- Direct affected dev tools are drizzle-kit, ESLint, eslint-config-next, and
  Next; the remaining 12 nodes are transitive.
- The Sites archive contains only `dist`, not `node_modules`. Artifact scanning
  finds none of drizzle-kit, esbuild-kit, esbuild, PostCSS, minimatch,
  brace-expansion, native `sharp`, or libvips. The only `sharp` text is an
  unrelated image-URL operation flag.
- `npm audit fix --dry-run` leaves all 16 findings. npm's proposed
  Drizzle/Next/ESLint/config changes are incompatible major
  downgrades/upgrades and the vulnerable transitives are pinned outside a
  compatible range. No force, override, or frozen architecture downgrade was
  applied. Re-evaluate when aligned upstream releases exist.

### Phase 8 verification ledger

- Required clean `npm.cmd ci`: exit 0; 504 packages installed from the exact
  lockfile.
- `npm.cmd ls --omit=dev --all` and `npm.cmd ls --all`: exit 0.
  `npm.cmd audit signatures`: exit 0; 504/504 registry signatures verified
  with 120 attestations.
- `npm.cmd run typecheck`: exit 0.
- Zero-warning `npm.cmd run lint`: exit 0 before and after the exact-source
  production build.
- Deterministic serial `npm.cmd test` on source commit
  `aaeb6a648e93a7dd2e41f329085b611b8b7d10b1`: exit 0; 849 passed,
  zero failed, skipped, cancelled, or todo; 79 files; 694,572ms.
- Exact-source `npm.cmd run build`: exit 0 with Vite 8.0.16. The resulting
  `dist/server/index.js` embeds the exact source commit and has SHA-256
  `a636ee02be41e3dbf7174b5cf7408a9736d9ed4bfc370fb87ad090e49a6bdc59`.
- Exact-artifact `npm.cmd run test:rendered`: exit 0; 25 passed, zero failed
  or skipped.
- Phase 8 source/artifact interface/leakage contracts: 15/15.
- Migration/invariant/real-D1 focused matrix: 53/53; security/path/media/export
  matrix: 45/45; exact-actor/events/portal matrix: 67/67; Meetup
  sync/budget/real-D1/media matrix: 64/64; publication/CMS/scheduling matrix:
  233/233; public/events/media/forms/calendar matrix: 158/158.
- New whole-route budget closures: 9/9.
- `drizzle-kit check`: exit 0. Local and preview apply each converge through
  nine migrations to 86 tables, 249 runtime triggers, a ready invariant
  marker, and zero foreign-key violations.
- `git diff --check`: exit 0; line-ending conversion notices are not whitespace
  errors.
- Exact build inventory: 168 files / 10,171,557 bytes, zero source maps, one
  exact-source SHA embedding, and 9/9 packaged migration hashes equal to
  source.
- Final exact-source test, build, post-build lint, rendered Worker,
  artifact/package parity, axe/Lighthouse/browser checks, pushed-source
  readback, and one unpublished Sites-version readback are **Completed and
  verified**.

### Development-only behavior, links, and honest content

- Static inventory found 125 app routes and 138 literal internal references
  with zero dead references; the two non-route targets are the existing CSV
  template and field guide.
- No lorem ipsum, award/recognition/testimonial/statistic claim,
  charity/tax-deductibility/donation claim, fake email/newsletter,
  automatic-backup/restore, two-way-sync, dead `href="#"`, or fake disabled
  action remains in public-facing source.
- Current CMS starter content truthfully describes the four working forms,
  private inbox storage, no marketing/email confirmation, variable
  accessibility facts, RSVP behavior, and owner/legal review. Historical
  “forms unavailable” strings remain only as exact-match reconciliation
  constants for safe legacy adoption.
- The three seeded Meetup group destinations match `OWNER_INPUTS.md`
  byte-for-byte. No additional public Meetup destination is fabricated.
- Metadata and JSON-LD use explicit public allowlists. Unconfirmed legal,
  nonprofit, charity, venue-accessibility, and media-rights claims remain
  suppressed.

### Remaining decisions awaiting real prerequisites

- Approved-real-artwork browser smoke: **Awaiting owner smoke test**.
- Five-minute Owner smoke card: **Awaiting owner smoke test**.
- Hosted second-identity role/suspension/reassignment: **Not run**; access
  changes are not authorized.
- External private calendar-client behavior: **Implemented but not externally
  verified**; no external calendar client was connected during Phase 9.
- Venue-specific accessibility facts, approved production photography/rights,
  confirmed public contact email, and other items in `OWNER_INPUTS.md` remain
  missing owner facts; no value is invented.
- Disposable local-D1 Owner-backup restore rehearsal remains **Not run**. The
  documented backup is not an automatic or complete infrastructure restore.

## Phase 7 feature status

### CSV import

**Completed and verified.**

The implementation is constrained to:

- one local UTF-8 RFC 4180 CSV upload, maximum 2 MiB, 40 columns, 2,000
  nonblank data rows, 32 KiB normalized rows, and 10,000 Unicode characters per
  cell;
- a self-contained versioned template and downloadable field guide;
- allowlisted mapping, visible defaults, normalized persisted preview, exact
  preview fingerprint, validation, duplicate warnings, conflict preview, and
  no event/public mutation before approval;
- deterministic non-null CSV source namespaces when `external_id` is used;
- current Owner/Administrator approval only;
- one authoritative Phase 4 scheduling-write envelope per applied row;
- durable idempotency, cursor, lease, per-row result, interruption/resume, and
  no automatic conflict retry;
- private events only; import never publishes or overwrites;
- Owner-only terminal source-payload redaction after 90 days.

The parser, preview, approval, application, history, route/UI, conflict,
concurrency, redaction, real-D1 compatibility, and dense-limit focused matrix
passed 98/98. The measured worst complete apply route is 47 D1 statements,
below the 50-statement Worker limit. The deterministic clean-install repository
matrix passed 737/737 with no failures, skips, or todos.

### Public downloads, private exports, and calendar subscriptions

**Completed and verified locally. The external calendar-client seam is
implemented but not externally verified.**

Current source includes:

- one-event public ICS;
- filtered public ICS and CSV with bounded max-plus-one rejection;
- Owner/Administrator operational CSV;
- Owner-only `vcc-owner-backup-v1` JSON and safe media manifest;
- Owner-authenticated original-media download by asset ID;
- revocable read-only private calendar subscriptions using one-time raw
  256-bit tokens and stored lowercase SHA-256 hashes;
- separate persisted public/private calendar component revisions with opaque
  UID, exact emitted-VEVENT fingerprint, signed 32-bit sequence, and monotonic
  last-modified time.

External calendar-client behavior is **Implemented but not externally
verified** while Phase 7 remains unpublished.

### Public forms and private submissions

**Completed and verified locally.**

Current source includes:

- Contact, Volunteer, Host an Event, and Venue or Community Partnership forms;
- bounded plain-text validation, same-origin protection, signed time-bounded
  form instances, honeypot/minimum-time redacted spam receipts, anonymous
  HMAC-derived rate scopes, durable D1 limits, and request idempotency;
- atomic base submission, canonical workflow, minimum-safe notifications, and
  audit receipt;
- private Owner/Administrator inbox plus assignment-scoped Organizer access;
- New, In Review, Responded, and Archived workflow;
- append-only private notes;
- received-date filtering and bounded pagination;
- 365-day retention-review flags;
- Owner-only irreversible personal-content redaction.

The focused form/submission service, route, UI, real-D1, redaction, and
whole-request budget gates are green. The largest public form Worker path
measured 16 D1 statements, below the 50-statement limit. Rendered and browser
checks verified the single-main compositions, unique form IDs, focused error
summary, field errors with preserved values, and the exact post-commit
private-inbox/no-email success message.

### Existing CMS intake-copy adoption

**Completed and verified.**

Fresh catalog starter copy truthfully describes the four working forms and no
email confirmation. A versioned one-page-per-request CMS save/publish upgrader
patches only the exact four legacy starter strings and matching exact starter
metadata. It preserves owner edits, skips a newer Owner draft, uses the normal
CAS/receipt/materialization path, marks completion only after all four pages,
and is idempotent. Fresh seed, exact-legacy upgrade, owner-edit preservation,
newer-draft skip, idempotency, and public parity passed 5/5.

## Migration and runtime-invariant status

- The sole Phase 7 migration is
  `drizzle/0016_phase7_import_export_forms.sql`; no `0017` is authorized.
- The Phase 7 migration and `drizzle/meta/0016_snapshot.json` are frozen.
- Current frozen-source provenance:

  - `0016` SQL SHA-256:
    `543b5a386961d169926216890079cb4ae1738aac8d4f01582d7d30018418b377`
  - `0016` snapshot SHA-256:
    `5c7e90c362afc5eb75995e8349648b2fca7299300910c731d6cc3d30cf096b77`
  - journal SHA-256:
    `1979ea18d896ad101299876b8b4cb59645ec1720c457cdf0d030d977fc83aa9f`
  - schema signature: 86 tables, 243 checks, 298 foreign keys, 199 explicit
    indexes, 79 unique indexes, and zero packaged triggers
  - schema/migration statement parity: 285/285 with zero mismatches
  - tokenizer/partial-prefix/package parity: passed
- The runtime invariant contract advances from the completed Phase 6 version to
  Phase 7. The current fingerprint is
  `94aa90e191244072d66fb3f77575e56064ef8478660d7778c3c4b473f632582b`.
  It installs 249 global triggers, including 36 Phase 7 triggers, and seven
  Phase 7 integrity counts. Empty convergence is nine requests; the
  12-profile legacy-attribution plus taxonomy path is 23; the worst repair
  request is 46 statements.
- `npm.cmd run db:generate` exited 0 with no schema changes, and
  `drizzle-kit check` exited 0.
- Local and preview migration application each exited 0 with nine migrations,
  86 tables, all 249 expected triggers installed, bounded
  repaired-to-ready convergence, and zero foreign-key violations.
- Migration coverage includes clean, populated prior-phase, archived-legacy,
  idempotent reapply, every partial-prefix retry cut, tokenizer, concurrent
  invariant installation, package equality, foreign-key checks, and exact
  snapshot/schema agreement.

## D1, R2, authentication, and authorization

- D1 remains the only application database, bound as `DB`.
- R2 remains the only media store, bound as `MEDIA`; raw object keys are
  private. Phase 7 media backup resolves authenticated Owner downloads by
  allowlisted asset ID.
- Sign in with ChatGPT remains the organizer identity boundary.
- Owner, Administrator, Organizer, and public capabilities are enforced on the
  server. Crafted organization, profile, event, batch, row, submission, token,
  media, or role values must not widen access.
- Import, form, submission, token, and export writes use bounded D1 batches and
  completion sentinels rather than treating a post-commit `meta.changes` check
  as rollback.
- Every measured Phase 7 Worker invocation stays below 50 D1 statements. Exact
  invariant-plus-maintenance-plus-route totals are: public ICS 9, public CSV 7,
  operational CSV 6, Owner backup 23, media manifest 6, media download 6,
  calendar-token create 6, private feed 7, and token revoke 7. The import apply
  maximum is 47 and the public-form maximum is 16.
- Public-form protection keys, raw tokens, token hashes, rate fingerprints,
  private Meetup feed addresses, and R2 keys are excluded from ordinary
  settings, logs, errors, exports, and client bundles.

## Import validation, idempotency, and conflict status

- The strict parser covers BOM/RFC 4180 quoting, embedded commas/newlines,
  duplicate headers, invalid UTF-8/NUL, binary/HTML/XML/ICS/JSON masquerades,
  row/column/cell/file limits, normalized-payload byte limits, DST gaps and
  ambiguity, canonical URLs, lifecycle and mapping constraints, normalized
  co-organizer sets, and deterministic final-payload fingerprints.
- Preview persists only allowlisted mapped facts and does not create events,
  organizers, venues, revisions, source links, conflict facts, or public
  projections.
- An external ID requires a deterministic CSV source namespace. Duplicate
  safety does not rely on a nullable SQLite unique key.
- Import application uses the authoritative Phase 4 service. Warn-and-reason,
  administrator-review, and blocked collisions retain their exact existing
  meanings.
- Per-row application, source link, result, and batch cursor/count updates must
  be atomic and idempotent.
- Terminal import and 90-day Owner source redaction are covered, including
  Administrator/Organizer denial, exact-90-day acceptance, zero-row terminal
  batches, and irreversible bounded postcondition checks.

## Export and privacy status

- All Phase 7 download formats use explicit field allowlists and bounded
  max-plus-one reads.
- CSV output neutralizes spreadsheet formula prefixes before RFC 4180 quoting.
- Public downloads use only verified current public event projection fields.
- Operational CSV excludes organizer email, meeting credentials, conflict
  reasons, identity/invitation data, tokens, source-feed secrets, submissions,
  and generic audit payloads.
- The Owner backup uses export-local `member-N` references and contextual
  nested sanitizers. It excludes email/provider identity, invitations,
  sessions, tokens and hashes, private feed addresses, form/rate/protection
  state, notifications, generic audits, runtime values, credentials, and R2
  keys.
- The backup is not an infrastructure backup and has no automatic or in-app
  restore. Disposable local-D1 restore rehearsal: **Not run**.
- Source and exact-build output privacy scans found no credential, email,
  private-feed, raw-token, R2-key, form/import sentinel, local-path, environment
  file, local database, or private client-bundle leak.
- The exact pushed-source artifact contains 165 files and 10,108,055 source
  bytes. Its canonical sorted path/size/content SHA-256 is
  `3a15e80cd009736fff61f5fda7d03eb96b3455f56e238c47dca5c30d974db7e9`.
  The compressed archive is 2,484,680 bytes with SHA-256
  `584eed6a914c89f096ac18d2afe0d5b6788e5f3ec6f9a1d8a5b69aed5b6aa5ab`.
  Archive extraction matched the exact build 165/165 with zero missing, extra,
  or content-mismatched files.

## Phase 7 verification ledger (preserved history)

Completed verification checkpoints:

- complete focused Phase 7 matrix: 124/124 passed;
- import parser/UI/atomicity/real-D1/scheduling matrix: 98/98 passed;
- non-import read-only audit matrix: 53/53 passed;
- private-calendar denial and exact export/calendar route-budget matrix: 19/19
  passed, including real Miniflare D1;
- CMS exact-legacy starter-copy upgrade: 5/5 passed;
- migration/tokenizer/invariant/runtime-D1 audit: green with zero foreign-key
  and invariant violations;
- `npm.cmd ci`: exit 0; 503 packages installed;
- `npm.cmd ls --depth=0`: exit 0 with a clean npm dependency tree;
- `npm.cmd run typecheck`: exit 0;
- zero-warning `npm.cmd run lint` before and after build: exit 0;
- deterministic `npm.cmd test`: exit 0; 737 passed, zero failed, skipped, or
  todo;
- `npm.cmd run build`: exit 0;
- `npm.cmd run test:rendered`: exit 0; 25 passed, zero failed, skipped, or
  todo;
- `git diff --check`: exit 0 at the verified source checkpoint;
- production `npm.cmd audit --omit=dev --json`: exit 1 with 709 dependencies,
  three high findings and zero low, moderate, or critical findings (`next`
  direct; `postcss` and `sharp` transitive);
- complete `npm.cmd audit --json`: exit 1 with 709 dependencies and 18
  findings: one low, four moderate, 13 high, and zero critical.

The audit findings are recorded for the dedicated Phase 8 hardening phase; no
forced incompatible dependency upgrade was applied.

Local browser verification used synthetic `.invalid` identities only:

- 320, 390, 768, 1280, and 1440 pixel widths had no essential horizontal
  overflow, exactly one `main`, and the established skip target;
- Get Involved rendered both forms with unique IDs; Contact, Host, and Privacy
  content remained inside the canonical main landmark;
- an invalid Contact attempt focused the accessible error summary, rendered
  field-specific errors, and preserved entered values;
- a legitimate local Contact attempt focused the success region only after the
  D1 commit and used the exact private-inbox/no-email copy;
- public ICS and CSV downloads completed;
- the browser emitted zero warnings or errors;
- a signed-out organizer import request redirected to Sign in with ChatGPT.

Phase 7 intentionally did not run Lighthouse or a synthetic performance score;
the Phase 8 measurements above supersede that historical limitation.
Approved-real-artwork smoke remains **Awaiting owner smoke test**.

## Authorized cuts and known limitations

- **ICS file import — Not implemented — authorized cut.**
- Downloadable QR generation — **Not implemented — authorized cut.**
- Daily notification digests — **Not implemented — authorized cut.**
- Weekly notification digests — **Not implemented — authorized cut.**
- Editor role — **Not implemented — authorized cut.**
- Viewer role — **Not implemented — authorized cut.**
- Realtime subscriptions — **Not implemented — authorized cut.**
- CSV import has no overwrite/update/merge mode and never publishes.
- No email or form-confirmation email is sent.
- No newsletter enrollment is performed.
- Backups are Owner-run; no automatic backup, scheduler, or automatic restore
  is claimed.
- Retention review is flagged; there is no automatic purge.
- The private calendar is read-only and not a two-way sync.
- External calendar-client behavior is **Implemented but not externally
  verified**; no external calendar client was used in Phase 9.
- Owner backup deliberately excludes identity, tokens, source-feed secrets,
  public forms, and rate-limit state.
- Approved-real-artwork browser smoke — **Awaiting owner smoke test**.
- Missing approved real artwork remains an owner input. Synthetic local
  non-person fixtures verify mechanics only.

## Source, build, Sites, and live-state provenance

The Phase 7 and Phase 8 lines below preserve their historical save-checkpoint
state. Phase 9 deployed version 14; the later owner-directed month-calendar
release is the current version-16 production state recorded afterward.

- Phase 7 saved source commit: `f39fcb3fc6ab97a21fa8cc00d3b180f5ccf84842`
- Phase 7 status-only ledger commit:
  `abedfca034f063b467fe381292fa5e0d29cca3f9`
- Exact pushed `refs/heads/main` readback:
  `f39fcb3fc6ab97a21fa8cc00d3b180f5ccf84842`
- Exact Phase 7 production archive:
  SHA-256
  `584eed6a914c89f096ac18d2afe0d5b6788e5f3ec6f9a1d8a5b69aed5b6aa5ab`,
  2,484,680 compressed bytes, 165 files
- New unpublished Phase 7 Sites version: `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_34386dc8a6b88191bff111eb49b8de7c`
- Version number: 13
- Version source commit:
  `f39fcb3fc6ab97a21fa8cc00d3b180f5ccf84842`
- Version content hash:
  `sha256:509d83482466740e5c4b5755ef1d55c6f2c5eb32ab9702b12e86347c91953f61`
- Version readback: 165 files / 10,240,000 stored bytes / null screenshot /
  no preview URL
- Deployment: **Not run**
- Preview deployment: **Not run**
- Live-access change: **Not run**

Sites readback after the single save confirmed the required project, exactly
versions 1–13 with one version 13, the unchanged live URL, no preview URL, no
custom domains, and custom access revision 1 with exactly one allowed user and
zero account, workspace, or tenant groups. No deploy, preview, access, domain,
binding, runtime, D1, or R2 mutation was invoked. The connector exposes the
live URL but not its deployed-version number; the established ledger records
live version 8, and the unpublished save did not alter production.

Current Sites identity:

- project ID: `appgprj_6a62eaf79c4881919bb8e47998af851a`;
- logical D1 binding: `DB`;
- logical R2 binding: `MEDIA`;
- live public version: 16;
- access: public revision 2; one project Owner and zero groups;
- custom domains: none;
- preview URL: none;
- runtime revision: 1 with only the redacted `INITIAL_OWNER_EMAIL` value.

Exactly one unpublished Phase 8 Sites version was saved after every Phase 8
gate was green. It was not deployed during Phase 8; Phase 9 later deployed
that exact saved version without creating another version.

### Phase 8 source/save checkpoint

- Phase 8 substantive source commit: `aaeb6a648e93a7dd2e41f329085b611b8b7d10b1`
- Phase 8 pushed `refs/heads/main` readback:
  `aaeb6a648e93a7dd2e41f329085b611b8b7d10b1`
- Exact Phase 8 production archive: SHA-256
  `50ae0f49e078da9f44488fe4a115b4b5670b7f70f13c435013e310e097fbcbb0`,
  2,494,040 compressed bytes, 168 files / 10,171,557 staged bytes, 184 tar
  entries, one `dist/` root, and 9/9 source-equal migrations.
- Saved Sites version 14: `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_69aafba5ef148191b00042bce388a678`
- Version 14 source commit:
  `aaeb6a648e93a7dd2e41f329085b611b8b7d10b1`
- Version 14 content hash:
  `sha256:0b65ec790f59acd1ceb1d8ac62350e8914352c6b251aa78ecefbf743c81505d1`
- Version 14 readback: 168 files / 10,311,680 stored bytes / null
  screenshot / no preview URL.
- Phase 8 status-only ledger commit:
  `23b7b6e57bb0ced218cc75311755e2609a224105`
- Phase 9 deployment:
  `appgdep_6a6a8ade7fa08191a6c1a21cf7d1f0b9`, terminal `succeeded`
- Phase 9 status-only documentation ledger commit:
  `3a89dfee4423446a947121d9cc7462e2a0f0911e`
- Preview deployment: **Not run**
- Live access/domain/binding/runtime/R2 change: **Not run**
- Hosted D1 effects: bounded migration/invariant readiness,
  Owner/organization/catalog bootstrap, exact-match CMS copy upgrade, and
  form-protection key/cookie checks, plus one clearly labelled private
  production-smoke Draft that was verified nonpublic, archived, and moved to
  deleted items. No public projection, submission, import, media asset,
  invitation, notification, calendar token, or Meetup source was created.

Phase 8 pre/post-save readback confirmed exactly versions 1–14 with one version
14, the unchanged live URL, no preview URL, no custom domains, custom access
revision 1 with exactly one allowed owner and zero groups, and runtime revision
1 with only the redacted `INITIAL_OWNER_EMAIL` key. Phase 9 then deployed that
exact version 14 through the private deployment operation. Post-deployment
readback retained the same access, domain, preview, runtime, and binding state.

### Owner-directed calendar-first version 15 release

- Exact substantive source commit:
  `af3477b439a1e06b07a077747f903643abb7da09`
- Exact pushed `refs/heads/main` readback:
  `af3477b439a1e06b07a077747f903643abb7da09`
- Exact production archive: SHA-256
  `e31fd4006bead100a61e5131022665c0cf989a61e0a8d5fe4722b077c1f07df5`,
  2,510,890 compressed bytes, 186 tar entries, one `dist/` root, and source-
  equal packaged migrations `0008` through `0016`.
- Saved Sites version 15:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_55bc8063b394819187383a908b631554`
- Version 15 source commit:
  `af3477b439a1e06b07a077747f903643abb7da09`
- Version 15 content hash:
  `sha256:2dbb36488593cbe050120c6888139beccbdb31c970d743ce3ea2b2caa26d226a`
- Version 15 readback: 170 files / 10,373,120 stored bytes / screenshot
  available / no preview URL.
- Private deployment:
  `appgdep_6a6ba12078f08191bfd0693e7726921a`, terminal `succeeded`.
- Access readback: custom revision 1, exactly one allowed owner, zero groups,
  no custom domain, no preview URL, runtime revision 1, and unchanged `DB` /
  `MEDIA` logical bindings.
- Subsequent explicit Owner access change: public revision 2. No version,
  deployment, domain, preview, runtime, binding, D1, or R2 change accompanied
  the access update.
- Anonymous production checks: Home, Calendar, Events, robots, and sitemap
  returned `200`; `/organizer` retained its Sign in with ChatGPT redirect;
  the organizer API returned `401`; and a guessed private-calendar token
  returned `404` with private/no-store/noindex headers.
- The current status-only documentation ledger commit is reported in the
  terminal handoff because a commit cannot contain its own hash.

### Owner-directed month-calendar and Meetup-poster version 16 release

- Exact substantive source commit and pushed `refs/heads/main` readback:
  `27f6d319544e430aeae1c4367528b30c54fbd6a4`.
- Exact local production archive: SHA-256
  `05c84e6bd8b0258c7919a66d6d4c48933ce8a9463fee7aaa5b5feb38c5bea112`,
  3,099,796 compressed bytes, 198 tar entries, one `dist/` root, and 9/9
  source-equal packaged migrations `0008` through `0016`.
- Saved Sites version 16:
  `appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_a0313813e8d481918a8d9d309560edc8`.
- Version 16 source commit:
  `27f6d319544e430aeae1c4367528b30c54fbd6a4`.
- Version 16 content hash:
  `sha256:e7b247f6e44cec2a448620f7148373ef4fdf29f4e2fd834b9dde25e055e6e795`.
- Version 16 readback: 181 files / 10,977,280 stored bytes / screenshot
  available / no preview URL.
- Production deployment:
  `appgdep_6a6c4cf1f870819189cc2cb3d7803064`, terminal `succeeded`,
  at `https://vancouver-curiosity-club.reza5777.chatgpt.site`.
- Post-deployment readback retained public access revision 2, one project
  Owner, zero groups, no custom domain, no preview, runtime revision 1, and
  unchanged logical `DB` / `MEDIA` bindings.
- Production browser checks confirmed the canonical August month calendar,
  eight populated dates with titles at 1280px and 768px, readable dot/count
  cells with full tap detail at 390px and 320px, non-underlined title hover,
  11 source-backed event posters including Cicero, no horizontal overflow,
  and zero browser-console warnings or errors.
- The status-only documentation ledger commit is reported in the terminal
  handoff because a commit cannot contain its own hash.

## Five-minute Phase 9 Owner smoke-test card

Overall status: **Awaiting owner smoke test.**

1. Sign in as the Owner.
2. Confirm the exact production URL opens version 16 without a visitor login,
   while Organizer Login still requires Sign in with ChatGPT.
3. At 320px and 390px, browse Home, Events, Contact, and organizer Calendar;
   confirm no horizontal overflow or clipped focus.
4. Open one real published event and verify its individual Meetup destination,
   or record **Not run — no approved real published event**.
5. Using only the keyboard, review organizer Calendar, Events, Conflicts,
   Imports, Submissions, Content, Media, and Exports without committing
   synthetic production data.
6. Trigger one private-event validation error and confirm the error summary
   and exact field errors receive useful focus and persist no event.
7. Verify a guessed draft, submission, import, token, private feed, backup, or
   media-original URL reveals no private data.
8. Review the empty Media library and leave approved-real-artwork review
   pending until real rights/consent facts and artwork are supplied.
9. Confirm no venue, charity, award, email, automatic-backup, two-way-sync, or
   response-time claim appears without an approved fact.
10. Confirm version 16 remains active with public visitor access, one project
    Owner, zero groups, no custom domain, and no preview deployment.

## Exact next phase and stop condition

- Phase 7 is completed and verified for its authorized scope.
- Phase 8 is **Completed and verified** for its authorized scope.
- Phase 9 is **Completed and verified** for its authorized private-deployment
  and production-verification scope.
- Owner smoke status remains **Awaiting owner smoke test**.
- Approved-real-artwork review remains **Awaiting owner smoke test**.
- This is the final planned build phase. No Phase 10 is started or authorized.
