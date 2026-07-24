---
title: "veryfront/metrics"
description: "Runtime/application metric hooks for project code."
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
| `counter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L446) |
| `gauge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L474) |
| `histogram` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L460) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MetricAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L29) |
| `MetricAttributeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L28) |
| `MetricInstrumentOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L31) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `metrics` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts#L494) |
