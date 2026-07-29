# Phase 7 exports, private calendar, and Owner backup

## Public event downloads

The public event download routes read only the verified current public event
projection:

- `/events/[slug]/calendar.ics` emits one currently public event, including a
  retained public cancellation where eligible.
- `/events/calendar.ics` emits a filtered calendar.
- `/events/events.csv` emits the same filtered public facts as CSV.

The date range defaults to 180 days and may not exceed 366 days. ICS is limited
to 500 events and public CSV to 2,000 rows. A result over the limit is rejected;
it is never silently truncated. Organization identity is selected on the
server.

Timed ICS events use UTC `DTSTART` and `DTEND` values ending in `Z` and include
the validated IANA timezone as safe calendar metadata. All-day events use
`VALUE=DATE` with an exclusive end date. Text is escaped, UTF-8 content lines
are folded at 75 octets, and output uses CRLF. Public and private calendars
keep separate persisted component revisions keyed by the stable internal event
identity. A SHA-256 fingerprint is computed from the exact canonical emitted
`VEVENT` facts, excluding request-generation time and revision fields.
Identical content keeps the same signed 32-bit `SEQUENCE` and
`LAST-MODIFIED`; a visible content change increments once and advances
`LAST-MODIFIED`, including changes in the same millisecond and dates after
2038. Public `UID` values are stable opaque hashes and do not reveal database
IDs.

Public CSV and ICS exclude private notes, meeting details, organizer identity
unless separately confirmed for public attribution, conflict data, invitation
or authentication data, audit history, source-feed URLs, tokens, and storage
keys. CSV cells that begin with spreadsheet formula prefixes are neutralized
before RFC 4180 quoting.

## Operational CSV

Current Owners and Administrators can download an allowlisted operational event
CSV from `/organizer/exports`. It includes internal event reference, source,
taxonomy, schedule, lifecycle, attendance mode, public venue match, Meetup URL,
and scheduling buffers. It excludes organizer emails, private meeting links,
conflict reasons, submissions, invitation/authentication data, tokens, source
feed addresses, and audit payloads.

The operational export is limited to 5,000 rows and rejects an oversized
result. Organizer assignments do not automatically round-trip: CSV import
requires explicit authenticated email mapping.

## Read-only private calendar subscription

An active Owner, Administrator, or Organizer can create and revoke only their
own private calendar URLs from the Calendar workspace. The raw 256-bit
URL-safe token is shown once. D1 stores only its lowercase SHA-256 hash. Each
profile may have no more than three active tokens.

Every feed request revalidates the token, organization, profile, and active
membership. Revocation, suspension, removal, profile deletion, or organization
mismatch denies the feed immediately. `last_used_at` is updated no more than
once per day; simultaneous first reads converge without duplicate durable
touches. Responses are private/no-store, no-referrer, nosniff, and noindex.

The feed contains scheduled Ideas, Drafts, tentative Holds, Confirmed or
Published events, and relevant cancellations that the member may already see.
It includes only title, schedule, timezone, club, lifecycle status, an approved
public venue label where available, and the authenticated internal event URL.
It excludes private notes, meeting links, organizer identity, conflict reasons,
forms, team/invitation data, source-feed URLs, and tokens.

This is a read-only subscription, not two-way sync. Because Phase 7 is
unpublished, external calendar-client behavior is implemented but not
externally verified.

## Owner JSON backup and media routine

The Owner-only JSON action requires live Owner authorization and the explicit
confirmation phrase shown in the workspace. The export has a versioned schema,
generation time, source-revision field, section counts, stable relationships,
pseudonymous `member-N` identity references, explicit included/excluded
sections, a media manifest, and restore limitations. It is sensitive private
product data.

### Exact `vcc-owner-backup-v1` envelope

The top-level JSON object contains only:

- `schemaVersion`: exactly `vcc-owner-backup-v1`;
- `applicationRevision`: the versioned export contract;
- `sourceRevision`: the exact source/build revision embedded in the running
  artifact;
- `generatedAt`: an ISO-8601 timestamp;
- `organization`: allowlisted name, slug, timezone, and created/updated times;
- `counts`: the exact row count for each included section;
- `includedSections`: the section-name allowlist;
- `excludedSections`: the explicit privacy exclusion list;
- `restore`: `automatic:false` plus the restore limitation;
- `sections`: the allowlisted product-data sections below.

The `sections` object contains:

1. `memberships`: `reference`, `role`, `status`, `createdAt`, `updatedAt`,
   `deletedAt`. `reference` is export-local `member-N`; there is no email or
   provider identity.
2. `clubs`: `id`, `name`, `slug`, `description`, `createdAt`, `updatedAt`,
   `deletedAt`.
3. `programs`: `id`, `clubId`, `name`, `slug`, `description`, `createdAt`,
   `updatedAt`, `deletedAt`.
4. `lanes`: `id`, `name`, `slug`, `description`, `sortOrder`, `createdAt`,
   `updatedAt`, `deletedAt`.
5. `categories`: `id`, `name`, `slug`, `description`, `colorToken`,
   `sortOrder`, `createdAt`, `updatedAt`, `deletedAt`.
6. `venues`: `id`, `name`, `slug`, `timezone`, `publicLocationName`,
   `publicAddress`, `privateAddress`, `privateDirections`,
   `accessibilityNotes`, `isPublic`, `createdAt`, `updatedAt`, `deletedAt`.
7. `events`: `id`, `clubId`, `programId`, `laneId`, `categoryId`, `venueId`,
   pseudonymous `primaryOrganizer`, `title`, `slug`, `summary`, `description`,
   `privateNotes`, safe `meetupEventUrl`, `planningStatus`,
   `publicationStatus`, `scheduleShape`, `startsAtUtc`, `endsAtUtc`,
   `timezone`, `allDayStartDate`, `allDayEndDateExclusive`,
   `bufferBeforeMinutes`, `bufferAfterMinutes`, `contentVersion`,
   `scheduleVersion`, pseudonymous `createdBy`/`updatedBy`, `createdAt`,
   `updatedAt`, `deletedAt`.
8. `eventOrganizers`: `eventId`, pseudonymous `member`, `createdAt`,
   `deletedAt`. Rows with no mapped export-local member are omitted.
9. `eventRevisions`: `id`, `eventId`, `action`, `contentVersion`,
   `scheduleVersion`, contextual allowlisted `snapshot`, pseudonymous `actor`,
   `createdAt`.
10. `conflictPolicy`: `policyVersion`, `mode`, `configuredAt`,
    `defaultHoldHours`, `nearingExpiryHours`.
11. `pages`: `id`, `title`, `slug`, `status`, `visibility`,
    `currentRevision`, `publishedAt`, `createdAt`, `updatedAt`, `deletedAt`.
12. `pageSections`: `id`, `pageId`, `sectionKey`, `sectionType`,
    section-type-specific allowlisted `content`, `sortOrder`, `createdAt`,
    `updatedAt`, `deletedAt`.
13. `cmsRevisions`: `id`, `entityType`, `entityKey`, `revisionNumber`,
    allowlisted `snapshot`, `contentHash`, `restoredFromRevisionId`,
    pseudonymous `actor`, `createdAt`. Snapshots are parsed through the exact
    page/Club/Program/Community/navigation/Site Identity/legal contract.
14. `communityLinks`: `id`, `label`, safe public `url`, `linkType`,
    `isPublished`, `sortOrder`, `createdAt`, `updatedAt`, `deletedAt`.
15. `navigation`: `id`, `label`, `placement`, `pageId`, safe public
    `externalUrl`, `sortOrder`, `isPublished`, `createdAt`, `updatedAt`,
    `deletedAt`.
16. `publicSettings`: `key`, key-specific allowlisted `value`, `createdAt`,
    `updatedAt`. Unknown or unsafe values are omitted.
17. `media`: `id`, `fileName`, `mimeType`, `byteSize`, `width`, `height`,
    `sha256`, `publicClassification`, `altText`, `caption`, `credit`,
    `informative`, `rightsStatus`, `rightsSourceNote`, `consentStatus`,
    `participantConsentNote`, `createdAt`, `updatedAt`, and `usages`.
    Each usage contains only `entityType`, `entityId`, `revisionId`,
    `usageKind`, and `publicationScope`; no R2 key or permanent URL appears.

The 17 product sections and media manifest are read together in one bounded
18-statement transactional D1 batch, so the exported cross-section is not
assembled from separately committed reads. Each section uses an explicit
maximum plus one row. The export rejects an over-limit section rather than
truncating it. Nested objects are contextually allowlisted; arbitrary D1 rows
or application JSON are never serialized generically.

It excludes email addresses, Sign in with ChatGPT/provider identifiers,
invitations, sessions, raw tokens and token hashes, private subscription URLs,
Meetup source-feed addresses, form protection keys, rate fingerprints, form
submissions and notes, raw import cells, notifications, generic audit payloads,
environment/runtime values, credentials, and R2 object keys. The audit receipt
records only export type, actor, time, schema version, and row counts.

The Owner-run recurring routine is:

1. Preserve the exact current source revision locally, excluding environment
   files, local D1 stores, logs, and generated secrets.
2. Generate the Owner JSON backup.
3. Download the media manifest.
4. Download each required original through its authenticated asset-ID route and
   verify the recorded SHA-256 value.
5. Store those artifacts in an Owner-controlled secure location.
6. Periodically rehearse the documented mapping in a nonproduction local
   database.

Saved Sites versions are not an automatic backup. There is no scheduler,
automatic restore, or complete infrastructure backup. Identity, tokens,
source-feed secrets, public forms, rate-limit state, runtime configuration, and
R2 key layout must be recreated through their authorized operational
workflows.

### Dependency-order restore mapping

Phase 7 has no automatic or in-app restore. The following mapping is
documentation for a reviewed disposable-local rehearsal, not a command to
write production:

1. Verify the backup schema version, exact source revision, artifact checksum,
   JSON parse, section names, and every declared count before creating rows.
2. Apply the matching source migrations to an empty disposable local D1
   database and reach current invariant readiness.
3. Map the organization first.
4. Recreate identity and active membership through the normal authentication
   and invitation workflows. Build a private mapping from each export-local
   `member-N` reference to the newly authorized local profile. Do not invent or
   restore provider identifiers.
5. Map lanes, categories, venues, Clubs, and Programs in dependency order,
   preserving stable relationships only after same-organization validation.
6. Map events, then event-organizer links, event revisions, and conflict policy
   using the member and taxonomy/venue/Club/Program mappings.
7. Map pages, page sections, CMS revisions, Community links, navigation, and
   public settings through the current CMS save/publish services. Do not insert
   public projections or receipts directly.
8. Recreate media metadata through the authorized media workflow, upload each
   separately downloaded asset, verify its recorded SHA-256 when present, and
   rebuild usages from the mapped entity/revision references. Never restore an
   old R2 key.
9. Recreate excluded operational facts only through their normal workflows:
   invitations, tokens, Meetup source feeds, public-form keys, and runtime
   configuration are deliberately absent.
10. Run `PRAGMA foreign_key_check`, all current runtime invariant counts,
    source/schema/snapshot checks, per-section count reconciliation, checksum
    verification, and private/public leakage scans before treating the
    rehearsal as structurally valid.

This mapping does not promise byte-for-byte identity or an automated production
restore. Any future restore tool would require a separate design, authorization,
and verification phase.

### Restore rehearsal status

**Not run.** No disposable local-D1 restore rehearsal result has been recorded
for the current Phase 7 artifact. Final release documentation must keep this
label unless the exact source revision, backup checksum, dependency mappings,
foreign-key check, invariant counts, and rehearsal outcome are actually
measured.

## Known limitations

- ICS file import — Not implemented — authorized cut.
- Imports never publish and have no overwrite/update mode.
- No email is sent by exports or calendar subscription actions.
- There is no automatic backup or automatic retention purge.
- External private-calendar clients are not hosted-verified before a later
  authorized deployment.
