# Phase 7 Owner guide

## Import a CSV

1. Open **Imports** in the organizer workspace and download the versioned CSV
   template and field guide.
2. Choose one local `.csv` file. Remote URLs and non-CSV formats are rejected.
3. Confirm the header mapping. The official template maps automatically; for
   other headers, map to one canonical field or choose **Ignore**.
4. Review every preview row. The preview shows defaults, validation errors,
   record matches, hard duplicates, possible duplicates, and current conflict
   advice. It does not create or change events.
5. Choose Skip, Select, or Create Separate Event where permitted. A possible
   duplicate needs an explicit written reason. Hard duplicates and invalid
   rows remain skipped.
6. Approve the exact preview fingerprint and version. Imports always remain
   private and never publish.
7. Apply the next persisted row until the batch reaches a terminal result.
   Refreshing or closing the browser does not erase completed row results.
   Retry returns the existing result rather than creating a duplicate.
8. Read the batch history for imported, skipped, failed, and pending rows.
   A conflict requiring Administrator review leaves only a non-reserving
   private Draft and the normal pending conflict review.

The importer does not create Clubs, Programs, lanes, categories, venues,
profiles, memberships, or invitations. It never overwrites an existing event.

### Result terms

- **Imported** means the private event and its exact revision, conflict/source
  facts, audit, and row receipt committed atomically. It does not mean
  published.
- **Skipped** means no event was created for that row. This covers invalid
  rows, hard duplicates, explicit Skip decisions, and other safe policy
  outcomes recorded by the batch.
- **Failed** means the attempted row reached a durable error result and its
  event envelope did not partially commit. Resolve the underlying condition
  before starting a new import; the importer does not silently retry a
  conflict or stale write.
- **Pending** means an approved selected row has not reached an Imported,
  Skipped, or Failed terminal result. Resume applies the next persisted row
  from the durable cursor.
- **Administrator review** means the conflict policy required a separate
  approval. The import leaves only a private, non-reserving Draft and the
  normal pending conflict-review request. It is not a successful reservation
  or publication.

### Source namespace

If any row contains `external_id`, enter a source namespace of 1 to 64
characters. It is normalized to lowercase, starts with a letter or number, and
then uses only letters, numbers, dots, dashes, or underscores. Use a stable,
nonpersonal namespace such as `member-calendar-2026` or `community.partner`.
Do not put an email, token, URL, credential, or person name in it. The CSV
source type, namespace, and external ID form a durable duplicate key.

### Import source redaction

Redaction is available only to an Owner, only for a terminal batch, and only
after 90 days. The interface shows the eligibility date and requires explicit
irreversible confirmation. Redaction removes retained mapped source payload
while preserving the file hash, parser/template and mapping versions, row
fingerprints, outcome codes, target event references, counts, and minimum-safe
audit provenance. It does not delete created events or rewrite their history.

## Export event data

The public Events page offers filtered public ICS and CSV. Those files contain
only verified public event projection fields.

Owners and Administrators can download the operational event CSV from
**Exports**. It is private-safe but intentionally excludes organizer emails,
meeting credentials, form submissions, conflict reasons, invitation/auth
data, tokens, source-feed addresses, and generic audit data. Organizer
assignments do not automatically round-trip; imports require explicit email
mapping.

## Generate the Owner backup

The Owner-only JSON backup requires the exact confirmation shown in the
workspace and a final live Owner-role check immediately before the audit seal.
Treat the downloaded file as sensitive.

The backup contains only the documented product-data allowlists and
pseudonymous membership relationships. It excludes emails, identity-provider
identifiers, invitations, sessions, tokens and hashes, private calendar URLs,
Meetup source feeds, form submissions and notes, rate/protection state,
environment values, credentials, and R2 keys. It is not a complete
infrastructure backup and has no automatic restore.

Use the Owner-run backup routine in
`docs/phase7-exports-calendar-backup.md`: preserve the exact source revision,
generate JSON, download the media manifest, download required originals
through authenticated asset-ID routes, verify checksums, store the artifacts
securely, and follow the documented dependency-order mapping only in a
disposable nonproduction local database. Phase 7 does not provide an in-app or
automatic restore action.

## Manage a private calendar subscription

Open **Calendar**, create a labelled read-only private subscription, and copy
the URL when it is shown. The raw token is never shown again. A profile can
have at most three active tokens.

Revoke a URL when it should stop working. Revocation, profile suspension,
membership removal, profile deletion, or organization mismatch denies the
feed immediately.

This is read-only, not two-way synchronization. External calendar-client
behavior is implemented but not externally verified while Phase 7 is
unpublished.

## Review submissions

Open **Submissions** to filter by form type, status, assignment, received date,
or bounded search. Lists omit full sensitive content.

On a submission:

- assign or unassign an active same-organization member;
- move between New, In Review, Responded, and Archived;
- append a private note; or
- as Owner, enter the exact public reference to irreversibly redact personal
  content.

Responded is a manual record of an external response. The application does
not send email.

The default retention-review date is 365 days after receipt. This release
flags review-due records but does not automatically purge them.

## Authorized cut

**ICS file import — Not implemented — authorized cut.**

There is no ICS upload route or control. This does not affect event ICS
downloads, filtered public ICS, the private read-only calendar subscription,
or the existing Meetup iCalendar source workflow.
