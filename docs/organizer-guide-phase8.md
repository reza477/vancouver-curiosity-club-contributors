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
and regression evidence is recorded in `BUILD_STATUS.md`. Owner smoke,
approved-real-artwork, hosted second-identity, and external calendar-client
checks are not implied by local synthetic verification.

Live owner-only version 8 is unchanged. Phase 9 deployment has not started.
