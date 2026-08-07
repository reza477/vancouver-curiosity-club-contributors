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
- Source-backed event verification: **Completed for 13 current published
  events** from the completed Vancouver Literature and Film and Vancouver
  Fantasy & Sci-Fi Group snapshots. Their public event destinations are the
  exact individual Meetup URLs supplied by those feeds.
- Current curated enrichment candidate: **42 exact public Meetup event pages
  verified across the three confirmed groups.** This includes 38 current
  numeric-canonical listings plus four older or no-longer-listed records
  retained because the latest bounded refresh did not complete cleanly enough
  to prove removal. Four additional current recurring listings use
  alphanumeric canonical paths and remain blocked rather than guessed. All 42
  records have verified local responsive poster copies. Five smaller
  Meetup originals are preserved at native width and are never upscaled. This
  owner-directed, source-controlled inventory supplies sanitized
  attendee-visible description, location, and poster facts only when the
  existing public projection already makes that exact event eligible. It does
  not activate the conflict-blocked main Vancouver Curiosity Club feed and is
  not a claim that all 42 records are currently public.
- Vancouver Curiosity Club feed activation: **Blocked safely by cross-post
  conflicts.** Several of its gatherings are also present in another group
  feed with a different Meetup source identity. The authoritative scheduling
  guard rejected the duplicate reservations and kept the last completed
  snapshots visible. No automatic title/time merge was performed.
- Exact Eventbrite, Flock, and Instagram destinations: **Missing**. They must
  not be guessed. The simplified public shell does not expose a Community hub;
  distinct event-level destinations require a later additive event-signup
  model after the exact URLs are supplied.

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

- Final approved public copy: **Missing**. The Owner authorized a fuller
  explanatory starter for Home and About, including the four existing activity
  lanes and the fact that public visitors do not need an account. That current
  candidate remains subject to Owner editorial acceptance and later authorized
  CMS editing; it does not add legal or accessibility claims.
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
  organizer inbox and creates eligible Owner/Administrator in-app
  notifications. It sends no email to the visitor or the organizers.
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
- Owner-directed logo replacement: **Implemented in the current unpublished
  candidate; final visual acceptance is awaiting Owner smoke.** The candidate
  uses a deterministic Penrose-inspired mathematical mark across the icon set
  and social card. Live version 16 retains its existing published artwork until
  a later explicitly authorized deployment.
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
- General Owner-approved venue and venue-specific accessibility facts:
  **Missing per event.** The current curated candidate may show only the venue
  name and address visible to an ordinary attendee on each exact verified
  Meetup page; it makes no accessibility claim.

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
- Calendar-as-home refinement: **Implemented, verified, and saved as
  unpublished Sites version 17**
  (`appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_0f5c6d1f80688191b7f8a26d52ec9293`).
  It was not directly deployed; its changes are included in deployed version
  20.
- Identity/About/Meetup enrichment refinement: **Implemented, verified, and
  saved as unpublished Sites version 18**
  (`appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_1ecfb8d602248191a1cc7673dc4e1459`).
  It was saved from exact source
  `d0560bd1b887dbf63dbf3958ab5e04cd72ff6050` and was not directly deployed.
  Live version 20 now includes its changes; historical version 17 remains
  saved.
- Navigation/Home/Contribute/performance refinement: **Implemented, verified,
  and saved as unpublished Sites version 19**
  (`appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_5f4c21512a54819187963e5af19613b3`).
  Exact pushed source `ebb4e8a72898ceecf6f714efb0926c38ff748274`
  uses Calendar, About, and Contribute as the three visible
  primary destinations, removes the unwanted Home invitation/attending/
  Community panels, redirects the legacy Community route to Contribute, and
  renders the last completed calendar immediately during a concurrent Meetup
  refresh. It was not directly deployed; its changes are included in deployed
  version 20.
- Stable calendar selection repair: **Completed, verified, and deployed as
  Sites version 20**
  (`appgprj_6a62eaf79c4881919bb8e47998af851a~appgver_f2cb620c3dc081918f9f152c7bbfe5e1`).
  Exact pushed source `45ece3319cdbc2d4f130cc1a42a770892ce1d155`
  keeps the selected date and its right-hand event panel stable while the
  pointer crosses other date cells. Deployment
  `appgdep_6a7507fb96648191aae650faba2eb84a` reached terminal `succeeded`; the
  existing public access policy and protected organizer boundary were
  unchanged.
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
- Latest Owner direction to replace the calendar-as-home candidate with a
  living cultural-community homepage, upcoming-first Events route, optional
  Month calendar, Clubs navigation, concise About page, and poster-led event
  detail system: **Implemented and locally verified in current source on
  2026-08-06; deployment pending explicit public-publish approval.**
- Real published-event detail and individual Meetup-event URL:
  **Completed for source-backed Meetup events on 2026-07-30.**
- Hosted second-identity role/suspension/reassignment: **Not run**. The access
  policy permits one owner and zero groups.
- External private calendar-client behavior: **Implemented but not externally
  verified**.
- Owner backup restore rehearsal: **Not run**.
