# RC2 Execution and Admission Plan

Date: 2026-07-30  
Admission status: **BLOCKED BY RC1 GA NO-GO**  
Parent baseline if admitted: immutable GA tag derived from
`45bc75f13245fcc37c0fa17b7b895c3667be7f64`

This is a planning artifact only. It does not authorize a branch, schema,
dependency, API, engine, or production change.

## Admission sequence

1. Close every condition in `GA_DECISION.md`.
2. Record authorized GA signatures and immutable evidence references.
3. Create the final GA tag without rewriting `v1.0.0-rc1`.
4. Create the RC2 branch from that final GA tag.
5. Record the parent tag, initial RC2 commit, owners, and approved scope.
6. Reopen engineering only through the Wave Governance admission gate.

## Proposed engine roadmap

| Engine | Scope | Mandatory safety boundary |
| --- | --- | --- |
| 36 Clinical Intelligence | Drug/allergy/contraindication/duplicate/dose risk assistance | Licensed human retains every clinical decision; confidence and provenance required |
| 37 National Interoperability | FHIR/OpenHIE/EHR/lab/insurance/government exchange | Versioned conformance, consent, patient matching, tenant and jurisdiction isolation |
| 38 Population Health | Surveillance, forecasting, regional analytics and alerts | De-identification, minimum cohort rules, approved public-health authority |
| 39 Healthcare Intelligence | Operational, journey, revenue, cost and utilization analytics | Governed metrics, lineage, tenant-safe aggregation, no clinical automation |
| 40 Autonomous Operations | Agent planning, delegation, escalation and optimization | Human approval for privileged/clinical actions; fail-closed execution and complete audit |

## Agent architecture

Agents are governed adapters behind the existing Runtime, Workflow, AI
Governance, Human Approval, Audit, and Observability owners. No agent directly
writes clinical or operational state. Stable proposed identifiers:

- Engine 36: `ML-AGT-CLINICAL-001`, `ML-AGT-SAFETY-002`,
  `ML-AGT-GUIDELINE-003`, `ML-AGT-RISK-004`
- Engine 38: `ML-AGT-EPI-001`, `ML-AGT-FORECAST-002`,
  `ML-AGT-HOTSPOT-003`
- Engine 39: `ML-AGT-INSIGHT-001`, `ML-AGT-ANALYTICS-002`,
  `ML-AGT-OPTIMIZER-003`
- Engine 40: `ML-AGT-ORCH-001`, `ML-AGT-PLANNER-002`,
  `ML-AGT-DELEGATE-003`, `ML-AGT-CONSENSUS-004`,
  `ML-AGT-SUPERVISOR-005`

## Contract and data evolution gates

- API and event contracts require architecture review, semantic versioning,
  compatibility tests, tenant authorization, idempotency, and rollback strategy.
- Database changes require additive-first design, RLS policy proof, migration
  reset, hosted dry-run, rollback/forward recovery, and data-retention review.
- FHIR/HIE contracts require approved profiles and external conformance evidence.
- AI contracts require model/prompt version, dataset provenance, confidence,
  explainability, evaluation, monitoring, human escalation, and kill switch.

## Testing strategy

Each engine requires unit, integration, contract, tenant/RLS, workflow,
security, performance, chaos/recovery, AI safety, human-approval, observability,
and independent certification evidence. RC1 regression remains mandatory at
every RC2 promotion gate.

## Proposed milestones

1. Admission and architecture decisions.
2. Stable API/event/extension contracts.
3. Data/RLS migration certification.
4. Engine 36 and 37 controlled integration.
5. Engine 38 and 39 governed analytics.
6. Engine 40 authorization-limited orchestration.
7. Independent operational certification and release decision.

No milestone may begin until RC2 admission is formally approved.
