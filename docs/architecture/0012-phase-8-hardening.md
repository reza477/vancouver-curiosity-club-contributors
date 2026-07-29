# ADR 0012: Phase 8 security and release hardening

Status: Accepted and implemented; measured evidence belongs in
`BUILD_STATUS.md`

Date: 2026-07-29

## Context

Phases 1 through 7 established the public projection, private organizer
workspace, conflict engine, publication workflow, CMS and media library, CSV
imports, exports, calendars, public forms, and private submissions inbox.
Phase 8 hardens those existing contracts. It does not add a new product phase,
replace Sites, or authorize deployment.

The application runs as a vinext Cloudflare Worker with Sites-managed D1 and
R2. D1 has no row-level security and permits at most 50 statements in one
Worker invocation. A request may also cross more than one asynchronous read,
so authorization at the beginning of a service is not sufficient by itself:
membership, assignment, publication, receipt, media, or token state can change
before a response or mutation commits.

The public and private shells share one Worker entry point. Route
classification therefore has to use the same canonical pathname that the
router receives. Classifying a raw encoded path while routing a decoded path
would allow encoded organizer, API, invitation, or private-calendar paths to
receive public caching or referrer behavior.

## Decision

### Sites and phase boundary

Sites remains the only host. The project continues using the existing logical
`DB` and `MEDIA` bindings and platform-owned Sign in with ChatGPT. Phase 8 does
not create or change a deployment, preview deployment, access policy, domain,
runtime value, hosted D1 database, or R2 bucket.

Phase 8 changes no D1 schema. The additive migration chain still ends at:

```text
drizzle/0016_phase7_import_export_forms.sql
```

There is no `0017`. Runtime authorization and integrity guards may be repaired
through the existing fingerprinted, fail-closed initializer, but a request is
not allowed to treat a partial installation as ready.

### Canonical request classification and response headers

The Worker decodes each pathname segment once, normalizes Unicode to NFC, and
rejects malformed encoding, residual percent escapes, controls, encoded URL
delimiters, slash or backslash ambiguity, dot segments, empty segments, and
overlong paths before application dispatch. The resulting canonical pathname
drives routing, private/identity classification, invitation-token capture,
maintenance, trusted server-component context, safe error labels, cache
policy, robots policy, and referrer policy.

Private calendar token paths are represented in diagnostics by the constant
route label `/api/calendar/private/[token]`, never by the token-bearing
pathname.

The production Worker supplies a nonce-based practical CSP:

- `default-src 'self'`;
- `base-uri 'none'`;
- `form-action 'self'`;
- `frame-ancestors 'none'`;
- self-only script and connection sources, with a per-response nonce and
  `strict-dynamic` for framework bootstrap scripts;
- no script attributes or objects;
- self/data/blob sources only where the application needs them; and
- `upgrade-insecure-requests`.

Local development alone retains the inline/eval and WebSocket allowances
needed by hot module replacement. Production responses also set MIME-sniffing,
framing, referrer, permissions, opener/resource isolation, and HTTPS
transport headers. Private/identity responses, errors, and previews remain
no-store and noindex. The CSP continues to allow inline styles because the
current framework and generated style path require them; executable inline
scripts are not broadly allowed in production.

### Exact actor and state seals

Sign in with ChatGPT establishes identity, not authorization. Every protected
operation roots its SQL in the current active, nondeleted profile and
same-organization membership. Role, club assignment, submission assignment,
ownership, and entity organization are checked on the server.

For a multi-read response, the final data query includes the current actor and
scope proof where practical. Otherwise the service performs a compact exact
revalidation immediately before returning. A service fails closed when the
actor is suspended, removed, reassigned, demoted, moved to another
organization, or loses the required club or submission assignment between
reads.

Publication, public-event enrichment, public calendar generation, media byte
serving, and other projection-sensitive reads carry exact state, revision,
receipt, or projection tokens across stages. The final stage revalidates those
tokens. Missing or changed proof suppresses the result rather than returning a
stale public or private DTO.

Concurrency-sensitive writes use D1 `batch()` with conditional mutation and an
in-batch completion sentinel. Post-commit `meta.changes` is not treated as a
rollback mechanism. Audit, notification, receipt, source-link, and state
changes cannot commit when the guarded action did not occur.

### D1 request discipline

The 50-statement limit applies to the whole Worker invocation, including
invariant preflight, request maintenance, layout/page loaders,
authorization, service reads, writes, audits, and final seals. Tests count
complete routes, not only helpers. New final seals are folded into the last
data statement where possible; a separate seal is accepted only when the
measured worst-case route remains below the cap with useful margin.

Set-based `json_each` statements remain the preferred bounded mechanism for
large import, association, notification, and conflict sets. SQL byte size,
bind count, expression depth, function arity, row/value limits, result limits,
and connection concurrency are measured in addition to statement count.

### Public, private, R2, token, and log boundaries

Anonymous HTML, metadata, JSON-LD, sitemap, robots output, redirects, errors,
ICS, CSV, media, and API responses use explicit field allowlists. They never
serialize a complete D1 row or private application model. Drafts, Ideas,
Holds, confirmed-but-unpublished records, previews, private notes, conflict
facts, identities, memberships, invitations, submissions, audits, raw or
hashed tokens, private Meetup feed addresses, runtime values, and R2 object
keys remain outside every public surface and public cache.

D1 holds opaque R2 object keys and media safety state. Public media resolves
only an approved public variant with an exact current published usage. Private
originals and variants require current authorized membership and role. The
service revalidates the exact D1 media proof after `MEDIA.get()` and before
returning bytes so a rights, consent, usage, actor, or organization change
during the R2 read fails closed. Routes accept allowlisted asset and variant
identifiers, never arbitrary object keys.

Raw invitation and private-calendar tokens are transient bearer values. Only
their hashes are stored. Token-bearing paths, cookies, feed URLs, identity
headers, form content, note bodies, private source payloads, and R2 keys are
excluded from structured logs, safe errors, audit metadata, downloads, and
client bundles. Production errors expose a stable safe code and generic
message rather than SQL, identity, existence, or object-storage detail.

Rich public content remains structured and allowlisted. Submitted and private
text remains plain text. No route renders caller-supplied executable HTML.

### Accessibility, responsive behavior, and performance

WCAG 2.2 AA is the target. Automated checks and manual keyboard checks are both
required. Essential routes must retain one skip target and main landmark,
logical headings, visible focus, accessible names, explicit labels and error
summaries, useful announcements, non-color status cues, reduced-motion
behavior, and focus restoration for dialogs and destructive actions.

Responsive verification uses exactly 320, 390, 768, 1280, and 1440 CSS pixels,
plus 200% zoom. It covers public browsing and event detail, the sign-in
boundary, organizer agenda and event editing, conflict review, imports,
submissions, CMS/media, forms, and downloads. Static source assertions do not
replace browser behavior.

Performance measurements run against a fresh local production build, not the
development server. The report records the exact tool, version, machine,
viewport, pages, runs, scores, and web-vital measurements. The specification's
scores are optimization targets, not assertions. Private caching remains
no-store even when a broader cache could improve a synthetic score.

### Dependency and artifact boundary

Dependency remediation prefers compatible direct upgrades that preserve the
Sites/vinext architecture. There are no forced major upgrades, blanket
overrides, audit suppressions, or severity re-labelling. Production and
complete-tree audits are reported separately, with package/advisory,
reachability, and residual rationale recorded in `BUILD_STATUS.md`.

The final build must come from the exact committed source bytes. Source maps,
environment files, local D1/R2 state, logs, test identities, fixtures, runtime
values, secrets, and temporary browser artifacts are excluded from the Sites
archive. An unpublished saved Sites version is a source/build candidate, not a
deployment or an automatic backup. Deployment remains a separately authorized
Phase 9 action.

## Consequences

- Some reads perform one additional bounded exact-state seal. That cost is
  intentional and must remain within the full 50-statement route budget.
- A concurrent loss of access or projection parity may convert an otherwise
  successful-looking read into a safe denial, not a stale response.
- Public media can be denied after R2 retrieval when D1 state changes during
  the read. The bytes are not returned in that case.
- CSP changes require rendered-Worker and browser verification because a
  syntactically strict policy that blocks vinext bootstrap is not acceptable.
- Phase 8 can complete without a new migration and without deploying. Hosted
  second-identity, external calendar-client, approved-real-artwork, and Owner
  smoke checks remain pending until their separately authorized prerequisites
  exist.
