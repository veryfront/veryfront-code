# Error Observability

Structured error logging, metrics, tracing, and alerting using the slug-based error registry.

**Prerequisite:** [Error codes refactoring](./refactor_error_codes.md) (slug registry must exist). Pairs with [error handling middleware](./error_handling_middleware.md).

---

## Problem

Current error observability is fragmented:

- `ErrorCollector` (`src/observability/error-collector.ts`) uses its own `ErrorType` enum (`compile`, `runtime`, `bundle`, `hmr`, `module`) — disconnected from slug registry categories
- `handleError()` logs `Error: ${message}` — no slug, no category, no structured fields
- Metrics record `recordRenderError()`, `recordRSCError()` as separate counters — no unified error metric
- Tracing exists (`withSpan`, OpenTelemetry) but errors don't attach slug/category as span attributes
- No way to alert on specific slug frequency spikes or new slugs appearing
- Log format is inconsistent: some use `serverLogger.error(message, error)`, others use `console.error`

---

## Target State

- All errors logged in structured format with `slug`, `category`, `status` fields
- Single `veryfront.error` metric counter with `slug` and `category` labels
- Error spans include `error.slug` and `error.category` attributes
- `ErrorCollector` uses slug registry categories instead of its own enum
- Grafana dashboard: error rate by category, top slugs, new slug detection
- Alert rules: spike detection per-slug, new slug appearance

---

## Execution Plan

### Phase 1: Structured error logging

- [ ] **1.1** Create `src/errors/logging.ts`
  - `logError(error: VeryfrontError, context?: Record<string, unknown>): void`
  - Output format:
    ```
    [ERROR] {slug} ({category}) — {title}
      Detail: {detail}
      Suggestion: {suggestion}
      Docs: https://veryfront.com/docs/errors/{slug}
    ```
  - JSON mode for production (structured logging to stdout):
    ```json
    {"level":"error","slug":"config-not-found","category":"CONFIG","title":"...","detail":"...","timestamp":"..."}
    ```

- [ ] **1.2** Create `src/errors/logging.test.ts`

> 1.3 depends on 1.1

- [ ] **1.3** Replace all `handleError()` call sites with `logError()`
  - `src/errors/error-handlers.ts` → update `handleError` to delegate to `logError`
  - Grep for `serverLogger.error` in error-handling code paths → use `logError`

### Phase 2: Error metrics

- [ ] **2.1** Create `src/observability/instruments/error-instruments.ts`
  - Counter: `veryfront.error.count` with labels `{slug, category, status}`
  - Histogram: `veryfront.error.rate` for error rate tracking
  - Function: `recordError(error: VeryfrontError): void`

- [ ] **2.2** Create `src/observability/instruments/error-instruments.test.ts`

> 2.3 depends on 2.1

- [ ] **2.3** Wire `recordError()` into error boundary middleware
  - `httpErrorBoundary` → call `recordError()` before responding
  - `cliErrorBoundary` → call `recordError()` before exiting

### Phase 3: Error tracing integration

- [ ] **3.1** Create `src/errors/tracing.ts`
  - `attachErrorToSpan(error: VeryfrontError, span: Span): void`
  - Sets span attributes: `error.slug`, `error.category`, `error.status`
  - Sets span status to ERROR
  - Adds span event with error detail

- [ ] **3.2** Create `src/errors/tracing.test.ts`

> 3.3 depends on 3.1

- [ ] **3.3** Wire into existing tracing infrastructure
  - `src/observability/auto-instrument/wrappers.ts` → attach error attributes when errors are caught
  - `src/server/universal-handler/index.ts` → tracing catch blocks use `attachErrorToSpan`

### Phase 4: Migrate ErrorCollector

- [ ] **4.1** Update `src/observability/error-collector.ts`
  - Replace `ErrorType` enum with `ErrorCategory` from slug registry
  - `DevError.type` → `DevError.category` (use registry categories)
  - `DevError.id` → include slug when available
  - Keep backward compat for MCP consumers during transition

- [ ] **4.2** Update `src/observability/error-collector.test.ts`

- [ ] **4.3** Update all `ErrorCollector.add*()` call sites
  - `addCompileError()` → `add({ category: "BUILD", slug: "..." })`
  - `addRuntimeError()` → `add({ category: "RUNTIME", slug: "..." })`
  - `addBundleError()` → `add({ category: "BUILD", slug: "..." })`
  - `addHMRError()` → `add({ category: "DEV", slug: "..." })`
  - `addModuleError()` → `add({ category: "MODULE", slug: "..." })`

### Phase 5: Grafana dashboards and alerts

- [ ] **5.1** Create error rate dashboard in `veryfront-observability/`
  - Panel: Error count by category (stacked bar)
  - Panel: Top 10 slugs (table)
  - Panel: Error rate over time (line graph)
  - Panel: New slugs in last 24h (stat)

- [ ] **5.2** Create alert rules
  - Spike: `rate(veryfront_error_count[5m])` > 2x baseline for any slug
  - New slug: slug appears that wasn't seen in last 7 days
  - Category threshold: CONFIG/BUILD errors > 10/min (indicates systemic issue)

### Phase 6: Verify

- [ ] **6.1** All error log lines include slug and category
- [ ] **6.2** Prometheus `/metrics` endpoint includes `veryfront_error_count`
- [ ] **6.3** Grafana dashboard renders with sample data
- [ ] **6.4** All tests pass

---

## Code Patterns

### Structured error logging

```typescript
// src/errors/logging.ts
export function logError(error: VeryfrontError, context?: Record<string, unknown>): void {
  const entry = {
    level: "error",
    slug: error.slug,
    category: error.category,
    title: error.title,
    detail: error.detail,
    suggestion: error.suggestion,
    status: error.status,
    docs: `https://veryfront.com/docs/errors/${error.slug}`,
    ...context,
    timestamp: new Date().toISOString(),
  };

  if (isProductionMode()) {
    // Structured JSON for Loki ingestion
    console.error(JSON.stringify(entry));
  } else {
    // Human-readable for dev
    console.error(`[ERROR] ${error.slug} (${error.category}) — ${error.title}`);
    if (error.detail) console.error(`  Detail: ${error.detail}`);
    if (error.suggestion) console.error(`  Suggestion: ${error.suggestion}`);
  }
}
```

### Error metric recording

```typescript
// src/observability/instruments/error-instruments.ts
import { getMetricsState } from "../metrics/index.ts";

const errorCounter = createCounter("veryfront.error.count", {
  description: "Total errors by slug and category",
});

export function recordError(error: VeryfrontError): void {
  errorCounter.add(1, {
    slug: error.slug,
    category: error.category,
    status: String(error.status),
  });
}
```

### Error span attributes

```typescript
// src/errors/tracing.ts
export function attachErrorToSpan(error: VeryfrontError, span: Span): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.title });
  span.setAttributes({
    "error.slug": error.slug,
    "error.category": error.category,
    "error.status": error.status,
  });
  span.addEvent("error", {
    "error.slug": error.slug,
    "error.detail": error.detail ?? "",
  });
}
```

---

## File Changes

| File | Phase | Change |
|------|-------|--------|
| `src/errors/logging.ts` | 1 | **New** |
| `src/errors/logging.test.ts` | 1 | **New** |
| `src/observability/instruments/error-instruments.ts` | 2 | **New** |
| `src/observability/instruments/error-instruments.test.ts` | 2 | **New** |
| `src/errors/tracing.ts` | 3 | **New** |
| `src/errors/tracing.test.ts` | 3 | **New** |
| `src/observability/error-collector.ts` | 4 | Migrate to registry categories |
| `src/observability/error-collector.test.ts` | 4 | Update tests |
| `veryfront-observability/dashboards/` | 5 | **New** dashboard JSON |
| `veryfront-observability/alerts/` | 5 | **New** alert rules |

---

## Loki Query Examples (post-migration)

```logql
# All errors by category
{namespace="veryfront-production"} | json | level="error" | line_format "{{.slug}} ({{.category}})"

# Config errors specifically
{namespace="veryfront-production"} | json | category="CONFIG"

# Specific slug frequency
sum(rate({namespace="veryfront-production"} | json | slug="hydration-mismatch" [5m]))

# New slugs not seen before
{namespace="veryfront-production"} | json | level="error" | slug != "" | slug !~ "config-not-found|build-failed|..."
```
