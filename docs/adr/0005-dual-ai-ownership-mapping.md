# ADR 0005: Dual-AI ownership mapping (Claude ↔ Codex)

## Status

Accepted.

## Context

A dual-AI development protocol was introduced naming two engineers —
Codex ("Engineer A") and Claude Code ("Engineer B") — with exclusive
folder ownership, a "never modify the other's folders" rule, and a
`docs/HANDOFF.md` escalation path for cross-boundary work. The protocol's
folder list (`apps/api`, `packages/platform-os`, `packages/domain`,
`packages/pharmacy-engine`, `packages/clinical-engine`,
`packages/inventory-engine`, `packages/audit`, `packages/auth`,
`packages/security`, `packages/telemetry`) does not match this repository.
MedLink's actual structure is `apps/admin`, `apps/patient`,
`apps/pharmacist`, `apps/pharmacy`, `apps/provider`, `apps/dashboard`,
`apps/developer`, `apps/web`, and roughly 25 focused `packages/*`
(`medicine`, `clinical`, `prescription`, `search`, `workflows`,
`conversation`, `whatsapp`, `runtime`, `api`, `observability`, `platform`,
`ui`, and others), built up across 13 passes of this session's work.

Rather than restructure a working, tested, committed codebase to match a
folder layout from a different project template, this ADR maps the
protocol's *intent* — service/domain/runtime work vs. presentation work —
onto the structure that already exists. No files are renamed or moved by
this decision.

Every app in this repo already follows one internal convention
consistently: `app/**/page.tsx` and `layout.tsx` (routed UI),
`components/**` (React components), `app/globals.css` (styling), and
`lib/**` (application services, repositories, adapters) plus
`app/api/**/route.ts` (API route handlers, which call into `lib/` per
`docs/ENTERPRISE_RUNTIME_CONTRACT.md` — "never query persistence or
implement business rules in a route"). That existing convention is what
this mapping uses as the ownership boundary; it needed no invention.

## Decision

**Claude (Engineer B) owns:**

- Every package under `packages/*` except `packages/ui` — this includes
  `access`, `adherence`, `ai`, `analytics`, `api`, `certification`,
  `clinical`, `conversation`, `database`, `governance`, `integrations`,
  `inventory`, `medicine`, `notifications`, `observability`, `payments`,
  `pharmacy`, `platform`, `prescription`, `reporting`, `reservations`,
  `runtime`, `search`, `security`, `whatsapp`, `workflows`.
- Within every app (`apps/admin`, `apps/patient`, `apps/pharmacist`,
  `apps/pharmacy`, `apps/provider`, `apps/dashboard`, `apps/developer`,
  `apps/web`): `lib/**` (application services, repositories, adapters,
  their tests) and `app/api/**/route.ts` plus any sibling `schema.ts` and
  `route.contract.test.ts` (API route handlers — service-layer entry
  points, not presentation).
- `apps/web/middleware.ts` (session/tenant resolution, not presentation).
- `supabase/migrations/**` (database schema — exclusively mine; no
  duplicate migrations, per the protocol's own rule).
- `docs/adr/**`, `docs/audit/**`, `docs/ENTERPRISE_RUNTIME_CONTRACT.md`,
  `docs/release-scope.md`, `IMPLEMENTATION.md` (architecture governance
  and certification, matching the protocol's "certification" and
  "architecture" responsibilities).

**Codex (Engineer A) owns:**

- `packages/ui/**`.
- Within every app: `app/**/page.tsx`, `app/**/layout.tsx`,
  `app/globals.css`, `components/**` (React components), and any
  client-side form validation colocated with those components.

**Currently unowned by either (today, in practice):** `apps/web` has no
`page.tsx`/`components/` of its own yet beyond the default Next.js
scaffold — it is presently 100% Claude-owned until Codex adds a UI to it.

**Shared infrastructure (coordinate before changing, owned by neither
exclusively):** root `package.json`, `tsconfig.base.json`,
`vitest.config.ts`, `eslint.config.*`, and CI workflow files. These affect
every package/app regardless of ownership; treat a change here the same
way the protocol treats a cross-boundary change — flag it rather than
edit unilaterally, even though it isn't inside either party's listed
folders.

**Pre-existing files that predate this ADR:** `apps/pharmacist/components/
decision-form.tsx` was written by Claude earlier this session, before this
ownership split existed. Under this mapping it is now Codex-owned. It is
left as-is; Claude will not modify it going forward except to restore
compilation, per the operating rules below.

## Operating rules (this repo's instance of the protocol)

1. Never modify a Codex-owned path (see above) unless required to restore
   compilation after an owned-side change — and even then, prefer the
   smallest fix that satisfies the type/contract, not a redesign.
2. If a task requires a change inside a Codex-owned path for reasons
   beyond restoring compilation: stop, do not implement, and create
   `docs/HANDOFF.md` with the reason, the files affected, the required
   change, and the API contract the Codex-owned side must satisfy.
3. Never redesign a UI or component API without a HANDOFF entry
   describing the contract change the presentation layer must absorb.
4. Never duplicate a service, a route, a domain model, or a migration —
   extend or reuse what exists in `packages/*` first.
5. Before every commit: `npm run check` (lint, typecheck, `vitest run
   --coverage`) and `npm run build` (all app workspaces), matching this
   session's established verification standard, not a new one.
6. Commit only files inside Claude's ownership as mapped above, unless a
   change is the minimal compilation-preserving exception in rule 1.

## Consequences

No files move; every path referenced throughout this session's prior 13
passes and `docs/audit/RC1_SPRINT_REPORT.md` remains valid. Future work
that would touch `packages/ui`, a `components/**` file, or a `page.tsx`
stops and produces a `docs/HANDOFF.md` entry instead of a unilateral edit.
This ADR is the reference for "whose folder is this" going forward; it
does not change RC1 wave scope, `IMPLEMENTATION.md`, or the Platform
Freeze Gate — those govern *what* gets built and *when*, this governs
*who* edits which files while building it.
