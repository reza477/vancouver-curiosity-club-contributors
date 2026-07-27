# Phase 5 owner guide

This guide applies only after a Phase 5-or-later version is explicitly
deployed owner-only. The current live version 8 does not contain Phase 5.

## Prepare and preview

Open a confirmed private event and use **Website publication**. Complete the
public summary, description, attendance format, and approved public
destination. Private venue details and private meeting information are never
used as fallback public copy.

Choose one RSVP mode:

- **RSVP on Meetup** requires the exact individual Meetup event page and an
  explicit confirmation that it is the intended event.
- **RSVP information coming soon** shows no RSVP button and makes no destination
  claim.

A Meetup group homepage is not an event RSVP destination. Changing a saved
Meetup event URL clears its confirmation before the new value can appear
publicly.

If public hosts are enabled, select at least one currently eligible organizer
who has opted into canonical public attribution. Private profile drafts do not
alter the public website.

**Protected preview** uses the same allowlisted renderer as the public detail
page, but remains authenticated, no-store, noindex, and absent from the
sitemap. It never includes private notes, conflict reasons, email, identity
data, feed configuration, or audit history.

## Publish, schedule, and unpublish

Owner and Administrator can publish any eligible event in the organization.
Organizer self-publishing is off by default and can be enabled only through
the narrow private publication policy in Settings.

**Publish to Website** reruns the authoritative conflict and readiness checks,
then makes the canonical event available through Home, Events, its detail
page, its club page, metadata, structured data, and sitemap.

**Schedule publication** stores a version-bound future instant. There is no
background cron promise: the job runs on the first relevant public or
organizer request at or after that instant. If the event, authorization,
readiness, slug, or conflict facts changed, the job fails closed and the event
stays nonpublic. Editing a scheduled event invalidates its old job unless it is
explicitly rescheduled.

**Unpublish** removes the page and every discovery surface while preserving
the stable slug and private publication history. It does not cancel a
confirmed reservation.

## Cancellation and restoration

Cancelling an already published event keeps its public detail page with a
prominent cancellation notice and removes it from Upcoming. Cancelling an
event that was only scheduled cancels the job and leaves the event
unpublished.

Archive and soft-delete also remove scheduled or published events from public
discovery. Restore never silently republishes; review the event and choose a
new explicit publish action.

## Meetup and phase boundary

Website publication does not publish, edit, or synchronize an event back to
Meetup. The separate one-way Meetup calendar connection remains unchanged.

Phase 5 has no general page CMS, community-link editing, media upload, import,
export, public form, email, QR download, payment, RSVP account, comment,
message, forum, or chat workflow.
