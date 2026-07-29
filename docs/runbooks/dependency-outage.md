# Dependency outage

1. Confirm the dependency failure from readiness details and provider status.
2. Preserve idempotency keys and allow durable outbox events to remain queued.
3. Disable unsafe writes and route clinical uncertainty to human handoff.
4. Restore connectivity, then drain traffic gradually while watching failures.
5. Reconcile queued and dead-letter events before closing the incident.
