# Phase 3 owner guide

This guide applies only after a Phase 3-or-later version is explicitly
deployed owner-only. The current live version 8 does not contain Phase 3.

## Enter the workspace

1. Open `/organizer`.
2. Continue with Sign in with ChatGPT.
3. Use the ChatGPT account whose email matches the configured owner secret.

The workspace is private and does not reuse the public site header or footer.
If a signed-in account has no active membership, it receives an organizer
access-denied page.

## Private event planning

Use **Add event** to create either:

- an unscheduled or scheduled **Idea**; or
- a scheduled **Draft**.

Ideas and Drafts are private. Phase 3 cannot reserve the calendar or publish to
the website. There are no hold, confirm, cancel, publish, or unpublish actions.
Meetup and other existing reserving or public records appear read-only.

Each successful edit creates an immutable revision and audit entry. If another
person changed the same record first, the workspace returns a stale-edit
message instead of overwriting either person's work.

The Dashboard summarizes real private drafts, unscheduled Ideas, recent
changes, assigned clubs, unread notifications, and Meetup feed health. The
Calendar provides Agenda, Day, Week, and Month views. **Events** is the
searchable planning index; **Clubs** manages private club planning and
assignments without changing the public club catalog.

## Team and invitations

Owners can create copyable Administrator or Organizer invitations.
Administrators can create Organizer invitations only. An Organizer invitation
requires a club. No email is sent: copy the one-time link when it is created
and send it manually to the recipient. The recipient must sign in with the
invited ChatGPT email.

Invitation links expire, can be revoked, and can be accepted only once. The
token is never shown again in the invitation list. The current Sites access
policy allows only the owner, so a hosted second-person acceptance test remains
unavailable until a later explicit access-policy authorization.

Only the Owner can transfer ownership. The transfer is atomic and preserves
exactly one active Owner. A member cannot be removed or suspended while they
still own private Ideas or Drafts, including soft-deleted records that remain
restorable; reassign the listed records first.

Use **Notifications** for real coordination changes and **Profile** for the
private workspace display name, initials, calendar color, biography draft,
attribution-consent draft, and notification preference. These Phase 3 profile
drafts do not rename or change attribution on the current public website.
**Settings** changes only the private workspace name and default IANA timezone;
it cannot publish legal, branding, or public-footer claims.

## Meetup connection

The existing Meetup workspace remains at `/organizer/meetup`.

- Owner and Administrator may configure and manually refresh official feeds.
- Organizer access is read-only.
- Saved feed addresses never render back to the browser.
- Website changes do not write back to Meetup.

## Current boundary

Phase 3 intentionally has no public preview, publishing, conflict review,
media upload, CMS editing, imports, exports, email, form inbox, RSVP, payment,
comment, message, or chat workflow.
