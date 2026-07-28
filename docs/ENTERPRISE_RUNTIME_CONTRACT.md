# MedLink RC1 Enterprise Runtime Contract

## Status

Accepted. This contract is mandatory for every RC1 runtime component.

## Mission

Every MedLink operation follows one certified runtime lifecycle, regardless of
whether it begins through an API, WhatsApp conversation, portal, background
worker, scheduled task, AI capability, import, or administrative command.

An operation is not successful merely because it returns HTTP 200. It succeeds
only when required identity, tenant, authorization, validation, domain,
transaction, event, audit, telemetry, recovery, and certification obligations
are satisfied.

## Universal runtime lifecycle

```text
Initialize
    |
Load configuration
    |
Authenticate identity
    |
Resolve tenant and organization
    |
Resolve conversation (when applicable)
    |
Authorize with RBAC and applicable attributes
    |
Validate request
    |
Load workflow context
    |
Execute domain use case
    |
Persist transaction atomically
    |
Publish domain events transactionally
    |
Trigger asynchronous automations
    |
Write immutable audit record
    |
Emit telemetry
    |
Return response or acknowledgement
    |
Schedule recovery when needed
```

No component may create a custom execution pipeline or bypass a mandatory
stage. A stage may be explicitly inapplicable to a profile, but that decision
must be documented and certifiable.

## Runtime profiles

| Profile | Entry points |
| --- | --- |
| API Runtime | REST endpoints, Experience API, professional portals |
| Conversation Runtime | WhatsApp webhooks, messages, replies, attachments |
| Background Runtime | Queue workers, scheduled jobs, retries, outbox dispatch |
| AI Runtime | OCR, matching, clinical assistance, education |
| Administrative Runtime | Bulk operations, imports, configuration, certification |

All profiles use the same context, error taxonomy, audit vocabulary, telemetry,
privacy controls, and certification model.

## Runtime context

Every operation carries one immutable, validated context:

```ts
interface RuntimeContext {
  correlationId: string;
  requestId: string;
  conversationId?: string;
  workflowId?: string;
  tenantId: string;
  organizationId: string;
  userId?: string;
  role: string;
  locale: string;
  timezone: string;
  channel: string;
  apiVersion: string;
}
```

`tenantId` and `organizationId` identify the same security boundary in RC1.
Both fields remain explicit for compatibility with product and integration
vocabularies; runtime validation must reject disagreement.

Context is created only at trusted entry boundaries and propagated through
application, domain, infrastructure, events, audit, logs, traces, and recovery
work. Clients may suggest correlation identifiers but cannot assert trusted
identity, role, tenant membership, or workflow ownership.

## Profile obligations

### API Runtime

- Authenticate before protected work.
- Resolve tenant membership and authorization through shared middleware.
- Parse versioned contracts and call one application use case.
- Never query persistence or implement business rules in a route.
- Return typed problem details with a correlation ID.

### Conversation Runtime

- Verify provider authenticity before parsing content.
- Resolve channel identity, tenant, conversation, and workflow.
- Detect duplicates and enforce ordering where required.
- Persist inbound acknowledgement before slow processing.
- Support attachments, timeouts, resumption, escalation, human handoff, replay,
  and recovery.
- Keep channel adapters free of business rules.

### Background Runtime

- Authenticate workload identity and scope it to least privilege.
- Claim work atomically with bounded leases.
- Be idempotent and safe under concurrent delivery.
- Use bounded retries, circuit breakers, and dead-letter handling.
- Propagate originating context and record recovery outcomes.

### AI Runtime

- Receive typed, minimized input through the AI Coordinator.
- Never write directly to persistent storage.
- Never bypass domain rules or mandatory pharmacist review.
- Return confidence, provenance, policy flags, and escalation state.
- Support human override and explainable output where feasible.
- Persist only through an authorized application use case after validation.

### Administrative Runtime

- Require strong authentication and explicit elevated authorization.
- Validate files, limits, dry-run behavior, and blast radius.
- Make bulk actions resumable, idempotent, rate-limited, and auditable.
- Apply the same tenant and domain policies as interactive operations.

## Reliability contract

Every operation defines:

- Idempotency scope and key
- Duplicate-detection behavior
- Retry policy and retry-safe boundaries
- Timeouts and cancellation
- Dead-letter and operator recovery
- Circuit breaking for external dependencies
- Graceful-degradation behavior
- Replay policy
- Ordering requirements
- Compensation for multi-step work

Retries must not duplicate MAR transitions, clinical decisions, inventory locks,
reservations, payments, messages, or audit records.

## Transaction and event contract

Domain state changes are atomic, consistent, isolated, and durable where the
data store supports ACID transactions.

Domain events are recorded in the same transaction as the accepted state
change, using a transactional outbox. Publication and consumers are idempotent.
Consumers may create new authorized commands but may not mutate another
aggregate directly or bypass its state machine.

Long-running and cross-service workflows use durable state, events, and
compensating actions. Partial distributed commits are not treated as success.

## Privacy and security contract

Every operation:

- Minimizes PHI/PII access and output
- Enforces authenticated tenant isolation and least privilege
- Encrypts sensitive data in transit and at rest
- Masks secrets and sensitive fields in logs and telemetry
- Records access to protected records
- Enforces consent, purpose, retention, deletion, and legal-hold rules
- Uses managed secret references rather than embedded credentials

Service-role or privileged access is isolated to named workloads, narrowly
scoped, monitored, and never held by a user-facing route.

## Audit contract

Every accepted business action writes an immutable audit record containing:

- Actor or workload identity
- Action and affected resource
- Previous and new state, or privacy-safe change summary
- Timestamp
- Tenant and organization
- Correlation, request, and workflow identifiers
- Conversation identifier when applicable
- Source channel
- Outcome and stable error code when unsuccessful

Audit writes are not optional side effects. If required audit persistence fails,
the business action must fail or remain uncommitted.

## Telemetry contract

Every execution emits:

- Structured, redacted logs
- Metrics and performance timings
- Distributed traces
- Business event references
- Stable error classifications

Telemetry includes runtime profile, operation, outcome, duration, correlation,
tenant-safe dimensions, retry count, and dependency status. PHI/PII, secrets,
message bodies, prescription content, and raw AI prompts or outputs are excluded
unless an explicitly approved protected telemetry store is used.

## Error contract

Errors use one category:

- Validation
- Authentication
- Authorization
- Business Rule
- Infrastructure
- External Dependency
- AI Confidence
- System Failure

Every surfaced error includes a stable code, safe human-readable message,
correlation ID, and recovery guidance when action is possible. Internal
exceptions, SQL details, secrets, and sensitive record contents are never
returned to clients.

Errors declare retryability. Authentication, authorization, validation, and
business-rule errors are not automatically retried. Infrastructure and external
dependency errors use bounded policy-based retries.

## Runtime certification

Every runtime component must prove:

- Configuration validation
- Authentication enforcement
- Tenant and organization resolution
- Authorization enforcement
- Input validation
- Workflow/use-case execution
- Atomic transaction behavior
- Transactional event recording and publication
- Immutable audit persistence
- Logs, metrics, traces, and timing
- Error classification and safe response
- Idempotency, timeout, retry, replay, and recovery
- Health and dependency status
- Privacy and sensitive-data controls

## Required component deliverables

Every new runtime component includes:

- Runtime specification and profile
- Sequence diagram
- Health check
- Metrics definition
- Trace and correlation mapping
- Audit mapping
- Error catalog
- Retry, timeout, dead-letter, replay, and recovery strategy
- Certification tests and retained evidence

## Governance

Implementations reuse this contract and shared runtime middleware. Deviations
require an ADR, documented risk acceptance, compensating controls, and a
certification plan.

The RC1 governance set is:

1. `IMPLEMENTATION.md` — execution and engineering contract
2. `docs/release-scope.md` — RC1 scope authority
3. ADR 0001 — platform foundation
4. ADR 0002 — historical WhatsApp-first decision, superseded by ADR 0003
5. ADR 0003 — Conversation-Driven Architecture
6. `docs/ENTERPRISE_RUNTIME_CONTRACT.md` — runtime authority
7. `docs/PLATFORM_EVOLUTION_FRAMEWORK.md` — evolution and compatibility policy
8. `docs/audit/` — conformance evidence, gaps, debt, and backlog
