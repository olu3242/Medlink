# Enterprise Health Services

MedLink exposes four operational probes:

- `/health/live` confirms process and event-loop responsiveness without dependencies.
- `/health/ready` confirms that critical dependencies can accept traffic.
- `/health/startup` confirms runtime, configuration, and database initialization.
- `/health/details` returns the full component report to authenticated platform or
  tenant administrators.

Public probes return only `status` and `checkedAt`, never tenant data, credentials,
SQL, exception messages, or patient information. Detailed failures are sanitized.
Responses are not cacheable.

## Providers and dependency registration

Implement `HealthCheckProvider` with a stable name, category, criticality flag, and
asynchronous `check`. Register it with `HealthRegistry`; health aggregation does
not require changes when new providers are introduced.

Critical failures produce `unhealthy` and HTTP 503. Non-critical failures produce
`degraded` and HTTP 200. All passing checks produce `healthy`.

Dependency checks should perform the least expensive operation that proves
availability. Recovery hints must be operational guidance and must not contain
secrets or internal payloads.
