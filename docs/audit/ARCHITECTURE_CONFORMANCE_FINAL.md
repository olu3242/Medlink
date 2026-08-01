# RC1 Architecture Conformance -- Final (Engine 61)

Successor to `docs/audit/RC1_ARCHITECTURE_CONFORMANCE.md` (Batch S01.5,
"CONDITIONAL PASS -- 70% source-level convergence," written before Wave 2/3
existed). That document is historical baseline, not current state --
referenced here, not repeated. This document evaluates the repository as
it stands today: `main` at `cb04786`, plus five open, evidence-audited,
mutually-mergeable PRs (#5-#9, per `MERGE_READINESS_REPORT.md`).

## Conformance against the MVP Constitution

| Principle | Conformance | Evidence |
| --- | --- | --- |
| WhatsApp-first patient entry | Conditional | Real inbound webhook exists (PR #6); no outbound reply, no completed workflow chain from it yet (`WORKFLOW_CATALOG.md`) |
| Pharmacist authority over clinical decisions | **Conformant** | No agent capability can call a clinical decision RPC (type- and runtime-enforced, `CLINICAL_SAFETY_CERTIFICATION.md`); every decision RPC re-checks `auth.uid()` and role |
| Multi-tenant isolation | Conditional | Broad static RLS coverage (57 tables); zero live authenticated cross-tenant proof (`MULTITENANT_SECURITY_REPORT.md`) |
| Never reimplement shared platform services | Conformant, with one known exception | `apps/web/lib/api-runtime.ts`'s `runWebApi` and `packages/api/src/index.ts`'s `runApi` independently reimplement the same runtime lifecycle -- pre-existing, documented (`RC1_BACKLOG.md` item 1), not newly introduced, flagged as needing an ADR before consolidation, not a quiet merge |
| Never mutate business state without audit/evidence | **Conformant** | Every atomic RPC audited this program (`create_mar`, `decide_clinical_review`, `reserve_inventory`, `create_prescription_record`, `raise_agent_escalation`, etc.) commits business state and `record_runtime_evidence` in one transaction, verified by `migration.test.ts` content assertions |

## Runtime contract conformance

`docs/ENTERPRISE_RUNTIME_CONTRACT.md` defines five profiles (API,
Conversation, Background, AI, Administrative) sharing one universal
lifecycle. Status per profile:

- **API Runtime**: conformant. `createRuntime()` is the one pipeline every
  `apps/*/app/api/v1/**/route.ts` uses (enforced by
  `packages/runtime/src/architecture.test.ts`, which caught a real
  violation in this program's own Prescription Intake work before it
  landed -- direct evidence the enforcement is live, not aspirational).
- **Conversation Runtime**: conformant as of PR #6, with one documented,
  narrow deviation. ADR 0004 (accepted) resolves the `RuntimeContext.userId`
  contradiction the contract document and the actual schema had (the
  contract's prose still says `userId` is optional; the schema still
  requires it -- ADR 0004 keeps the schema, not the prose, and that prose
  correction remains an open documentation debt, not a code gap).
- **Background Runtime**: **not conformant in practice.** `OutboxDispatcher`
  exists and matches the profile's "bounded retries... dead-letter
  handling" obligation in design, but has zero test coverage and zero live
  callers (`FAILURE_TEST_MATRIX.md`) -- a profile with no exercised
  implementation is not certifiable as conformant, only as present in
  source.
- **AI Runtime**: conformant. `packages/agents`' governed catalog
  (PR #5) enforces "never bypass domain rules or mandatory pharmacist
  review" and "persist only through an authorized application use case"
  by construction (type system + runtime validator), though nothing yet
  routes through it in production.
- **Administrative Runtime**: not independently re-audited in this pass;
  no PR in this program touched it.

## Tenant architecture conformance

Conformant at the schema/policy level (`rls-matrix.test.ts`'s 57-table
discovery, `wave2/3-rls.test.ts`'s content assertions); not independently
verified live (`MULTITENANT_SECURITY_REPORT.md`). PR #8's storage RLS
extends the same tenant model to `storage.objects` correctly (patient-path
or staff-role, org-scoped) -- architecturally consistent with every
existing RLS policy pattern, not a new model.

## Security model conformance

Conformant with one real, newly-found gap: `clinical_findings` lacks the
append-only/immutability trigger every comparable audit table in this
schema has (`CLINICAL_SAFETY_CERTIFICATION.md` item 4) -- a drift from the
platform's own established pattern, not a designed exception.

## Conversation architecture conformance

Conformant with the Conversation-Driven Architecture (ADR 0003, Accepted):
`packages/conversation`'s `ConversationEngine` owns dialogue only,
delegates business process via the `WorkflowInvoker` port, never runs
domain rules itself -- verified unchanged by this program's review of
`packages/conversation/src/service.ts`.

## Architectural drift detected in this pass

1. **ADR numbering collision, not previously documented.** `docs/adr/`
   contains two files each claiming ADR number 0004
   (`0004-conversation-runtime-webhook-identity.md`,
   `0004-production-operations-framework.md`) and two claiming 0005
   (`0005-dual-ai-ownership-mapping.md`,
   `0005-enterprise-service-management-platform.md`). Both pairs are
   independently `Accepted`, on unrelated topics, with no cross-reference
   to each other. This is very likely the residue of two development
   streams (referenced by `0005-dual-ai-ownership-mapping.md`'s own
   description of a "dual-AI development protocol" with separate folder
   ownership) numbering ADRs independently before merging. Full detail
   and remediation recommendation: `ADR_CONFORMANCE_REPORT.md`.
2. **`packages/reservations` is dead code**, confirmed by
   `docs/audit/ENGINE_STATUS_MATRIX.md`'s own prior finding (zero real
   callers anywhere in the repository) and unchanged by this program --
   its state vocabulary still disagrees with the real DB enum
   `reservation_status`, harmlessly, since nothing calls it.
3. **`apps/web`'s and `packages/api`'s duplicated runtime-lifecycle
   reimplementation** (see MVP Constitution table above) -- pre-existing,
   tracked, not worsened by any PR in this program.

## Verdict

**Conditional conformance.** No PR in this program's scope (#5-#9)
introduced new architectural drift -- the one new finding (ADR numbering
collision) predates all five PRs and was simply never caught until this
audit cross-referenced every ADR file by number. The platform's
foundational patterns (runtime pipeline, audit/evidence atomicity,
pharmacist-authority enforcement, RLS-by-default) remain intact and are,
if anything, more consistently applied after this program's work than
before it (PR #6's `architecture.test.ts` catch during PR #8's own
development is direct evidence the enforcement mechanism works as
designed).
