# Meetup calendar reconciliation prompt

Copy everything below this introduction into a new Codex task when you want to
reconcile the Vancouver Curiosity Club website with its current Meetup events.
The prompt keeps Meetup authoritative while preserving the website's existing
security, publication, conflict, and privacy contracts.

---

# Vancouver Curiosity Club - Meetup-to-website event reconciliation

Work only in:

    C:\Users\user\Documents\Website

Meetup is the authoritative source for the club's current published event
facts. Reconcile the website against Meetup, updating only missing or genuinely
changed information. Do not redesign the website, deploy a new Sites version,
alter access, or write anything back to Meetup unless I separately authorize
those actions.

Read BUILD_STATUS.md, MASTER_BUILD_SPEC.md, README.md, OWNER_INPUTS.md, and
docs/architecture/0003-meetup-calendar-sync.md before acting. Preserve every
existing authentication, privacy, publication, conflict, D1-budget,
media-rights, and public-projection contract.

## Exact Meetup scope

Use only events belonging to these confirmed groups:

- https://www.meetup.com/vancouver-meetup-group/
- https://www.meetup.com/vancouver-literature-and-film/
- https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/

Use the current authenticated Meetup organizer session when available. Do not
use Meetup /home/ recommendations or unrelated similar events. Match events
using the exact canonical Meetup group slug plus numeric Meetup event ID and
official individual event URL - never by title alone.

Meetup access is read-only. Do not create, edit, cancel, message, or RSVP to
anything on Meetup.

If the authenticated Meetup inventory cannot be accessed, stop and tell me
exactly where to sign in. Do not substitute stale snippets or guessed data.

## Reuse the existing website workflow

Use the established flow first:

1. Open the authenticated /organizer/meetup workspace.
2. Use its existing Refresh now action until each bounded source generation
   reaches an honest terminal result.
3. Reuse:
   - app/api/organizer/meetup/refresh/route.ts
   - lib/server/meetup/sync.ts
   - lib/server/meetup/ics.ts
   - lib/server/meetup/fetch.ts
   - lib/server/meetup/url.ts
   - lib/server/public/events.ts
4. Preserve completed-generation publication, immutable source identity,
   source-scoped duplicate protection, cancellation handling, Phase 4
   conflicts, and the fewer-than-50-D1-statements-per-request limit.
5. Do not write directly to hosted D1, mutate immutable snapshots, or create a
   parallel importer.

The official iCalendar feed remains authoritative for title, date, start/end
time, timezone, cancellation/status, and official Meetup event URL.

Descriptions, public locations, and posters are not safely supplied by the
current iCalendar contract. Reuse the existing bounded, source-controlled
public enrichment workflow:

- scripts/refresh-curated-meetup-enrichment.mjs
- lib/meetup-event-enrichment.generated.json
- lib/meetup-event-enrichment.ts
- lib/meetup-event-posters.ts
- public/event-posters/

Compare the authenticated current event inventory with the exact EVENTS list in
the refresh script. Add a canonical group slug plus numeric event ID only after
opening and verifying that exact public event page. Remove an entry only when a
completed source generation and the ordinary cancellation/reconciliation path
prove that it is no longer current; never infer deletion from a partial fetch.

Run `npm.cmd run meetup:enrichment:refresh` only after the exact list has been
verified. The generator must continue to:

- read only the three allowlisted public Meetup groups;
- verify exact event identity and canonical group slug;
- remove public-description URLs and reject emails or meeting credentials;
- retain only the attendee-visible venue name and public address;
- download the verified high-resolution event poster without hotlinking;
- generate genuine 480, 960, and up-to-1600-pixel local variants without
  upscaling;
- fail closed on unexpected host, MIME type, byte size, dimensions, or page
  shape;
- leave manually authored website summary, description, venue, and approved
  CMS artwork untouched when those already exist.

Do not replace this bounded source-reviewed workflow with a direct hosted-D1
write or a second importer. If a future automatic server-side enrichment job
is proposed, stop and design its authorization, generation binding,
publication receipt, invariant, privacy, and request-budget protocol before
implementation.

## Per-event comparison and updates

For every current published Meetup event in scope, compare:

- exact title;
- date;
- start and end time;
- IANA timezone;
- cancellation/status;
- exact individual Meetup RSVP URL;
- attendee-visible public location;
- public event description;
- poster.

Update only fields that are missing or differ from the current authoritative
Meetup listing. If a field already matches, leave it untouched. Never overwrite
an owner-authored website field with an older or empty value.

Do not automatically merge two cross-posted Meetup IDs. If the same gathering
appears under different group-specific event IDs, retain the existing
fail-closed conflict behavior and report it for owner review.

For events missing from a completed source generation, use the existing
reconciliation/cancellation path. Never hard-delete an event or remove a
listing based on a partial or failed refresh.

## Description rules

Copy the public attendee-visible Meetup event description faithfully,
preserving meaningful paragraphs, headings, and lists as safe plain or rich
text supported by the existing sanitizer.

Do not invent or summarize a description when Meetup has none. Do not publish:

- organizer-only instructions;
- email addresses or provider identity;
- online meeting credentials;
- hidden RSVP details;
- private notes;
- attendee data;
- tracking parameters;
- scripts or submitted HTML.

Store and render it only through the existing public-safe projection. The event
detail page must show useful About this event content when Meetup provides it.

## Location rules

Copy only the location visible to an ordinary attendee on the exact Meetup
event page.

- If Meetup publicly shows a venue name and public address, preserve them
  accurately.
- If only a venue name is public, do not invent an address.
- If Meetup says the location is undecided or hidden until RSVP, keep the
  website location undecided or hidden.
- Never expose online meeting links, access codes, private instructions, or
  organizer-only location fields.

The public month/day detail and event detail must display the verified location
when available.

## Poster rules

Inspect the exact event's real Meetup poster. Use the highest-resolution image
URL actually exposed by Meetup for that event; do not manufacture a URL by
changing 600_ to another prefix unless that exact asset is present and
verified.

Reuse and extend:

- lib/meetup-event-posters.ts
- public/event-posters/
- the existing approved media/R2 pipeline where appropriate.

Requirements:

- key the poster by exact numeric Meetup event ID;
- download and store an owned local or managed copy - do not hotlink Meetup in
  public HTML;
- verify image MIME type, byte size, natural width/height, and event match;
- preserve provenance privately;
- add concise factual alt text and the existing credit convention;
- generate or use responsive variants where the current media pipeline
  supports them;
- never upscale a 600-pixel image and call it high resolution;
- if no suitable poster exists, retain the controlled category fallback and
  report it honestly.

## Verification

After reconciliation, verify every affected event through the actual public
projections:

- /
- /calendar
- /events/[exact-slug]
- relevant public ICS/CSV output where applicable.

For each event prove:

- the month grid contains its title on the correct day;
- click, tap, or keyboard selection shows title, sharp poster, time, and
  verified location; pointer hover over another date must not replace the
  selected day panel;
- the event detail shows When and Location without relying on a redundant
  Format fact;
- About this event contains the sanitized Meetup description when supplied;
- the poster loads with nonzero natural dimensions and is not visibly blurred
  because of an undersized source;
- the RSVP button uses the exact individual Meetup URL;
- unchanged fields remained unchanged;
- no private data appears in HTML, metadata, JSON-LD, sitemap, ICS, CSV, logs,
  errors, or client bundles.

Run the focused Meetup, poster, public-calendar, and unified-event tests, then
the repository's exact typecheck, zero-warning lint, full test, production
build, rendered Worker, privacy/artifact, and git diff --check gates if source
changed.

Do not weaken tests or update expectations merely to hide a mismatch.

## Scheduling honesty

Do not claim this runs automatically every day. Sites currently provides manual
bounded refresh plus refresh-on-view; there is no guaranteed cron scheduler.
This separate task is the repeatable owner-invoked reconciliation workflow
until a supported scheduler is explicitly added.

## Final report

Return a compact table with:

- exact Meetup event ID and URL;
- Added / Updated / Unchanged / Cancelled / Skipped / Blocked;
- fields changed;
- poster source dimensions and stored dimensions;
- any hidden or undecided location;
- any cross-post conflict;
- public verification result.

Also report totals for scanned, added, updated, unchanged, cancelled,
poster-upgraded, skipped, and blocked events.

Stop after reconciliation and verification. Do not deploy, change Sites access,
or begin unrelated work.
