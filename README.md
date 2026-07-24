# Vancouver Curiosity Club

> A social calendar with a brain.

This is the isolated ChatGPT Sites project for Vancouver Curiosity Club and its future organizer portal. The umbrella working name is Vancouver Curiosity and Education Society. No legal-status or charity claim is approved for publication.

## Current scope

Only Phase 1 is authorized. Phase 2 and all later product surfaces are not started.

The selected design foundation is **Field Notes**: an editorial, warm, Vancouver-rooted system with clear development-content labels. Phase 1 establishes the public visual foundation, Sites-owned identity boundary, server-side authorization, D1 schema and atomic scheduling proof, public/private projection boundary, timezone utilities, and quality tooling. It does not expose schedule-reserving UI.

- `BUILD_STATUS.md` is the authoritative implementation and verification ledger.
- `OWNER_INPUTS.md` records information that only Reza may supply or approve.
- `MASTER_BUILD_SPEC.md` is the unchanged canonical multi-phase reference.
- `docs/architecture/` records foundation decisions.

## Platform

- ChatGPT Sites-managed hosting
- Strict TypeScript and the official vinext Cloudflare Worker-compatible structure
- Sites-managed D1 through logical binding `DB`
- Sites-managed R2 through logical binding `MEDIA`
- Platform-owned Sign in with ChatGPT
- Server-side D1 membership and role authorization
- Zod-compatible centralized validation, Vitest-equivalent Node tests, and Miniflare D1 integration tests

No alternative host, external database, external authentication provider, email service, custom domain, paid account, or billing detail is required.

## Local development

Requires Node.js `>=22.13.0` and the starter’s locked npm package manager.

```powershell
npm.cmd ci
npm.cmd run db:apply:local
npm.cmd run dev
```

The preview is served at `http://localhost:3000/` by default.

## Verification

```powershell
npm.cmd run db:generate
npm.cmd run db:apply:local
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:rendered
npm.cmd audit --omit=dev
```

`test:rendered` executes the built Cloudflare Worker inside Miniflare. Missing owner runtime values are never committed; see `.env.example`.
