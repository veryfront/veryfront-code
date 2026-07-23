# Observability

Veryfront provides tracing, metrics, automatic instrumentation wrappers, and
in-process diagnostic utilities through `veryfront/observability`.

Automatic instrumentation records bounded operational dimensions. It does not
record concrete request URLs, hosts, paths, queries, fragments, userinfo,
project identifiers, file identifiers, raw errors, messages, stacks, or causes.

## How-to guides

### Initialize tracing and metrics

Initialize observability once during application startup.

```ts
import { initAutoInstrumentation } from "veryfront/observability";

await initAutoInstrumentation({
  tracing: {
    enabled: true,
    exporter: "otlp",
    serviceName: "veryfront-app",
  },
  metrics: {
    enabled: true,
    exporter: "otlp",
    prefix: "veryfront_app",
  },
});
```

Use the standard OpenTelemetry environment variables to configure exporter
endpoints and credentials. Do not place credentials in source code.

### Instrument an HTTP handler

Pass a stable, code-owned route template when one is available. Never pass
`request.url` or `url.pathname` as the template.

```ts
import { instrumentHttpHandler } from "veryfront/observability";

const handler = instrumentHttpHandler(
  async (_request: Request) => {
    return new Response("OK");
  },
  { routeTemplate: "/projects/{project}/files/{file}" },
);

Deno.serve(handler);
```

Omit `routeTemplate` when the router cannot provide a stable template.

### Instrument fetch

`instrumentFetch` returns a wrapped fetch implementation. It does not replace
`globalThis.fetch`.

```ts
import { instrumentFetch } from "veryfront/observability";

const observedFetch = instrumentFetch(fetch);
const response = await observedFetch(new Request("https://example.invalid/health"));
```

The wrapper preserves existing `Request` headers, injects trace propagation
headers when a propagator is available, and invokes the underlying fetch once.
Automatic propagation permits only `traceparent` and `tracestate`. It does not
inject baggage or overwrite application authorization headers.

### Instrument React rendering

```ts
import { instrumentReactRender } from "veryfront/observability";

function renderApplication(): string {
  return "<main>Ready</main>";
}

const html = await instrumentReactRender(
  () => renderApplication(),
  "Application",
);
```

The component name remains an API compatibility argument. Automatic telemetry
does not emit it because generic instrumentation cannot verify that it is a
stable, non-customer label.

### Instrument an error handler

```ts
import { instrumentErrorHandler } from "veryfront/observability";

const handleError = instrumentErrorHandler(
  (_error: Error, _request?: Request) => {
    return new Response("Internal server error", { status: 500 });
  },
);
```

The span receives a bounded error category. The original error remains
available to the handler but is not attached to the span.

### Instrument an arbitrary operation

Use a stable, code-owned span name. Automatic operation wrappers do not inspect
function arguments.

```ts
import { instrument, instrumentSync } from "veryfront/observability";

const refreshContent = instrument(
  async (): Promise<string> => await Promise.resolve("ready"),
  "content.refresh",
);

const readCacheState = instrumentSync(
  (): string => "warm",
  "cache.state.read",
);

const content = await refreshContent();
const cacheState = readCacheState();
```

The legacy `attributes` option remains accepted for compatibility, but the
automatic wrappers do not evaluate or emit it. Use a manual span when trusted,
code-owned attributes are required.

### Instrument a batch

`instrumentBatch` processes a stable snapshot of the supplied array. It runs
up to `batchSize` processors concurrently, then starts the next batch.

```ts
import { instrumentBatch } from "veryfront/observability";

await instrumentBatch(
  "content.refresh",
  ["home", "about", "contact"],
  async (route) => {
    await Promise.resolve(route);
  },
  { batchSize: 10 },
);
```

`batchSize` must be a positive safe integer no greater than 1000.

### Create manual spans

Manual attributes are caller-controlled. Use only stable, low-cardinality,
non-sensitive values.

```ts
import { setSpanAttributes, withSpan } from "veryfront/observability";

async function loadContent(): Promise<string> {
  return await Promise.resolve("content");
}

const result = await withSpan("content.load", async (span) => {
  setSpanAttributes(span, {
    "content.source": "cache",
    "content.result": "hit",
  });
  return await loadContent();
});
```

Do not attach prompts, payloads, tokens, request URLs, identifiers, email
addresses, database statements, or raw error data to manual spans.

### Buffer and persist diagnostic logs

`LogBuffer` stores bounded, sanitized snapshots. Returned entries and
subscriber entries are copies, so callers cannot mutate buffered state.

```ts
import { createFileLogSubscriber, LogBuffer } from "veryfront/observability";

const logs = new LogBuffer({ maxSize: 1000 });
const fileLogs = createFileLogSubscriber({
  enabled: true,
  path: "./logs/runtime.log",
  maxSize: "10mb",
  maxFiles: 5,
  level: "info",
  format: "json",
});
const unsubscribe = logs.subscribe(fileLogs.getSubscriber());

logs.info("Runtime ready", "server", { mode: "production" });
await fileLogs.flush();

unsubscribe();
await fileLogs.close();
```

The buffer accepts at most 100,000 entries. File rotation sizes must be positive
and no greater than 1 TiB, and `maxFiles` must be between 1 and 100. The file
subscriber bounds its pending queue and individual entries. It redacts
credentials and local absolute paths even when entries bypass `LogBuffer`.

### Collect development errors

`ErrorCollector` keeps bounded compile, bundle, runtime, HMR, and module errors.
It validates type and category pairs, sanitizes diagnostic text and context,
and returns copies from every read and subscription boundary.

```ts
import { ErrorCollector } from "veryfront/observability";

const errors = new ErrorCollector({ maxErrors: 100 });
errors.addCompileError("Cannot resolve module", "src/app.ts", 12, 4);

const buildErrors = errors.getAll({ category: "BUILD" });
```

Collector capacity must be between 1 and 10,000. Local absolute paths are
replaced with `<LOCAL_PATH>`. Repo-relative paths remain available for
diagnostics.

### Inspect request profiles

Veryfront keeps up to 200 completed request profiles when request profiling is
enabled. `snapshotRequestProfiles()` returns a deep snapshot with at most 50
bounded phase names per request. Set
`VERYFRONT_DISABLE_SLOW_REQUEST_PROFILING=1` to disable default HTML request
profiling. Set `VERYFRONT_ENABLE_SERVER_TIMING=1` to add bounded phase durations
to `Server-Timing` responses.

## Reference

### Automatic HTTP attributes

Automatic HTTP and fetch spans can emit these attributes:

| Attribute            | Values                                       |
| -------------------- | -------------------------------------------- |
| `http.method`        | A standard method, or `OTHER`                |
| `http.scheme`        | `http` or `https`                            |
| `http.route`         | An explicitly supplied stable route template |
| `http.status_code`   | The response status code                     |
| `http.duration_ms`   | A non-negative duration                      |
| `http.response.size` | A valid `content-length` value               |
| `error`              | `true` for a failed operation                |
| `error.category`     | A bounded failure category                   |
| `error.type`         | The same bounded failure category            |

Automatic spans use stable names such as `http.server.request`,
`http.client.fetch`, `render.component`, and `error.handler`.

### Route template syntax

A route template:

- starts with `/`;
- contains literal segments, `:parameter` segments, or `{parameter}` segments;
- contains no query, fragment, origin, userinfo, whitespace, or control data;
- is at most 256 characters.

Invalid route templates are omitted.

### Generic operation attributes

`instrument` and `instrumentSync` emit `duration_ms` plus bounded failure
attributes when the operation fails. `instrumentBatch` emits only these built-in
batch attributes:

| Attribute             | Meaning                       |
| --------------------- | ----------------------------- |
| `batch.total_items`   | Number of supplied items      |
| `batch.size`          | Configured items per batch    |
| `batch.total_batches` | Number of generated batches   |
| `batch.index`         | Zero-based batch index        |
| `batch.items`         | Number of items in this batch |

`batchSize` must be a positive safe integer no greater than 1000. Automatic
operation wrappers do not emit argument-derived or caller-supplied custom
attributes.

### Configuration

```ts
interface AutoInstrumentConfig {
  tracing?: {
    enabled: boolean;
    exporter?: "jaeger" | "zipkin" | "otlp" | "console";
    endpoint?: string;
    serviceName?: string;
  };
  metrics?: {
    enabled: boolean;
    exporter?: "prometheus" | "otlp" | "console";
    endpoint?: string;
    prefix?: string;
  };
  instrumentHttp?: boolean;
  instrumentFetch?: boolean;
  instrumentReact?: boolean;
  captureErrors?: boolean;
}
```

The `instrumentHttp`, `instrumentFetch`, `instrumentReact`, and `captureErrors`
values describe the selected policy. Call the corresponding wrapper to apply
instrumentation to an operation.

Trace and metric-specific OTLP endpoints take precedence over the generic OTLP
endpoint. Invalid exporters, service names, prefixes, sample rates, endpoints,
and collection intervals normalize to documented defaults. A metrics
collection interval must be a positive safe integer no greater than 24 hours.

Tracing and metrics managers can initialize again after shutdown. Cached
tracers and simple metric instruments refresh when the global OpenTelemetry
provider or metrics API changes.

## Explanation

### Why automatic telemetry omits request identity

A generic fetch or HTTP wrapper sees only a concrete URL. It cannot determine
which segments are code-owned route names and which segments contain customer
or project data. Redacting selected query keys is insufficient because sensitive
data can appear in hosts, paths, fragments, userinfo, and ordinary query values.

Veryfront therefore uses an allowlist. Automatic instrumentation emits only
bounded operational dimensions and an optional route template that the caller
explicitly identifies as stable. Raw exceptions are also excluded because an
error message, stack, or cause can contain payloads, credentials, URLs, or
identifiers. A bounded category preserves failure analysis without exporting
that data.

Tracing and exporter hook failures are isolated from application behavior. The
wrapped handler, render operation, or fetch runs once, and its original result
or thrown value remains authoritative.
