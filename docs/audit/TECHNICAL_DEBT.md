# Technical Debt Register

| ID | Severity | Area | Debt | Consequence | Remediation |
| --- | --- | --- | --- | --- | --- |
| TD-001 | Critical | API architecture | Routes query Supabase directly | Domain rules, events, audit, and telemetry can be bypassed | Canonical use-case pipeline |
| TD-002 | Critical | Tenant security | Most APIs trust tenant header without membership resolution in application code | Inconsistent defense in depth and authorization evidence | Shared request-context resolver |
| TD-003 | High | RBAC | Most routes do not invoke platform authorization | RLS becomes the only effective control | Route/use-case permission checks |
| TD-004 | High | CDA | Conversation Engine and channel identity model absent | RC1 primary journey cannot exist | Wave 3 engine and schema |
| TD-005 | High | Workflow | Generic callback runner lacks durable waits, compensation, recovery, and definitions | Cannot certify multi-turn processes | Durable orchestrator |
| TD-006 | High | Events | No general transactional domain-event outbox | Silent mutations and unreliable side effects | Versioned outbox and consumers |
| TD-007 | High | API completeness | Portal clients call missing endpoints | Interfaces cannot complete advertised work | Contract inventory and implementation |
| TD-008 | High | Testing | No runtime RLS/integration/contract/workflow suites | Static safety claims are unverified | Layered certification suites |
| TD-009 | High | Build | Root typecheck covers only `apps/web` | Other workspaces can regress undetected | Workspace-wide typecheck/build |
| TD-010 | High | State models | MAR and Reservation vocabularies differ across governance docs, package, DB, and UI | Illegal or unmappable transitions | Canonical state ADR/contracts |
| TD-011 | Medium | Errors | API helpers return 400 and raw exception messages | Poor semantics and information disclosure risk | Typed problem mapping |
| TD-012 | Medium | Observability | Logging/correlation limited to platform shell | Cross-service diagnosis impossible | Shared middleware and trace context |
| TD-013 | Medium | Observability | Metrics, traces, SLOs, alerts, queue health absent | Operational certification impossible | Instrumentation baseline |
| TD-014 | Medium | Models | Patient lifecycle is implicit in Auth/profile tables | Ambiguous aggregate ownership | Canonical Patient contract |
| TD-015 | Medium | Models | Consultation aggregate is absent | Clinical review may become a competing proxy | Define Consultation context |
| TD-016 | Medium | Models | Delivery and refill have no domain implementation | Two canonical workflows lack owners | Assign bounded contexts |
| TD-017 | Medium | Notifications | TS channel union omits WhatsApp while SQL enum includes it | Contract drift | Channel-neutral contract update in Wave 3 |
| TD-018 | Medium | Code quality | Many later-wave services/UI files are compressed one-line scaffolds | Low maintainability and misleading completeness | Format and deepen only in assigned waves |
| TD-019 | Medium | Documentation | Old certification docs conflict with revised wave definitions | False completion signal | Historical labels and cross-links |
| TD-020 | Low | Repository | Root README is minimal and encoding is inconsistent | Poor onboarding | Normalize during docs remediation |
| TD-021 | Critical | Runtime | No shared implementation of the Enterprise Runtime Contract lifecycle | Entry points execute inconsistent subsets of mandatory stages | Build shared profile middleware and certification harness |
| TD-022 | High | Runtime context | Existing context lacks request, workflow, locale, timezone, channel, and API-version fields | Correlation and policy cannot flow end to end | Adopt the canonical ERC context |

## Priority rule

Critical and P0 high-severity debt must be remediated before Wave 2.1 feature
work. Other items are scheduled in their owning wave and must not trigger scope
expansion.

## Convergence disposition

- Resolved at source level: TD-001, TD-002, TD-003, and TD-009.
- Partially remediated: TD-006, TD-008, TD-011, TD-012, TD-013, TD-021, and
  TD-022.
- All other items remain assigned to their owning RC1 wave.

S01.8 added durable runtime audit/outbox, idempotency, and dead-letter schema
plus source transaction/recovery primitives. TD-006 and TD-021 remain open
because existing business mutations and runtime evidence are not yet committed
inside one database transaction.
