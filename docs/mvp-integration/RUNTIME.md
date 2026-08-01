# Runtime Integration

The transactional runtime coordinates workflow state, outbox events, retries, recovery, dead letters, and runtime evidence. Every request carries correlation and idempotency identifiers. Domain writes and outbox publication share a transaction boundary. Metrics, structured logs, traces, health checks, and evidence must use the same correlation ID. See `packages/runtime` and the transactional runtime migrations for implementation evidence.
