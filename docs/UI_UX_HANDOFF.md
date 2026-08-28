# UI/UX contributor handoff

This guide is the shortest path for a designer-developer improving the public
website without disturbing its data, privacy, or publishing boundaries.

## Product context

Vancouver Curiosity and Education Society operates Vancouver Curiosity Club as
its public program. The website serves prospective partners and supporters as
well as people browsing public events. Meetup remains the source of confirmed
event facts and RSVP destinations.

The visual language is editorial rather than application-dashboard based:
serif display type, restrained borders, warm paper backgrounds, strong navy,
and limited red, teal, coral, and yellow accents. Preserve the existing
information hierarchy before introducing a new pattern.

## Where visual work belongs

| Concern | Source |
| --- | --- |
| Color, type, spacing, shared dimensions | `app/styles/tokens.css` |
| Elements, focus, typography defaults | `app/styles/base.css` |
| Site shell and shared responsive layout | `app/styles/layout.css` |
| Shared component breakpoint overrides | `app/styles/components/responsive-overrides.css` |
| Shared component styles | `app/styles/components/` |
| Route-specific compositions and breakpoints | `app/styles/pages/` |
| Shared React renderers | `app/_components/` |
| Approved public imagery | `public/` |
| Canonical brand artwork | `design-assets/brand-icon-master.png` |

`app/globals.css` is an import registry. Add styles to the narrowest owning
file instead of turning it into a second global stylesheet.

## Local preview

For a private browser-based workspace, use the
[GitHub Codespaces contributor preview](CONTRIBUTOR_PREVIEW.md). It installs
the same locked dependencies and prepares an isolated local D1 database without
providing production access.

Use Node.js 22.16 or newer, then run:

```powershell
npm ci
npm run db:apply:preview
npm run dev
```

Fresh local D1 contains schema but no production content. Empty event states
are expected. Never request or copy the production database, submissions, or
hosted secrets merely to make a visual preview look populated. There is no
reusable synthetic content seed at present. Use the public site only as a
side-by-side visual reference, keep all edits in the local working copy, and
use the focused component and route contract tests for representative states.
When a content-rich comparison is essential, note it in the pull request so the
maintainer can perform the final verification against approved test data before
deployment.

## Visual change checklist

- Reuse an existing shared component before creating a route-only copy.
- Keep headings, landmarks, labels, and reading order semantic.
- Verify keyboard focus, touch targets, readable zoom, contrast, and reduced
  motion.
- Check at least a narrow phone viewport around 375 pixels and a desktop
  viewport around 1440 pixels; also test the content between them.
- Preserve exact event titles, dates, times, venues, Meetup links, status, and
  provenance unless the owner explicitly changes the source content.
- Use privacy-safe before-and-after screenshots in the pull request.
- Do not introduce unapproved fonts, stock media, generated artwork, personal
  data, testimonials, attendance claims, or legal claims.

## Contribution flow

1. Agree on the page and intended outcome.
2. Update `main` and create a focused branch such as
   `design/compact-mobile-header`.
3. Make the smallest coherent change and add or update its visual/behavioral
   contract where appropriate.
4. Run type-check, lint, focused tests, and a local responsive review.
5. Open a pull request to `main` with screenshots, risk, and recovery notes.
6. Wait for CI and maintainer review. Do not merge or deploy the change.

The full architecture and release boundaries are in
[../DEVELOPMENT.md](../DEVELOPMENT.md). Repository policy is in
[../CONTRIBUTING.md](../CONTRIBUTING.md).
