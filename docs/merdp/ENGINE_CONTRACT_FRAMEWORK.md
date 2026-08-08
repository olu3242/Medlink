# MERDP Engine Contract Framework (ECF)

## 1. Status and mission

Status: normative Level 2 contract, version 1.0.0.

The ECF makes each of MERDP's 20 engines independently implementable,
replaceable, observable, and certifiable while preserving one platform runtime.
It specializes `docs/ENTERPRISE_RUNTIME_CONTRACT.md`; it does not replace it.

## 2. Execution model

Every execution follows:

```text
accept -> initialize -> authorize -> validate -> execute -> persist atomically
-> record outbox events and audit -> emit telemetry -> certify result -> return
```

An engine MUST NOT claim success unless all mandatory atomic state, outbox, and
audit writes commit. Certification may be synchronous for small deterministic
operations or a subsequent durable stage for datasets.

## 3. Engine descriptor

Every engine publishes a versioned descriptor:

```ts
interface EngineDescriptor {
  engineId: `merdp.engine.${string}`;
  name: string;
  version: string;
  contractVersion: "1.0";
  owner: string;
  capabilities: readonly string[];
  inputSchemas: readonly SchemaReference[];
  outputSchemas: readonly SchemaReference[];
  emittedEventTypes: readonly string[];
  consumedEventTypes: readonly string[];
  dependencies: readonly DependencyDescriptor[];
  dataClassifications: readonly string[];
}
```

Descriptors are immutable per released version and available to certification,
operations, and compatibility tooling.

## 4. Command contract

```ts
interface EngineCommand<T> {
  commandId: string;
  commandType: string;
  schemaVersion: string;
  idempotencyKey: string;
  issuedAt: string;
  deadline?: string;
  context: RuntimeContext;
  input: T;
}

interface EngineResult<T> {
  executionId: string;
  engineId: string;
  engineVersion: string;
  status: "succeeded" | "rejected" | "failed" | "pending_review";
  output?: T;
  quality: readonly QualityMeasurement[];
  evidence: readonly EvidenceReference[];
  emittedEventIds: readonly string[];
  error?: SafeEngineError;
  startedAt: string;
  finishedAt: string;
}
```

Input schemas specify size, format, entity types, required schema versions, and
validation constraints. Unknown required fields or unsupported major versions
fail closed. Output schemas specify entity versions, certification state,
quality measurements, lineage, and events.

## 5. State model

Execution state is:

```text
accepted -> ready -> running -> succeeded -> certified -> published
                         |          |
                         v          v
                       failed   certification_failed
                         |
                  retry_scheduled -> running
                         |
                  review_required -> recovered | rejected
```

`published` is only applicable to publication-capable executions. State
transitions are compare-and-set, append audited history, and reject illegal
movement. Retry does not create a new logical command.

## 6. Runtime obligations

Every engine declares:

- idempotency scope, key, retention, and response-replay behavior;
- transaction boundary and outbox atomicity;
- timeout and cancellation semantics;
- maximum attempts, backoff, jitter, and retryable errors;
- concurrency and ordering key;
- lease and heartbeat behavior for background work;
- compensation or rollback behavior;
- DLQ entry, replay, and manual recovery policy;
- payload and batch limits;
- dependency degradation policy.

Exactly-once delivery MUST NOT be claimed. Commands and consumers are designed
for at-least-once execution with idempotent effects.

## 7. Communication policy

Durable cross-stage handoff, fan-out, replayable projection, and asynchronous
workflow use the Reference Data Bus. Atomic in-process collaboration, validation
lookups, authorization, and control-plane reads use versioned typed ports.

Engines MUST NOT:

- write another engine's owned tables;
- call another engine's infrastructure adapter;
- create cyclic synchronous dependencies;
- use events as unaudited remote procedure calls;
- place raw artifacts or sensitive payloads in general event envelopes.

This hybrid rule preserves loose coupling without turning local atomic work into
an unreliable distributed workflow.

## 8. Error contract

Errors use the enterprise categories plus stable engine codes. Each error
declares safe message, retryability, failed stage, correlation ID, and recovery
guidance. Validation, authorization, policy, unsupported-schema, and clinical
hard-stop errors are not automatically retried. Secrets, stack traces, raw
source content, PHI, and SQL details are never surfaced.

## 9. Observability contract

Each execution emits `accepted`, `started`, `progress` where useful, and one
terminal observation. Required dimensions are engine/version, operation,
execution and correlation IDs, source/release where applicable, safe tenant
dimension, outcome, attempt, duration, record counts, exception counts,
dependency status, and certification state.

Required metrics:

- executions and outcomes;
- duration and queue delay;
- input/output/rejected record counts;
- retries, DLQ entries, and replay outcomes;
- quality-gate failures;
- dependency latency and errors;
- backlog age and lease expiry.

Cardinality is bounded; entity IDs and raw error strings are not metric labels.

## 10. Security contract

Each descriptor declares workload identity, permissions, schemas/tables/buckets,
network dependencies, sensitive fields, encryption, retention, audit actions,
and tenant/global scope. Engines use least privilege and managed secrets.
Privileged execution is isolated from user-facing routes and tested for RLS
bypass boundaries.

## 11. Certification contract

Each engine specification defines preconditions, postconditions, invariants,
quality thresholds, fixtures, acceptance tests, recovery tests, performance
limits, and evidence locations. An engine produces evidence; an independent
policy or authorized certifier decides certification. “Self-certification” MUST
NOT mean that the executing engine can waive its own gates.

Mandatory test classes are unit, contract, integration, migration where
applicable, performance, security/tenancy, regression, idempotency/concurrency,
recovery/replay, and certification.

## 12. Configuration governance

Rules, mappings, thresholds, source priorities, and publish policies are
versioned configuration where appropriate. Each configuration bundle has ID,
semantic version, checksum, owner, approval, effective period, compatibility,
and rollback target. Arbitrary executable configuration is prohibited.

Every result records the exact configuration bundle and runtime version used.

## 13. Per-engine specification template

Every Engine 01–20 document MUST contain:

1. identity, owner, mission, and non-responsibilities;
2. capabilities and dependencies;
3. commands, queries, schemas, ports, and events;
4. entity/state ownership and transaction boundary;
5. idempotency, concurrency, retries, timeout, DLQ, replay, and rollback;
6. security, tenancy, privacy, retention, and audit mapping;
7. metrics, logs, traces, health, SLOs, and runbooks;
8. preconditions, postconditions, invariants, and quality gates;
9. test matrix and retained evidence;
10. compatibility, rollout, migration, and decommission plan.

## 14. Normalization example

Engine 08 accepts parsed or transformed candidate records plus referenced rule
and vocabulary bundles. It returns normalized candidates, aliases, field-level
lineage, confidence, and exceptions. It emits durable
`reference.normalization.completed.v1` and
`reference.normalization.exception-raised.v1` events only after state, audit,
and outbox commit atomically.

Its hard gates are zero unexplained record loss, 100% output-field provenance,
dimensionally valid unit conversions, deterministic replay for identical
manifests, and no publication of unresolved safety-significant ambiguity. A
“99% deterministic” aggregate cannot excuse the remaining unsafe 1%.

## 15. Framework conformance

An engine conforms only when descriptor validation, schema compatibility,
runtime lifecycle, atomic outbox/audit, idempotent replay, observability,
least-privilege access, failure recovery, and certification evidence all pass.
Shared libraries SHOULD implement these mechanics; conformance MUST still be
tested for every engine integration.
