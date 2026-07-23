---
title: "veryfront/metrics"
description: "Runtime and application metric hooks for project code."
order: 17
---

## Import

```ts
import {
  counter,
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
| `counter` | Add a non-negative value to a monotonic counter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L163) |
| `gauge` | Set the latest finite value for a gauge series. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L214) |
| `histogram` | Record a finite observation in a histogram. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L189) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MetricAttributes` | Low-cardinality attributes attached to a metric measurement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L26) |
| `MetricAttributeValue` | A scalar value accepted as a metric attribute. Nullish values are omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L23) |
| `MetricInstrumentOptions` | Descriptive metadata for a metric instrument. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L29) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `metrics` | Runtime and application metric operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L232) |
