# Phase 4 owner guide

This guide applies only after a Phase 4-or-later version is explicitly
deployed owner-only. The current live version 8 does not contain Phase 4.

## Private scheduling

Open `/organizer` and sign in with the matching ChatGPT owner account. Manual
events remain private even after they are held or confirmed; Phase 4 does not
publish to the public website or write back to Meetup.

The event editor supports:

- private Ideas and Drafts;
- time-limited tentative holds;
- private confirmed events;
- release, extension, cancellation, completion, and archive actions when the
  current lifecycle allows them;
- a private venue, organizer/co-organizer scope, and setup or cleanup buffers.

The editor's conflict preview is advisory. The save performs a fresh atomic D1
check. If another organizer saves first, the second write is refused or sent
through the current policy instead of silently overwriting the schedule.

## Conflict policies

In **Settings**, Owner and Administrator can choose:

- **Warn and require a reason** — an authorized editor can intentionally save
  an overlap only with a written coordination reason.
- **Require administrator approval** — the event remains a non-reserving Draft
  until an Owner or a different Administrator approves it. The Owner may
  approve their own request in a single-owner workspace.
- **Block** — no overlap can reserve until the schedule changes or an
  Owner/Administrator changes the policy.

Changing a policy increments its version. Existing approvals do not transfer
to a different policy, time, organizer set, venue, buffer, expiry, or
conflicting schedule.

The default hold duration is 72 hours and the initial nearing-expiry threshold
is 24 hours. Both are private scheduling settings. Hold expiry uses D1 time and
does not depend on a background job.

## Conflict centre

Open **Conflicts** to inspect open conflicts, approval requests, decisions,
invalidated reviews, resolved items, and informational Draft warnings. Each
entry shows the exact overlap and every relevant organization, organizer, or
venue fact. Reasons and activity remain private.

A pending Meetup generation is not a scheduling source. Only its last
completed active generation participates. If a completed generation would
activate into an unreviewed reservation conflict, activation fails closed and
the prior active generation remains authoritative.

Re-enabling a disabled source that already has an active generation, or
restoring that source, runs the same database guard. It cannot silently make
an unchecked schedule reserving.

The Meetup workspace labels this condition **Schedule conflict** without
showing the saved feed address or a raw source error. Open the private
calendar, move or release the conflicting manual reservation (or cancel it
when appropriate), and choose **Refresh now** again. The retained staged
generation is retried; a successful retry clears the schedule-conflict state.
Do not reconnect the feed or delete the last completed snapshot merely to
resolve the schedule.

## Venues and notifications

The Settings venue panel creates and manages private scheduling venues.
Archiving a venue never publishes or deletes its private address or
directions. Venue conflicts use the selected private venue ID.

Notifications are in-app only. Phase 4 can notify directly affected
organizers about conflicts, requests, decisions, material schedule changes,
hold expiry, confirmation, and cancellation. It does not send email or claim
realtime delivery.

## Phase boundary

Phase 4 has no public event preview, publish/unpublish, scheduled publication,
CMS or Community editing, media upload, import/export, email, public form,
QR download, RSVP, payment, attendee account, comment, message, or forum
workflow.
