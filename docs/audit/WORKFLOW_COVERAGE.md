# Canonical Workflow Coverage

“Partial” requires at least one domain, database, API, or UI artifact. No
workflow currently has a versioned canonical definition with complete
conversation, orchestration, event, recovery, and certification coverage.

| ID | Workflow | Owner | Status | Existing evidence | Primary gap |
| --- | --- | --- | --- | --- | --- |
| WF-001 | Patient Registration | Identity | Partial | Supabase Auth/profile schema and sign-in UI | No conversation onboarding or registration workflow |
| WF-002 | Authentication | Identity | Partial | Auth callback, session client, request context | No WhatsApp OTP/account-linking workflow |
| WF-003 | Prescription Upload | Prescription Intelligence | Partial | Prescription POST and extraction schema | No media workflow, storage adapter, or conversation |
| WF-004 | Prescription Parsing | Prescription Intelligence | Partial | Parser, OCR port, audit port, unit test | No configured OCR or durable orchestration |
| WF-005 | Medicine Search | Search | Partial | Search service, catalog APIs, patient page | No channel-neutral workflow definition |
| WF-006 | Medication Access Request | Medication Access | Partial | MAR service, DB state guard, APIs, patient pages | API bypasses service; no full state workflow |
| WF-007 | Clinical Review | Clinical Intelligence | Partial | Validation service, review schema/UI | Missing decision endpoint and end-to-end hard-stop test |
| WF-008 | Inventory Discovery | Pharmacy/Inventory | Partial | Discovery and inventory services, APIs | Direct DB reads; no orchestration or integration test |
| WF-009 | Reservation | Reservation | Partial | Service, schema, POST route, portal UI | State mismatch; API bypasses service and lock policy |
| WF-010 | Pickup | Reservation/Fulfillment | Partial | Pickup token/schema references and UI status | No canonical command/API/workflow |
| WF-011 | Delivery | Fulfillment | Missing | None identified | Domain owner and RC1 acceptance criteria required |
| WF-012 | Medication Reminder | Adherence/Notification | Partial | Adherence and notification primitives | No workflow definition or delivery adapter |
| WF-013 | Consultation | Clinical Operations | Partial | Clinical review model and pharmacist UI | No canonical Consultation object/API/handoff |
| WF-014 | Refill | Adherence/Medication Access | Missing | No refill domain artifact identified | Define owner, state, eligibility, and API |
| WF-015 | Workflow Completion | Workflow Orchestrator | Scaffolded | Generic `WorkflowService.complete` | No canonical completion policy or emitted event |

## Coverage summary

- Partial: 11
- Scaffolded: 1
- Missing: 2
- Complete/certified: 0

## Ownership decisions required

- WF-011 requires a Fulfillment bounded context or an explicit Reservation
  ownership decision.
- WF-013 must use a canonical Consultation aggregate rather than treating
  clinical review records as consultations.
- WF-014 ownership must be shared through commands, not a duplicated model
  between Adherence and Medication Access.

## Cross-workflow requirements

All workflows still need version identifiers, tenant context, authorization,
idempotency, correlation, domain events, durable waits, timeout/retry policy,
recovery, human escalation, audit projections, and contract tests.
