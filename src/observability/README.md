# Observability Module

The Observability module provides comprehensive OpenTelemetry integration for distributed tracing, metrics collection, and automatic instrumentation across the entire framework.

## Import Map Alias

```typescript
// Using import map alias (recommended)
import {
  initAutoInstrumentation,
  initMetrics,
  initTracing,
  instrumentHttpHandler,
  recordHttpRequest,
  startSpan,
} from "#observability";

// Using barrel file
import { initTracing, startSpan } from "./observability/index.ts";
```

## Public API Overview

The Observability module exports:

- **Tracing utilities** - OpenTelemetry distributed tracing and span management
- **Metrics utilities** - Performance metrics for HTTP, cache, rendering, RSC, builds
- **Auto-instrumentation** - Automatic instrumentation for handlers, fetch, React
- **Configuration** - Simple setup for common observability backends

## File Structure

```
observability/
├── index.ts                    # Public API (barrel file) ← USE THIS
├── README.md                   # This file
├── tracing/                    # Distributed tracing
│   ├── index.ts
│   ├── init.ts                 # Tracing initialization
│   ├── spans.ts                # Span management
│   ├── context.ts              # Context propagation
│   └── config.ts               # Tracing configuration
├── metrics/                    # Metrics collection
│   ├── index.ts
│   ├── init.ts                 # Metrics initialization
│   ├── http.ts                 # HTTP metrics
│   ├── cache.ts                # Cache metrics
│   ├── render.ts               # Rendering metrics
│   ├── rsc.ts                  # RSC metrics
│   ├── build.ts                # Build metrics
│   └── manager.ts              # Metrics manager
└── auto-instrument/            # Auto-instrumentation
    ├── index.ts
    ├── orchestrator.ts         # Instrumentation orchestrator
    ├── http.ts                 # HTTP instrumentation
    ├── fetch.ts                # Fetch instrumentation
    ├── react.ts                # React instrumentation
    └── error.ts                # Error instrumentation
```

## Quick Start

### Basic Setup

```ts
import { initAutoInstrumentation, initMetrics, initTracing } from "#observability";

// Initialize observability (typically in your main server file)
await initTracing({
  serviceName: "my-veryfront-app",
  endpoint: "http://localhost:4318", // OTLP endpoint
  enabled: true,
});

await initMetrics({
  serviceName: "my-veryfront-app",
  endpoint: "http://localhost:4318",
  enabled: true,
});

// Enable automatic instrumentation
await initAutoInstrumentation({
  tracing: true,
  metrics: true,
  instruments: ["http", "fetch", "react", "error"],
});
```

### Manual Tracing

```ts
import { endSpan, setSpanAttributes, startSpan, withSpan } from "#observability";

// Manual span management
async function processRequest(req: Request) {
  const span = startSpan("process-request");

  try {
    setSpanAttributes(span, {
      "http.method": req.method,
      "http.url": req.url,
    });

    const result = await doWork();
    return result;
  } finally {
    endSpan(span);
  }
}

// Using withSpan helper (recommended)
async function processRequest(req: Request) {
  return await withSpan("process-request", async (span) => {
    setSpanAttributes(span, {
      "http.method": req.method,
      "http.url": req.url,
    });

    return await doWork();
  });
}
```

### Manual Metrics

```ts
import {
  recordCacheGet,
  recordHttpRequest,
  recordHttpRequestComplete,
  recordRender,
} from "#observability";

// Record HTTP request start
const requestId = recordHttpRequest("GET", "/api/users");

// Do work...
const response = await handleRequest();

// Record completion
recordHttpRequestComplete(requestId, {
  statusCode: 200,
  duration: 150,
});

// Record cache operations
recordCacheGet("user:123", true); // hit
recordCacheSet("user:123", 1024); // size in bytes

// Record render
recordRender("page:/users", 250, false); // duration, isRSC
```

## Distributed Tracing

### Configuration

```ts
interface TracingConfig {
  serviceName: string;
  endpoint: string; // OTLP endpoint (e.g., 'http://localhost:4318')
  enabled: boolean;
  sampleRate?: number; // 0.0 to 1.0 (default: 1.0)
  exporterType?: "otlp" | "console" | "jaeger";
  headers?: Record<string, string>; // Auth headers
}

await initTracing({
  serviceName: "veryfront-app",
  endpoint: process.env.OTLP_ENDPOINT,
  enabled: process.env.NODE_ENV === "production",
  sampleRate: 0.1, // Sample 10% of traces
  headers: {
    "Authorization": `Bearer ${process.env.OTLP_TOKEN}`,
  },
});
```

### Span Management

```ts
import {
  addSpanEvent,
  createChildSpan,
  endSpan,
  setSpanAttributes,
  startSpan,
} from "#observability";

// Start root span
const rootSpan = startSpan("http.request");

// Add attributes
setSpanAttributes(rootSpan, {
  "http.method": "GET",
  "http.url": "/api/users",
  "http.user_agent": req.headers.get("user-agent"),
});

// Add events
addSpanEvent(rootSpan, "validation.start");
await validateRequest(req);
addSpanEvent(rootSpan, "validation.complete");

// Create child span
const dbSpan = createChildSpan(rootSpan, "db.query");
setSpanAttributes(dbSpan, {
  "db.system": "postgresql",
  "db.statement": "SELECT * FROM users",
});
await db.query("SELECT * FROM users");
endSpan(dbSpan);

// End root span
endSpan(rootSpan);
```

### Context Propagation

```ts
import { extractContext, getActiveContext, injectContext, withActiveSpan } from "#observability";

// Extract context from incoming request
const context = extractContext(req.headers);

// Inject context into outgoing request
const headers = new Headers();
injectContext(headers);
await fetch("https://api.example.com", { headers });

// Get current active span
const activeSpan = withActiveSpan((span) => {
  console.log("Current span:", span);
  return span;
});
```

### Async Span Wrapping

```ts
import { withSpan } from "#observability";

// Automatically creates and ends span
async function fetchUser(id: string) {
  return await withSpan("fetch-user", async (span) => {
    setSpanAttributes(span, { "user.id": id });

    const user = await db.users.findById(id);

    if (!user) {
      addSpanEvent(span, "user.not_found");
      throw new Error("User not found");
    }

    return user;
  });
}

// Nested spans work automatically
async function processOrder(orderId: string) {
  return await withSpan("process-order", async () => {
    const order = await fetchOrder(orderId); // Child span
    const user = await fetchUser(order.userId); // Child span
    await sendEmail(user.email); // Child span
    return { order, user };
  });
}
```

## Metrics Collection

### Configuration

```ts
interface MetricsConfig {
  serviceName: string;
  endpoint: string;
  enabled: boolean;
  collectInterval?: number; // Collection interval in ms (default: 60000)
  exportInterval?: number; // Export interval in ms (default: 60000)
  headers?: Record<string, string>;
}

await initMetrics({
  serviceName: "veryfront-app",
  endpoint: process.env.OTLP_ENDPOINT,
  enabled: true,
  collectInterval: 30000, // Collect every 30s
  exportInterval: 60000, // Export every 60s
});
```

### HTTP Metrics

```ts
import { recordHttpRequest, recordHttpRequestComplete } from "#observability";

// Start recording request
const requestId = recordHttpRequest("POST", "/api/users", {
  userAgent: req.headers.get("user-agent"),
  remoteAddr: req.headers.get("x-forwarded-for"),
});

// Handle request
const response = await handleRequest(req);

// Record completion
recordHttpRequestComplete(requestId, {
  statusCode: response.status,
  duration: performance.now() - startTime,
  bytesWritten: response.headers.get("content-length"),
});
```

### Cache Metrics

```ts
import {
  recordCacheGet,
  recordCacheInvalidate,
  recordCacheSet,
  setCacheSize,
} from "#observability";

// Record cache operations
recordCacheGet("user:123", true); // Cache hit
recordCacheGet("user:456", false); // Cache miss

recordCacheSet("user:789", 2048); // Set with size in bytes

recordCacheInvalidate("user:*", 10); // Invalidated 10 entries

// Update cache size
setCacheSize(1024 * 1024 * 10); // 10 MB
```

### Rendering Metrics

```ts
import { recordRender, recordRenderError, recordRSCRender, recordRSCStream } from "#observability";

// SSR rendering
recordRender("page:/users", 250, false); // path, duration, isRSC

// RSC rendering
recordRSCRender("component:UserList", 120);
recordRSCStream("payload:users", 5120); // size in bytes

// Render errors
recordRenderError("page:/users", "TypeError: Cannot read property...");
```

### Build Metrics

```ts
import { recordBuild, recordBundle, recordDataFetch } from "#observability";

// Build process
recordBuild(45000, true); // duration, success

// Bundle generation
recordBundle("client", 512000, 2500); // target, size, duration

// Data fetching (SSG)
recordDataFetch("users", 150, true); // source, duration, success
recordDataFetchError("posts", "Network timeout");
```

## Auto-Instrumentation

### Configuration

```ts
interface AutoInstrumentConfig {
  tracing: boolean;
  metrics: boolean;
  instruments?: ("http" | "fetch" | "react" | "error")[];
}

await initAutoInstrumentation({
  tracing: true,
  metrics: true,
  instruments: ["http", "fetch", "react", "error"],
});
```

### HTTP Handler Instrumentation

```ts
import { instrumentHttpHandler } from "#observability";

// Wrap your HTTP handler
const instrumentedHandler = instrumentHttpHandler(
  async (req: Request) => {
    return new Response("Hello World");
  },
  {
    spanName: "http.request",
    recordMetrics: true,
  },
);

// Use with server
Deno.serve(instrumentedHandler);
```

### Fetch Instrumentation

```ts
import { instrumentFetch } from "#observability";

// Instrument fetch globally
instrumentFetch();

// Now all fetch calls are automatically traced
const response = await fetch("https://api.example.com/users");
// Creates span: "http.client.fetch" with method, url, status attributes
```

### React Render Instrumentation

```ts
import { instrumentReactRender } from "#observability";

// Instrument React rendering
const instrumentedRender = instrumentReactRender(
  async (element: React.ReactElement) => {
    return await renderToString(element);
  },
);

// Use instrumented render
const html = await instrumentedRender(<App />);
// Creates span: "react.render" with component name and duration
```

### Error Instrumentation

```ts
import { instrumentErrorHandler } from "#observability";

// Wrap error handler
const instrumentedErrorHandler = instrumentErrorHandler(
  async (error: Error, req: Request) => {
    console.error("Error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
);

// Errors automatically create spans and record metrics
```

### Batch Instrumentation

```ts
import { instrumentBatch } from "#observability";

// Instrument multiple functions at once
const operations = instrumentBatch({
  fetchUser: async (id: string) => {/* ... */},
  updateUser: async (id: string, data: any) => {/* ... */},
  deleteUser: async (id: string) => {/* ... */},
});

// Each operation now creates spans automatically
await operations.fetchUser("123");
```

## Observability Backends

### Jaeger

```ts
await initTracing({
  serviceName: "veryfront-app",
  endpoint: "http://localhost:14268/api/traces",
  exporterType: "jaeger",
  enabled: true,
});
```

### Zipkin

```ts
await initTracing({
  serviceName: "veryfront-app",
  endpoint: "http://localhost:9411/api/v2/spans",
  exporterType: "otlp",
  enabled: true,
});
```

### Grafana Cloud (OTLP)

```ts
await initTracing({
  serviceName: "veryfront-app",
  endpoint: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp",
  enabled: true,
  headers: {
    "Authorization": `Basic ${btoa(`${instanceId}:${apiToken}`)}`,
  },
});

await initMetrics({
  serviceName: "veryfront-app",
  endpoint: "https://otlp-gateway-prod-us-east-0.grafana.net/otlp",
  enabled: true,
  headers: {
    "Authorization": `Basic ${btoa(`${instanceId}:${apiToken}`)}`,
  },
});
```

### Honeycomb

```ts
await initTracing({
  serviceName: "veryfront-app",
  endpoint: "https://api.honeycomb.io",
  enabled: true,
  headers: {
    "x-honeycomb-team": process.env.HONEYCOMB_API_KEY,
    "x-honeycomb-dataset": "veryfront-traces",
  },
});
```

## Best Practices

1. **Initialize early** - Call init functions at application startup
2. **Use auto-instrumentation** - Enable for common patterns (HTTP, fetch, React)
3. **Manual spans for business logic** - Use `withSpan` for important operations
4. **Add meaningful attributes** - Include user IDs, request IDs, operation details
5. **Sample in production** - Use `sampleRate` to reduce overhead (e.g., 0.1 = 10%)
6. **Propagate context** - Always extract/inject context for distributed traces
7. **Record metrics consistently** - Use standard metric names and labels
8. **Handle shutdown gracefully** - Call `shutdownTracing()` and `shutdownMetrics()`

## Performance Tips

- Auto-instrumentation adds ~1-5ms overhead per operation
- Sampling reduces overhead proportionally (0.1 = 90% reduction)
- Use batch exports to reduce network calls
- Disable in development if not needed
- Use console exporter for debugging (no network overhead)

## Monitoring Examples

### SLI/SLO Tracking

```ts
// Track service level indicators
recordHttpRequestComplete(requestId, {
  statusCode: 200,
  duration: 120, // < 200ms SLO
});

// Query metrics to calculate SLI
const successRate = successfulRequests / totalRequests;
const p95Latency = calculateP95(requestDurations);

console.log(`Success Rate: ${successRate * 100}% (SLO: 99.9%)`);
console.log(`P95 Latency: ${p95Latency}ms (SLO: 200ms)`);
```

### Error Rate Monitoring

```ts
// Automatic error tracking
instrumentErrorHandler(async (error) => {
  // Error automatically recorded in metrics
  return handleError(error);
});

// Query error rate
const errorRate = errorCount / totalRequests;
if (errorRate > 0.01) { // > 1% error rate
  alert("High error rate detected!");
}
```

## Related Modules

- **#server** - Server implementation with observability hooks
- **#rendering** - SSR/RSC rendering with automatic tracing
- **#api** - API routes with HTTP metrics
- **#middleware** - Middleware pipeline with instrumentation

## References

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Grafana Cloud OTLP](https://grafana.com/docs/grafana-cloud/send-data/otlp/)
- [Honeycomb Documentation](https://docs.honeycomb.io/)
