# Vancouver Curiosity Club

[![Continuous integration](https://github.com/reza477/vancouver-curiosity-club/actions/workflows/ci.yml/badge.svg)](https://github.com/reza477/vancouver-curiosity-club/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-vancouver--curiosity--club-5b35d5)](https://vancouvercuriosityclub.com)

![Vancouver Curiosity Club social preview](public/og.png)

The institutional website for Vancouver Curiosity and Education Society and its
public program, Vancouver Curiosity Club. It presents the organization, its
mission, community programs, and a source-faithful calendar of public events.

**Live website:** [vancouvercuriosityclub.com](https://vancouvercuriosityclub.com)

**Current supported release:** Version 1.0

[Contributor onboarding](docs/UI_UX_HANDOFF.md) ·
[Developer handoff](DEVELOPMENT.md) ·
[Architecture decisions](docs/architecture/) ·
[Release and recovery](docs/RELEASE_AND_ROLLBACK.md) ·
[Security policy](SECURITY.md)

## Product highlights

- Responsive public event discovery, month planning, club profiles, and event detail pages.
- Protected daily Meetup synchronization with durable, fast Home and Events snapshots, local poster handling, and source-faithful event facts.
- Google Calendar links plus standards-compliant public and private iCalendar feeds.
- An authenticated organizer workspace for scheduling, publishing, content, media, imports, exports, and submissions.
- D1-backed structured content with revision history, previews, publication safeguards, and audited changes.
- Accessible public forms for feedback, volunteering, partnerships, and event proposals.
- Privacy-preserving public projections, role-based authorization, CSP, security headers, and bounded database operations.
- Responsive layouts, reduced-motion support, keyboard navigation, semantic metadata, sitemap, robots rules, and structured data.

## Technology

| Layer | Technology |
| --- | --- |
| Application | React 19, Next.js App Router APIs, TypeScript |
| Runtime | vinext and Cloudflare Workers |
| Data | Drizzle ORM and Sites-managed D1 |
| Media | Sites-managed R2 with approved responsive variants |
| Authentication | Sign in with ChatGPT with server-side membership and role checks |
| Validation | Zod, ESLint, TypeScript, Node test runner, Miniflare, axe-core |
| Hosting | ChatGPT Sites |

## Local development

### Prerequisites

- Node.js 22.16 or newer
- npm

### Setup

```powershell
npm ci
npm run db:apply:preview
npm run dev
```

Vite prints the local URL when it starts (normally `http://localhost:5173`).
On Windows PowerShell, use `npm.cmd` in place of `npm` if execution policy
blocks `npm.ps1`. Start with [DEVELOPMENT.md](DEVELOPMENT.md) for architecture,
safe change workflow, test selection, and release boundaries.

Copy `.env.example` to an ignored local environment file only when organizer bootstrap settings are needed. Never commit credentials, local D1 files, generated output, or production exports.

## Collaboration workflow

All changes begin on a focused branch and are proposed through a pull request
to `main`. GitHub CI validates the source, tests, and built Worker; a maintainer
then reviews the change before it is accepted. Merging source code never
deploys production automatically. Only the owner or an explicitly authorized
release maintainer can publish the reviewed revision through ChatGPT Sites.

Do not push directly to `main`, share production credentials, or copy
production D1/R2 data into a development environment. UI/UX contributors
should begin with [the focused handoff guide](docs/UI_UX_HANDOFF.md), then read
[CONTRIBUTING.md](CONTRIBUTING.md) and [DEVELOPMENT.md](DEVELOPMENT.md).

## Quality checks

```powershell
npm run typecheck
npm run lint
npm audit --omit=dev
npm test
git diff --check
```

The full test suite is intentionally serialized because its Worker and D1 integration coverage uses isolated Miniflare runtimes.
Production builds intentionally refuse a dirty Git working tree. After the
exact reviewed source is committed, run:

```powershell
npm run build
npm run test:rendered
```

## Project structure

```text
app/                 Public routes, organizer workspace, and API handlers
db/                  Drizzle schema and database entry point
drizzle/             Ordered, retry-safe D1 migrations
lib/                 Domain logic, projections, security, media, and validation
public/              Approved production assets and responsive artwork
tests/               Unit, contract, integration, security, and rendered-Worker tests
docs/architecture/   Architecture decision records
docs/                Owner, organizer, testing, and operational guides
worker/              Cloudflare Worker entry point and response hardening
```

## Documentation

- [Documentation index](docs/README.md)
- [UI/UX contributor handoff](docs/UI_UX_HANDOFF.md)
- [Developer handoff and architecture](DEVELOPMENT.md)
- [Release and recovery](docs/RELEASE_AND_ROLLBACK.md)
- [Architecture decisions](docs/architecture/)
- [Owner guides](docs/owner-guide-phase8.md)
- [Organizer guides](docs/organizer-guide-phase8.md)
- [Historical Phase 8 verification](docs/phase8-local-testing.md)
- [Historical build evidence (not current onboarding)](BUILD_STATUS.md)
- [Historical owner-input ledger](OWNER_INPUTS.md)

## Deployment

The application is built and deployed through ChatGPT Sites. `.openai/hosting.json` contains the Sites project identifier and logical resource bindings, but no credentials or secrets; hosted credentials and runtime values are managed outside Git.

Production releases are built from a clean, committed source revision. Database migrations remain additive and must be reviewed before deployment.

The `v1.0.0` Git tag and GitHub Release identify the first supported
collaboration baseline. Recovery uses a reviewed revert or a known-good Sites
version; shared history is never force-rewritten. See
[Release and recovery](docs/RELEASE_AND_ROLLBACK.md).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report security concerns using the private process in [SECURITY.md](SECURITY.md), not a public issue.

Community participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Project roles and decision boundaries are documented in
[GOVERNANCE.md](GOVERNANCE.md).

## License

Copyright © 2026 Vancouver Curiosity Club. All rights reserved. See [LICENSE](LICENSE).
