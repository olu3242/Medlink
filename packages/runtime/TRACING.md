# Enterprise Tracing

The runtime tracing package provides provider-neutral distributed trace context.
It does not export, store, sample, or visualize traces.

## Lifecycle and propagation

`RuntimeTrace` creates one root span after the canonical runtime has established
trusted identity and tenant context. `TraceManager` uses async-local context to
preserve the active span across promises. Nested operations inherit the trace ID
and record the active span as their parent. Detached work starts a new trace.

W3C-compatible `traceparent` parsing and formatting helpers are available at
channel and HTTP boundaries. Invalid inbound values must be ignored.

## Naming

Spans use stable, low-cardinality names:

- `service`: deployable service, such as `medlink-api`
- `component`: runtime phase or repository name
- `operation`: canonical application operation

Repository instrumentation records the repository and operation only. SQL,
parameters, request bodies, responses, tokens, secrets, and patient data are
never span attributes.

## Errors

Failed spans contain only the normalized error code, exception type, retryable
flag, and runtime error category. Error messages and stack traces are excluded.

## Instrumentation

Use `instrumentOperation` for runtime phases and `instrumentRepository` at
repository boundaries. The canonical API and web runtimes use the shared
`runtimeTracing` adapter. A future, separately certified batch may connect a
trace exporter without changing domain or channel code.
