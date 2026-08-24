# Partner Engine gap audit

Date: 2026-08-18
Branch: `feat/partner-engine-e2e`
Baseline: `b3ff0cdec16782cf9b18f7382387c3f329554bd7`

## Executive finding

MedLink has reusable organization, membership, workflow, runtime evidence, outbox, pharmacy-location, and MERDP manufacturer authorities. It does not have a partner lifecycle, partner-facing experience, reviewer workbench, agreement/integration governance, readiness gate, or partner-specific certification suite. The implementation must therefore add a bounded Partner Engine that links to those authorities rather than replacing them.

## Existing authority to reuse

| Concern | Canonical authority | Decision |
| --- | --- | --- |
| Tenant and legal entity | `organizations` | Link an approved application to exactly one organization; never create a parallel partner organization table. |
| User access | `organization_memberships`, `member_role`, platform permission checks | Applicant access is initially user-scoped; approved applicants receive an organization membership. Reviewer decisions require `platform_admin`. |
| Pharmacy operations | `pharmacy_locations` and pharmacy/inventory APIs | Pharmacy readiness requires a real active location; activation hands off to the pharmacy experience. |
| Manufacturer data | MERDP source links and canonical organization mappings | Manufacturer activation exposes an explicit MERDP handoff contract keyed by canonical organization ID. |
| Durable orchestration | `workflow_instances` and `@medlink/workflows` | Register a partner-onboarding workflow definition and keep domain transitions transactional in database RPCs. |
| Audit and delivery | `runtime_evidence_records`, `runtime_outbox_events`, `record_runtime_evidence` | Every governed transition writes audit/evidence and a metadata-only outbox event in the same transaction. |
| Notifications | Existing outbox dispatcher and notification adapters | Emit partner lifecycle event contracts; dispatch remains asynchronous and retryable. |
| Agent governance | Governed agent registry | Add advisory-only partner qualification/readiness capabilities; approval, suspension, and termination remain human-exclusive. |

## Gaps and convergence decisions

### Domain and persistence

Missing: partner taxonomy, applications, contacts, identity claims, qualifications, verification records, decisions, requirements, agreements, integration profiles, readiness assessments, status history, and lifecycle events.

Decision: add normalized partner tables linked by `partner_applications.organization_id` after identity resolution. Keep relationship status and integration status as separate enums. Store documents as references and digests, not uploaded secrets or unrestricted blobs.

### Identity and duplicate prevention

Missing: resolution of registration/license identifiers and normalized organization identity before entity creation.

Decision: identity claims are unique by `(scheme, country_code, normalized_value)`. A reviewer must explicitly link an existing organization or approve creation. Creation fails on a conflicting slug or identity claim; no silent duplicate or automatic merge is allowed.

### Authorization and RLS

Missing: pre-tenant applicant authorization and partner-review policies.

Decision: authenticated applicants may access only applications where `applicant_user_id = auth.uid()`. Linked organization members receive tenant-scoped read access. Platform admins can review across tenants. All decisions and terminal lifecycle transitions are exposed only through security-definer RPCs that re-check platform-admin authority and prohibit self-review. Direct mutation grants are withheld.

### Experience surfaces

Missing: public entry, application portal, reviewer workbench, and domain handoff visibility.

Decision: replace the marketing mail link with `/partner`; require sign-in before creating or resuming an application; add an authenticated portal under the web app and a platform-admin review surface. Pharmacy activation links to the existing pharmacy application.

### Workflow, agents, notifications, observability

Missing: a canonical onboarding workflow, bounded advisory checks, partner event contracts, and operational metrics.

Decision: register `WF-016 Partner Onboarding`; add advisory qualification and readiness capabilities without decision authority; emit versioned metadata-only events and record correlated runtime evidence. Operational state is derived from durable status history, decisions, requirements, and outbox records.

### Certification

Missing: partner unit, migration, RLS, API, browser, concurrency, and three-persona tests.

Decision: add static migration invariants plus live-database tests, API/contract tests, and a browser golden loop covering applicant, reviewer, and pharmacy administrator. Negative cases include cross-tenant reads, self-approval, premature activation, duplicate identity, stale-version writes, and direct-table mutation.

## Migration and branch governance

- Main and `origin/main` were synchronized at the baseline above before work began.
- Current canonical migration head is `202608180066_frontend_discovery_browser_fixture.sql`; this wave owns `202608180067_partner_engine.sql`.
- Draft PR #35 contains isolated pharmacy catalog-SKU mapping work and is not a dependency of this Partner Engine branch.
- No merge is authorized by this execution wave.

## Stop conditions

Implementation stops on any unresolved authority conflict, migration collision, RLS bypass, duplicate-identity ambiguity, self-approval path, or regression in the medication-access golden loop. Such a condition is a release blocker, not a waived test.
