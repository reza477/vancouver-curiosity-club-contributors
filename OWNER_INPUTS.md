# Vancouver Curiosity Club — Owner Inputs

No value below may be guessed, inferred, or replaced with sample production
data.

## Identity and bootstrap

- `INITIAL_OWNER_EMAIL`: **Configured in Sites runtime settings as a secret**
  from the existing owner identity in Sites access metadata. Runtime revision
  1 is active on the current public version-16 deployment; the value is
  never copied into this file, source, logs, or build artifacts.
- Second invited test identity: **Not supplied**. Public visitor access does
  not grant organizer membership. Phase 3 invitation acceptance and Phase 4
  role/club authorization are verified through isolated local and built-Worker
  seams; hosted second-identity verification still requires a real invited
  second identity.

## Meetup connection

- Exact official Meetup calendar feed operator inputs: **Supplied** for all
  three groups and independently smoke-tested. The private feed addresses are
  intentionally not recorded here, in source, or in build artifacts.
- Confirmed exact program/group mapping:

  - **Vancouver Curiosity Club** —
    https://www.meetup.com/vancouver-meetup-group/
  - **Vancouver Literature and Film** —
    https://www.meetup.com/vancouver-literature-and-film/
  - **Vancouver Fantasy & Sci-Fi Group** —
    https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/
- Public per-program URL fields/pages: **Implemented and verified in Phase 2**
  using only the three confirmed clean public group URLs above. Private
  calendar-feed configuration remains separate.
- Exact public Meetup discussion URL: **Missing**
- Any confirmed social-profile, future community-platform, or other public
  Community destination beyond the three Meetup groups: **Missing**. No future
  platform may be named or seeded without the exact owner-confirmed URL.
- Production source configuration on 2026-07-30: **Completed by the Owner**
  through the authenticated organizer workspace for all three official group
  feeds. The private source addresses remain intentionally absent from this
  file, source, logs, and client state.
- Source-backed event verification: **Completed for 11 current published
  events** from the completed Vancouver Literature and Film and Vancouver
  Fantasy & Sci-Fi Group snapshots. Their public event destinations are the
  exact individual Meetup URLs supplied by those feeds.
- Vancouver Curiosity Club feed activation: **Blocked safely by cross-post
  conflicts.** Several of its gatherings are also present in another group
  feed with a different Meetup source identity. The authoritative scheduling
  guard rejected the duplicate reservations and kept the last completed
  snapshots visible. No automatic title/time merge was performed.
- Exact Eventbrite, Flock, and Instagram destinations: **Missing**. They must
  not be guessed. Confirmed global URLs can be added to Community; distinct
  event-level destinations require a later additive event-signup model.

## British Columbia legal identity

- Exact legal name: **Missing**
- Jurisdiction: **Missing**
- Legal form/status wording: **Missing**
- Registration number: **Missing**
- Effective date: **Missing**
- Approved legal footer: **Missing**
- CRA registered-charity status: **Unconfirmed**
- CRA charity number: **Missing**
- Owner-approved charity wording, if applicable: **Missing**

Until these are supplied and approved, the site must not publish a legal-status,
society-registration, tax, or charity claim.

## Copy approval

- Approved public copy: **Missing**. Phase 2 contains restrained, D1-backed
  starter copy that remains subject to owner approval and later authorized CMS
  editing.
- Working tagline currently supplied: `A social calendar with a brain.`
- Confirmed Resources or reading-packet content: **Missing**. The Resources
  page must remain unpublished until real content is entered and explicitly
  published.
- Sufficient confirmed public content and destination links for
  **Off-Radar Eats** and **Contemplative Meditation + Journaling Circle**:
  **Missing**. Their profiles must remain unpublished.
- Verified public accessibility facts beyond general process guidance:
  **Missing**. Venue- and event-specific accessibility claims require separate
  factual confirmation.

## Public contact and permanent origin

- Confirmed public contact email address: **Missing**. Phase 7 does not invent
  one: the public Contact form stores a reply email and message in the private
  organizer inbox and explicitly sends no confirmation email.
- Public Sites origin: **Available for deployed version 16** at
  `https://vancouver-curiosity-club.reza5777.chatgpt.site`. The Owner
  explicitly authorized public visitor access on 2026-07-30. Access revision 2
  retains one project Owner and zero groups, no preview deployment, and no
  custom domain. QR downloads remain an authorized cut.
- Custom domain: **Not requested and not required**

## Photography and consent

- Real photographs: **Missing**
- Approved-real-artwork browser smoke: **Awaiting owner smoke test**.
  Synthetic local non-person artwork may verify mechanics but cannot satisfy
  this factual owner-approval step.
- Owner-approved logo or Open Graph replacement artwork: **Missing**. The
  existing Field Notes brand icon and social card remain the safe published
  fallback.
- Final per-page, per-club, and per-event Open Graph selections: **Missing**
  unless an approved asset is deliberately selected in the corresponding
  private editor.
- Rights/license state for each photograph: **Missing**
- Required credit for each photograph: **Missing**
- Participant-consent state for each identifiable person: **Missing**

No AI-generated attendee faces or unapproved photographs may be substituted.

## Public organizers

- Approved public organizer names: **Missing**
- Approved public organizer biographies: **Missing**
- Profile-level public-attribution consent: **Missing**
- Per-event permission to display each organizer: **Missing**
- Approved venue names, addresses, and venue-specific accessibility facts:
  **Missing per event**

The public projection defaults organizer attribution to private and requires
both consent gates before displaying a name.

## Phase 9 production and Owner verification

- Version 14 private deployment and representative production verification:
  **Completed and verified**. Deployment
  `appgdep_6a6a8ade7fa08191a6c1a21cf7d1f0b9` reached terminal `succeeded`
  without changing the owner-only access policy.
- Calendar-first version 15 deployment: **Completed and verified**.
  Deployment `appgdep_6a6ba12078f08191bfd0693e7726921a` reached terminal
  `succeeded` from source
  `af3477b439a1e06b07a077747f903643abb7da09`, with the same one-owner,
  zero-group access boundary and no preview or custom domain.
- Public visitor access: **Completed and verified** after explicit Owner
  authorization. Access revision 2 changed only the Sites visitor access mode;
  version 15, organizer authorization, runtime, bindings, domains, preview,
  D1, and R2 remained unchanged.
- Owner-directed month-calendar version 16 deployment: **Completed and
  verified**. Deployment `appgdep_6a6c4cf1f870819189cc2cb3d7803064`
  reached terminal `succeeded` from source
  `27f6d319544e430aeae1c4367528b30c54fbd6a4`; access revision 2, one Owner,
  zero groups, runtime revision 1, `DB` / `MEDIA`, domains, and preview state
  remained unchanged.
- Five-minute Phase 9 Owner smoke test: **Awaiting owner smoke test**.
  Production engineering checks do not constitute Owner approval.
- Owner-authenticated production views for dashboard, events, calendar,
  conflicts, clubs, imports, submissions, exports, content, media, Meetup,
  profile, settings, notifications, and team were healthy. One clearly
  labelled private production-smoke Draft was created, verified nonpublic,
  archived, and moved to deleted items through the normal Owner workflow; its
  immutable audit trace remains.
- Production responsive checks now cover the calendar-first public release at
  320px, 390px, 768px, and 1280px, plus the prior representative organizer
  routes and 200%-reflow equivalent. The
  Owner's own end-to-end mobile and keyboard acceptance remains
  **Awaiting owner smoke test**.
- Approved-real-artwork browser check: **Awaiting owner smoke test**. The
  hosted Media workspace contains no uploaded artwork, and synthetic artwork
  cannot replace rights, consent, credit, or Owner approval.
- Owner calendar-first product feedback and authenticated sign-in:
  **Completed on 2026-07-30.** This is not the complete five-minute Owner smoke
  card, which remains awaiting Owner review.
- Owner direction to make the month calendar the public Home and remove the
  separate Calendar masthead: **Implemented and locally verified in current
  source on 2026-08-06; deployment pending explicit public-publish approval.**
- Real published-event detail and individual Meetup-event URL:
  **Completed for source-backed Meetup events on 2026-07-30.**
- Hosted second-identity role/suspension/reassignment: **Not run**. The access
  policy permits one owner and zero groups.
- External private calendar-client behavior: **Implemented but not externally
  verified**.
- Owner backup restore rehearsal: **Not run**.
