---
title: "veryfront/observability"
description: "OpenTelemetry tracing, metrics collection, auto-instrumentation for fetch/HTTP/React, OTLP export, and structured error and log buffering."
order: 17
---

# veryfront/observability

OpenTelemetry tracing, metrics collection, auto-instrumentation for fetch/HTTP/React, OTLP export, and structured error and log buffering.

## Examples

```ts
import { withSpan } from "veryfront/observability";

const result = await withSpan("load-data", async () => {
  return await fetch("https://example.com/data");
});
```
