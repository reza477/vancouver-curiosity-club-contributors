# Vancouver Curiosity Club — Owner Inputs

No value below may be guessed, inferred, or replaced with sample production
data.

## Identity and bootstrap

- `INITIAL_OWNER_EMAIL`: **Configured in Sites runtime settings as a secret**
  from the existing owner identity in Sites access metadata. The value is not
  copied into this file or source. It will become active only with a future
  owner-authorized deployment.

## Meetup connection

- Exact official Meetup calendar feed operator inputs: **Supplied** for all
  three groups and independently smoke-tested. The private feed addresses are
  intentionally not recorded here, in source, or in build artifacts.
- Confirmed exact program/group mapping:

  - **Vancouver Curiosity Club** —
    https://www.meetup.com/vancouver-meetup-group/
  - **Vancouver Literature and Film** —
    https://www.meetup.com/vancouver-literature-and-film/
  - **Vancouver Fantasy & Sci-Fi Group** —
    https://www.meetup.com/vancouver-fantasy-scifi-meetup-group/
- Public per-program URL fields/pages: **Implemented and verified in Phase 2**
  using only the three confirmed clean public group URLs above. Private
  calendar-feed configuration remains separate.
- Exact public Meetup discussion URL: **Missing**
- Owner-selected real event RSVP URLs for a hosted production smoke test:
  **Missing**. The earlier isolated feed smoke test verified official RSVP
  destinations without committing them as fixtures; the Phase 2 review
  database intentionally contains no real event.

Until a future owner-authorized deployment activates the runtime revision and
the feeds are entered through the authenticated organizer workspace into
Sites-managed D1, hosted production imported event data remains empty. Feed
URLs are private configuration: they must not be copied into public content,
client state, logs, or this file.

## British Columbia legal identity

- Exact legal name: **Missing**
- Legal form/status wording: **Missing**
- Registration number: **Missing**
- Effective date: **Missing**
- Approved legal footer: **Missing**
- Charity status and approved wording: **Missing**

Until these are supplied and approved, the site must not publish a legal-status,
society-registration, tax, or charity claim.

## Copy approval

- Approved public copy: **Missing**. Phase 2 contains restrained, D1-backed
  starter copy that remains subject to owner approval and later authorized CMS
  editing.
- Working tagline currently supplied: `A social calendar with a brain.`

## Public contact and permanent origin

- Confirmed public contact email address: **Missing**. Phase 2 uses only the
  confirmed Meetup group destinations and renders no fake form.
- Stable production Sites origin: **Missing until a future owner-authorized
  deployment**. Downloadable QR codes remain blocked.
- Custom domain: **Not requested and not required**

## Photography and consent

- Real photographs: **Missing**
- Rights/license state for each photograph: **Missing**
- Required credit for each photograph: **Missing**
- Participant-consent state for each identifiable person: **Missing**

No AI-generated attendee faces or unapproved photographs may be substituted.

## Public organizers

- Approved public organizer names: **Missing**
- Approved public organizer biographies: **Missing**
- Profile-level public-attribution consent: **Missing**
- Per-event permission to display each organizer: **Missing**
- Approved venue names, addresses, and venue-specific accessibility facts:
  **Missing per event**

The public projection defaults organizer attribution to private and requires
both consent gates before displaying a name.
