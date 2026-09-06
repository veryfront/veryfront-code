---
title: "veryfront/metrics"
description: "Runtime/application metric hooks for project code."
order: 20
---

## Import

```ts
import { counter, gauge, histogram, metrics } from "veryfront/metrics";
```

## Examples

### Record application metrics

```ts
import { metrics } from "veryfront/metrics";

metrics.counter("orders_processed_total", 1, { status: "completed" });
metrics.histogram("order_processing_ms", 240);
metrics.gauge("orders_queued", 3);
```

## Exports

### Functions

| Name        | Description | Source                                                                               |
| ----------- | ----------- | ------------------------------------------------------------------------------------ |
| `counter`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts) |
| `gauge`     |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts) |
| `histogram` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts) |

### Types

| Name                      | Description | Source                                                                               |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `MetricAttributes`        |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts) |
| `MetricAttributeValue`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts) |
| `MetricInstrumentOptions` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/index.ts) |

### Constants

| Name      | Description                                         | Source                                                                                |
| --------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `metrics` | Immutable metric recording facade for project code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/metrics/public.ts) |
