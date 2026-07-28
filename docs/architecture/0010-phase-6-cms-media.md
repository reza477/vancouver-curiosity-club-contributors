# ADR 0010: Phase 6 structured CMS and controlled R2 media

Date: 2026-07-27
Status: Accepted for Phase 6

## Context

Phases 1–5 established a ChatGPT Sites application with one D1 database,
Sign in with ChatGPT, an allowlisted public projection, an authoritative
conflict-checked organizer-event service, and a private-to-public event
publication workflow. Phase 6 must make the existing public pages, club
profiles, Community destinations, navigation, site identity, and approved
artwork editable without turning the public projection tables into draft
storage or introducing another host, database, identity provider, or CMS.

ChatGPT Sites packages D1 migration SQL by complete semicolon-tokenized
statements. D1 also limits one Worker invocation to 50 statements. R2 and D1
cannot commit together. These constraints shape the workflow and its recovery
paths.

## Decision

### Existing projections remain authoritative public materializations

The existing `pages`, `page_sections`, `club_public_profiles`,
`community_links`, `navigation_items`, `site_settings`, and `media_assets`
tables remain in place. Phase 6 does not build a replacement CMS.

The additive `0015_phase6_cms_media.sql` migration introduces organization-
scoped publication state, immutable revision, redirect, media-detail,
media-variant, media-usage, upload-cleanup, materialization-receipt,
organizer-attribution receipt, taxonomy write-intent/state, and
legal-confirmation structures. It is the only Phase 6 migration. Every create
is retry-safe, and the packaged migration contains no trigger body, reset,
rebuild, rename, `DROP`, `ALTER`, or `PRAGMA` mutation.

The companion data model is explicit:

- `cms_adoption_states`, `cms_entity_publication_states`,
  `cms_entity_revisions`, and `cms_public_materialization_receipts` bind
  adoption, private history, workflow state, and exact public projection;
- `club_public_profile_details`, `program_public_profile_details`,
  `community_link_public_details`, `page_public_metadata`,
  `organizer_event_public_metadata`, and `public_slug_redirects` hold bounded
  public-only companion facts;
- `media_asset_details`, `media_asset_variants`, and
  `media_usage_references` keep R2 metadata, variant state, cleanup state, and
  exact revision-bound use;
- `legal_status_confirmation_receipts` preserves legal confirmation history;
- `organizer_public_attribution_write_intents`,
  `organizer_public_attribution_states`, and
  `organizer_public_attribution_receipts` separate private profile drafts from
  explicit public attribution; and
- `taxonomy_write_intents`, `event_lane_taxonomy_states`, and
  `category_taxonomy_states` protect audited lane/category versions while the
  established base taxonomy tables remain authoritative identities.

The first authorized CMS request performs bounded, organization-scoped
adoption when the durable adoption marker is absent. Existing pages and
sections, club profiles, the three already verified Meetup-group
destinations, navigation, and site identity become truthful revision-one
baselines without altering their public output. Candidate reads are bulked
rather than performed once per entity. Adoption is idempotent and concurrent;
malformed source data fails closed with no partial marker or editorial state.

Recurring Programs remain first-class canonical `programs` records, with
their public CMS projection and revision history kept separately from the
parent club profile. A public Program profile must be assigned to one active
same-organization parent club; an organization-level core Program with
`club_id = NULL` remains private and keeps its private record/history, but
cannot publish until an Owner or Administrator assigns an eligible parent.
Cross-organization, deleted, or archived parents are rejected without public
projection, receipt, revision, or audit residue. The five adopted starter
Programs retain their verified Program-to-club mappings rather than
reclassifying or replacing established IDs.

Draft revisions are immutable JSON snapshots with a bounded allowlisted
schema. Saving a draft never changes a public projection. Publishing validates
the exact revision and atomically materializes only public fields, media
usages, redirects, publication state, and audit history. Unpublish removes the
public materialization while preserving history. Restore always creates a new
private draft revision.

### Structured content, not arbitrary HTML

Pages support a maximum of 24 allowlisted blocks and a canonical revision of
at most 128 KiB. Raw HTML, scripts, iframes, arbitrary CSS, event handlers,
data URLs, executable Markdown, protected routes, and unconfirmed external
destinations are rejected.

Dynamic blocks store only bounded selections and presentation settings.
Public event, club, Community, and media facts are bulk-resolved from current
allowlisted public projections. Render components receive one materialized
context and perform no per-block database reads. Preview uses the same
materializer and entity-specific public renderers as production.

Home and the existing required system pages retain their canonical slugs and
cannot be renamed, archived, deleted, or unpublished through the generic CMS.
Resources is optional and may remain an unpublished draft, but `/resources` is
also non-renamable. An Owner or Administrator can create that private draft
from the content dashboard without a source change. Eligible generic pages and
club profiles may create same-organization permanent redirects. Redirect
resolution rechecks that the current target is still published and suppresses
the redirect while the target is unpublished or archived; republishing
reactivates only a valid current target and never creates a redirect-to-404
chain.

Published navigation preserves the exact validated labels and order. Header
and footer item caps reserve room for every required destination. Duplicate
`(placement, target)` pairs are rejected rather than silently deduplicated,
and Organizer Login remains an immutable internal target and label. Resources
may appear only while its page is published. Required header, footer, policy,
and organizer destinations cannot be removed, repointed, or truncated by
optional items.

Community destination types are semantic, not cosmetic. Meetup group and
discussion types accept only their canonical Meetup URL shapes. Other
confirmed HTTPS destinations remain neutrally labelled; the default public
heading is **Confirmed community destinations**, not a claim that every
social, resource, or future platform link is a Meetup group. The missing
discussion and future-platform destinations are not seeded.

### Concurrency and database enforcement

Every save, publish, unpublish, restore, reorder, legal action, media metadata
change, and deletion requires the expected content version. Sensitive batches
repeat active profile, membership, role, and organization checks inside the
committing SQL.

CMS publication uses a durable action envelope and SQL dependency chain. A
projection, usage, redirect, state, or audit statement can run only after the
exact preceding precondition succeeds. A completion sentinel aborts the
transaction on any stale or zero-row intermediate result, so JavaScript never
reports rollback after D1 committed partial state.

Every public CMS projection is authenticated by an immutable materialization
receipt tied to the exact current revision and canonical projection proof.
Anonymous reads require revision, state, receipt, live projection, and
content-safety equality. Crafted edits to mutable legacy projection rows,
missing or forged receipts, or a missing exact media usage therefore fail
closed rather than leaking through a durable healthy marker.

Media usages are revision-bound. Page, club, navigation, site-logo,
site-Open-Graph, event-artwork, and other public references must identify the
exact same-organization revision or canonical event version they belong to.
An empty or unrelated revision cannot authorize a usage. Draft and published
usage sets are reconciled with set-based statements; unpublish, archive,
soft-delete, safe restore, or scheduled cancellation retires public event
artwork, while an intentionally still-public cancellation or completed event
may retain it.

Phase 6 runtime triggers are installed and verified by the existing
fail-closed invariant initializer. The durable marker is written only after
the exact normalized definitions and global integrity scans pass. Healthy
verification is deliberately consolidated to leave statement budget for the
route and service while retaining current database verification.

Event lanes and categories use their own guarded write-intent protocol:
intent, base/state mutation, immutable audit, and completion proof commit
together. The four canonical lane identities keep stable slugs while their
labels, descriptions, and order remain editable. Base-table and companion
state guards reject direct writes, cross-organization state, version gaps,
forks, reference-unsafe archive/delete, and missing audit/completion. Existing
Phase 5 rows are adopted before readiness certification, including archived
legacy values. Immutable club/Program revision snapshots are references at the
database boundary, closing both archive-first and revision-first races.

### Media bytes in R2, authority in D1

R2 stores immutable original bytes and generated WebP variants. D1 stores the
opaque object keys, state, hashes, dimensions, MIME types, metadata,
provenance, cleanup state, and exact draft and published usages. Object keys,
original filenames, rights notes, consent notes, and actor IDs never enter a
public DTO.

Before any R2 write, D1 receives the complete pending variant manifest. The
server awaits every put with all-settled semantics. If any put or final D1
commit fails, every successful object write is cleaned up. A failed cleanup
remains in a private durable maintenance queue and can be retried
idempotently after a new request or Worker instance.

Upload finalization repeats a live Owner or Administrator authorization guard
for every variant transition and seals the transaction with a completion
sentinel. Organizers cannot upload or manage media. An assigned Organizer may
select only an already ready, approved asset for an event they are authorized
to edit. The selector eligibility predicate is repeated inside the committing
batch so a concurrent rights, consent, credit, alt-text, deletion, role, or
assignment change rolls the event edit back.

Public media routes accept only `webp_480`, `webp_960`, and `webp_1600`.
Originals are private, no-store, and Owner/Administrator-only. Stable public
variant URLs use bounded revalidation because rights, consent, publication
usage, and deletion can change. Every anonymous byte read rechecks a current
published usage and all approval gates.

Published use requires same-organization ready media, approved rights,
confirmed or not-applicable participant consent, required credit, and useful
alt text for informative images. Metadata changes that would break a current
published image are blocked with bounded usage details. Deletion is blocked
while any draft or public revision still uses the asset.

Public media DTOs report the stored dimensions of all three WebP variants
rather than assuming a crop or aspect ratio. Page, club, and event renderers
use those dimensions, live canonical alt text, credit, and focal points.
Focal-point storage uses `0..10000` and rendering maps it to `0%..100%`.
Page media blocks store only an explicit caption override; `null` inherits the
asset's current approved caption. No block-level alt override exists, so the
live asset alt text is always authoritative. Historical private previews
revalidate the exact revision's media without making retired usage public.

### Published identity, SEO, contrast, and structured data

Published site identity is the global fallback for brand name, palette,
typography, logo, default SEO, and Open Graph media. Page, club, and event
SEO title, meta description, and approved Open Graph or artwork selections
override that fallback only through their allowlisted public projection.
Metadata uses real public media alt text and dimensions; it does not invent a
1200-by-630 or 1600-by-900 image. Revoked, deleted, unapproved, or
no-longer-published media is suppressed before a public URL is emitted.

Field Notes colors remain constrained. Site-identity publication validates
every actual text/background, accent, border, and focus pairing and rechecks
all published club theme colors in the same guarded operation. Club
publication validates its theme against the current published site palette.
Club theme is used only in contrast-safe accents and decoration.

Editorial and club detail routes emit Breadcrumb structured data from current
published canonical paths and labels. Resources may emit Article structured
data only when its real published revision supplies the required facts; no
author or date is invented. Public event structured data uses the confirmed
site identity and eligible consented host Person facts where available. It
does not mislabel a club, circle, series, or program as an Organization
organizer.

### Legal wording remains separately confirmed

Administrator may prepare a private legal-status draft. Only Owner may confirm
the exact revision hash, revoke confirmation, publish, or unpublish legal
wording. The confirmed receipt is immutable and separate from the published
projection. A later edit creates an unconfirmed draft and does not change the
existing public wording.

Ordinary page, club, navigation, and site copy is screened for protected legal
and charity claims. The same shared predicate applies to every public event
field and event SEO, including title, summary, description, cost, access,
location, arrival, preparation, and accessibility notes. The application
checks before publication, database transition and integrity guards repeat the
check against the aggregate canonical event state, and public projections
suppress malformed legacy or raced rows. Neutral community-organization
language remains allowed. Provincial status and CRA charity status remain
separate, and no status, number, tax treatment, donation, or tax-deductibility
claim is inferred.

### Organizer attribution is separately published

An organizer profile save updates a private attribution draft only. Explicit
self-publication consumes a guarded write intent and creates an immutable
structured receipt bound to the canonical profile consent, display name,
biography, approved photo, draft version, and published version. Revocation is
another versioned receipt and removes the attribution output immediately. A
newer private draft does not change the existing public receipt or website.

Existing canonical consent is upgraded by bounded, deterministic invariant
maintenance before readiness certification. Adopted and newly confirmed
receipts are equally valid historical proofs; later actor demotion or
suspension does not rewrite authorization that was valid at action time.
Current self/Owner authority is still required for new publication or
revocation actions.

The event host projection adds a second gate: event-level public-host display
and exact organizer selection. Public DTOs contain only the receipt-backed
display name, bounded biography, and ready approved photo with alt, credit,
focal point, and real dimensions. Email, role, assignments, auth identifiers,
private fields, a newer draft, and raw R2 keys are never selected.

### Public/private fidelity and caching

Private previews are authenticated, no-store, noindex, have no share token,
and use the same public header, footer, palette, typography, responsive media,
structured blocks, and entity renderer as production, with a clear preview
banner outside the public content. The route has one main landmark and the
global skip link targets it correctly.

Only published revisions affect public HTML, metadata, canonical URLs,
Open Graph values, structured data, navigation, footer, redirects, or sitemap.
Media and CMS reads use explicit public DTOs. Draft snapshots, actor IDs,
revision metadata, object keys, original filenames, legal drafts, private
rights/consent notes, invitations, conflicts, identities, and runtime values
are excluded from public output.

Request-driven Meetup refresh and scheduled-event publication are processed
by one bounded request-maintenance coordinator. At most one due publication is
handled first; a state-changing result redirects before rendering. Meetup
refresh uses bounded continuation chunks and the same redirect-before-render
rule, so it does not share one D1 invocation with a full public render or a
co-due publication. Healthy invariant preflight, mutation, notification
fan-out, and maximum structured-page rendering are measured as complete
Worker paths against D1's 50-statement ceiling. The application makes no cron,
realtime, or exact-to-the-second claim.

## Consequences

- Public content can be drafted, previewed, published, unpublished, and
  restored without a source-code edit.
- Existing Phase 1–5 event, Meetup, conflict, invitation, authorization, and
  public-projection semantics remain intact.
- R2 object failures are recoverable without making partial assets public.
- Public image revocation takes effect through live authorization and bounded
  caching rather than an unsafe immutable stable URL.
- Public redirect, navigation, metadata, media, and structured-data output
  always derives from a current published target rather than a stale draft or
  historical revision.
- Editor and Viewer roles, realtime subscriptions, imports, exports, public
  forms, and submissions remain outside Phase 6.
- The Phase 6 candidate is not deployed. The owner-only live version 8 remains
  unchanged until a separate authorization, and Phase 7 has not started.
