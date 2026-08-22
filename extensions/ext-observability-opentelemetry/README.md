# @veryfront/ext-observability-opentelemetry

> **Category:** Observability | **Contracts:** `TracingExporter`, `NodeTelemetryProvider` | **Optional**

Provides distributed tracing, OTLP log export, OTLP metrics export, the OpenTelemetry metrics API bridge, and Node telemetry bootstrap for Veryfront via the [OpenTelemetry JS SDK](https://github.com/open-telemetry/opentelemetry-js). Exports trace spans, log records, and metrics over OTLP/HTTP to any OpenTelemetry-compatible collector.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extOpenTelemetry from "@veryfront/ext-observability-opentelemetry";

export default defineConfig({
  extensions: [extOpenTelemetry()],
});
```

## Environment variables

The extension reads the standard OpenTelemetry env vars at setup time:

| Variable                                                  | Required         | Description                                                       |
| --------------------------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                             | Yes (for export) | Base collector URL, e.g. `http://localhost:4318`                  |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`                      | No               | Trace-specific OTLP HTTP URL                                      |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`                     | No               | Metric-specific OTLP HTTP URL                                     |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`                        | No               | Log-specific OTLP HTTP URL                                        |
| `OTEL_EXPORTER_OTLP_HEADERS`                              | No               | Comma-separated `key=value` pairs (commonly used for auth tokens) |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS`                       | No               | Trace-specific headers merged over global headers                 |
| `OTEL_EXPORTER_OTLP_METRICS_HEADERS`                      | No               | Metric-specific headers merged over global headers                |
| `OTEL_EXPORTER_OTLP_LOGS_HEADERS`                         | No               | Log-specific headers merged over global headers                   |
| `OTEL_SERVICE_NAME`                                       | No               | Service name attached to telemetry                                |
| `OTEL_TRACES_ENABLED` / `OTEL_TRACES_EXPORTER=otlp`       | No               | Enables trace export                                              |
| `OTEL_METRICS_ENABLED` / `OTEL_METRICS_EXPORTER=otlp`     | No               | Enables metric export                                             |
| `OTEL_LOGS_ENABLED` / `OTEL_LOGS_EXPORTER=otlp`           | No               | Enables log export                                                |
| `OTEL_METRIC_EXPORT_INTERVAL`                             | No               | Metric export interval in milliseconds                            |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` | No               | Metrics temporality. Dedicated service defaults to `delta`.       |

Configuration is read from process `OTEL_*` environment variables. In shared Veryfront runtimes these are platform-owned host env vars. The extension does not accept `ctx.config.otel` exporter endpoint, header, service name, or enable-flag overrides because project config is tenant controlled in shared runtimes.

## Factory configuration

```ts
extOpenTelemetry();
```

Exporter configuration is process-level. Dedicated runtimes can use project-specific collector endpoints by running the project in its own process with its own process environment.

## Metrics

Set `OTEL_METRICS_ENABLED=true` to export framework metrics through OTLP HTTP. The extension resolves `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` first, then `OTEL_EXPORTER_OTLP_ENDPOINT`. A base OTLP endpoint receives `/v1/metrics`.

Dedicated Node agent services create a startup counter named `veryfront.agent.telemetry.startups` when metrics export is enabled. The dedicated service defaults metric temporality to `delta`, which matches Datadog's OTLP metrics intake requirement.

## Logs

Set `OTEL_LOGS_ENABLED=true` or `OTEL_LOGS_EXPORTER=otlp` to export structured Veryfront agent logs through OTLP HTTP. The extension resolves `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` first, then `OTEL_EXPORTER_OTLP_ENDPOINT`. A base OTLP endpoint receives `/v1/logs`.

Dedicated Node agent services bridge Veryfront's structured logger into OpenTelemetry logs after telemetry initialization. Log records include the active `trace_id` and `span_id` when available, so Datadog can correlate logs with traces.

In shared Veryfront runtimes, these variables are platform-owned host env vars. Project env overlays must not control the shared runtime metrics exporter. Use a dedicated runtime for project-owned collector endpoints or credentials.

## Provided contracts

`TracingExporter`: Veryfront's core shim calls `getProvider()` to wire the SDK's `TracerProvider` into framework-emitted spans. Spans are batched and exported by the SDK's `BatchSpanProcessor`; `export(spans)` on the contract is intentionally a no-op because the SDK owns the export pipeline.

`start(config)` constructs the provider + OTLP HTTP exporter; `shutdown()` flushes and shuts down the provider.

`NodeTelemetryProvider`: the Node agent service calls `initialize(options)` when telemetry is enabled. The provider starts `NodeSDK`, configures sampling, attaches HTTP/Express/fs auto-instrumentation, and registers shutdown handling.

## Capabilities

- **net `*`:** OTLP exporter reaches the configured collector.
- **env:** reads the `OTEL_*` variables listed above.

## Workflow spans and map fan-out

With this extension registered, the workflow executor emits a `workflow.run` span per
execution and a `workflow.node <id>` span per node, and agent spans nest beneath the node
that produced them.

Node spans are named after the node id so a trace reads at a glance. Map and loop children
name their spans differently, and the difference decides which problem you get:

- **Map children carry generated ids.** A `map` over N items builds children `<map>_0`,
  `<map>_1`, and so on, so it emits one span per item _and_ one distinct span name per item.
  The same generated id also lands in `workflow.node.id`.
- **Loop children keep their authored ids.** A `loop` re-runs the same authored steps once
  per iteration, so every iteration emits a span carrying that step's own id as both its
  name and its `workflow.node.id`. Span names stay bounded no matter how long the loop runs,
  and nothing on the span says which iteration produced it: only the span id and the start
  timestamp separate iteration 0 from iteration 5. The `<loop>_iter_N` ids that appear in run
  state are child-graph run ids, not span names, and no span is ever named after one.

Two consequences worth planning for:

- **Span volume.** A map over 10,000 items yields at least 10,000 node spans in a single
  trace, before any agent spans nested beneath them. The framework applies no cap on `items`,
  so the caller is the only bound on how large a map can get. `OTEL_BSP_MAX_QUEUE_SIZE` and
  `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` govern the SDK's export buffer, not span generation: once
  the queue fills, further spans are dropped rather than exported. Collector-side tail
  sampling decides whether to keep or drop an entire trace, not how many spans it contains.
  Neither control substitutes for keeping map size bounded at the call site.
- **Name cardinality.** Backends that aggregate by span name, for example Tempo's metrics
  generator, see one series per map item. Loop iterations add no name cardinality. Drop or
  rewrite the `workflow.node <id>` span name at the collector if map fan-out matters for your
  backend; `workflow.node.id` is a separate attribute and rewriting the span name leaves it
  untouched unless you rewrite it too.

`workflow.run` is always a trace root. Started from an instrumented HTTP handler, webhook,
or approval callback it does **not** join that request's trace: a run is durable work that
outlives whatever started it. Parked on an approval it can resume days later, so nesting it
under the request would leave an open span inside a finished trace, and OpenTelemetry's
default parent-based sampler would let a sampled-out request silently drop the entire run.

The causal edges survive as span **links** instead. Every `workflow.run` span carries up to
two, each tagged with `workflow.link.type`:

| `workflow.link.type` | Points at                                                                     |
| -------------------- | ----------------------------------------------------------------------------- |
| `caller`             | The span that was active when this execution started, when anything traced it |
| `previous_execution` | This run's previous `workflow.run` span, when it is resuming                  |

Runs are still traced per execution attempt: a run that pauses at a wait node or a pending
approval and later resumes produces a _separate_ trace per execution. Those traces are now
chained by `previous_execution` links, and every span still carries `workflow.run_id`, so
filtering on that attribute reassembles the whole run as it always did.

The link is built from a W3C `traceparent` persisted on the run record when each execution
claims it. A run executed with tracing disabled simply stores nothing and the next
execution links to nothing, so the chain degrades to `workflow.run_id` correlation.

Node spans carry `workflow.node.status`, and a failed node or run sets the span status to
ERROR, so the usual errored-spans filters in Jaeger, Tempo and Datadog work. A cancelled run
is not a failure: the in-flight node span ends as ERROR reporting `Node "<id>" failed`, while
the `workflow.run` span stays unset, so cancellations do not show up in errored-run queries.
Span statuses never carry the underlying error text, on this path or any other: they name the
node, or a bounded classification such as `ECONNRESET`. The detail stays in the run record and
the logs. The `exception` event a failed span records carries no `exception.stacktrace` either,
because the error the span reports is a classification built where the failure was noticed, so
its frames would name framework files and the absolute paths they sit at rather than the
failure. A caller that wants the real stack on a span opts in with an `errorStatus` mapper that
returns the error it was given.

Retry attempts of a composite node appear as repeated sibling spans sharing one name. Status
tells them apart only when an attempt eventually succeeds: that one is not ERROR while the
earlier ones are. When the retries exhaust and every attempt fails, the sibling spans are
identical in name, status and attributes, and only the span id and the timestamps separate
them. `workflow.node.attempts` does not help either, because it reads `1` on every child: the
attempt counter lives on the parent composite span, and each child re-runs from scratch
counting its own attempts from one. The parent node span carries a `workflow.node.retry` event
per retry, which is the reliable way to count them.
