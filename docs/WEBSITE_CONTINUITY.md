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
  identity plus group ownership. Public publication remains limited through
  September 30, 2026. Do not extend the cutoff without owner direction.
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

The first repair is implemented in production source `cc65de3` (PR #32).
The linked frame now has one block box matching its image at 390, 1024 and
1440 pixels. Local checks cover reduced motion, normal poster navigation and
Back; all eight focused poster checks and 38 built-Worker checks pass, as does
the complete PR CI run. The connected browser could not capture screenshots,
so actual screenshot-based visual review remains outstanding. The public
calendar read contained 33 events, all starting by September 30 in Vancouver
time. Treat these as dated verification results.

Release packaging must preserve exactly one copy of the validated migration
tree. Windows directory copying into an existing directory can accidentally
nest a second `drizzle` folder; compare the staged file list and hashes before
saving a version. A saved version with a failed archive verification must not
be deployed. Sites version saving is idempotent by source commit, so prepare
and verify a new source version instead of assuming another upload replaces
an existing archive.

1. **Repair disappearing Events-list posters.** The last old-task exchange
   diagnosed but did not fix this. `EventCard` changed its artwork frame from
   a block div to an anchor, while the shared CSS omitted `display: block`.
   Reveal clipping then used an inline box around block picture content.
   Restore block layout in the shared frame rule; retain artwork, motion and
   click destinations. Verify real card geometry, reveal states, mobile,
   reduced motion, event navigation and Back. Do not substitute a Meetup
   refresh for this presentation repair.
2. **Finish visual review of the latest editorial design.** The old task
   published it after automated checks while explicitly reporting browser
   visual QA as pending. Assess actual desktop/mobile pages against the
   owner's existing direction before proposing further aesthetic changes.
3. **Investigate the known JavaScript-dependent Home/Events loading shell.**
   The earlier motion handover records this limitation. Reproduce against
   current source and distinguish framework streaming from application data
   before proposing a repair. Do not claim it resolved by poster CSS.
4. **Make representative local visual checks repeatable.** Fresh local D1 has
   schema without production content. Existing synthetic fixture scripts can
   support local-only checks; never copy production D1, private submissions or
   secrets to populate a preview.

The current architecture review found documentation drift in maintenance
scheduling, public HTML caching and dependency-audit commands. Align those
guides with the existing code. No high-confidence privacy defect was found in
this source pass; multi-identity production auth and backup restoration were
not exercised.

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
