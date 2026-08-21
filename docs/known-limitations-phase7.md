# Phase 7 known limitations and authorized cuts

- **ICS file import — Not implemented — authorized cut.**
- CSV import creates new private events only. There is no overwrite, update,
  merge, remote-URL, XLSX, JSON, ZIP, or arbitrary-file import.
- Imports never publish. Publication still uses the normal Phase 5 workflow.
- Public forms may send one private organizer email copy after the durable inbox
  record commits. The application sends no visitor confirmation, import,
  export, invitation, calendar, or notification-digest email.
- There is no newsletter enrollment.
- Backups are Owner-run downloads. There is no scheduler, automatic backup,
  automatic restore, or complete infrastructure-backup claim.
- Submission retention review is flagged after 365 days, but deletion/redaction
  remains an explicit Owner action. There is no automatic retention purge.
- The private calendar is read-only. External calendar-client behavior is
  implemented but not externally verified before a future authorized
  deployment.
- Owner JSON backup excludes identity-provider facts, emails, invitations,
  sessions, token data, private source-feed addresses, public-form protection
  and rate-limit state, form submissions, notification payloads, generic audit
  payloads, runtime values, credentials, and R2 object keys.
- Editor role — **Not implemented — authorized cut.**
- Viewer role — **Not implemented — authorized cut.**
- Realtime subscriptions — **Not implemented — authorized cut.**
- Downloadable QR generation remains an authorized cut from an earlier phase.
- Daily and weekly notification digests remain an authorized cut.
- No automatic Meetup publishing, attendee accounts, internal RSVP, payments,
  donations, comments, chat, messaging, forums, or social-networking features
  are included.
- Approved-real-artwork browser smoke remains **Awaiting owner** because no
  approved production photographs or replacement artwork were supplied.
