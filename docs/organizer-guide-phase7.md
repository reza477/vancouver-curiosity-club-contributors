# Phase 7 Organizer guide

## Assigned submissions

An Organizer can open only submissions currently assigned to their active
same-organization profile. They cannot browse unassigned submissions or
another Organizer's assignments.

For an assigned submission, an Organizer may:

- append a private plain-text note;
- move New to In Review;
- move In Review to Responded; and
- move Responded back to In Review.

Responded means someone recorded an external response. The application does
not send a message or email.

An Organizer cannot assign, unassign, archive, purge, or redact a submission.
Reassignment, suspension, or membership removal removes access immediately.
Private note bodies never appear in audit or notification metadata.

## Private calendar subscription

An active Organizer may create and revoke only their own read-only private
calendar URLs from **Calendar**. Copy the URL when it is created because the
raw token is shown once and only its SHA-256 hash is stored.

The feed includes the minimum useful organization-wide schedule fields the
member can already view. It excludes private notes, meeting links, organizer
identity, conflict reasons, forms, team/invitation data, source-feed URLs, and
tokens.

Revocation, suspension, removal, profile deletion, or organization mismatch
denies the URL immediately. The feed is not a two-way synchronization
service. External calendar-client behavior is implemented but not externally
verified while Phase 7 remains unpublished.

## Phase 7 actions not available to Organizers

Organizers cannot import events, download operational CSV, generate the Owner
backup, download the Owner media-backup collection, view import history, list
all submissions, assign submissions, archive submissions, or redact personal
content.

**ICS file import — Not implemented — authorized cut.**
