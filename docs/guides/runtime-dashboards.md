---
title: "Runtime dashboards"
description: "Monitor workflow outcomes, step latency, and model usage in Grafana and Langfuse."
order: 175
---

Use runtime traces to investigate individual executions and metrics to measure application
outcomes over time. This guide configures a local or dedicated runtime; shared hosted
applications must use the [project trace export settings](https://github.com/veryfront/veryfront-code/blob/main/extensions/ext-observability-opentelemetry/README.md#hosted-application-traces).

## Export runtime traces

Install `@veryfront/ext-observability-opentelemetry` at the same version as `veryfront`, then
declare it in `veryfront.config.ts`:

```ts
import { defineConfig } from "veryfront";
import extOpenTelemetry from "@veryfront/ext-observability-opentelemetry";

export default defineConfig({ extensions: [extOpenTelemetry()] });
```

Set these variables in the process environment before starting the command:

```sh
export OTEL_TRACES_ENABLED=true
export OTEL_SERVICE_NAME=my-application
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
npx veryfront dev
```

Use the collector's OTLP **HTTP** endpoint. Declared extensions also start for `task`,
`eval`, and `workflow run`, and flush on command completion, including execution failure.
Force-killing a process can still lose buffered spans. If using an older installed version,
verify command support before relying on CLI exports.

Send one request or run one workflow, then locate `my-application` in the trace backend.
Before building a dashboard, confirm that a workflow contains `workflow.run`,
`workflow.node <id>`, and any agent/model child spans. A paused workflow produces another
trace when resumed: use `workflow.run_id` and span links to follow the durable run.

## Build a Grafana dashboard

Add a Tempo data source and enable
[TraceQL metrics](https://grafana.com/docs/tempo/latest/metrics-from-traces/metrics-queries/)
in Tempo. Start with a short time range that contains your test execution. Create these
panels using the Tempo data source; replace `my-application` with your service name:

| Panel | TraceQL query |
| --- | --- |
| Workflow execution rate | `{ resource.service.name = "my-application" && name = "workflow.run" } \| rate()` |
| Failed execution rate | `{ resource.service.name = "my-application" && name = "workflow.run" && status = error } \| rate()` |
| Workflow p95 duration | `{ resource.service.name = "my-application" && name = "workflow.run" } \| quantile_over_time(duration, .95)` |
| Step p95 duration | `{ resource.service.name = "my-application" && name =~ "workflow.node .*" } \| quantile_over_time(duration, .95) by (span.workflow.node.id)` |
| Failed executions to inspect | `{ resource.service.name = "my-application" && name = "workflow.run" && status = error }` |

Use time-series panels for the first four queries and a trace table for the last. The
rates count execution attempts, including resumed executions, rather than unique durable
runs. A cancelled run is not necessarily marked as an errored workflow span. Inspect its
run status separately. Empty time ranges should display no data, not a success rate.

For retries, inspect the parent node's `workflow.node.retry` events and
`workflow.node.attempts`. For model usage, inspect the model span's `gen_ai.request.model`,
`gen_ai.usage.input_tokens`, and `gen_ai.usage.output_tokens`. Aggregate one span level only:
adding parent agent totals to their child model totals double-counts usage.

Group by authored step identifiers for small workflows. Generated map-child IDs can create
many series; use `workflow.node.type` for an aggregate view or normalize generated IDs in
the collector. See [workflow span semantics](https://github.com/veryfront/veryfront-code/blob/main/extensions/ext-observability-opentelemetry/README.md#workflow-spans-and-map-fan-out).

## Measure application outcomes

A successful model call does not prove that the application made a correct decision. Record
the application's accepted/reviewed outcome after validation, separately from technical
success. Call this helper from the active workflow step:

```ts
import { setActiveSpanAttributes } from "veryfront/observability";
import { metrics } from "veryfront/metrics";

export function recordOutcome(outcome: "accepted" | "review") {
  setActiveSpanAttributes({ "app.outcome": outcome });
  metrics.counter("vf_work_item_total", 1, { outcome });
}
```

Enable `OTEL_METRICS_ENABLED=true` and configure a metrics-capable collector to graph the
counter. Keep labels bounded: outcome, step type, and model are useful; document IDs and
raw input are not metric labels. Use a trace ID to investigate an individual case. See
[Project metrics](./project-metrics.md) for runtime scoping and exporter configuration.

## Send traces to Langfuse

Langfuse accepts OTLP/HTTP traces. Set a trace-specific endpoint for your Langfuse region:

```sh
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="Authorization=Basic ${LANGFUSE_AUTH_BASE64}"
```

Supply `LANGFUSE_AUTH_BASE64` from your secret configuration: it is the base64 encoding of
the project's public key, a colon, and secret key. Choose your region's endpoint and restart
the process. Follow [Langfuse's OTLP setup](https://langfuse.com/integrations/native/opentelemetry)
for current ingestion headers and attribute mappings.

Use one OpenTelemetry collector with two trace exporters when you want both Tempo and
Langfuse. Keep the runtime pointed at that collector rather than installing another global
tracer provider. Langfuse receives traces; send metrics to a metrics backend.

For filterable application dimensions in Langfuse, set
`langfuse.trace.metadata.<key>` or `langfuse.observation.metadata.<key>` on the relevant spans.
Attributes on one span do not automatically propagate to every descendant. Keep raw inputs
and secrets out of metadata. Use [eval report exporters](./eval-reporting.md) for scored
datasets and comparison reports; telemetry alone does not create an eval report.

## Verify the dashboard

Run a known success and a deliberate failure using synthetic data. Confirm the failed
execution appears in the trace table, its step is marked as an error, and the application
outcome counter changes once per processed item. Run a CLI workflow and confirm its spans
arrive before the command exits. A collector error must leave the task or workflow outcome
unchanged; diagnose missing telemetry separately.

If a trace is missing, check the extension declaration, process environment, HTTP endpoint,
credentials, sampling, and selected time range. Check collector logs before adding more
instrumentation. Hosted project export has a narrower scope than local runtime export;
use the deployment's documented capabilities rather than assuming all internal spans are
copied to a project collector.
