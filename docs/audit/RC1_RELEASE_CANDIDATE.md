# RC1 Release Candidate

Date: 2026-08-01. This document is the release-candidate declaration
itself -- what this candidate contains, how it was produced, and what
governs it from this point forward. It supersedes no prior certification
document; it packages them.

**Two distinct references, not one, because this document cannot describe
its own commit:**

- **Code content**: fixed at commit `ac87d58` -- the last commit produced
  by merging PR #5 through #10. All runtime code, migrations, and prior
  certification documents in this candidate are frozen as of this commit.
- **Full package (code + this document and its three companions)**: the
  commit that merges this PR (docs/rc1-release-candidate-integration) on
  top of `ac87d58`. `release/rc1-candidate` is advanced to that commit
  once merged, specifically so the branch's tip always contains both the
  code it describes and the documents describing it -- a prior draft of
  this document named `ac87d58` as if it were also the tip after this PR
  merged, which cannot be true by construction (a commit cannot contain
  the PR that adds it). Corrected here per review.

## What this candidate is

The result of merging PR #5 through #10 into `main` in a controlled,
dependency-ordered sequence (documentation first, then ascending runtime
risk), with a full quality gate re-run after every merge and zero
regressions found. Full merge-by-merge record: `MERGE_HISTORY.md`.
Full certification carry-forward: `FINAL_CERTIFICATION_STATUS.md`.
Go/No-Go verdict: `GO_NO_GO_SUMMARY.md`.

## Contents of this candidate

- **Runtime**: Agent Governance Layer (AGL-1..AGL-5), WhatsApp inbound
  webhook (G04, ADR 0004 accepted), Prescription Intake storage and
  duplicate-detection runtime (G05, Engine 26).
- **Certification**: Launch Gap Matrix (G01-G10), End-to-End Workflow
  Certification (9 documents, Batch 4), Enterprise Certification &
  Governance Program (10 documents, Batch 7).
- **Test state**: 572 tests passing, 8 skipped (live-database only, a
  structural sandbox limitation named throughout this program, not a
  quality gap), 0 failed.
- **Build state**: all 8 app workspaces build successfully.

## What this candidate is not

Not a GA release -- `docs/release/rc1-ga/GA_DECISION.md` remains the
authority on General Availability and its NO-GO stands unchanged, blocked
on items outside repository control (managed backup/DR execution,
independent penetration test, provider conformance, human sign-offs).
Not a pilot-ready build either, without four further items -- see
`GO_NO_GO_SUMMARY.md`.

## Release branch discipline from this point forward

Per the freeze instruction governing this integration: `release/rc1-
candidate` accepts only bug fixes, regression fixes, security fixes, and
documentation corrections from this point forward. No new feature work.
Anything expanding scope belongs on the RC2 track
(`docs/audit/RC2_TRANSITION_PLAN.md`, `docs/release/rc1-ga/RC2_EXECUTION_PLAN.md`),
which remains correctly gated behind this candidate's own promotion
decision and is not authorized to merge into either `main` or
`release/rc1-candidate`.

## Recovery points

Two named reference points exist for this integration, both as commit
SHAs rather than pushed git tags -- see `MERGE_HISTORY.md`'s "Tagging: a
real, named limitation" section for why, and the exact commands needed to
convert them into real tags from an environment with tag-push rights:

- **`rc1-pre-integration`** = commit `ecf3ab4` -- last known-good state
  before any runtime PR (#5, #6, #8) was integrated.
- **`rc1-candidate-1`** = commit `ac87d58` -- this candidate's frozen
  *code* content, fully integrated and certified. The full package
  (code plus this certification document set) lands one commit later,
  on `release/rc1-candidate`, once this PR merges -- see the note above.

## Next decision point

Promotion of this candidate to a pilot depends on the four items
`GO_NO_GO_SUMMARY.md` names, none of which are closable by further
documentation or by continuing this integration program -- they require
live infrastructure provisioning, a scoped wiring change, a minimal
notification slice, and a credential rotation. That is the next body of
engineering work this program recommends, on the frozen
`release/rc1-candidate` branch, scoped narrowly as bug/regression/security
fixes rather than new feature development where each item permits that
framing (credential rotation, certainly; the chaining-gap wiring and
minimal G09 slice are closer to the line and may warrant the user's own
judgment on whether they fit "bug fix" or need to be treated as the first
RC1.1 patch).
