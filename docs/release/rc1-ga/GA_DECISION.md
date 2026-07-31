# RC1 GA Decision

Date: 2026-07-30  
Decision baseline: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`  
Outcome: **NO-GO**

## Gate evaluation

| Gate | Result |
| --- | --- |
| Repository integrity | PASS |
| Engineering certification | PASS |
| Runtime readiness | PASS |
| Hosted anonymous RLS validation | PASS |
| Security certification | CONDITIONAL / OPEN |
| Dependency risk acceptance | OPEN |
| Managed backup and restore | FAIL — no execution evidence |
| Disaster recovery | FAIL — no execution evidence |
| Production deployment/rollback | OPEN |
| Provider conformance | OPEN |
| Hypercare exit | OPEN |
| Compliance evidence review | OPEN |
| Required human approvals | OPEN |

## Rationale

RC1 software is technically ready, but General Availability requires more than
source correctness. Repository contracts explicitly fail closed when real
penetration, recovery, provider, operational, and human evidence is missing.
Those artifacts cannot be synthesized from tests or documentation.

## Conditions to reconsider

1. Close or formally accept production dependency findings.
2. Complete independent security and authenticated tenant-isolation reviews.
3. Execute managed backup, data restore, PITR, and regional DR exercises with
   measured RTO/RPO.
4. Validate production deployment, rollback, monitoring, support, and hypercare.
5. Complete external provider conformance.
6. Record signed Security, Operations, Data, Compliance, Clinical, Product, and
   Executive approvals.

## Authority boundary

This document records the evidence-based repository recommendation. It is not a
human approval. RC1 remains frozen, GA remains unauthorized, and RC2/Engines
36–40 remain blocked.

