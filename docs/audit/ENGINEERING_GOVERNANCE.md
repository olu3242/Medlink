# Engineering Governance Audit (Engine 62)

## Module/code ownership

This repository has no per-engineer or per-team ownership file (no
`CODEOWNERS`, confirmed by `find . -iname CODEOWNERS` returning nothing
outside `node_modules`). Ownership is structural, by package/app
boundary, documented informally across `docs/audit/*` certification
documents rather than in one canonical registry.
`WORKFLOW_DEPENDENCY_MATRIX.md`'s Owner column is the most current
per-capability ownership statement this repository has; this document
does not duplicate it, it extends the same discipline to
non-workflow packages.

| Domain | Packages | Apps | Governance doc |
| --- | --- | --- | --- |
| Platform/runtime | `packages/runtime`, `api`, `platform`, `observability` | -- | `docs/ENTERPRISE_RUNTIME_CONTRACT.md` |
| Conversation | `packages/conversation`, `whatsapp` | `apps/web` (webhook) | `WHATSAPP_RUNTIME_CERTIFICATION.md` |
| Prescription | `packages/prescription` | `apps/patient`, `apps/admin` | `PRESCRIPTION_INTAKE_CERTIFICATION.md` |
| Clinical | `packages/clinical`, `medicine` | `apps/admin`, `apps/patient`, `apps/pharmacist` | `CLINICAL_SAFETY_CERTIFICATION.md` |
| Workflow orchestration | `packages/workflows` | `apps/web` | `WORKFLOW_CATALOG.md` |
| Agent governance | `packages/agents` | none yet | `AGENT_GOVERNANCE_LAYER.md` |
| Access/reservation | `packages/access`, `inventory`, `pharmacy` | `apps/patient` | `ENGINE_STATUS_MATRIX.md` |
| Notification | `packages/notifications` | none | `LAUNCH_GAP_MATRIX.md` G09 |

## Orphaned components (confirmed, not assumed)

1. **`packages/reservations`** -- zero real callers anywhere in the
   repository (only self-referenced in its own `package.json`), confirmed
   by `ENGINE_STATUS_MATRIX.md`'s prior audit and unchanged since.
   Its state vocabulary (`active`/`expired`/`cancelled`/`fulfilled`)
   disagrees with the real `reservation_status` DB enum
   (`pending`/`confirmed`/`ready`/`collected`/`cancelled`/`expired`) --
   harmless only because nothing calls it. **Recommendation**: either
   wire it to a real consumer or remove it; carrying dead code with a
   vocabulary that silently disagrees with the schema is a latent trap
   for a future engineer who assumes it's live.
2. **`packages/notifications`** -- a real, tested, minimal dispatch shell
   with zero concrete `NotificationChannel` implementations and zero
   callers (`LAUNCH_GAP_MATRIX.md` G09, `FAILURE_TEST_MATRIX.md`). Not
   dead code in the same sense as `packages/reservations` -- it's
   intentionally-staged infrastructure awaiting the G09 batch, not an
   abandoned design.
3. **`OutboxDispatcher`** (`packages/workflows/src/service.ts`) -- real
   code, zero tests, zero callers (`FAILURE_TEST_MATRIX.md`). Same
   staged-not-abandoned characterization as above.
4. **UI-only app scaffolds referencing non-existent APIs**: `RC1_BACKLOG.md`
   item 1's prior finding, unchanged -- `apps/dashboard`, `apps/developer`,
   and `apps/provider` collectively reference 9 API paths with no backing
   route anywhere. Expected for Wave 4/5 scaffolding built ahead of its
   API, not a regression, but worth this document's explicit
   acknowledgment as intentional technical debt, not oversight.

## Dependency management

- Workspace dependency convention: every cross-package `package.json`
  dependency uses `"*"` (verified across `packages/agents`,
  `packages/prescription`'s consumers, and every pre-existing
  cross-package edge) -- npm workspaces resolve these to the local
  workspace package directly, not a registry version, so there is no
  version-drift risk within the monorepo. This is a real, consistent
  convention, not ad hoc.
- External dependency security: `npm audit` shows 3 high-severity
  findings today (`LAUNCH_GAP_MATRIX.md`'s correction of the stale "15
  high" figure in `DEPENDENCY_RISK_REGISTER.md`), all requiring a `next`
  major-version bump with no non-breaking fix available.
- Duplicated runtime-lifecycle implementation: `apps/web/lib/api-runtime.ts`'s
  `runWebApi` and `packages/api/src/index.ts`'s `runApi` independently
  reimplement the same pipeline (`RC1_BACKLOG.md` item 1) -- flagged
  there as needing an ADR before consolidation, unchanged by this
  program.

## Test ownership

No test file in this repository lacks a corresponding source file it
tests (spot-checked across every package touched by PRs #5-#9; not
exhaustively verified for the full pre-existing tree). Coverage
convention: `vitest.config.ts` enforces 70/70/65/70
statements/branches/functions/lines over `packages/**/src` only --
`apps/**` UI and route handlers are deliberately excluded from the
coverage gate (documented rationale in that config file: exercised by a
future integration/e2e suite, not unit tests). This is a real, if
narrow, choice: a route handler with a subtle bug could ship without
tripping the coverage gate as long as the application-layer logic it
calls is covered -- `architecture.test.ts`'s static checks (no `.from()`/
`.rpc()` in a route handler) are what actually constrains route-handler
quality today, not the coverage threshold.

## Documentation ownership

`docs/audit/` has grown to over 40 documents across this repository's
history, several superseding earlier ones without archiving them (e.g.
`docs/wave-3-certification.md`/`wave-4-certification.md`/`wave-5-certification.md`,
already marked historical/pre-CDA per `RC1_BACKLOG.md` item 5's prior
work). This program adds documents rather than consolidating -- a
deliberate choice (each is independently evidence-cited and dated, so
superseding in place would lose the audit trail of what was known when),
but it does mean a reader needs `RC1_PILOT_READINESS.md`/
`FINAL_GO_NO_GO.md`/this document as the entry points, not a chronological
read of the directory. Recommend `docs/audit/README.md` (does not exist
today) as a small, low-risk follow-up: an index distinguishing current
authoritative documents from historical/superseded ones.

## Summary

No new orphaned component was introduced by PRs #5-#9 -- every orphan
found in this audit predates this program and was already documented
elsewhere, confirmed unchanged rather than newly discovered. The one
genuinely new governance finding from this engine is
`ADR_CONFORMANCE_REPORT.md`'s numbering collision, which is a
documentation-organization issue, not a code-ownership one.
