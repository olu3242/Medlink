# Reference Event Contract (REC)

## Scope

The Reference Data Bus carries durable facts after an authorized transaction.
Events are immutable notifications, not commands and not database row dumps.
Initial transport is the existing transactional outbox and workers; broker
adoption is an operational decision supported by evidence.

## Envelope

```ts
interface ReferenceEvent<T> {
  eventId: string;
  eventType: string;
  schemaVersion: string;
  occurredAt: string;
  producer: { engineId: string; engineVersion: string };
  correlationId: string;
  causationId?: string;
  tenantScope: { scope: "global" | "organization"; organizationId?: string };
  aggregate: { type: string; id: string; version: number };
  idempotencyKey: string;
  certificationId?: string;
  dataClassification: string;
  payload: T;
}
```

`eventId` deduplicates delivery. The aggregate tuple controls optimistic
ordering. The producer transaction records domain state, audit, and event in one
commit.

## Event taxonomy

Use past-tense, namespaced, versioned facts:

- `reference.source-release.registered.v1`
- `reference.artifact.verified.v1`
- `reference.parsing.completed.v1`
- `reference.normalization.completed.v1`
- `reference.entity.match-proposed.v1`
- `reference.entity.merged.v1`
- `reference.entity.unmerged.v1`
- `reference.relationship.certified.v1`
- `reference.certification.granted.v1`
- `reference.certification.revoked.v1`
- `reference.entity.published.v1`
- `reference.entity.deprecated.v1`
- `reference.dataset.published.v1`

Names such as `medicine.updated` are too ambiguous unless they identify the
canonical aggregate, completed fact, and schema version.

## Delivery semantics

- Delivery is at least once.
- Ordering is guaranteed only per declared aggregate/partition key.
- Consumers persist processed `eventId` and effect atomically where possible.
- Retry uses bounded exponential backoff and typed retryability.
- Poison events enter a DLQ with redacted error, attempts, and recovery action.
- Replay preserves original event identity and records replay execution.
- Consumers reject unsupported major versions and alert before compatibility
  windows expire.

## Schema evolution

Additive optional fields may use a minor schema revision under compatibility
testing. Removed, retyped, semantically changed, or newly required fields need a
new major event version. Producers support the approved overlap window;
consumers publish compatibility declarations and contract-test fixtures.

## Payload rules

Payloads contain the minimum consumer fact plus canonical IDs, versions,
operation, and provenance/certification references. Raw artifacts, source
documents, secrets, prompts, PHI, and unrestricted clinical evidence are
referenced through authorized retrieval, never copied into general events.

## Consumer contract

Every consumer declares subscribed types/versions, authorization, ordering key,
idempotent effect, checkpoint, retry/DLQ, maximum lag, replay range, projection
rebuild, sensitive-data handling, metrics, and runbook. A consumer cannot infer
certification from event arrival; it checks the explicit certification contract.

## Certification

Required evidence covers atomic outbox recording, duplicate delivery,
out-of-order delivery, consumer crash between receipt and commit, poison event,
DLQ replay, schema compatibility, authorization, redaction, lag alerting,
revocation compensation, and full projection rebuild.
