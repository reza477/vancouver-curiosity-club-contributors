# ADR 0001: ChatGPT Sites foundation

- Status: Accepted for Phase 1
- Date: 2026-07-23
- Decision owner: Reza

## Context

Vancouver Curiosity Club needs a new, isolated public website and organizer portal. Phase 1 must establish a durable, testable foundation without implementing later product surfaces or making the Site public.

## Decision

- Use the official ChatGPT Sites vinext starter with strict TypeScript and Cloudflare Worker-compatible ESM output.
- Use Reza's selected **Field Notes** direction as the design-system foundation: editorial composition, generous space, paper texture, forest/teal/cobalt with restrained coral and amber, accessible typography, and explicit labels for all fictional development samples.
- Use Sites-managed D1 through logical binding `DB` for structured durable data.
- Use Sites-managed R2 through logical binding `MEDIA` for uploaded files.
- Use dispatch-owned Sign in with ChatGPT for identity.
- Treat identity as distinct from authorization. Enforce organization membership, active/suspended state, role, and club assignment on the server.
- Keep database access behind a small server-only boundary, use prepared statements, and use `DB.batch()` for related multi-statement writes.
- Use centralized runtime validation and safe error handling.
- Keep public responses behind explicit allowlisted projections.
- Store timed events as UTC instants plus their original IANA timezone; store all-day events as calendar dates.
- Enforce the Phase 1 reserving-write invariant inside SQLite for every `hold`, `tentative`, and `confirmed` timed event, regardless of generic review state. Buffered interval overlap blocks organization-wide; deterministic private reason codes prioritize shared venue, then organizer intersection, then the organization-wide fallback.
- Treat a hold as active only while `hold_expires_at` is strictly greater than SQLite's current time. Equality is expired. Holds require an expiry, non-holds forbid one, and no scheduler is needed for expiry.
- Do not provide a generic conflict-override bypass in Phase 1. Any later override must be conflict-specific and schedule-version-bound. Until that design is implemented, the database conservatively rejects the overlap.
- Do not make a production deployment during Phase 1.

## Consequences

- No GitHub, Supabase, PostgreSQL, Firebase, Vercel, Netlify, custom OAuth provider, password system, email delivery service, custom domain, billing detail, or paid account is required.
- D1/SQLite compatibility constrains the concurrency proof. If the blocking overlap invariant cannot be proven on the production-compatible D1 path, Phase 1 must be reported as blocked rather than weakened.
- Reserving all-day writes remain conservatively rejected until the later conflict engine can normalize their intervals without converting calendar dates to midnight UTC.
- Invitations are copyable links in the current scope; sending invitation email is not claimed.
- Legal identity, legal status, public organizer profiles, photographs, and production community links remain owner-controlled inputs.
- Public organizer attribution requires both profile-level consent and per-event display selection.
- Phase 1 may save a validated Sites version but must not make the Site public.

## Design decision record

Exactly three substantive directions were prepared: Field Notes, Bookshop Board, and Poster Press. Reza selected Field Notes and then delegated the remaining visual and implementation judgment. That gate is closed; no later subjective approval is required for Phase 1.
