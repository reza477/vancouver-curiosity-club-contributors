# Website continuity

Reviewed September 7, 2026 (America/Vancouver). This is a dated handover,
not a claim that hosted state will remain unchanged.

## Working task

The owner moved ongoing website work to **Main Website — GPT-6**
(`01a07fa0-3337-79b2-a627-f8048c62746d`). Continue website work there.
The previous **Main Channel** (`019fd9b7-da4a-7d51-9d63-e56338c93a33`)
is historical context. Do not send new implementation work back to it.

At handover, production source and this clean worktree started at
`89f29e17bcabd26aa547d1f7439053a408612303`, matching Sites saved version 158.
The canonical website is https://vancouvercuriosityclub.com/.

## Product and decisions to preserve

- Vancouver Curiosity and Education Society is the nonprofit; Vancouver
  Curiosity Club is its public program. The exact owner-approved identity
  sentence lives in `lib/public-mission-copy.ts`. Preserve the mission text;
  do not infer charity status or donation tax benefits.
- The site serves prospective participants, partners and supporters, with a
  separate authenticated organizer workspace. Meetup is the event-fact and
  RSVP source. Public accounts, on-site RSVP, payments and two-way Meetup
  synchronization are intentionally absent.
- The design direction is an artwork-led cultural publication: real posters,
  deliberate page composition, cream/navy identity, restrained frames and
  clear typography. Preserve the approved magnet-C logo, actual wording,
  verified participant feedback, and program colors.
- About uses discussion-oriented artwork: Debate Night, Cicero's On
  Friendship and The Bet. Do not replace it with games or hangouts.
- Preserve clickable posters, ordinary scrolling, keyboard navigation, Back,
  reduced-motion behavior and once-only reveals. Incoming stage artwork must
  decode before replacing outgoing artwork. Never show an empty poster frame.
- The owner requested approval before new suggested aesthetic changes.
  Repair confirmed regressions within the approved design; do not treat this
  handover as approval for an unsolicited redesign or new product features.
- Keep changes reversible and record browser evidence for visual releases.
  Code and source-contract tests alone do not establish that artwork paints.

## Operating boundaries

- Preserve Sites-managed `DB` and `MEDIA`, private organizer authorization,
  additive migrations, public-safe projections and completed snapshots.
- Meetup maintenance reads all three official groups and matches stable event
  identity plus group ownership. On October 3, 2026, the owner replaced the
  September cutoff with a rolling five-week public horizon: today through the
  next 35 Vancouver calendar days, with the final boundary exclusive. Keep
  later automatic Meetup repeats in complete source snapshots and filter them
  from public views at read time. The window advances without visitor imports;
  ordinary upcoming and archive rules still control past events.
- Meetup refresh is manual through the protected workflow or authorized
  organizer action. Scheduled form-email delivery is independent and remains
  enabled. Never re-enable automatic Meetup refresh as routine cleanup.
- Production and contributor repositories use reviewed branches and PRs.
  The owner expects accepted work to reach both repositories' main branches;
  preserve contributor-only preview support and unrelated changes.
- A Git merge does not deploy. Publish the exact validated source through the
  existing Sites project and verify the affected public journey afterwards.
  A prior owner override explicitly limited to one sync is not a standing
  bypass of release checks.

## Current continuation and priorities

The first poster repair was published as Sites version 160 from production
source `e472774` on September 8, 2026. The owner then requested a broad repair
pass and public deployment. That pass addresses:

- Home and Events serving usable HTML without page-wide loading boundaries,
  with snapshot reads deduplicated across the framework's probe and render.
- Poster keyboard focus preserving sticky positioning, responsive AVIF/WebP
  source sizing, and the mobile menu closing when its home logo is activated.
- Contact, Host and Volunteer preparing signed form instances on the server.
  Native validation and expiry retain answers and the idempotency nonce.
- Same-origin native retries, bounded multilingual request bodies, independent
  volunteer interest selection, and recovery from unavailable Host choices.

Preserve the approved artwork and wording while correcting these functional
issues. The read-only audit covered all 46 sitemap/public pages and 48 image
URLs with no broken responses. These are dated counts, not a future guarantee.
The connected in-app browser now supports screenshots; use the existing tab
for responsive and interaction checks. Preview content is synthetic and must
never be promoted to hosted data. Submission tests run locally without an
email provider; do not send test inquiries to the live organizer inbox.

Release packaging must preserve exactly one copy of the validated migration
tree. Windows directory copying into an existing directory can accidentally
nest a second `drizzle` folder; compare staged file lists and hashes before
saving a version. Never deploy a saved version that failed archive validation.
Version saving is idempotent by source commit, so a corrected immutable
release needs a new validated source revision.

Contributor PR #11 is awaiting GitHub's independent review requirement. An
ordinary website deployment request does not authorize an owner override of
that protection. Keep its source current while leaving that approval gate
intact unless the owner explicitly resolves it.

## Evidence and authoritative guides

Read `DEVELOPMENT.md`, `docs/UI_UX_HANDOFF.md` and
`docs/RELEASE_AND_ROLLBACK.md` first. `BUILD_STATUS.md`, `OWNER_INPUTS.md`,
`MASTER_BUILD_SPEC.md` and phase guides are historical ledgers, not the current
backlog. Verify live state before reusing any old count or version number.

Old Main Channel evidence: artwork/no-empty-frame requirement in turn
`01a051ec-64a5-7e80-b3d8-d4952b40ffde`; aesthetic approval boundary in
`01a07a88-7174-7d71-923f-4189341b5d12`; latest unresolved poster report in
`01a07f95-d8ed-7042-9104-ca6bc118effa`. Earlier motion screenshots and
recordings are in the owner's local `Website-reference-pass-2026-09-07`
evidence folder beside the original Website checkout. They are historical
verification, not evidence for this correction.
