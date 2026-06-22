---
title: "Project metrics"
description: "Emit project-scoped counters, histograms, and gauges from app and eval code."
order: 41
---

Project metrics are custom application and eval measurements that show up in
the Veryfront Metrics panel. They are separate from runtime traces and logs:
the runtime installs the OpenTelemetry meter provider, while project code emits
named instruments through `veryfront/metrics`.

For runtime observability APIs and OTLP setup, see
[veryfront/observability](../api-reference/veryfront/observability.md).

## Emit metrics

Use the SDK hook from app, agent, tool, task, workflow, and eval code:

```ts
import { metrics } from "veryfront/metrics";

metrics.counter("vf_signup_total", 1, {
  plan: "pro",
  source: "checkout",
});

metrics.histogram("vf_checkout_duration_seconds", 1.24, {
  step: "payment",
});

metrics.gauge("vf_queue_depth", 42, {
  queue: "email",
});
```

Use counters for totals, histograms for durations and sizes, and gauges for
current values. Prefer stable `vf_`-prefixed metric names so they are easy to
discover in Studio.

When code runs inside Veryfront, the SDK adds request-scoped labels for
`project_id`, `project_slug`, `environment`, and `branch` for preview requests.
Preview requests without an explicit branch use `branch="main"`. User code
should not provide or trust those labels for isolation; the platform-owned
request context wins.

## Emit eval metrics

Eval definitions still use `veryfront/eval` metrics for pass/fail, scores, and
reports. Add project metrics when you also want aggregate dashboards:

```ts
import { datasets, evalAgent, metrics as evalMetrics } from "veryfront/eval";
import { metrics } from "veryfront/metrics";

export default evalAgent({
  target: "agent:support",
  dataset: datasets.inline([
    { id: "q1", input: "Capital of France?", reference: "Paris" },
  ]),
  metrics: [evalMetrics.answer.exactMatch().gate()],
  async check(ctx) {
    const passed = ctx.record.output.text?.includes("Paris") === true;

    metrics.counter("vf_eval_result_total", 1, {
      eval_id: "support",
      metric: "answer.exactMatch",
      outcome: passed ? "pass" : "fail",
    });

    metrics.histogram("vf_eval_duration_ms", ctx.record.durationMs, {
      eval_id: "support",
    });
  },
});
```

## Label policy

Metric labels become query dimensions. Keep them low-cardinality and safe:

| Good labels                                                                                      | Avoid                                                                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `environment`, `branch`, `service`, `route`, `status`, `outcome`, `model`, `provider`, `eval_id` | User IDs, email addresses, prompts, outputs, request IDs, session IDs, raw URLs, secrets |

Use a small allowlist per metric. Do not put tenant identity, project identity,
credentials, or personally identifiable data into user-supplied labels.
Project, environment, and preview branch labels are injected by the platform.

## Relationship to OpenTelemetry

`veryfront/metrics` writes to the active OpenTelemetry metrics API. Export
routing is owned by the runtime process:

- Shared Veryfront runtimes use platform-owned OTel env vars and filter
  project-supplied telemetry routing keys.
- Dedicated project runtimes may use deployment environment variables because
  they run in their own process boundary.
- Local or customer-cloud deployments can use any Prometheus-compatible backend
  that the runtime config points at; Studio should treat the backend as an
  implementation detail.

Regular OpenTelemetry traces and metrics describe runtime behavior. Project
metrics describe product, app, and eval behavior inside one project.

## Relationship to eval exporters

Langfuse, LangSmith, Braintrust, and similar systems should use explicit eval
report exporters from `veryfront/extensions/eval`. Those exporters receive the
completed, redacted `EvalReport` only when an eval run selects them.

Project metrics are aggregate signals for dashboards and alerts. They are not
the report transport and should not include eval inputs, outputs, traces, or
judge evidence.

## MCP posture

Do not expose arbitrary raw metric writes over MCP. Agents that need to create
metrics should call project code or a typed project tool that uses
`veryfront/metrics`; that keeps project scoping, label policy, rate limits, and
redaction in one framework path.

## Verify it worked

Deploy or run the code path that emits the metric, then open the project
Metrics panel in Studio and query the metric name, for example
`vf_eval_result_total`.

If no series appears, check that metrics export is enabled for the runtime
environment and that the selected time range includes the emitted sample. In
shared Veryfront runtimes, platform telemetry env vars control export. In
dedicated runtimes, check the deployment environment variables for the project
runtime process.
