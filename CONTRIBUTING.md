# Contributing

Thank you for helping improve Vancouver Curiosity Club.

This is a production community website. Changes must preserve visitor trust,
organizer privacy, source accuracy, accessibility, and the integrity of the
published calendar.

Start with [DEVELOPMENT.md](DEVELOPMENT.md). It is the current architecture and
handoff guide; the phase/build ledgers are historical evidence rather than the
active backlog.

## Before you start

1. Open an issue or discuss the change with a maintainer before substantial work.
2. Use Node.js 22.16 or newer and install dependencies with `npm ci`.
3. Update local `main`, then create a focused branch. Never commit directly to `main`.
4. Never commit credentials, `.env` files, local databases, exports, submission data, or unapproved media.

UI/UX contributors should also read [docs/UI_UX_HANDOFF.md](docs/UI_UX_HANDOFF.md)
before changing shared components, typography, responsive behavior, or visual
assets.

This public repository may be inspected, cloned, or forked to prepare a
contribution. Public visibility does not grant broader reuse, distribution,
publication, or branding rights; [LICENSE](LICENSE) remains controlling.

## Development

Online contributors may use the
[GitHub Codespaces preview](docs/CONTRIBUTOR_PREVIEW.md). It supports editing,
branching, and a live browser preview without production data or deployment
access.

```powershell
npm ci
npm run db:apply:preview
npm run dev
```

Windows PowerShell users may use `npm.cmd` if execution policy blocks
`npm.ps1`.

Keep changes narrow and preserve the existing architecture. Reuse shared public projections and renderers instead of creating preview-only or route-specific copies.

## Required checks

Run the checks appropriate to your change before opening a pull request:

```powershell
npm run typecheck
npm run lint
npm audit --omit=dev
npm test
git diff --check
```

The full suite is serialized and commonly takes 12-15 minutes. Do not run
multiple full suites concurrently. A production build requires a clean,
committed tree; after committing the reviewed source, also run:

```powershell
npm run build
npm run test:rendered
```

## Data, content, and media rules

- Do not invent events, locations, accessibility facts, attendance claims, testimonials, legal status, or response-time promises.
- Preserve confirmed Meetup destinations, event schedules, and source provenance.
- Do not add personal information to fixtures, logs, screenshots, issues, or commits.
- Add imagery only when its ownership, permission, credit, and public usage are confirmed.
- Keep organizer-only data out of public DTOs, metadata, feeds, errors, and structured logs.
- Database changes must be additive, retry-safe, reviewed, and accompanied by contract coverage.

## Pull requests

Push the focused branch and open a pull request against `main`. Wait for CI and
maintainer review; do not merge your own contribution or attempt a production
deployment. Only the owner or an explicitly authorized release maintainer
publishes a reviewed revision.

A pull request should explain:

- what changed and why;
- the visitor or organizer impact;
- any security, privacy, accessibility, content, data, or migration implications;
- the tests and manual checks completed;
- screenshots for intentional visual changes at relevant desktop and phone widths;
- the risk level and a practical rollback plan.

Keep unrelated changes in separate pull requests. Maintainers may request revisions before a production release.
GitHub CI validates pull requests but does not deploy them. Do not add Sites or
production credentials to a branch or workflow; deployment remains an explicit
owner-authorized step.
