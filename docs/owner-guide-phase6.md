# Phase 6 owner guide

This guide applies only after a Phase 6-or-later version is explicitly
deployed owner-only. The current live version 8 does not contain Phase 6.

## Draft, preview, and publish content

Open **Website content** from the organizer workspace. Pages, club profiles,
Community destinations, navigation, site identity, and legal status each keep
an immutable revision history.

- **Save Draft** stores private work only.
- **Preview** opens the exact revision in the public design with a private
  preview banner. It is authenticated, no-store, noindex, and has no share
  token.
- **Publish** validates and materializes the current draft.
- **Unpublish** removes an eligible entity from public output without deleting
  its history.
- **Restore as New Draft** copies a historical revision into a new private
  revision. It never changes public output by itself.

Home and the required public pages retain their canonical slugs and cannot be
renamed, archived, deleted, or unpublished. Resources is optional: use
**Create Resources draft** on the content dashboard when real material is
ready. It may remain a private draft, and its canonical path remains
`/resources`. Site identity is also a protected published baseline; it can be
updated through a validated revision but cannot be unpublished.

Reorder blocks and navigation with **Move Up** and **Move Down**. Dragging is
never required. Public required navigation and policy links remain reachable,
and Organizer Login cannot be renamed, removed, or repointed. A destination
may appear only once in each placement. Optional items cannot displace a
required link, and Resources can appear in navigation only after its page is
published.

Dynamic event, club, Community, resource, and media selections are resolved
against the current public catalog. If a selected item later becomes
unavailable, the editor keeps an honest unavailable entry with a **Remove**
action rather than silently hiding the stale selection. A published club
resource link also blocks unpublishing its target page until the dependency is
removed.

Slug changes are available only to eligible generic pages and club profiles.
An old slug redirects only while the same-organization target remains
published. Unpublishing or archiving the target suppresses the redirect;
republishing safely restores a valid redirect.

## Community destinations

Publish only an exact confirmed HTTPS destination. The three already verified
Meetup group destinations remain available. Do not add a Meetup discussion
link, future platform, social profile, or other destination until its exact
URL is confirmed.

Publishing a Community destination does not create on-site chat, comments,
messages, a forum, or a member directory. Meetup group and discussion types
must match their exact Meetup URL shape. Other social, community, and resource
destinations appear under the neutral **Confirmed community destinations**
heading rather than being described as Meetup groups.

## Media, rights, and consent

Phase 6 accepts JPEG, PNG, and WebP images up to 8 MiB and within the decoded
dimension and pixel limits shown by the form. SVG, GIF, PDF, video, audio,
archives, scripts, corrupt files, and mismatched MIME/extension/container
uploads are rejected.

Before public use, record:

1. useful alt text for an informative image;
2. required credit;
3. an explicit **Approved** rights status;
4. participant consent as **Confirmed** or genuinely **Not applicable**;
5. optional private source, rights, and consent notes.

Do not infer rights or consent. Replacing an image creates a new immutable
asset. Public pages receive responsive 480, 960, and 1600 pixel WebP variants;
the original stays private. Public markup and Open Graph metadata use each
variant's real dimensions, canonical live alt text, credit, and focal point;
the application does not assume a landscape crop.

For page media, leave the block caption empty to inherit the asset's current
approved caption. Entering a block caption creates an explicit page-specific
override. Alt text always comes from the current approved media record and is
updated centrally rather than copied into page content.

Deleting an in-use asset is blocked with its bounded usages. Remove it from
every draft and published entity first. If R2 cleanup is interrupted, the
private cleanup queue keeps an actionable retry without revealing object keys.
The retry is safe to repeat after a new browser session or Worker instance.

## Brand, navigation, and SEO

The Field Notes defaults remain the baseline. Custom colors must pass contrast
checks for every public text/background pairing. Typography is restricted to
the shipped vetted choices. Logo and Open Graph selections require approved
media. Failed brand validation cannot publish.

Each page, club, and event has bounded SEO title and meta-description fields.
Its approved Open Graph selection or event artwork takes precedence over the
approved published site default. Removing, unpublishing, or revoking an asset
suppresses that URL and uses a current safe fallback; it never exposes a
private object key or retains anonymous access.

A club theme is checked against the current published site palette and is used
for safe accent and decorative treatments. Publishing a site-palette change
also rechecks every published club theme. The save is blocked with named
conflicts if the combined palette would not meet the required contrast.

## Legal-status wording

Administrator may prepare a private legal draft. Only Owner can:

- confirm the exact revision;
- revoke a confirmation;
- publish or unpublish legal wording.

Nothing is prefilled or inferred. Provincial registration and CRA charity
status are separate. Charity wording requires an explicitly confirmed status
and exact owner-supplied number. Editing confirmed data creates an unconfirmed
draft and leaves the existing public projection unchanged until a new exact
revision is confirmed and published.

Protected nonprofit, society, incorporation, registration, charity,
tax-deductibility, or tax-receipt wording cannot be placed in ordinary page,
club, site, Community, or event fields to bypass this workflow. Neutral
community-organization language remains available.

## Event and club publication

Event and club website publication remains separate from Meetup. An approved
individual Meetup event URL produces the event RSVP action; an approved group
URL may appear on a club profile. The application does not publish back to
Meetup.

Event and club SEO, approved Open Graph media, responsive artwork, captions,
credit, and theme changes remain versioned content edits. Event publication
continues through the Phase 4 conflict-checked service. Public event structured
data uses only the confirmed site identity and eligible consented host facts;
it does not invent an organizer organization from a club, program, circle, or
series.

Programs are first-class records nested under a public parent club. A private
organization-level Program with no parent club is retained, but it cannot be
published until you or an Administrator assigns one active parent club in the
same organization. A deleted, archived, or other-organization club is never an
eligible parent. Rejected assignment or publication attempts leave the
Program's private draft and history intact and create no public page.

## Event lanes and categories

Open **Settings → Event lanes and categories** as an Owner or Administrator to
create, edit, reorder, archive, or safely delete taxonomy values.

- The four canonical lane slugs remain stable. Their labels, descriptions, and
  order may change, but they cannot be renamed into different URL identities,
  archived, or deleted.
- Categories are not fabricated by the application. Add only categories the
  organization actually uses.
- Archive is blocked when an event, club, Program, or restorable immutable CMS
  revision still needs the value.
- Safe-delete is available only for an archived value with no current or
  historical references.
- Existing events retain an exact archived lane or category during unrelated
  edits. A new event or reassignment may select only an active value.
- An archived category remains in the public filter while a current published
  event still uses it, then disappears when no public event uses it.

Every change is optimistic-versioned and audited. Refresh after a stale edit;
the application never silently overwrites another manager's taxonomy change.

## Organizer public attribution

Each active organizer manages their own public-attribution draft on
**Organizer profile**. Saving a display name, optional biography, approved
profile photo, and consent keeps the change private. **Publish public
attribution** is a separate action that creates the immutable public receipt.
**Revoke public attribution** removes that public name, biography, and photo
output immediately while retaining private history.

This profile publication is only the first gate. A public event must also
enable host display and explicitly select that eligible organizer. Public
output contains only the confirmed display name, bounded biography, and
approved photo metadata. It never contains email, role, assignments, private
profile fields, auth identifiers, a newer private draft, or R2 object keys.

## Request-driven refresh

Sites does not provide a promised cron or realtime subscription. Due scheduled
publication and official Meetup refresh run in bounded request-maintenance
steps. A relevant request may process work and redirect before rendering, then
show the current page on the next request. Do not interpret this as
exact-to-the-second background execution.

## Phase boundary

The phase cuts are explicit:

- Editor role — **Not implemented — authorized cut**
- Viewer role — **Not implemented — authorized cut**
- Realtime subscriptions — **Not implemented — authorized cut**

Phase 6 also does not add image imports from remote URLs, automatic Meetup
publishing, imports, exports, public forms, submissions, email, payments,
attendee accounts, comments, messaging, forums, or chat. Imports, exports,
forms, and submissions remain Phase 7.

Content publication, a saved Sites version, and deployment are separate. A CMS
publish action changes D1-backed public content only in an already deployed
application. A saved Sites version is an immutable unpublished candidate.
Deployment is the separate action that changes the live URL. The Phase 6
candidate is not deployed.
