# Runtime Diagnostics and Anomaly Detection

The diagnostics engine consumes normalized runtime signals from logging, metrics,
tracing, and health services. It detects and classifies operational anomalies; it
does not notify, remediate, or make speculative AI conclusions.

## Rules and providers

Diagnostic modules implement `DiagnosticProvider` and register ordered,
side-effect-free rules with `DiagnosticRegistry`. Rules return a category,
severity, confidence score, evidence references, and an optional concise root
cause. Domain packages must not modify the diagnostics core.

Severity is centralized:

- `info`: expected or informational failures
- `warning`: degraded or retryable operation
- `error`: non-retryable operation failure
- `critical`: immediate startup or resource risk

## Evidence and persistence

Events contain operational identifiers and references only. Never include request
or response payloads, SQL, tokens, credentials, stack traces, patient data, or
exception messages. Repeated correlated findings retain first/last detection and
increment occurrence count.

`DiagnosticStore` is the persistence boundary. The runtime uses the memory adapter
for process-local inspection; a durable adapter can be introduced with the Runtime
Evidence Repository batch without changing rules or inspection APIs.

## Inspection API

Administrators can inspect:

- `/runtime/diagnostics`
- `/runtime/diagnostics/{id}`
- `/runtime/anomalies`

List endpoints accept `severity`, `category`, `component`, `correlationId`, `from`,
and `to`. Platform and tenant administrators are authorized. Responses are
non-cacheable.

## Troubleshooting

Start from correlation and trace references, confirm the classified component,
then inspect the linked logs, metrics, trace, and health evidence. Confidence is
an evidence-strength indicator, not a guarantee of causality.
