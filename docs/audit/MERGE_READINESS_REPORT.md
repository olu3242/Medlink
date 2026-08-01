# RC1 Merge Readiness Report (Engine 51)

Scope: PRs #5 (Agent Governance Layer), #6 (WhatsApp webhook), #7 (Launch
Gap Matrix), #8 (Prescription Intake Runtime), #9 (Workflow Certification
Program). All five currently draft, open, based independently off `main`
at `cb04786`. `main` has not moved since (confirmed: `git log origin/main
-1` still resolves to `cb04786`).

Method: a local, unpushed integration branch (`integration/merge-readiness-audit`)
merging `main` <- #5 <- #6 <- #7 <- #8 <- #9 in that order, the same
sequence as their PR numbers. `npm run check` and `npm run build` both run
against the fully-merged tree, not against any single PR in isolation.

## Merge conflicts

**One trivial conflict, twice (once in this pass, once in the earlier
Batch 4 audit that used the same four PRs) -- always the same file, same
cause, same resolution.** `packages/runtime/src/migration.test.ts`: PR #6
and PR #8 each append a new `describe()` block near the end of the file.
Git's merge cannot tell two independent appends at the same location
apart automatically. Resolution is mechanical: keep both blocks,
concatenated. No other file in any of the five branches produced a
conflict marker (`grep` for conflict markers across the fully merged tree
returns nothing after resolution).

**Recommendation**: merge in PR-number order (#5, #6, #7, #8, #9) exactly
as tested here. If #6 merges before #8 (or vice versa), whichever merges
second will hit this identical, single, mechanical conflict in
`migration.test.ts` -- expected, already diagnosed, two-minute fix per
occurrence.

## Duplicate implementations

None found. Each PR's package/file footprint is disjoint:

- PR #5: new package `packages/agents` only, plus two new migrations.
- PR #6: `apps/web/lib/whatsapp-webhook*`, `apps/web/app/api/whatsapp/webhook`,
  `apps/web/lib/supabase/service-role.ts`, `apps/web/lib/env.ts` (new
  export added, not replaced), `packages/conversation/src/service.ts`
  (one new `try/catch`, additive), `apps/web/lib/conversation-store.ts`
  (one new duplicate-handling branch, additive), plus two migrations and
  three docs.
- PR #7: one new doc file only.
- PR #8: `apps/patient/lib/prescription-*`, `apps/patient/app/api/v1/prescriptions/*`,
  `packages/prescription/src/file-intake.ts`, one migration, one doc.
- PR #9: nine new doc files only.

No two PRs modify the same production source file with overlapping
logic. The only shared file is the test file above, and it's additive on
both sides.

## API compatibility

**Verified by successful typecheck on the fully merged tree, not just
inspected.** The one cross-PR dependency relationship worth naming
explicitly: PR #5's `packages/agents/src/coordination.ts` imports
`WorkflowInvoker` from `@medlink/conversation` (PR #5 depends on a type
PR #6 does not touch -- PR #6 only modifies `packages/conversation/src/service.ts`'s
`ConversationEngine.receiveMessage()` body, never `ports.ts` where
`WorkflowInvoker` is defined). `npm run check`'s typecheck step passing
against the five-way merge is direct, not inferred, evidence this
relationship holds.

PR #8's extension of `create_prescription_record` (three new trailing
`default null` parameters) is backward-compatible by construction --
verified in isolation in `PRESCRIPTION_INTAKE_CERTIFICATION.md`, and nothing
in PR #5, #6, #7, or #9 calls that RPC at all, so there is no cross-PR
compatibility question to raise here beyond what that document already
covers.

## Database migration ordering

28 migrations before this program's PRs, 5 new ones across PR #5 (2) and
PR #6/#8 (1 each, plus PR #8's is numbered `...0003`, deliberately
skipping `...0002` to leave room -- confirmed harmless: Supabase/Postgres
migration tooling applies by lexicographic filename order, gaps in the
numbering scheme are not meaningful). Full resulting order, newest six:

```
202607310001_agent_memory_governance.sql              (PR #5)
202607310002_agent_escalations.sql                     (PR #5)
202608010001_conversation_runtime_system_identity.sql  (PR #6)
202608010003_prescription_file_storage.sql              (PR #8)
```

No filename collisions (`ls ... | xargs basename | sort | uniq -d`
returns nothing). No migration references a table/function another
migration in this set defines out of order -- PR #8's
`create_prescription_record` extension is a `drop`-then-`create` against
a function that has existed since migration `202607290008`, well before
any of these five branches. PR #5's `agent_escalations` table has no
foreign key into anything PR #6 or #8 introduces, and vice versa.

## ADR consistency

ADR 0001 and ADR 0004 are touched by PR #6 only (acceptance + amendment).
No other PR touches either document. No conflicting ADR claims across the
five branches.

## Documentation consistency

`docs/audit/ENGINE_STATUS_MATRIX.md` is touched by both PR #6 (Conversation
Engine, Workflow Orchestrator, WhatsApp Adapter rows) and PR #8
(Prescription Intelligence row) -- **auto-merged cleanly by git**, zero
conflict, because the two PRs edit entirely different table rows. No
document in this set makes a claim contradicted by another document in
the set (cross-checked: PR #9's `WORKFLOW_CATALOG.md` cites PR #6 and #8's
work consistently with those PRs' own certification docs, since it was
written after both existed).

## Test overlap

No test file name collision beyond the single `migration.test.ts` append
case already covered. No test in one PR exercises behavior another PR
changes in a conflicting way -- confirmed by the full suite passing
post-merge (572 tests, 0 failed) rather than assumed from file-level
inspection alone.

## Dependency conflicts

`package-lock.json` merges cleanly (git auto-merge, no conflict markers)
and `npm install` against the merged tree succeeds. New workspace
packages (`@medlink/agents` from PR #5) and new dependency edges
(`apps/patient` -> `@medlink/prescription` from PR #8) introduce no
version mismatches -- every new `package.json` dependency uses `"*"`
(the existing convention every other cross-workspace dependency in this
monorepo already uses, not a new pattern).

## Verdict

**Ready to merge, in PR-number order, with one two-minute mechanical
conflict resolution expected in `packages/runtime/src/migration.test.ts`
on whichever of #6/#8 merges second.** No blocking finding in this audit.
This report certifies mergeability, not production readiness -- see
`docs/audit/FINAL_GO_NO_GO.md` (Batch 4) for the separate, still-current
NO-GO-for-pilot verdict. Merging these five PRs closes none of that
document's four reconsideration items by itself (no live environment is
provisioned, no chaining gap is connected, no notification channel is
wired, no credential is rotated) -- but it is a real prerequisite for the
cheapest of the four: WF-003's upload step already exists (PR #8) and the
WhatsApp receipt path already exists (PR #6), so once both are merged,
connecting them is the wiring work that item names, not new capability
that still needs to be built from nothing.
