# Merge History (RC1 Release Candidate Integration)

Chronological, commit-cited record of every merge executed in this
integration sequence, in the controlled order specified by the RC1
Release Candidate Integration mission: documentation first (zero runtime
risk), then runtime PRs in ascending risk order, with a full quality gate
(`npm run check` + `npm run build`) run against `main` after every merge.

## Pre-integration baseline

`main` before this sequence: commit `cb04786` (merge of PR #4,
`reconcile/rc1-readiness`).

## Phase 1 — Documentation (zero runtime risk)

| Order | PR | Title | Merge commit | Files | Runtime risk |
| --- | --- | --- | --- | --- | --- |
| 1 | #7 | Launch Gap Matrix (G01-G10) | `36cd807` | 1 doc | None |
| 2 | #9 | End-to-End Workflow Certification (Batch 4) | `693869c` | 9 docs | None |
| 3 | #10 | RC1 Enterprise Certification & Governance (Batch 7) | `ecf3ab4` | 12 docs | None |

No file-path overlap between the three PRs' diffs; all three merged with
zero conflicts. Post-phase gate at `ecf3ab4`: `npm run check` pass (no
source touched), `npm run build` pass.

**`ecf3ab4` is this sequence's designated `rc1-pre-integration` reference
point** -- the last commit before any runtime code was integrated. See
"Tagging" below for why this is a commit SHA reference rather than a
pushed git tag.

## Phase 2 — Agent Governance Layer (lowest runtime risk)

| PR | Title | Merge commit | Gate result |
| --- | --- | --- | --- |
| #5 | Agent Governance Layer (AGL-1..AGL-5) | `47da6af` | `npm run check`: 518 passed, 8 skipped, 0 failed. `npm run build`: pass, all 8 workspaces. |

No conflicts. Confirmed the pre-existing duplicate `@vitest/coverage-v8`
key in `package.json` (flagged in this PR's own description) is resolved
on `main` post-merge -- verified by absence of the esbuild duplicate-key
warning that appeared in the Phase 1 gate run.

## Phase 3 — WhatsApp Runtime (core runtime, G04)

| PR | Title | Merge commit | Gate result |
| --- | --- | --- | --- |
| #6 | WhatsApp inbound webhook route (G04), ADR 0004 | `cf84752` | `npm run check`: 539 passed, 8 skipped, 0 failed. `npm run build`: pass; `/api/whatsapp/webhook` registered as a dynamic route. |

No conflicts. Test count increase (518 -> 539, +21) consistent with this
PR's own stated addition of 13 tests in `whatsapp-webhook.test.ts` plus
supporting changes.

## Phase 4 — Prescription Intake Runtime (G05, Engine 26)

| PR | Title | Merge commit | Gate result |
| --- | --- | --- | --- |
| #8 | Prescription Intake Runtime (G05, Engine 26) | `ac87d58` | `npm run check`: 572 passed, 8 skipped, 0 failed. `npm run build`: pass; `/api/v1/prescriptions`, `/api/v1/prescriptions/[id]/file-url` registered. |

**One real merge conflict**, anticipated from this program's own prior
integration-branch testing (`MERGE_READINESS_REPORT.md`): PR #6 and PR #8
each append a new `describe()` block to
`packages/runtime/src/migration.test.ts` at the identical insertion
point. Resolved by concatenating both blocks in sequence (conversation
runtime system identity block first, prescription file storage block
second, matching insertion order), identical to the resolution already
rehearsed twice on local integration branches earlier in this program.
Resolution steps: fetched `feat/prescription-intake-runtime`, merged
`origin/main` into it locally (merge commit `1dd4f3d`), resolved the one
conflicted file, verified `npm run check` locally (572 passed -- the
identical figure this program's own `MERGE_READINESS_REPORT.md` had
already predicted for the four-PR combination), pushed the resolution,
then merged via the GitHub API.

Static canonical-workflow trace confirmed in source after this merge
(Patient Upload -> Storage -> Prescription Record -> Pharmacist Queue ->
Audit): `apps/patient`'s upload route -> `PrescriptionIntakeApplication.upload()`
-> `SupabasePrescriptionFileStore` -> `create_prescription_record` RPC
(commits the prescription record and `record_runtime_evidence` audit
trail atomically) -> `apps/admin`'s existing `prescriptions`-table read
(the pharmacist queue, unchanged by this PR). This is a source-level
trace, not a live execution -- consistent with every other finding in
this program, no live database has ever been exercised.

## Phase 5 — Release candidate cut

- `release/rc1-candidate` branch created from `main` at `ac87d58`
  (the final merge commit of this sequence).
- **`ac87d58` is this sequence's designated `rc1-candidate-1` reference
  point.**

## Tagging: a real, named limitation

This session's git credentials can push branches but **not** tag refs --
confirmed by attempting to push both an annotated and a lightweight test
tag to `ecf3ab4`, both rejected with HTTP 403 at the git proxy layer
(branch pushes to the same remote succeed without issue in the same
session). No `create_tag` capability exists in the GitHub MCP tool surface
available to this session either. This is a session/environment
permission-scope limit, not a repository setting -- `v1.0.0-rc1` already
exists as a real tag on this repository, created by a prior process with
broader push rights.

**Consequence**: `rc1-pre-integration` and `rc1-candidate-1` exist in
this document as commit-SHA references (`ecf3ab4` and `ac87d58`
respectively), not as pushed git tags. Recovery to either point is
identical in practice (`git checkout <sha>` or `git reset --hard <sha>`
work the same whether or not a tag label exists), but the durable,
memorable label the user's instruction asked for does not yet exist on
the remote. **To create the actual tags**, run from an environment with
tag-push rights:

```
git tag -a rc1-pre-integration -m "Last known-good baseline before integrating PR #5, #6, #8" ecf3ab4
git tag -a rc1-candidate-1 -m "RC1 Release Candidate 1: PR #5-10 fully integrated and certified" ac87d58
git push origin rc1-pre-integration rc1-candidate-1
```

or create both via GitHub's web UI (Releases -> Tags -> the target
commit SHAs above).

## Summary

Six PRs merged in the specified controlled order, one real (anticipated)
conflict resolved, zero regressions at any phase boundary. Final state:
`main` and `release/rc1-candidate` both at `ac87d58`, 572 tests passing
(8 skipped, live-DB only), full 8-workspace build green, zero open pull
requests remaining from this integration sequence.
