# @veryfront/ext-observability-opentelemetry

> **Category:** Observability | **Contracts:** `TracingExporter`, `NodeTelemetryProvider` | **Optional**

Provides distributed tracing, OTLP metrics export, the OpenTelemetry metrics API bridge, and Node telemetry bootstrap for Veryfront via the [OpenTelemetry JS SDK](https://github.com/open-telemetry/opentelemetry-js). Exports trace spans and metrics over OTLP/HTTP to any OpenTelemetry-compatible collector.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extOpenTelemetry from "@veryfront/ext-observability-opentelemetry";

export default defineConfig({
  extensions: [extOpenTelemetry()],
});
```

## Environment variables

The extension reads the standard OpenTelemetry env vars at setup time:

| Variable                              | Required         | Description                                                       |
| ------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| Variable                              | Required         | Description                                                       |
| ------------------------------------  | ---------------- | ----------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | Yes (for export) | Base collector URL, e.g. `http://localhost:4318`                  |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | No               | Trace-specific OTLP HTTP URL                                      |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | No               | Metric-specific OTLP HTTP URL                                     |
| `OTEL_EXPORTER_OTLP_HEADERS`          | No               | Comma-separated `key=value` pairs (commonly used for auth tokens) |
| `OTEL_SERVICE_NAME`                   | No               | Service name attached to telemetry                                |
| `OTEL_TRACES_ENABLED`                 | No               | Set to `true` to enable trace export                              |
| `OTEL_METRICS_ENABLED`                | No               | Set to `true` to enable metric export                             |
| `OTEL_METRIC_EXPORT_INTERVAL`         | No               | Metric export interval in milliseconds                            |

Configuration is read from process `OTEL_*` environment variables. In shared Veryfront runtimes these are platform-owned host env vars. The extension does not accept `ctx.config.otel` exporter endpoint, header, service name, or enable-flag overrides because project config is tenant controlled in shared runtimes.

## Factory configuration

```ts
extOpenTelemetry();
```

Exporter configuration is process-level. Dedicated runtimes can use project-specific collector endpoints by running the project in its own process with its own process environment.

## Metrics

Set `OTEL_METRICS_ENABLED=true` to export framework metrics through OTLP HTTP. The extension resolves `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` first, then `OTEL_EXPORTER_OTLP_ENDPOINT`. A base OTLP endpoint receives `/v1/metrics`.

In shared Veryfront runtimes, these variables are platform-owned host env vars. Project env overlays must not control the shared runtime metrics exporter. Use a dedicated runtime for project-owned collector endpoints or credentials.

## Provided contracts

`TracingExporter`: Veryfront's core shim calls `getProvider()` to wire the SDK's `TracerProvider` into framework-emitted spans. Spans are batched and exported by the SDK's `BatchSpanProcessor`; `export(spans)` on the contract is intentionally a no-op because the SDK owns the export pipeline.

`start(config)` constructs the provider + OTLP HTTP exporter; `shutdown()` flushes and shuts down the provider.

`NodeTelemetryProvider`: the Node agent service calls `initialize(options)` when telemetry is enabled. The provider starts `NodeSDK`, configures sampling, attaches HTTP/Express/fs auto-instrumentation, and registers shutdown handling.

## Capabilities

- **net `*`:** OTLP exporter reaches the configured collector.
- **env:** reads the `OTEL_*` variables listed above.
