# Organizer guide — Phase 8 hardening

Phase 8 preserves the Phase 7 organizer workflows while making access and
state changes fail closed.

## Access and current-state checks

- Every protected request revalidates the active profile, current membership,
  organization, role, and any required club or submission assignment.
- Suspension, removal, reassignment, or role loss takes effect immediately.
- A page may deny a response when access or record state changes between two
  reads. Reload and reopen the record from the organizer workspace.
- Crafted organization, member, event, submission, import, media, export, or
  token identifiers never widen access.

## Private workflows

- Event conflicts, overrides, drafts, previews, imports, submissions, notes,
  CMS revisions, media originals, and operational downloads stay inside the
  private organizer boundary.
- Marking a submission Responded records a manual response outside the
  application; it does not send an email.
- Private calendar tokens are personal, shown once, and revocable. Never place
  the raw URL in notes, logs, screenshots, or shared documents.
- If a save or download fails after concurrent state changed, review current
  state before retrying. The application does not silently reuse stale
  authorization or conflict facts.

## Verification status

The exact local security, accessibility, responsive, performance, dependency,
and regression evidence is recorded in `BUILD_STATUS.md`. Phase 9 separately
verified representative production Organizer workspaces in view-only mode,
the private cache/indexing boundary, and safe validation behavior without
committing a synthetic event or other product record.

Live Sites version 16 is now active at
`https://vancouver-curiosity-club.reza5777.chatgpt.site` under the explicitly
authorized public visitor policy. Organizer access still requires Sign in with
ChatGPT plus a current active membership; public access grants no organizer
authorization. The Sites project contains one Owner and zero groups, so hosted
second-identity Organizer behavior is **Not run** rather than inferred from the
local test seam.

Owner smoke, approved-real-artwork review, and external calendar-client
behavior remain pending. Hosted D1 now contains real source-backed Meetup
events, and live version 16 passed an individual event/poster/Meetup-link smoke.
The one synthetic production-smoke event was a clearly labelled private Draft;
after its public-absence check it was archived and moved to deleted items,
leaving only the expected private record and immutable audit trace.

The newer mathematical-icon, fuller-About, and curated Meetup enrichment work
is an unsaved and undeployed source candidate. Its reconciliation helper is an
owner-invoked maintenance workflow, not a daily scheduler or Meetup write-back
path.
