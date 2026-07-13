# @veryfront/ext-eval-report-http

> **Category:** Eval export | **Requires:** `EvalReportExporterRegistry` | **Optional**

Registers HTTP-backed eval report exporters. Use this extension when a project
needs to send redacted `EvalReport` payloads to an internal endpoint, Braintrust,
Langfuse, LangSmith, or another eval platform through a gateway.

The extension does not own runtime tracing. Use
`@veryfront/ext-observability-opentelemetry` for OpenTelemetry spans, metrics,
and service monitoring.

Eval report HTTP export is an explicit data export path. It sends the completed,
redacted `EvalReport` and its export context to the configured endpoint only
when an eval run selects the exporter. Use this extension for Langfuse,
LangSmith, Braintrust, or internal gateway integrations that need eval records,
scores, redaction policy, and optional trace correlation. Do not use OTLP
runtime telemetry env vars to route eval reports; `OTEL_*` settings only control
runtime trace and metric export.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extEvalReportHttp from "@veryfront/ext-eval-report-http";

export default defineConfig({
  extensions: [
    extEvalReportHttp({
      exporters: [
        {
          id: "braintrust-proxy",
          url: "https://evals.example.com/reports",
          token: "<TOKEN>",
          headers: { "x-workspace": "default" },
        },
      ],
    }),
  ],
});
```

Then run an eval with a matching exporter id:

```bash
veryfront eval deep-research --export braintrust-proxy
```

## Environment variables

Without factory configuration, the extension registers one exporter from env
configuration.

| Variable                               | Required | Description                                       |
| -------------------------------------- | -------- | ------------------------------------------------- |
| `VERYFRONT_EVAL_HTTP_EXPORTER_URL`     | Yes      | HTTP endpoint that receives `{ report, context }` |
| `VERYFRONT_EVAL_HTTP_EXPORTER_ID`      | No       | Exporter id. Defaults to `http`                   |
| `VERYFRONT_EVAL_HTTP_EXPORTER_TOKEN`   | No       | Bearer token for the `authorization` header       |
| `VERYFRONT_EVAL_HTTP_EXPORTER_HEADERS` | No       | JSON object or comma-separated `key=value` pairs  |

## Factory configuration

```ts
extEvalReportHttp({
  exporters: [
    {
      id: "langfuse-proxy",
      url: "https://evals.example.com/langfuse",
      token: "<TOKEN>",
      headers: { "x-project": "docs-agent" },
      method: "POST",
    },
  ],
});
```

Each exporter sends:

```json
{
  "report": {},
  "context": {}
}
```

The registry redacts report records before the HTTP exporter runs. Inputs,
outputs, references, traces, tool payloads, metric evidence, metric
explanations, record metadata, and export context metadata are omitted unless
the caller explicitly allows them with the export redaction policy.

## Gateway mapping strategy

Keep vendor SDKs and schema translation in the receiving gateway, not in this
extension. The HTTP exporter always sends the same redacted `{ report, context
}` payload.

| Destination      | Gateway mapping                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Braintrust       | Map the report run id, eval id, target, summary scores, and redacted records to the Braintrust experiment shape. Store `context.trace.traceId` and `context.trace.spanId` as correlation metadata. |
| Langfuse         | Map records to trace observations or score events. Forward only the redacted fields present in the report, and return a receipt id or URL from the gateway response.                               |
| LangSmith        | Map the report to a dataset run and records to examples or feedback rows. Keep references, evidence, explanations, and metadata absent unless the export policy explicitly allows them.            |
| Internal gateway | Persist the redacted Veryfront report first, fan out to vendor-specific adapters asynchronously, and return a sanitized receipt.                                                                   |

`runEval` enriches export context with the active runtime `traceId` and `spanId`
when OpenTelemetry is active and the caller did not pass an explicit
`context.trace`.

That trace context is correlation metadata only. It does not include span data,
metric streams, or logs, and changing the eval HTTP exporter does not change the
OpenTelemetry runtime exporter.

## Required contract

`EvalReportExporterRegistry` is seeded by Veryfront bootstrap. The extension
requires that registry during setup and registers one `EvalReportExporter` per
configured endpoint. Teardown unregisters only the exporter ids that this
extension registered.

## Capabilities

- **net `*`:** sends eval reports to the configured endpoint.
- **env:** reads the four `VERYFRONT_EVAL_HTTP_EXPORTER_*` variables listed
  above when explicit factory configuration is not set.
