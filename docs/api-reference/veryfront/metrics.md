---
title: "veryfront/metrics"
description: "Runtime/application metric hooks for project code."
order: 17
---

## Import

```ts
import {
  counter,
  flushMetrics,
  gauge,
  histogram,
  metrics,
} from "veryfront/metrics";
```

## Examples

```ts
import { metrics } from "veryfront/metrics";

metrics.counter("vf_eval_result_total", 1, { provider: "openai" });
metrics.histogram("vf_eval_latency_ms", 420, { model: "gpt-5" });
metrics.gauge("vf_eval_queue_depth", 3);
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `counter` | Add a non-negative finite value to a monotonic project counter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L595) |
| `flushMetrics` | Attempt to flush pending direct OTLP project metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L643) |
| `gauge` | Set the latest finite value for a project gauge series. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L627) |
| `histogram` | Record one finite value in a project histogram. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L611) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MetricAttributes` | Low-cardinality attributes attached to one metric measurement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L58) |
| `MetricAttributeValue` | Primitive value accepted for a metric attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L48) |
| `MetricInstrumentOptions` | Stable OpenTelemetry metadata for a metric instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L67) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `metrics` | Immutable project metric hooks and direct-export lifecycle control. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L656) |
