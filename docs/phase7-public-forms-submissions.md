# Phase 7 public forms and private submissions

## What the public forms collect

The public site provides four plain-text forms:

- Contact collects name, reply email, topic, and message.
- Volunteer collects name, reply email, one to five allowlisted interest
  areas, how the visitor would like to help, and optional availability or
  relevant context.
- Host an Event collects name, reply email, proposed title or topic, short
  event idea, format, and optional preferred Club or Program and timing.
- Venue or Community Partnership collects contact name, reply email,
  organization or venue name, partnership type, message, and an optional
  HTTPS website.

The forms do not request a phone number, home address, birth date,
demographics, password, payment information, attachment, marketing consent,
or unnecessary social profile.

Submitting stores a message in the private organizer inbox and queues one
private email copy to the configured organizer address. It does not enroll the
visitor in marketing, send the visitor an email confirmation, or promise a
response time.

## Validation and plain-text handling

The server accepts a bounded JSON body of at most 16 KiB. It normalizes Unicode
and line endings, rejects NUL and unsafe control characters, validates every
field against the form-specific allowlist, and stores submitted text as plain
text. Submitted HTML is never rendered as HTML.

An invalid request returns field-specific errors and the normalized entered
values. It does not create a normal submission and does not show a success
message. The form renders a keyboard-focusable error summary whose links lead
to each marked field.

## Form instance, anti-abuse, and idempotency

Before submission, the browser obtains a time-bounded form instance containing
the form key, a random nonce, and issue time. D1 stores a random 256-bit
organization protection key; only the server can use it to authenticate the
instance.

The service also uses:

- same-origin `Origin`, `Referer`, and `Sec-Fetch-Site` checks;
- a minimum three-second completion heuristic;
- a hidden honeypot field;
- one random `Secure`, `HttpOnly`, `SameSite=Lax` anonymous cookie with a
  one-year lifetime;
- private keyed hashes derived from bounded network-address, user-agent, and
  accepted-language facts; and
- atomic D1 rate windows for 15-minute, daily, and organization-wide hourly
  limits.

Raw IP addresses, user-agent strings, accepted-language values, and protection
keys are not stored in rate-limit records, rendered, logged, or exported.

A legitimate submission commits rate admission, the base submission,
canonical workflow, non-enumerable public reference, idempotency hash,
retention-review date, minimum-safe notifications, PII-free email outbox row,
audit receipt, and completion proof in one D1 batch. Success is returned only
after that batch commits. A retry with the same nonce returns the same
reference without creating another submission, notification, or email row.

Honeypot and impossible-speed requests store only a redacted spam receipt,
generate no organizer notification, and return generic success only after the
redacted receipt commits. A durable rate-limit rejection does not claim that a
message was stored.

There is no public endpoint for looking up a submission reference.

## Private inbox authorization

Owners and Administrators can list and read all submissions in their current
organization, assign or unassign an active same-organization member, append
private notes, change status, and archive.

An Organizer can read only a submission currently assigned to their active
profile. They may append notes and move an assigned submission from New to In
Review, from In Review to Responded, or from Responded back to In Review.
Reassignment, suspension, removal, or organization mismatch removes access
immediately.

Every protected read and mutation revalidates current Sign in with ChatGPT
identity, active profile, active membership, organization, role, and current
assignment at the server. List and detail responses also revalidate immediately
before returning sensitive data, so an interleaved reassignment or suspension
fails closed.

The canonical statuses are New, In Review, Responded, and Archived. Marking
Responded records that someone responded outside the application; the site
does not claim to send a response.

## Notes, notifications, and audit data

Notes are private plain text and append-only during ordinary use. The note body
does not appear in audit metadata, notification payloads, public pages,
exports, or logs.

A new legitimate submission notifies active Owners and Administrators through
the existing in-app important-notification preference. Assignment notifies
the assigned Organizer. Notifications contain only form type, public
reference, status, and an authenticated detail path. They do not contain the
visitor's email or message. There is no notification digest.

The email outbox stores no destination address or form content. Its fixed
destination and provider credential come from server-only runtime settings.
After the D1 submission commits, a bounded worker sends a plain-text organizer
copy, uses the visitor's validated address only as Reply-To, and records a
provider receipt. Provider failure never rolls back the submission; rows
remain queued for an independent signed maintenance job, including after a
credential or sender-configuration error is corrected. Provider requests use
a stable idempotency key so public retries do not create duplicate email
copies. The daily runner follows fresh route-bound signatures through bounded
six-row slices until the due queue is current, so one deferred slice does not
starve newer submissions. It fails visibly if any copy remains deferred.
Email delivery does not depend on Meetup refresh success.

Audit records contain only minimum workflow facts. They never copy form
content, email addresses, note bodies, raw protection facts, or rate-limit
hashes.

## Retention review and Owner redaction

Each legitimate submission receives a retention-review date 365 days after
receipt. This release flags due records but does not automatically delete
them.

Only an Owner can irreversibly redact personal content. The Owner must enter
the exact public reference and pass an optimistic-version check. One atomic,
audited write replaces the submission payload, every private note body, and
every completed workflow-intent payload copy with the canonical redaction
marker while retaining only the reference, form type, received/redacted times,
final workflow status, actor, and minimum integrity facts. The application has
no recovery endpoint for redacted content. Redaction also suppresses any
queued organizer email copy that has not been sent. A copy already delivered
to the organizer inbox or retained by the email provider is outside the site
database and must be deleted separately there.

Administrators and Organizers may not perform personal-content redaction.

## Public privacy boundary

Submissions, public references, names, emails, messages, notes, assignments,
statuses, protection keys, and rate-limit hashes are excluded from public
HTML, metadata, JSON-LD, sitemap, robots output, event ICS/CSV, client bundles,
and public errors.

The public Privacy page is marked for Owner/legal review. Publishing it is not
a claim of legal compliance.
