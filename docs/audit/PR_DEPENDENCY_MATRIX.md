# PR Dependency Matrix (Engine 51)

Companion to `MERGE_READINESS_REPORT.md`. Each row: what a PR depends on,
what depends on it, and whether merge order matters for that relationship.

| PR | Depends on (must merge first) | Depended on by | Order-sensitive? | Notes |
| --- | --- | --- | --- | --- |
| #5 Agent Governance Layer | None | None (nothing merged yet calls `packages/agents`) | No | Fully independent; could merge in any position |
| #6 WhatsApp webhook | None | #5 (`packages/agents/src/coordination.ts` imports `WorkflowInvoker` from `@medlink/conversation`, a type PR #6 doesn't change) | No, but see note | #5 depends on a *type* PR #6's package defines, not on PR #6's *changes*. Merging #5 before or after #6 both typecheck cleanly (verified) since the type itself predates both PRs |
| #7 Launch Gap Matrix | None (references #5/#6 by PR number in prose, not by code) | #9 (cites #7's findings) | No | Doc-only; zero code dependency either direction |
| #8 Prescription Intake | None | None | No | Fully independent of #5/#6/#7 in code; only shares the one mechanical test-file conflict with #6 |
| #9 Workflow Certification | #5, #6, #7, #8 (its evidence is the merged state of all four) | None | **Yes, softly** | #9's documents describe the combined state of #5-#8. Merging #9 before the others doesn't break anything technically (it's doc-only), but its claims would describe branches, not `main`, until the others land -- recommend merging #9 last, matching its own PR number |

## Recommended merge order

**#5, #6, #7, #8, #9** -- the order their PR numbers already imply, and
the exact order this report's integration branch tested. Nothing in this
matrix requires a different order; it's recommended for narrative
consistency (#9's documents cite the others as already-merged context)
rather than technical necessity.

## What merging does NOT require

No PR in this set requires another to be merged first for its own tests
or build to pass -- confirmed by this session having verified each PR's
`npm run check`/`npm run build` independently at the time it was opened,
in addition to the combined verification `MERGE_READINESS_REPORT.md`
describes. This matrix's "depends on" column reflects narrative/evidence
dependencies, not build dependencies.
