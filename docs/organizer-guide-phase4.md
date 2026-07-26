# Phase 4 organizer guide

This guide applies after a Phase 4-or-later version is explicitly deployed and
your matching ChatGPT identity has an active assigned-club membership.

## Creating and scheduling an event

Use **Add Event** to create a private Idea or Draft. A duplicate starts as a
private non-reserving Draft. From an event you own or co-organize in an
assigned club, you may propose a tentative hold or private confirmation.

The editor keeps scheduling together:

1. title and club;
2. date, time or all-day dates, and IANA timezone;
3. primary and co-organizers;
4. private venue;
5. setup and cleanup/travel buffers;
6. the private lifecycle action.

An unscheduled Idea has no fake date and cannot become a hold or confirmation
until it receives a valid timed or all-day schedule. All-day end dates are
exclusive. Timed values retain their original IANA timezone; the system never
hardcodes Vancouver's UTC offset.

## Understanding conflict feedback

The advisory preview identifies:

- direct event overlap;
- buffer-only overlap;
- organization-wide coordination across clubs;
- shared primary or co-organizers;
- a shared private venue.

An event ending at 6:00 PM and another starting at 6:00 PM do not directly
overlap when both buffers are zero. If the first event has a 30-minute cleanup
buffer, a 6:15 PM start is a buffer conflict.

The final save always checks again in D1. A rejected save preserves your form
values. A stale-content or stale-schedule response means another committed
change won; refresh and reconcile rather than resubmitting blindly.

Existing tentative holds and confirmed private events remain editable by an
authorized owner or co-organizer. Time, timezone, venue, buffer, and organizer
changes all pass through the same full conflict check and version guard.

## Holds, reviews, and lifecycle

A tentative hold reserves until its exact expiry. At equality with D1 current
time, it stops reserving even before the page refreshes its visible status.
Extending an expired or active hold performs a fresh full conflict check.
Releasing a hold returns it to a Draft.

Under **Warn and require a reason**, enter a concise coordination reason for
each intentional overlap. Under **Require administrator approval**, your event
remains a non-reserving Draft while the request is pending. Under **Block**,
change the schedule or wait for an Owner/Administrator policy change.

Organizers cannot approve administrator-review requests or change policy.
They can inspect reasons only when they own or co-organize one of the involved
events.

Confirmed private events can later be cancelled. Confirmed events can be
completed after they occur. Restore returns to a safe private non-reserving
state unless a separately guarded reserving transition is explicitly run.

## Read-only sources and privacy

Active Meetup events and retained legacy reservations appear as labelled
read-only coordination sources. You cannot edit, cancel, delete, reassign, or
overwrite them. Pending or failed Meetup generations remain invisible.

Every organizer route is private, no-store, and noindex. Conflict reasons,
private venue details, notes, email addresses, identity data, feed addresses,
invitations, audit history, and notifications never appear on public pages.
Even a confirmed Phase 4 manual event remains absent from public Events, Home,
club pages, metadata, structured data, the sitemap, and guessed public slugs.

Calendar filters include a Conflict-only option. It narrows the real loaded
private schedule and never implies that a Draft warning is a reservation.

The workspace refreshes on ordinary loads, focus, and explicit actions. It
does not claim a background scheduler or realtime updates.
