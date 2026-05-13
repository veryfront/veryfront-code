# @veryfront/ext-tracing-opentelemetry

> **Type:** Observability | **Contract:** `TracingExporter` | **Optional**

Provides distributed tracing for Veryfront via the [OpenTelemetry JS SDK](https://github.com/open-telemetry/opentelemetry-js). Exports trace spans over OTLP/HTTP to any OTel-compatible collector.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extOpenTelemetry from "@veryfront/ext-tracing-opentelemetry";

export default defineConfig({
  extensions: [extOpenTelemetry()],
});
```

## Environment Variables

The extension reads the standard OpenTelemetry env vars at setup time:

| Variable                      | Required         | Description                                                       |
| ----------------------------- | ---------------- | ----------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Yes (for export) | Collector URL — e.g. `http://localhost:4318/v1/traces`            |
| `OTEL_EXPORTER_OTLP_HEADERS`  | No               | Comma-separated `key=value` pairs (commonly used for auth tokens) |
| `OTEL_SERVICE_NAME`           | No               | Service name attached to spans                                    |
| `OTEL_TRACES_ENABLED`         | No               | Set to `false` to disable tracing without removing the extension  |

Explicit config under `ctx.config.otel` wins over env vars.

## Factory configuration

```ts
extOpenTelemetry();
```

Configuration is read from `ctx.config.otel`:

```ts
config = {
  otel: {
    serviceName: "my-app",
    serviceVersion: "1.0.0",
    endpoint: "http://collector:4318/v1/traces",
    headers: { authorization: "Bearer <token>" },
  },
};
```

## Provided contract

`TracingExporter` — Veryfront's core shim calls `getProvider()` to wire the SDK's `TracerProvider` into framework-emitted spans. Spans are batched and exported by the SDK's `BatchSpanProcessor`; `export(spans)` on the contract is intentionally a no-op (the SDK owns the export pipeline).

`start(config)` constructs the provider + OTLP HTTP exporter; `shutdown()` flushes and shuts down the provider.

## Capabilities

- **net `*`:** OTLP exporter reaches the configured collector.
- **env:** reads the four `OTEL_*` variables listed above.
