# Vancouver Curiosity Club — Build Status

Last updated: 2026-07-28 (America/Vancouver)

## Active phase and release state

- **Active phase: Phase 7 — Imports, exports, calendars, and public forms.**
- Phase 6 is **Completed and verified** for its authorized scope.
- Phase 7 implementation is in progress. The final migration freeze, complete
  repository matrix, production build, rendered/browser verification, package
  inventory, source commit, and Sites save have not yet completed.
- **Phase 8 — Not started.**
- No Phase 7 deployment, preview deployment, access-policy change, domain
  change, binding change, runtime-value change, or hosted D1/R2 data mutation
  has been performed.
- The existing owner-only live deployment remains version 8 at
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`.
- Phase 7 is not viewable at that live URL unless a later separately authorized
  deployment occurs.

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

## Phase 7 feature status

### CSV import

**Implemented and focused-verified; final exact-source repository verification
is pending.**

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
passed 98/98 on the current source. The measured worst complete apply route is
47 D1 statements, below the 50-statement Worker limit. The final clean-install
repository matrix remains pending.

### Public downloads, private exports, and calendar subscriptions

**Implemented but not externally verified.**

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

The current Phase 7 focused matrix passed 124/124 across import, calendar,
export, form, submission, migration, invariant, D1, concurrency, overflow,
post-2038, privacy, and tamper cases.
External calendar-client behavior is **Implemented but not externally
verified** while Phase 7 remains unpublished.

### Public forms and private submissions

**Implemented but not externally verified.**

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
whole-request budget gates are green on the current working tree. The largest
public form Worker path measured 16 D1 statements, below the 50-statement
limit. Final rendered and browser gates remain to be run.

### Existing CMS intake-copy adoption

**Implemented and focused-verified.**

Fresh catalog starter copy truthfully describes the four working forms and no
email confirmation. A versioned one-page-per-request CMS save/publish upgrader
patches only the exact four legacy starter strings and matching exact starter
metadata. It preserves owner edits, skips a newer Owner draft, uses the normal
CAS/receipt/materialization path, marks completion only after all four pages,
and is idempotent. Fresh seed, exact-legacy upgrade, owner-edit preservation,
newer-draft skip, idempotency, and public parity passed 5/5.

## Migration and runtime-invariant status

- The sole Phase 7 migration is intended to remain
  `drizzle/0016_phase7_import_export_forms.sql`; no `0017` is authorized.
- The Phase 7 migration and `drizzle/meta/0016_snapshot.json` are frozen for
  the source-commit gate. Final exact-commit repetition is still required.
- Current frozen-source provenance:

  - `0016` SQL SHA-256:
    `543b5a386961d169926216890079cb4ae1738aacd4f01582d7d30018418b377`
  - `0016` snapshot SHA-256:
    `5c7e90c362afc5eb75995e8349648b2fca7299300910c731d6cc3d30cf096b77`
  - journal SHA-256:
    `1979ea18d896ad101299876b8b4cb59645ec1720c457cdf0d030d977fc83aa9f`
  - schema signature: 86 tables, 243 checks, 298 foreign keys, 199 explicit
    indexes, 79 unique indexes, and zero packaged triggers
  - schema/migration statement parity: 285/285 with zero mismatches
  - tokenizer/partial-prefix/package parity: passed on the source-freeze
    checkpoint
- The runtime invariant contract advances from the completed Phase 6 version to
  Phase 7. The current fingerprint is
  `94aa90e191244072d66fb3f77575e56064ef8478660d7778c3c4b473f632582b`.
  It installs 249 global triggers, including 36 Phase 7 triggers, and seven
  Phase 7 integrity counts. Empty convergence is nine requests; the
  12-profile legacy-attribution plus taxonomy path is 23; the worst repair
  request is 46 statements. Final exact-commit repetition remains required.
- Every final migration test must cover clean, populated prior-phase,
  archived-legacy, idempotent reapply, every partial-prefix retry cut,
  tokenizer, concurrent invariant installation, package equality,
  foreign-key checks, and exact snapshot/schema agreement.

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
- The final public-projection and built-output leakage scans are **Not run** on
  the final Phase 7 artifact.

## Verification ledger

Completed focused checkpoints on the current working tree:

- complete focused Phase 7 matrix: 124/124 passed;
- import parser/UI/atomicity/real-D1/scheduling matrix: 98/98 passed;
- non-import read-only audit matrix: 53/53 passed;
- private-calendar denial and exact export/calendar route-budget matrix: 19/19
  passed, including real Miniflare D1;
- CMS exact-legacy starter-copy upgrade: 5/5 passed;
- migration/tokenizer/invariant/runtime-D1 audit: green with zero foreign-key
  and invariant violations;
- typecheck: passed;
- zero-warning lint: passed;
- `git diff --check`: passed at the last checkpoint.

Final required commands on the frozen exact source:

- `npm.cmd ci` — **Not run**
- final `npm.cmd run db:generate`/snapshot parity — **Not run**
- `npm.cmd run db:apply:local` — **Not run**
- `npm.cmd run db:apply:preview` — **Not run**
- `npm.cmd run typecheck` — **Not run**
- zero-warning `npm.cmd run lint` before build — **Not run**
- full deterministic `npm.cmd test` — **Not run**
- `npm.cmd run build` — **Not run**
- zero-warning lint after build — **Not run**
- `npm.cmd run test:rendered` — **Not run**
- production dependency audit — **Not run**
- complete dependency audit — **Not run**
- final `git diff --check` — **Not run**
- migration/package/snapshot equality and interruption retries — **Not run**
- source and built-output privacy/credential scans — **Not run**
- exact archive inventory and packaged migration parity — **Not run**
- browser/accessibility verification at 320, 390, 768, 1280, and 1440 pixels
  — **Not run**

No final Phase 7 pass/fail/skip totals, command exit codes, build result,
accessibility measurements, SQL maxima, request counts, or dependency-audit
counts will be entered until measured from the frozen source.

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
  verified** before a future authorized deployment.
- Owner backup deliberately excludes identity, tokens, source-feed secrets,
  public forms, and rate-limit state.
- Approved-real-artwork browser smoke — **Awaiting owner / not run**.
- Missing approved real artwork remains an owner input. Synthetic local
  non-person fixtures verify mechanics only.

## Source, build, Sites, and live-state provenance

- Phase 7 saved source commit: **Not run**
- Phase 7 status-only ledger commit: **Not run**
- Exact pushed source readback: **Not run**
- Exact Phase 7 production archive: **Not run**
- New unpublished Phase 7 Sites version: **Not run**
- Version number/opaque ID/content hash/file count/bytes/screenshot state:
  **Not run**
- Deployment: **Not run**
- Preview deployment: **Not run**
- Live-access change: **Not run**

Required immutable Sites identity:

- project ID: `appgprj_6a62eaf79c4881919bb8e47998af851a`;
- logical D1 binding: `DB`;
- logical R2 binding: `MEDIA`;
- live owner-only version: 8;
- access: one allowed owner, zero groups;
- custom domains: none;
- preview URL: none;
- runtime revision: 1 with only the redacted `INITIAL_OWNER_EMAIL` value.

At most one new unpublished Sites version may be saved after every final gate
is green. It must not be deployed.

## Five-minute Owner smoke-test card

Overall status: **Awaiting owner smoke test.**

1. Sign in as the Owner.
2. Download the CSV template.
3. Upload a CSV containing one valid private Draft, one invalid row, one hard
   duplicate, and one possible scheduling conflict.
4. Confirm preview clearly distinguishes all four rows.
5. Confirm the Events count and calendar remain unchanged before approval.
6. Approve only the valid row.
7. Confirm one event is created, remains private, and its per-row result is
   durable after refresh.
8. Retry/resume and confirm no duplicate event appears.
9. Submit one public Contact form.
10. Confirm success appears only after storage and says no email was sent.
11. Open Submissions and verify only an authorized user can see the message.
12. Assign it to an Organizer and confirm another unassigned Organizer cannot
    read it.
13. Mark it In Review and Responded; confirm the site does not claim it sent a
    response.
14. Download one-event ICS and filtered public CSV/ICS; inspect them for private
    fields.
15. Generate the Owner JSON backup and confirm it contains no emails, tokens,
    credentials, form submissions, private feed addresses, or R2 keys.
16. Create a private calendar token, copy it once, revoke it, and confirm the
    revoked URL is denied.
17. Confirm the live owner-only URL still serves version 8 and was not changed
    by Phase 7.

Items that require Phase 7 to be accessible through hosted infrastructure are
**Awaiting a future authorized deployment**. They are not marked passed by
local implementation or an unpublished Sites save.

## Exact next phase and stop condition

- Finish and verify exactly Phase 7.
- Save at most one valid unpublished Sites version only after every gate is
  green.
- Do not deploy.
- Owner smoke status remains **Awaiting owner smoke test**.
- **Phase 8 — Not started.**
