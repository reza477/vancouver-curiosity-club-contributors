# Vancouver Curiosity Club

[![Continuous integration](https://github.com/reza477/vancouver-curiosity-club/actions/workflows/ci.yml/badge.svg)](https://github.com/reza477/vancouver-curiosity-club/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-vancouver--curiosity--club-5b35d5)](https://vancouver-curiosity-club.reza5777.chatgpt.site)

![Vancouver Curiosity Club social preview](public/og.png)

A calendar-first community website for finding thoughtful, creative, and social gatherings in Vancouver.

**Live website:** [vancouver-curiosity-club.reza5777.chatgpt.site](https://vancouver-curiosity-club.reza5777.chatgpt.site)

## Product highlights

- Responsive public event discovery, month planning, club profiles, and event detail pages.
- Trusted Meetup synchronization with local poster handling and source-faithful event facts.
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

- Node.js 22.13 or newer
- npm

### Setup

```powershell
npm.cmd ci
npm.cmd run db:apply:local
npm.cmd run dev
```

The local site is available at `http://localhost:3000`.

Copy `.env.example` to an ignored local environment file only when organizer bootstrap settings are needed. Never commit credentials, local D1 files, generated output, or production exports.

## Quality checks

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:rendered
git diff --check
```

The full test suite is intentionally serialized because its Worker and D1 integration coverage uses isolated Miniflare runtimes.

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

- [Architecture decisions](docs/architecture/)
- [Owner guides](docs/owner-guide-phase8.md)
- [Organizer guides](docs/organizer-guide-phase8.md)
- [Local verification](docs/phase8-local-testing.md)
- [Historical build evidence](BUILD_STATUS.md)
- [Owner facts still requiring confirmation](OWNER_INPUTS.md)

## Deployment

The application is built and deployed through ChatGPT Sites. `.openai/hosting.json` contains logical resource bindings only; hosted credentials and runtime values are managed outside Git.

Production releases are built from a clean, committed source revision. Database migrations remain additive and must be reviewed before deployment.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report security concerns using the private process in [SECURITY.md](SECURITY.md), not a public issue.

Community participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Copyright © 2026 Vancouver Curiosity Club. All rights reserved. See [LICENSE](LICENSE).
