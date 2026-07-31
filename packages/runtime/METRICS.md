# Runtime metrics

The MedLink runtime provides a provider-neutral metrics registry. Runtime
middleware records request lifecycle metrics automatically; application and
business services must not emit runtime metrics directly.

## Naming

- Use lowercase `snake_case`.
- Include the unit in histogram names, such as
  `api_request_duration_ms`.
- Counters describe cumulative events.
- Gauges describe current state.
- Histograms describe distributions.
- Never rename or repurpose a published metric.

## Context

Every metric point carries correlation, tenant, organization, service,
component, operation, and environment context. Context is derived from the
canonical `RuntimeContext`; call sites do not assemble it manually.

Metric attributes must not contain PHI, prescription content, message bodies,
credentials, tokens, or raw database queries.

## Standard catalog

The executable catalog is exported as `standardRuntimeMetrics`. It reserves API,
transaction, retry, audit, outbox, worker, queue, dead-letter, memory, CPU, and
latency names. Placeholder gauges remain inactive until their owning
infrastructure exists.

## Usage

Runtime adapters obtain the shared middleware from
`@medlink/observability`:

```ts
const metrics = runtimeMetrics("medlink-api");
metrics.start(context, operation);
metrics.finish({ context, operation, outcome: "succeeded", durationMs: 12 });
```

Use a registry timer around application, repository, or database infrastructure
only when that layer owns the timing boundary. Do not add business metrics until
the owning wave authorizes them.

## Exporters

Future exporters implement `MetricSink`. Adding OpenTelemetry, Prometheus,
Datadog, or another sink must not change metric-producing code. Exporters,
scrape endpoints, dashboards, health checks, and tracing are outside S01.9
Batch 2.
