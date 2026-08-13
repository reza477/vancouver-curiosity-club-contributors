# MASTER REFERENCE SPECIFICATION — VANCOUVER CURIOSITY CLUB WEBSITE AND ORGANIZER PORTAL

> **Historical initial-build specification.** It records the constraints that
> governed the first implementation, not the current host, domain, repository,
> backlog, or maintenance workflow. Start with [DEVELOPMENT.md](DEVELOPMENT.md)
> and verify live state before relying on anything below.

You are the primary product designer, full-stack engineer, database architect, security engineer, QA lead, and deployment engineer for this project.

Build a complete, production-capable website from scratch for Vancouver Curiosity Club and its community events. The project must include:

1. A distinctive, editorial-quality public website
2. Multiple club and program pages
3. A database-driven public events calendar
4. A private, invitation-only organizer portal
5. A shared internal planning calendar for approximately 10–12 co-organizers
6. Reliable, concurrency-safe event-conflict detection
7. A content-management system the owner can operate without editing code
8. Authentication, authorization, testing, documentation, and verified deployment

The sole production hosting target is **OpenAI/ChatGPT Sites**. Use the Sites-generated production URL ending in `chatgpt.site` as the canonical URL, but do not promise the exact hostname until deployment returns it. The owner must not need to buy a domain, open a separate hosting account, create a Supabase project, create a GitHub account or repository, configure Resend, or purchase another service for the first release.

This is a completely new ChatGPT Site. Do not inspect, select, copy, import, reuse, migrate, or adapt any previous Site, repository, project ID, slug, access policy, source code, data, D1 database, R2 storage, database schema, component, design, branding, configuration, credential, content, or asset. Create one fresh Sites project from a fresh local directory and leave every existing Site untouched. A generic future external-community link may be configurable, but no previous-project implementation may enter this codebase.

This document defines the complete product, but implementation is strictly phase-gated. In any one website-chat session, complete only the phase explicitly authorized for that session. Finish every safe, unblocked requirement inside that phase, run the phase-specific checks, update `BUILD_STATUS.md`, provide a five-minute owner smoke-test card, and then stop for owner review. Do not begin the next phase automatically.

Do not merely provide a plan, wireframe, mock-up, homepage, or snippets. Within the currently authorized phase, build the actual working application.

## 1. Working instructions and project isolation

Start by inspecting the selected new-project workspace and the tools available to you.

Before implementation:

1. Read all repository instructions, including any `AGENTS.md`, README, package configuration, deployment configuration, and environment documentation.
2. Confirm that this is a clean new-project directory created for Vancouver Curiosity Club.
3. If any file, Git history, `.openai/hosting.json`, deployment identity, database binding, or source appears to belong to a previous project, do not reuse it. Move this build to a clean new-project directory or stop and report the collision.
4. If the clean workspace is empty, initialize the supported Sites starter once. Do not run a second initializer.
5. State the selected Sites-compatible stack and why it fits the available environment.
6. Create a concrete plan for the currently authorized phase only.
7. Begin that phase immediately after the short stack explanation.
8. Store this complete specification as `MASTER_BUILD_SPEC.md` in the new project so later phase sessions can reread it without receiving the entire prompt again.
9. Maintain `BUILD_STATUS.md` as the authoritative progress ledger.
10. At the end of the active phase, stop for owner review. Continue only after the owner explicitly authorizes the next phase.
11. Ask a question during a phase only when a missing credential, owner-supplied fact, or essential decision prevents further useful work. The phase-end review is a required gate.
12. Complete every unblocked part of the active phase before reporting a blocker. Do not abandon unrelated phase work because one integration is blocked.
13. Use real platform-backed persistence. Never use `localStorage`, temporary arrays, static JSON, or in-memory mock data as the production source of truth.
14. Use browser storage only for non-authoritative device preferences such as theme, dismissed notices, or a last-selected view.

`BUILD_STATUS.md` must record:

* Project name and new-project path
* Sites project identity, without exposing credentials
* Active phase and authorized scope
* Completed-and-verified work
* Implemented-but-not-verified work
* Tests and commands actually run, with results
* Tests not run and the exact reason
* Owner smoke test, initially marked `Awaiting owner`
* Blockers
* Missing owner inputs
* Authorized scope cuts
* Known limitations
* Saved Sites version and deployment status when applicable
* Exact next phase or action

Use external services only through an existing owner-authenticated connection and only when the available tool explicitly supports the action. Never:

* Create a personal account on the owner’s behalf
* Purchase a domain, subscription, or plan
* Enter billing information
* Accept new commercial terms for the owner
* Fabricate credentials or API keys
* Expose secrets
* Claim provisioning, email delivery, synchronization, migration, backup, or deployment succeeded without verification

For the first release, do not create or require:

* GitHub
* Supabase
* PostgreSQL
* Vercel, Netlify, or another host
* A custom domain
* Google OAuth credentials
* Resend, SMTP, or another email-delivery provider

Use the native Sites capabilities specified in section 5.

If a requested capability is unavailable in the current Sites environment:

* Verify the limitation rather than assuming it
* Complete all unrelated work in the active phase
* Create a clean integration boundary if one is useful
* Provide a functional manual fallback when safe
* Hide or disable unavailable controls honestly
* Record the exact limitation in `BUILD_STATUS.md`
* Never silently deploy to another platform
* Never simulate success

## 2. Project identity and legal-status guardrails

Use this editable identity:

* Public-facing brand: **Vancouver Curiosity Club**
* Umbrella organization working name: **Vancouver Curiosity and Education Society**
* Location: Vancouver, British Columbia, Canada
* Default timezone: `America/Vancouver`
* Initial owner display name: Reza
* Working tagline: **A social calendar with a brain.**

Brand names, tagline, colors, typography, logo, and public footer language must be editable in Settings.

The owner has stated that the Society is formally registered in British Columbia. Do not infer or invent the exact legal name, legal form, registration or incorporation number, effective date, or approved public wording. During initial owner setup, collect and store:

* Exact legal name
* Jurisdiction
* Owner-supplied legal form or status wording
* Registration or incorporation number
* Effective date
* Owner-approved legal footer
* Confirmation actor and timestamp
* CRA registered-charity status, defaulting to `unconfirmed`
* CRA charity number, blank by default

Until the owner confirms those details, describe the project publicly only as a community organization and leave legal-status claims unpublished.

After confirmation, display only the exact owner-approved legal wording.

Track provincial society or incorporation status separately from CRA registered-charity status. Never infer charitable status from BC registration.

Do not publicly claim that the organization is:

* A registered charity
* A tax-deductible charity
* Government-funded
* Eligible to issue tax receipts
* A holder of a CRA charity number
* Any legal form or status the owner has not explicitly confirmed

Missing legal details must block only unsupported legal claims, not unrelated development.

## 3. What the organization does

This is a Vancouver community built around intelligent, approachable events, shared experiences, and substantive conversation.

Event subjects include:

* Literature
* Book discussions
* Film discussions
* Movie outings
* Philosophy
* Psychology
* Debate
* Artificial intelligence
* Technology
* Science fiction and fantasy
* Anime and speculative fiction
* Poetry
* Meditation
* Journaling
* Silent reading
* Art and culture
* Workshops
* Restaurant outings
* Hiking and park walks
* Karaoke
* Social gatherings

The public tone should be warm, human, intelligent, socially inviting, and slightly literary.

Avoid:

* Corporate nonprofit clichés
* Robotic AI language
* Academic stiffness
* Generic networking-community language
* Fake inspirational slogans
* Exaggerated marketing claims
* Fake testimonials
* Fake attendance statistics
* Fake awards, sponsors, partners, or press mentions

Do not use lorem ipsum.

If factual content is missing, create honest editable starter copy without inventing history, statistics, organizers, funding, accessibility guarantees, or permanent event schedules.

## 4. Clubs, programs, event lanes, and confirmed Meetup links

Model the site so one umbrella organization can operate multiple clubs and recurring programs.

Create these exact editable starter program records:

1. Vancouver Curiosity Club
2. Vancouver Literature and Film
3. Vancouver Fantasy & Sci-Fi Group
4. Off-Radar Eats
5. Contemplative Meditation + Journaling Circle

Preserve these exact public names unless the owner changes them.

Every starter program must support a confirmed real Meetup group URL. Program URLs and individual event RSVP URLs are separate fields.

* Seed a URL only when the owner supplies it or it is verified as the exact official destination.
* Group URLs may repeat when multiple programs genuinely use the same Meetup group.
* If a URL is missing, leave it null, hide the public link, keep the record in draft when appropriate, and record the missing input in `BUILD_STATUS.md`.
* Never invent, guess, or publish a placeholder Meetup URL.

Do not invent organizers, meeting cadence, statistics, or unsupported descriptions. Keep a program in draft until it has enough confirmed content for publication.

Administrators must be able to add, edit, publish, unpublish, reorder, feature, archive, and safely delete programs.

Create four editable event lanes:

### Think

Books, film, philosophy, debate, psychology, artificial intelligence, technology, and serious discussion.

### Reset & Make

Meditation, journaling, poetry, creative workshops, reflective practice, and silent reading.

### Explore

Walks, hikes, art, culture, neighbourhood outings, and discovering Vancouver.

### Eat & Play

Restaurant outings, karaoke, casual social events, and playful community gatherings.

Model these concepts separately:

* Organization
* Club or Meetup group
* Program or recurring series
* Event lane
* Event category
* Individual event

An event belongs to one primary club or program while also appearing in the organization-wide calendar.

## 5. Required ChatGPT Sites architecture

Use a modular monolith on OpenAI/ChatGPT Sites.

Required platform architecture:

* The supported Sites starter and its Cloudflare Worker-compatible build
* TypeScript with strict type checking
* App Router-style server and client boundaries supported by the starter
* Cloudflare D1, provisioned and managed through Sites, for durable structured data
* Cloudflare R2, provisioned and managed through Sites, for uploaded media and file contents
* Sign in with ChatGPT, handled through the Sites platform, for organizer identity
* Server-side membership and role authorization stored in D1
* Tailwind CSS or the starter’s maintainable styling system
* Accessible component primitives
* Server-side schema validation using Zod or an equivalent
* Vitest or an equivalent unit-test framework
* A Sites-compatible integration-test setup
* Browser end-to-end tests when the environment supports them
* Automated accessibility checks using Axe or an equivalent
* Sites production deployment only

Declare the logical bindings in `.openai/hosting.json`:

* D1 binding, normally `DB`
* R2 binding, normally `MEDIA`

Let Sites own the real resource provisioning and deployment wiring. Do not invent, derive, or manually substitute Sites project IDs.

Create a Sites project only once for this new local site. If `.openai/hosting.json` contains a `project_id` for this exact new site, reuse it. If it belongs to another site, do not reuse it.

Use the Sites-managed source repository and version workflow. Do not require a separate GitHub repository.

Use the `chatgpt.site` production URL returned by Sites. Do not hardcode or promise the exact hostname before deployment, and do not require a purchased domain.

Do not add Supabase, PostgreSQL, Firebase, Clerk, Auth0, Resend, or another external backend unless the owner later changes the product direction in writing. A platform limitation is a review gate, not permission to change architecture silently.

Create:

* `.openai/hosting.json`
* `.env.example` containing only genuinely used variable names and explanations, with no secrets
* D1 schema definitions
* Generated D1 migrations
* R2 media metadata schema
* Development-only seed data
* Separate development, test, and production behavior
* Central validation utilities
* Central authentication and authorization helpers
* Timezone-safe scheduling utilities
* Error boundaries
* Structured server logging that excludes private content
* `MASTER_BUILD_SPEC.md`
* `BUILD_STATUS.md`
* `OWNER_INPUTS.md`
* A clear README

`OWNER_INPUTS.md` must track:

* Initial owner ChatGPT account email
* Exact legal registry details
* Exact Meetup group and discussion URLs
* Real event RSVP URLs used for production smoke tests
* Approved public copy
* Real photographs, rights, credits, and participant-consent status
* Any approved public organizer names or biographies

Keep scheduling logic, authorization, publishing rules, public projections, and conflict detection in domain or service modules. UI components must never be the authoritative source of business rules.

Phase 1 must include a dated architecture decision record confirming the current Sites capabilities actually used. Do not repeat stale third-party pricing or platform-limit claims.

Sites is a public-beta hosting service with plan-specific limits. Do not promise a permanent free tier, fixed quota, data residency, enterprise SLA, indefinite availability, or a hostname before the platform confirms it. Record current verified limitations in the architecture decision record and owner documentation.

## 6. Two strictly separated website surfaces

Build one application using D1 and R2, with two clearly separated areas.

### Public website

Example routes:

* `/`
* `/events`
* `/events/[slug]`
* `/clubs`
* `/clubs/[slug]`
* `/community`
* `/about`
* `/get-involved`
* `/host-an-event`
* `/contact`
* `/conduct`
* `/accessibility`
* `/privacy`

### Private organizer portal

Example routes:

* `/organizer`
* `/organizer/calendar`
* `/organizer/events`
* `/organizer/events/new`
* `/organizer/events/[id]`
* `/organizer/conflicts`
* `/organizer/clubs`
* `/organizer/content`
* `/organizer/media`
* `/organizer/team`
* `/organizer/submissions`
* `/organizer/import`
* `/organizer/settings`

Public pages may be indexed.

Authentication, sign-in, invitation, preview, and organizer routes must be `noindex` and protected on the server.

Never rely on hidden navigation, client-side redirects, or concealed buttons as security.

## 7. Public website navigation

Use a concise primary navigation:

* Events
* Clubs
* Community
* About
* Get Involved
* Organizer Login

The footer should contain:

* Vancouver Curiosity Club
* Confirmed legal organization wording only when enabled
* Brief editable mission statement
* Vancouver, BC
* Events
* Clubs
* Community
* About
* Get Involved
* Contact
* Code of Conduct
* Accessibility
* Privacy
* Confirmed Meetup and social links
* Copyright year

Do not crowd the primary navigation with policy pages.

## 8. Public homepage

Build a complete, polished homepage containing:

1. A clear hero introducing Vancouver Curiosity Club
2. The editable working tagline
3. A prominent **Explore Upcoming Events** action
4. The next three to six published events from D1
5. The four event lanes
6. Featured clubs or programs
7. A short explanation of what attending feels like
8. A section inviting people to volunteer, host, or partner
9. A visible Community section explaining where conversation currently happens
10. Confirmed links to the relevant Meetup community
11. Organizer login in the navigation or footer
12. Appropriate loading, empty, and error states

Do not hardcode upcoming events. They must come from the public event projection in D1.

Publish a Community call to action only when its real destination URL exists.

Do not publish fake community statistics, reviews, testimonials, organizer biographies, or awards.

## 9. Public clubs and program pages

Create a reusable, database-driven template.

Each program supports:

* Name
* Stable slug
* Short summary
* Full description
* Parent organization
* Event lane
* Program type
* Cover artwork
* Thumbnail
* Image alt text
* Theme color
* Draft or public status
* Featured status
* Display order
* What participants can expect
* Optional preparation information
* Optional typical format
* Confirmed Meetup group URL
* Social links
* Upcoming published events
* Past published events
* Related resources

Authorized users must manage these pages without editing code.

A program page automatically displays its upcoming published events.

## 10. Public event discovery

Build a public Events section with:

* Accessible list view
* Calendar or date-browsing view
* Upcoming events tab
* Past events tab
* Keyword search
* Date or date-range filter
* Club or program filter
* Event lane filter
* Event category filter
* In-person, online, hybrid, or location-undecided filter
* Clear Filters action
* Result count
* Shareable filter URLs
* Pagination or incremental loading
* Useful empty states

Default to upcoming events ordered chronologically.

On phones, prioritize a readable event list or agenda instead of squeezing a desktop calendar into tiny columns.

Each public event card shows only approved public information:

* 16:9 event artwork or accessible category fallback
* Event title
* Full date
* Start and end time
* Program or category
* Format
* Public venue area or online label
* Short public summary
* Manually supplied cancellation, full, or waitlist state
* View Event action

Never expose:

* Drafts
* Ideas
* Tentative holds
* Confirmed but unpublished events
* Conflict warnings or overrides
* Private notes
* Private meeting links
* Team or invitation data
* Member email addresses
* Audit history

## 11. Public event details

Each published event page supports:

* Stable public URL
* Event title
* 16:9 artwork and alt text
* Program, lane, and category
* Complete date, time, and timezone
* In-person, online, hybrid, or location-undecided status
* Approved public venue name and address
* External map link
* Public description
* What to expect
* Reading or viewing preparation
* What to bring
* Arrival instructions
* Weather policy
* Cost text
* Capacity
* Manually controlled Open, Full, Waitlist, or Cancelled state
* Verified accessibility information
* Optional publicly visible host names
* Real Meetup RSVP URL
* Add-to-calendar download
* Native or normal share links
* Related upcoming events
* Past-event state
* Prominent cancellation or material-change banner

The primary RSVP action should normally be **RSVP on Meetup** and must link to the event’s real Meetup URL.

Do not build fake internal RSVP functionality. If no real destination exists, hide the button and show an honest alternative such as “RSVP information coming soon.”

Keep previously published cancelled-event pages accessible with a prominent cancellation notice. Remove them from the default Upcoming list.

## 12. Permanent links and QR sharing

Keep `/events` as a permanent public event-hub URL suitable for sharing and printing as a QR code.

When implemented and after a stable Sites production URL exists, allow administrators to download:

* A QR code for the Events page
* A QR code for a published event
* A QR code for a club page

QR codes must point directly to the real Sites production URL and must not depend on a temporary tracking service.

Downloadable QR generation is an authorized low-priority cut. Permanent shareable URLs are not.

## 13. Private organizer portal

The organizer portal is for approximately 10–12 co-organizers.

It must include:

* Sign in with ChatGPT
* Invitation acceptance
* Initial owner onboarding
* Organizer dashboard
* Shared organization-wide calendar
* Agenda, day, week, and month views
* Add, edit, duplicate, cancel, restore, and safely delete event actions
* Tentative holds
* Event publication workflow
* Conflict-review centre
* Team and invitation management
* Clubs and categories
* Public-content management
* Media management
* In-app notifications
* Import and export
* Form submissions
* Activity and revision history
* Personal preferences
* Organization settings

Use reliable polling or cache invalidation with a visible refresh or reconnect indicator. Use realtime subscriptions only if the current Sites/D1 environment supports them cleanly; realtime is not required for the MVP.

## 14. Organizer portal navigation

On desktop, use a clear sidebar.

On mobile, use an accessible bottom navigation or equivalent containing:

* Calendar
* Add Event
* Conflicts
* Team
* More or Settings

The main calendar header includes:

* Workspace name
* Today
* Previous and next controls
* Current date range
* View switcher
* Filters
* Search
* Add Event
* User menu

Remember each organizer’s last selected view and filters when reasonable. Device-local storage is acceptable for these non-authoritative preferences.

## 15. Authentication, invitations, and membership

The public website requires no account.

The organizer portal is invitation-only.

Use **Sign in with ChatGPT** as the only organizer authentication method for the first release.

Use the platform-provided sign-in and sign-out routes. Do not build:

* A custom password system
* Google OAuth
* Magic-link authentication
* Email-and-password registration
* Public self-registration

After ChatGPT authentication, authorization must still occur on the server:

1. Read the authenticated identity only through the Sites-provided server request context or identity headers.
2. Normalize the authenticated email.
3. Find an active D1 organization membership or a valid invitation for that email.
4. Deny access to authenticated but uninvited users.
5. Revalidate membership and role for every protected server action or API request.

Treat the optional full-name identity as display information only. Fall back to email when absent. Never use a display name for authorization.

Use `INITIAL_OWNER_EMAIL` as a Sites runtime value for Reza’s first account. Never place it in source or `.openai/hosting.json`.

Bootstrap the first Owner only when:

1. No Owner membership exists.
2. The server-authenticated ChatGPT email exactly matches the normalized `INITIAL_OWNER_EMAIL`.
3. One atomic D1 transaction creates the Owner membership and closes the bootstrap path.

After the first owner is created:

* Disable further owner bootstrapping
* Require invitations for additional portal users
* Prevent creation of another owner through public routes
* Require explicit ownership transfer for a new owner

Invitation tokens must be:

* Cryptographically random with at least 256 bits of entropy
* Stored hashed
* One-time use
* Expiring
* Revocable
* Bound to the intended normalized email and organization

The default invitation workflow is a secure copyable link the owner sends manually. No email provider is required.

Never display “Invitation email sent.” The first release does not send invitation email.

Every organizer must use a ChatGPT account whose authenticated email matches the invitation. Document this clearly before the owner sends an invitation.

Sign in with ChatGPT proves identity, not membership. Keep all authorization decisions in server-side code.

## 16. Roles and permissions

Required roles:

### Owner

The owner can:

* Manage the organization
* Invite, suspend, and remove members
* Change roles
* Manage every event
* Manage clubs and site content
* Configure conflict rules
* Export backups
* Transfer ownership
* Manage legal and branding settings

### Administrator

An administrator can:

* Manage events across all clubs
* Manage organizers and invitations
* Manage clubs and categories
* Manage public content
* Publish events
* Review conflict overrides
* Import and export events
* Manage workspace settings except ownership transfer

### Organizer

An organizer can:

* View the complete organization-wide schedule
* Create events in assigned clubs
* Edit events they own
* Edit events for which they are a co-organizer
* Create and release holds
* Publish their own event when workspace policy permits
* Review conflicts involving their events

By default, organizers must not edit or overwrite another organizer’s drafts or events unless they are a co-organizer.

Optional lower-priority roles:

### Editor

If implemented, an Editor can edit public pages and approved public event copy, manage media, and publish approved content. An Editor does not receive team-management or scheduling-administration powers.

### Viewer

If implemented, a Viewer can see the private schedule without editing it.

Editor and Viewer are authorized scope cuts before any required role.

Enforce every permission on the server and in D1-backed authorization logic. Hiding a button is not sufficient.

A removed or suspended user must lose access after membership revalidation.

When removing an organizer who owns future events, require reassignment or cancellation.

## 17. Public and private organizer profiles

Organizer profiles support:

* Display name
* Initials
* Accessible calendar color
* Optional photograph
* Optional public biography
* Public-attribution consent
* Assigned clubs
* Role
* Notification preferences

An organizer appears publicly only when:

* The organizer opted into public attribution
* The event enables public host display

Never expose organizer email addresses, authentication identifiers, roles, or private profile data publicly.

## 18. Event lifecycle

Use separate planning and publication statuses.

### Planning status

* `idea`
* `draft`
* `tentative_hold`
* `confirmed`
* `cancelled`
* `completed`
* `archived`

### Publication status

* `private`
* `scheduled`
* `published`
* `unpublished`

Rules:

* An idea may be unscheduled.
* A draft is internal and does not reserve time.
* A timed draft creates a softer possible-overlap warning.
* A tentative hold reserves time.
* A confirmed event reserves time.
* A published future event reserves time and appears publicly.
* Cancelled, completed, expired, archived, and soft-deleted events do not reserve future time.
* Only `published` events appear publicly.
* “Published to Website” must never be confused with “Published to Meetup.”
* Publishing must not claim to update Meetup.
* A previously published cancelled event keeps its public cancellation page.
* Unpublished events disappear from public listings and sitemaps.
* Completed published events may remain in the Past archive.

Support:

* Create
* Save draft
* Place hold
* Confirm
* Preview public page
* Schedule publication
* Publish to website
* Unpublish
* Duplicate
* Cancel
* Complete
* Archive
* Soft delete
* Restore
* Permanent deletion after a retention period

Use stable public slugs so title changes do not unnecessarily break shared links.

## 19. Tentative holds

A tentative hold contains:

* Owner
* Club
* Proposed date and time
* Expiration date
* Optional internal note

Use a configurable default expiration of 72 hours.

Provide:

* Confirm
* Extend
* Release

A hold whose `hold_expires_at` is in the past must stop reserving time even if no scheduler exists or a reconciliation task fails.

Keep expired holds in history.

Create an in-app notification before expiry when the notification system can do so honestly. Do not assume Sites provides cron or a background scheduler. Reconcile hold state and due notifications during relevant authenticated requests, page loads, polling, or refresh-on-focus.

## 20. Event data

Events support:

* Organization
* Club or program
* Lane
* Category
* Stable title and slug
* Short public summary
* Full public description
* Internal organizer notes
* Primary organizer
* Multiple co-organizers
* Planning status
* Publication status
* Timed or all-day event
* UTC start and end timestamps
* Original IANA timezone
* Separate all-day start and end dates
* Setup buffer
* Cleanup or travel buffer
* In-person, online, hybrid, or undecided format
* Private venue details
* Approved public location text
* Public address
* Private online link
* Optional public online link
* Real Meetup RSVP URL
* External source and external event ID
* Event artwork
* Image alt text
* Image focal point
* Cost text
* Capacity
* Open, Full, Waitlist, or Cancelled state
* Preparation instructions
* What to bring
* Weather note
* Accessibility notes
* Public host-display setting
* SEO title and description
* Hold expiration
* Published timestamp
* Cancelled timestamp
* Created and edited timestamps
* Created-by and edited-by users
* Optimistic-lock schedule version
* Soft-deletion timestamp

Public and internal fields must remain distinctly separated.

## 21. Add and edit event experience

Use one clear form rather than a long wizard.

Place scheduling first:

1. Title
2. Club
3. Date
4. Start time
5. End time
6. Timezone
7. Primary organizer
8. Co-organizers
9. Planning status
10. Publication status

As scheduling information changes, run a debounced, non-authoritative conflict preview.

Show a specific warning such as:

**This overlaps with Sam’s Book Discussion, scheduled from 4:00 PM to 6:00 PM.**

Show:

* Conflicting event title
* Organizer
* Club
* Status
* Date and time
* Exact overlapping period
* Direct overlap or buffer conflict
* View Event action
* Change Time action

Recheck conflicts authoritatively during Save through the mechanism in section 23.

Never silently save an unreviewed conflict. Never erase form information after validation or network errors.

Until Phase 4 is complete and its concurrency test passes, Phase 3 may persist only non-reserving `idea` and `draft` events. Do not enable holds, confirmation, or publication through a bypass path.

## 22. Shared organizer calendar

Provide:

* Agenda
* Day
* Week
* Month

On phones:

* Default to Agenda or the user’s last view
* Keep month cells uncluttered
* Show event dots or counts
* Open a date’s agenda when tapped
* Prefer a readable three-day view over seven squeezed columns

On desktop:

* Provide a full seven-day week
* Provide a conventional month grid
* Allow event details in a drawer or modal

Calendar events show:

* Time
* Title
* Organizer name or initials
* Club
* Planning status
* Publication status
* Conflict indicator

Assign each organizer a consistent accessible color, but always display text or initials.

Provide filters for:

* Organizer
* Club
* Status
* Lane
* Category
* Conflict-only
* Date range

Include search, Clear Filters, and a visible result count.

## 23. D1 conflict-detection engine and atomic writes

Conflict detection is a critical domain feature.

Use half-open interval comparison:

`proposedStart < existingEnd AND proposedEnd > existingStart`

An event ending exactly at 6:00 PM and another starting exactly at 6:00 PM do not directly overlap when the buffer is zero.

Detect:

* Direct organization-wide event overlap
* Setup-buffer conflicts
* Cleanup or travel-buffer conflicts
* Same-organizer double-booking
* Shared co-organizer double-booking
* Shared-venue conflicts
* Possible overlap with a draft
* Approved intentional overlap

Check across every club because different programs may compete for the same organizers, venue, and audience.

Active tentative holds, confirmed events, and published future events reserve time.

Drafts create softer warnings.

Exclude:

* The event currently being edited
* Cancelled events
* Completed events
* Expired holds
* Archived events
* Soft-deleted events

Recheck whenever any of these changes:

* Date
* Time
* Duration
* Timezone
* Organizer
* Co-organizer
* Venue
* Planning status
* Publication status
* Buffer

Perform:

1. A non-authoritative preview while editing.
2. A final authoritative server-side check and write through one database-enforced D1 operation.

All schedule-affecting operations must use the same authoritative write service, including create, edit, duplicate, import, hold, confirm, publish, cancel, restore, organizer changes, venue changes, timezone changes, and buffer changes.

Do not perform a normal application-level `SELECT` conflict check followed later by a separate `INSERT` or `UPDATE`. That sequence can race.

Use this D1-safe mechanism:

1. Create SQLite `BEFORE INSERT` and `BEFORE UPDATE` trigger guards, or an equivalently strong single conditional SQL mutation, that reevaluate active reserving conflicts against canonical D1 rows.
2. The guard must use the complete proposed timezone-normalized interval, buffers, planning and publication states, primary organizer, co-organizers, and venue rather than stale association rows.
3. The guard must abort an unreviewed reserving conflict with a deterministic application error.
4. Use `DB.batch()` for the event mutation, organizer and venue associations, revision, any required conflict incident, valid override, and audit records so the entire sequence commits or rolls back as one D1 transaction.
5. Validate the expected optimistic-lock version in the mutation itself. A stale version must change zero rows or abort, never overwrite.
6. Treat zero affected event rows as a conflict or stale edit, then query only to produce the user-facing explanation. Never interpret zero rows as success.
7. Under **Warn and require a reason**, place the version-bound reason or override record in the same transaction before the guarded mutation.
8. Under **Require administrator approval**, allow the proposed event to remain a non-reserving unresolved draft, but block hold, confirmation, scheduling, and publication until approval.
9. Under **Block overlaps**, abort the reserving mutation.
10. Map database aborts to a clear conflict response and preserve the user’s form data.
11. Make write retries idempotent or do not retry them automatically.

The exact implementation may differ only if it provides equal database-enforced atomicity on the current Sites-managed D1. If the chosen D1 version cannot support this mechanism, stop at the Phase 1 architecture gate with evidence. Do not replace it with an unsafe check-then-write path, and do not silently add another database.

Two people viewing an empty slot and saving overlapping events nearly simultaneously must not silently bypass review.

The concurrency integration test must synchronize two independent requests against the same empty slot. Under a blocking policy, at most one unreviewed reserving write may succeed. Under an override policy, every saved overlap must have the required valid review record.

## 24. Conflict policy and overrides

Support configurable workspace policies:

### Warn and require a reason

Recommended default. An intentional overlap may be saved only after a written explanation stored atomically with the relevant schedule versions.

### Require administrator approval

The event stays unresolved and non-reserving until an administrator reviews the request.

### Block overlaps

The event cannot be held, confirmed, scheduled, or published while the conflict remains.

Store:

* Both event IDs
* Scheduling version of each event
* Conflict type
* Requester
* Approver
* Written reason
* Requested timestamp
* Decision timestamp

Invalidate an override when either event’s relevant schedule version changes.

Do not allow an unresolved blocking conflict to be published.

## 25. Conflict-review centre

Create a dedicated private Conflicts page grouped by date.

Show:

* Both event titles
* Clubs
* Organizers
* Statuses
* Scheduled times
* Exact overlap
* Conflict type
* Override state
* Coordination note
* Activity history

Actions:

* View both events
* Edit my event
* Change time
* Cancel my event
* Request override
* Approve
* Reject
* Mark an informational warning reviewed

Conflict indicators remain visible in the calendar and private event details.

## 26. Public publishing workflow

The organizer enters an event once. Use one underlying record for private planning and public publishing.

Workflow:

1. Organizer creates an idea, draft, or hold.
2. It appears only in the organizer portal.
3. The team sees its proposed time.
4. Conflicts are reviewed.
5. The event becomes confirmed.
6. The organizer completes public fields.
7. The organizer previews the public page.
8. An authorized user chooses **Publish to Website**.
9. The event automatically appears on the public Events page, relevant club page, homepage, sitemap, and public calendar feed when enabled.
10. A visitor opens the public page.
11. The visitor follows the real Meetup URL to RSVP.

Before publishing, validate:

* Title
* Club
* Public summary
* Public description
* Date and time
* Timezone
* Public format
* Approved public location or clear undecided status
* Real RSVP URL or honest alternative
* Image alt text when an image is used
* No unresolved blocking conflict

Provide a private, `noindex` public Preview mode.

## 27. Strict public/private data separation

This is non-negotiable.

Use an explicit allowlisted public query, server projection, or public data-transfer object.

Do not fetch a complete private record and hide fields with CSS.

Public visitors must never receive:

* Internal notes
* Drafts
* Holds
* Conflict data
* Override reasons
* Private venue details
* Private meeting links
* Organizer email addresses
* Invitation information
* Audit history
* Account identifiers
* Private form submissions

Private fields must not appear in:

* Public HTML
* Client hydration data
* JSON responses
* Metadata
* Structured data
* Page source
* Sitemaps
* Public calendar feeds
* Public logs
* Cached public responses

Public caching must never cache authenticated organizer information.

A guessed draft or hold URL must return an appropriate private or not-found response.

## 28. Content-management system and Community link hub

Owners, administrators, and authorized editors must manage the public site without source-code edits.

Provide interfaces for:

* Homepage sections
* About page
* Clubs and programs
* Events
* Resources or reading packets
* Code of Conduct
* Accessibility Statement
* Privacy page
* Navigation
* Footer
* Contact information
* Meetup links
* Social links
* Featured content
* Branding
* SEO titles and descriptions
* Open Graph images
* Publication and unpublication
* Community page or section
* Ordered external conversation links

Each Community link supports:

* Label
* Short description
* Confirmed URL
* Destination type
* Publication status
* Display order

Seed a Meetup discussion link only when the real URL is supplied and verified.

Support an optional future external community-platform URL as a normal unpublished setting. Do not name it publicly until the owner supplies and publishes it. Do not import any code, data, accounts, branding, or implementation from another project.

Use structured content fields or sanitized rich text. Never allow unsafe executable HTML.

Support:

* Draft
* Preview
* Publish
* Unpublish
* Revision history
* Restore previous revision

## 29. R2 media library

Provide a private media-management interface using R2 for file bytes and D1 for metadata:

* Image upload
* File-type validation
* File-size validation
* Responsive image sizes
* Alt text
* Caption
* Credit
* Rights or consent note
* Focal point or crop
* Public and private separation
* Safe deletion checks

Do not silently delete a file still in use.

Optimize event artwork for 16:9 cards and headers.

If an event lacks artwork, use a tasteful accessible category graphic, not a broken image, random stock photo, or AI-generated face.

## 30. Public forms

Build forms for:

* Contact
* Volunteer
* Host an Event
* Venue or Community Partnership

Store submissions privately in D1 and show them only to authorized organizers.

Include:

* Minimum necessary fields
* Clear collection-purpose explanation
* Server-side validation
* Sanitization
* Rate limiting or spam protection
* Honeypot when useful
* Submission timestamp
* New, In Review, Responded, or Archived status
* Private internal notes

Show success only after D1 genuinely stores the submission.

The first release does not send form email. The organizer inbox is the notification destination.

Do not automatically enroll anyone in marketing.

The Privacy page must truthfully explain the personal data collected, why it is collected, retention choices, OpenAI/ChatGPT Sites hosting, Sign in with ChatGPT identity sharing, organizer access, and a contact method. Mark privacy language for owner or legal review; do not claim legal compliance merely because a page exists.

## 31. In-app notifications

Build a real in-app notification centre for:

* Invitation accepted
* New confirmed event
* New published event
* Material event-time change
* Cancellation
* New conflict
* Override request
* Override approval or rejection
* Hold nearing expiration
* Hold expired
* Form submission
* Relevant coordination note

Notify directly affected organizers promptly without notifying everyone about minor changes.

Allow preferences for:

* Important notifications only
* All relevant in-app notifications
* Daily in-app digest, if implemented
* Weekly in-app digest, if implemented

Email notification and email digests are not part of the first release. Do not request Resend or SMTP.

Daily and weekly digests are an authorized scope cut. Core in-app notifications are not.

## 32. Meetup and external integrations

Meetup remains the initial RSVP and attendance system.

For the MVP:

* Store a confirmed Meetup group URL
* Store a real Meetup event URL
* Display **RSVP on Meetup**
* Allow authorized users to paste or edit URLs
* Optionally store an external event ID

Do not:

* Scrape Meetup
* Ask for Meetup passwords
* Modify Meetup drafts
* Overwrite Meetup events
* Show fake Sync buttons
* Claim website publishing publishes to Meetup
* Claim an import or sync succeeded unless it genuinely did

Only add automatic Meetup integration if an official supported API or OAuth flow is later authorized and configured.

Keep future Meetup, Google Calendar, Outlook, maps, and email integrations behind clean optional adapters.

Prefer a normal external map link over an invasive embedded map.

## 33. Import and export

### CSV import

Provide:

* Downloadable CSV template
* Column mapping
* Preview
* Validation
* Organizer mapping
* Club mapping
* Duplicate warnings
* Conflict preview
* Per-row results
* Import history

Suggested fields:

* title
* club
* lane
* category
* start date
* start time
* end date
* end time
* timezone
* planning status
* publication status
* primary organizer
* co-organizers
* location
* Meetup URL
* notes

Imported schedule-affecting writes must use the authoritative service in section 23.

### ICS import

When implemented, support:

* File preview
* Timezone handling
* Duplicate detection
* Organizer assignment
* Import results

ICS file import is the first authorized scope cut.

### Export

Support:

* One-event ICS download
* Filtered public ICS export
* Filtered CSV export
* Owner-only JSON backup excluding credentials and secrets
* Optional revocable private ICS subscription feed

Never place passwords, invitation tokens, auth tokens, identity headers, or secrets in exports.

Do not claim automatic backups are configured. Provide an owner-run JSON export plus a media manifest and document a practical recurring source, data, and media backup routine supported by the current Sites environment.

## 34. Timezone correctness

Use `America/Vancouver` as the default IANA timezone.

Never hardcode Vancouver as UTC−7 or UTC−8.

For timed events:

* Store UTC timestamps
* Store the original IANA timezone
* Display in the workspace or user timezone
* Clearly show a different timezone when relevant

For all-day events:

* Store calendar dates rather than midnight UTC timestamps

Correctly handle:

* Events crossing midnight
* Multi-day events
* Daylight-saving transitions
* Leap dates
* Different organizer timezones
* Timezone changes during editing

Reject:

* End before start
* Zero-duration timed events
* Invalid dates
* Invalid timezone
* Missing organizer
* Invalid URL
* Unsupported status transitions

Use clear public language such as:

**Saturday, August 15, 2026, 4:00–6:00 PM**

## 35. Award-calibre visual direction

The goal is a distinctive, portfolio-quality, award-calibre design. This is a quality ambition, not permission to claim the site has won an award.

The public site should feel like:

* An intelligent cultural magazine
* An independent bookshop event calendar
* An artful community poster system
* Welcoming, social, and alive
* Rooted in Vancouver without resembling a tourist site

Use:

* Warm off-white
* Deep charcoal or midnight navy
* Forest green or teal
* Cobalt blue
* Restrained coral
* Amber for tentative information
* Accessible red for errors and cancellation
* Strong readable typography
* Editorial layouts
* Generous whitespace
* Subtle screen-print, paper, or risograph texture
* Flexible 16:9 event artwork
* Clear information hierarchy
* Restrained purposeful motion
* Memorable art direction without sacrificing usability

Avoid:

* Corporate SaaS styling
* Generic startup gradients
* Glassmorphism everywhere
* Stock-photo handshakes
* Fake conference visuals
* AI-generated community-member faces
* Generic Vancouver skyline clichés
* Gloomy academic styling
* Tiny text
* Decorative clutter
* Excessive animation
* Template-like sections with no editorial rhythm

Use system or open-source fonts with clear licensing.

Make colors, typography, logo, brand names, and tagline editable.

During Phase 1, present exactly three clearly differentiated high-quality visual directions using the same realistic content. Let the owner choose before locking the design system. Do not make three nearly identical color swaps.

Prefer owner-supplied photography from real events when rights and participant consent are confirmed. Store credits and rights information.

Never fabricate attendance, imply a stock photograph depicts this community, or use generated attendee faces.

If real photography is not available, use the editorial category-artwork system and strong typography. Missing photography must not become an excuse for generic design.

## 36. Responsive design

Build mobile-first.

Manually verify at:

* 320-pixel mobile
* 375- or 390-pixel mobile
* Tablet
* 1280-pixel desktop
* 1440-pixel desktop

Requirements:

* No essential horizontal scrolling
* At least 16-pixel body text on mobile
* Approximately 44×44-pixel touch targets
* iPhone safe-area support
* Understandable navigation
* Readable event cards
* Accessible mobile filters
* Graceful image crops
* Viewport-fitting dialogs
* Sticky controls that do not cover content

At 320 pixels, a user must be able to:

* Browse public events
* Open an event
* Reach the Meetup link
* Sign in
* View the organizer agenda
* Create and edit an event
* Review a conflict
* Save or cancel
* Read validation errors

## 37. Accessibility

Target WCAG 2.2 AA.

Implement:

* Skip-to-content link
* Semantic landmarks
* Logical headings
* Full keyboard navigation
* Visible focus
* Correct modal focus trapping and restoration
* Explicit form labels
* Required-field indicators
* Field-level errors
* Error summaries
* Screen-reader announcements
* Text or icons in addition to color
* Sufficient contrast
* Useful image alt text
* Empty alt text for decorative images
* Reduced-motion support
* No essential hover-only interaction
* Accessible date and time controls
* Useful calendar-event accessible names
* Usability at 200% zoom

A screen reader announces an organizer-calendar event in this order:

1. Title
2. Full date and time
3. Organizer
4. Club
5. Status
6. Conflict state

Run automated accessibility tests and manually verify the central keyboard workflow.

Create an editable truthful Accessibility Statement. Do not promise venue accessibility unless confirmed for that event.

## 38. SEO and social sharing

For public pages, implement:

* Unique titles
* Editable meta descriptions
* Clean URLs
* Canonical URLs based on the real Sites production URL
* Open Graph metadata
* A bespoke social-sharing image representing the actual site
* XML sitemap containing only published public content
* Correct `robots.txt`
* Semantic HTML
* Useful breadcrumbs
* Redirects when a public slug changes
* Custom 404
* Server rendering or pre-rendering where appropriate

Use accurate structured data when facts exist:

* Organization
* Event
* BreadcrumbList
* Article for real resources

Do not mark events free, sold out, accessible, sponsored, or available without supplied facts.

Exclude from indexing:

* Organizer portal
* Sign-in
* Invitations
* Private previews
* Drafts
* Holds
* Internal search
* Account pages

Do not expose unconfirmed legal status in metadata or structured data.

## 39. Performance

Prioritize fast public pages.

Use:

* Server rendering or static generation where appropriate
* Safe revalidation after publishing
* Code splitting
* Responsive images
* Modern image formats
* Lazy loading below the fold
* D1 indexes
* Bounded event queries
* Pagination
* Minimal public client JavaScript
* Avoidance of N+1 queries
* Safe caching that cannot leak private data
* Font loading without major layout shifts

Quality targets on representative public pages:

* Mobile Lighthouse Performance near or above 85
* Desktop Performance near or above 90
* Accessibility near or above 95 with no serious or critical violations
* Best Practices near or above 90
* SEO near or above 90
* Largest Contentful Paint near or below 2.5 seconds when measurable
* Cumulative Layout Shift near or below 0.1

Report real measurements. Never fabricate scores.

## 40. Suggested D1 entities

Create normalized D1/SQLite entities equivalent to:

* `organizations`
* `clubs`
* `programs`
* `event_lanes`
* `categories`
* `profiles`
* `organization_memberships`
* `club_memberships`
* `invitations`
* `venues`
* `events`
* `event_organizers`
* `event_revisions`
* `conflict_incidents`
* `conflict_overrides`
* `conflict_policies`
* `pages`
* `page_sections`
* `page_revisions`
* `community_links`
* `media_assets`
* `navigation_items`
* `site_settings`
* `notifications`
* `notification_preferences`
* `form_submissions`
* `audit_logs`
* `import_batches`
* `import_rows`
* `external_source_links`
* `ics_subscription_tokens`

Add:

* Foreign keys
* Organization-scoped uniqueness
* Slug uniqueness
* Sensible indexes
* Check constraints where useful
* Trigger guards required by section 23
* Soft deletion where appropriate
* Created and updated timestamps
* Actor IDs
* Optimistic-lock versions

Index event queries by:

* Organization
* Club
* Planning status
* Publication status
* Start time
* End time
* Organizer
* Venue
* Slug
* Deletion state

Keep each prepared statement to one SQL statement. Use D1 `batch()` when one operation requires multiple transactional statements.

## 41. Security and privacy

Implement:

* Sites-managed Sign in with ChatGPT
* Server-side membership and role authorization
* HTTPS in production
* Secure platform-managed sessions
* CSRF protection where required
* Server-side validation
* Parameterized D1 statements
* Sanitized rich text
* Output escaping
* Rate limiting for sign-in-sensitive actions, invitations, forms, and imports
* Sites-managed runtime values
* Public and private R2 separation
* Organization-level query isolation
* Membership revalidation
* Append-only audit history for sensitive actions
* Safe production errors
* Practical Content Security Policy
* Dependency vulnerability review

D1 does not provide PostgreSQL row-level security. Do not pretend it does. Enforce authorization and organization scoping in server-side services and guarded database operations, then test direct crafted requests.

Never place secrets or private identity data in:

* Source code
* Browser bundles
* Logs
* Test fixtures
* Screenshots
* Database exports
* Public files

Test direct API requests, not only browser buttons.

Changing an event ID, organization ID, club ID, user ID, email, or role in a crafted request must not grant access.

## 42. Activity and revision history

Keep audit and revision history for:

* Event creation
* Time changes
* Organizer changes
* Status changes
* Publishing
* Unpublishing
* Cancellation
* Restoration
* Conflict overrides
* Club changes
* Page changes
* Invitations
* Membership changes
* Role changes
* Legal-status confirmation

Show useful history only to authorized users.

Do not log:

* Session tokens
* Invitation tokens
* Runtime secrets
* Full sensitive form content when unnecessary
* Raw identity headers

## 43. Phase-gated implementation

Complete exactly one numbered phase per website-chat session.

At the start of each phase:

1. Read `MASTER_BUILD_SPEC.md`.
2. Read `BUILD_STATUS.md`.
3. Identify the phase explicitly authorized by the owner or coordinator.
4. Reinspect relevant source and current platform state.
5. Avoid repeating completed work.

At the end of each phase:

1. Run that phase’s relevant checks.
2. Update `BUILD_STATUS.md`.
3. Save a Sites version when the phase produces a valid reviewable candidate.
4. Do not deploy publicly unless that phase explicitly authorizes it and the owner approves.
5. When a phone smoke test requires a hosted URL before Phase 9, an owner-only Sites deployment may be used if supported. Do not widen its audience.
6. Provide the five-minute owner smoke-test card.
7. Mark the owner test `Awaiting owner`.
8. Stop.

Never implement the next phase automatically.

### Mandatory cut order

If environment or session limits force scope reduction, omit only these items, in this order:

1. ICS file import only; retain event and public ICS exports.
2. Downloadable QR-code generation; retain permanent shareable URLs.
3. Daily and weekly notification digests; retain core in-app notifications.
4. Editor and Viewer roles; retain Owner, Administrator, and Organizer.
5. Realtime subscriptions; use reliable polling or cache invalidation with a visible refresh state.

Record each cut as `Not implemented — authorized cut` in `BUILD_STATUS.md` and remove or disable the corresponding control honestly.

If further cuts are required, stop and request an owner decision.

Never cut:

* Sites-backed persistent storage
* Sign in with ChatGPT
* Server-side membership and authorization
* Strict public/private data separation
* The conflict engine
* Atomic conflict writes
* Conflict and concurrency tests
* The public publishing privacy test

### Phase 1 — New-project foundation and architecture gate

Build and verify:

* Clean project isolation
* Sites starter and project linkage
* Exactly one `.openai/hosting.json` identity for this new site
* D1 and R2 logical bindings
* Design-direction comparison and owner selection
* Design system foundation
* D1 schema and migrations
* Sign in with ChatGPT integration
* Owner bootstrap
* Membership and required-role model
* Server authorization
* Public projection pattern
* Validation
* Timezone utilities
* Error handling
* Test setup
* Environment validation
* Architecture decision record
* `OWNER_INPUTS.md`
* A minimal D1 proof showing that the atomic trigger or conditional-write design in section 23 is supported

Run type checking, linting, local migrations, authentication and authorization tests, public-projection tests, the D1 atomicity proof, and the production build.

Do not enable schedule-reserving event writes yet.

Owner smoke test:

* Open the preview.
* Confirm logged-out `/organizer` requires Sign in with ChatGPT and is `noindex`.
* Sign in with the allowlisted owner.
* Refresh and confirm access persists.
* Confirm an authenticated but uninvited account cannot enter.

### Phase 2 — Public website

Build:

* Home
* Events
* Event details
* Clubs
* Club details
* Community
* About
* Get Involved
* Contact
* Policies
* SEO
* Responsive behavior
* D1-backed public event projections
* Honest seed content

Use only confirmed Meetup URLs. Keep incomplete programs and events in draft.

Verify that private information cannot appear publicly.

Owner smoke test:

* On a phone, open Home, Events, one event, one club, and Community.
* Use and clear filters.
* Confirm a known draft or guessed draft URL is unavailable.
* Confirm every visible external link has a real destination.

### Phase 3 — Organizer portal, non-reserving workflow

Build:

* Owner and organizer sign-in flow
* Invitation acceptance
* Dashboard
* Calendar and agenda
* Idea and draft event forms
* Private event details
* Team
* Clubs
* Settings
* Core in-app notifications

Until Phase 4 passes, allow only non-reserving `idea` and `draft` persistence. Holds, confirmation, scheduling, publication, and imports that reserve time must remain unavailable.

Owner smoke test:

* Sign in.
* Create an internal draft.
* Refresh, sign out, and sign back in.
* Confirm the draft persists and is absent publicly.
* Confirm one organizer cannot edit another organizer’s draft without authorization.

### Phase 4 — Conflict engine and reserving writes

Build and test:

* Direct overlaps
* Buffers
* Holds
* Draft warnings
* Organizer and co-organizer conflicts
* Venue conflicts
* Overrides
* D1 transactional trigger or conditional-write guard
* Concurrency protection
* Stale-edit protection
* Conflict-review centre
* All reserving state transitions

Only after the atomic and concurrent-save tests pass may the UI enable holds and confirmation.

Owner smoke test:

* Create a hold.
* Propose an overlap and inspect the exact warning.
* Test a zero-buffer boundary.
* Verify the server refuses an unreviewed blocking conflict.
* Review one intentional overlap.

### Phase 5 — Private-to-public publishing connection

Build and verify the complete workflow from one private event record to a published public event.

Enable publication only through the same authoritative conflict-checked write service.

Owner smoke test:

* Use a real event.
* Confirm the draft is invisible.
* Publish it.
* See it on Events, Home, and the correct club.
* Open its real Meetup link.
* Confirm internal notes and conflict data are absent.
* Cancel or unpublish it and verify the correct public behavior.

### Phase 6 — CMS, Community, and media

Build:

* Page editing
* Club editing
* Community links
* Site settings
* Navigation
* Footer
* R2 media uploads
* Rights and alt-text metadata
* Revision history
* Preview and publication
* Legal-status confirmation controls

Owner smoke test:

* Edit and preview a page.
* Publish it and see the public change.
* Restore a prior revision.
* Upload approved real artwork.
* Confirm an unpublished Community link stays hidden.
* Confirm unverified legal wording stays hidden.

### Phase 7 — Imports, exports, and forms

Build:

* CSV import
* ICS import only if not cut
* CSV and ICS export
* Owner backup
* Contact, volunteer, host, and partnership forms
* Private submissions inbox

Route imported scheduling writes through section 23.

Owner smoke test:

* Preview a CSV containing an invalid row and a duplicate.
* Confirm nothing imports before approval.
* Submit a public form.
* Confirm only an authorized organizer can see it.
* Test an export and verify that it contains no secrets.

### Phase 8 — Hardening

Complete:

* Security review
* Public/private leakage review
* Accessibility review
* Mobile review
* Performance review
* Test expansion
* Dependency audit
* Production build
* Removal of development-only behavior
* Broken-link review
* Honest content review

Owner smoke test:

* At 320 and 390 pixels, browse, sign in, edit an event, and review a conflict.
* Repeat the core workflow by keyboard.
* Check for broken links, dead controls, overflow, and serious accessibility failures.

### Phase 9 — Sites deployment and production verification

Deployment must use Sites only.

1. Reuse the exact new-site `project_id`.
2. Validate the exact source revision.
3. Build the exact revision.
4. Generate and inspect final D1 migrations.
5. Save the exact validated Sites version.
6. Ask for explicit approval before making the site public.
7. Deploy the saved version.
8. Wait for a terminal deployment result.
9. Use the exact production URL returned by Sites.
10. Open the production URL.
11. Verify public pages.
12. Verify protected routes.
13. Test one complete organizer workflow.
14. Confirm private data is inaccessible anonymously.
15. Set canonical URLs to the real Sites production URL.
16. Report the exact production URL.

Do not call a local preview or saved-but-undeployed version production.

Do not promise that the public-beta service, quota, hostname, or deployment will remain available indefinitely. Record any current platform limitations in the final report.

Owner smoke test:

* Open the exact Sites production URL on a phone.
* Verify public pages.
* Verify logged-out organizer protection.
* Sign in as owner.
* Confirm draft privacy.
* Verify one real published event and its Meetup link.
* Do not publish fabricated production test events.

## 44. Required automated tests

Create meaningful tests.

### Unit tests

* Direct overlap
* Exact boundary with zero buffer
* Buffer conflict
* Draft warning
* Hold reservation
* Hold expiration
* Cancelled, completed, expired, archived, and deleted exclusions
* Self-exclusion during edit
* Same-organizer conflict
* Shared co-organizer conflict
* Shared-venue conflict
* Override invalidation
* Status transitions
* Timezone conversion
* Vancouver daylight-saving transitions
* Overnight events
* Multi-day events
* All-day events
* Input validation
* Role permissions
* Public data projection
* Legal language before and after owner confirmation

### Integration tests

* D1 migrations
* Event creation and editing
* Publish and unpublish
* Invitation expiration
* Invitation revocation
* One-time invitation use
* Authenticated but uninvited ChatGPT user denied
* Invited matching identity accepted
* Authentication never creates membership automatically
* Organizer permissions
* Administrator permissions
* Organization isolation
* Suspended-user denial
* Audit history
* Import validation
* Export authorization
* Server-side conflict recheck
* D1 trigger or conditional-write enforcement
* Two concurrent conflicting saves
* Stale edits
* Private-data leakage prevention
* Public HTML, metadata, structured data, and footer before and after legal confirmation

### End-to-end tests

At minimum:

1. Reza creates the owner workspace.
2. Reza creates a secure invitation link.
3. An invited organizer signs in with ChatGPT and accepts.
4. An authenticated but uninvited person is denied.
5. The organizer creates a tentative hold.
6. A second organizer sees the hold.
7. The second organizer proposes an overlap.
8. The app displays the exact conflict.
9. The server applies the configured policy.
10. An authorized user reviews an override.
11. A conflict-free event becomes confirmed.
12. Public fields are completed.
13. The event is published.
14. The event appears publicly.
15. Internal notes remain private.
16. The real Meetup link appears.
17. Cancellation updates the public page.
18. An unauthorized organizer cannot edit another organizer’s event.
19. A removed organizer loses access.
20. Saved events persist across refresh, sign-out, and another browser session.

Use test identities or supported local seams for automated authentication tests. Never weaken production authorization or trust user-supplied identity headers.

## 45. Mandatory acceptance criteria

The application is not complete until these pass:

1. The project is isolated from every prior project.
2. Sites is the only production host.
3. No custom domain, external host, Supabase, GitHub, Google OAuth, or Resend is required.
4. Public visitors understand the organization and reach upcoming events quickly.
5. Visitors can filter events, clear filters, and share filter URLs.
6. Published events appear automatically on the correct public pages.
7. Drafts, ideas, holds, and confirmed-but-unpublished events are inaccessible publicly.
8. Public responses contain no private notes, conflict data, organizer emails, invitations, identity data, or audit records.
9. Cancelled published events show a clear banner.
10. Past events do not appear among upcoming events.
11. Visible program and event Meetup buttons use real supplied URLs.
12. Community calls to action appear only when real URLs exist.
13. Approximately 10–12 organizers can use separate ChatGPT identities and see the same persistent calendar.
14. An authenticated but uninvited user cannot enter the portal.
15. A tentative hold reserves time.
16. A draft produces a softer warning.
17. Cancelled, completed, expired, archived, and deleted events do not reserve time.
18. Reza proposes 5:00–7:00 PM while Sam has 4:00–6:00 PM; a direct overlap is identified before and during save.
19. An event ending at 6:00 PM and another beginning at 6:00 PM do not conflict with a zero buffer.
20. An event ending at 6:00 PM and another beginning at 6:15 PM creates a buffer warning when the buffer is 30 minutes.
21. Editing into a conflict triggers the same checks as creation.
22. Two simultaneous overlapping saves cannot silently bypass conflict review.
23. Organizer and administrator permissions work as specified.
24. One organizer cannot overwrite another organizer’s draft without authorization.
25. Crafted cross-organization IDs cannot expose data.
26. Removed members lose access.
27. Overrides store actor, reason, events, schedule versions, and time.
28. Schedule changes invalidate old overrides.
29. Overnight, multi-day, and all-day events display correctly.
30. Vancouver times remain correct through daylight-saving changes.
31. Events persist after refresh and sign-out.
32. Core workflows function at 320-pixel width.
33. A keyboard-only user can navigate, create an event, and review a conflict.
34. Automated accessibility checks find no serious or critical errors on essential pages.
35. CSV import previews invalid and duplicate rows.
36. Public CMS content can be edited without code changes.
37. All navigation and footer links work.
38. Unconfirmed legal status never appears in public HTML, metadata, structured data, or the footer.
39. Production contains no lorem ipsum, fake statistics, fake testimonials, fake awards, fake integrations, dead buttons, hardcoded credentials, or development accounts.
40. The visual result is distinctive and editorial, not a generic SaaS template.
41. The production build succeeds without ignored type errors or critical lint failures.
42. A claimed production deployment has been opened and verified at the exact Sites URL.

## 46. Commands and verification

At the end of each phase, run the relevant subset of:

* Dependency installation
* D1 migration generation and local application
* Type checking
* Linting
* Unit tests
* Integration tests
* End-to-end tests
* Accessibility checks
* Production build
* Dependency or security audit
* Local or deployed smoke tests

Before Phase 9 completion, run the complete applicable set.

Do not:

* Disable failing tests
* Weaken assertions merely to pass
* Skip critical tests
* Use blanket lint suppression
* Cast away meaningful type errors
* Ignore broken builds
* Claim unrun tests passed
* Mark the owner smoke test passed before the owner reports it

If a test cannot run, record it as `Not run` and explain why.

## 47. Non-goals for the first release

Do not delay the core release to build:

* Public attendee accounts
* Internal RSVP management
* Ticket sales
* Payment processing
* Donations
* Tax receipts
* On-site social networking
* Public comments
* Direct messages
* A forum
* Complicated analytics
* Native iPhone or Android apps
* Automatic Meetup publishing
* Two-way Google or Outlook synchronization
* Complex recurring-event editing
* A newsletter-delivery platform
* Email notifications
* External OAuth
* A custom domain
* A second hosting deployment

The editable outbound Community link hub is in scope. Conversation itself remains on confirmed external destinations such as Meetup discussions until the owner publishes another destination.

Keep Meetup as the initial RSVP system.

## 48. Required documentation

Deliver:

* Complete source code
* Lockfile
* D1 schema
* D1 migrations
* R2 media model
* `.env.example`
* `.openai/hosting.json`
* `MASTER_BUILD_SPEC.md`
* `BUILD_STATUS.md`
* `OWNER_INPUTS.md`
* README
* Architecture decision record
* Data-model explanation
* Authentication and authorization explanation
* Atomic conflict-write explanation
* Local development instructions
* Test commands
* Sites deployment instructions
* Backup and restore instructions
* Owner-run source, data, and media export routine
* CSV import template
* Owner guide
* Organizer guide
* Known limitations
* Sites production URL when genuinely deployed

The plain-language owner guide explains:

1. How Reza creates the first owner account with Sign in with ChatGPT
2. How to invite organizers with secure copyable links
3. How to add or edit a club
4. How to create an event
5. How Idea, Draft, Hold, Confirmed, Published, Cancelled, and Completed differ
6. How conflicts work
7. How to approve an intentional overlap
8. How to publish an event publicly
9. How Meetup links work
10. How to cancel or unpublish an event
11. How to edit homepage and Community content
12. How to replace event artwork
13. How to record image rights and consent
14. How to view form submissions
15. How to remove an organizer
16. How to export a backup
17. How to restore deleted content
18. How to update branding
19. How to confirm legal-status wording without implying charity status
20. How to review Sites analytics
21. What Sites beta limits, hosting, identity sharing, and backup responsibilities mean

## 49. Honest phase and final reports

At the end of every phase, report:

* Active phase
* Features completed
* Important decisions
* D1 and R2 status
* Authentication and authorization status
* Tests run
* Number passed, failed, skipped, and not run
* Build result
* Accessibility or performance measurements actually taken
* Security checks completed
* Missing owner inputs
* Authorized cuts
* Known limitations
* Owner smoke-test card
* Exact next phase, not started

At the end of Phase 9, also report:

* Exact Sites production URL
* Deployment status
* Exact source revision and saved Sites version when available
* Production verification results
* Required runtime values
* Exact next action required from Reza

Use these labels accurately:

* **Completed and verified**
* **Implemented but not externally verified**
* **Not implemented**
* **Not implemented — authorized cut**
* **Not run**
* **Blocked**
* **Awaiting owner smoke test**

Do not use vague words such as “ready,” “supported,” or “configured for” to disguise unfinished work.

When a phase packet is provided, begin only that authorized phase. Complete and verify it, update `BUILD_STATUS.md`, provide the owner smoke-test card, and stop for owner review.
