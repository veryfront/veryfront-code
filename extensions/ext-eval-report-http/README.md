# @veryfront/ext-eval-report-http

> **Category:** Eval export | **Requires:** `EvalReportExporterRegistry` | **Optional**

Registers HTTP-backed eval report exporters. Use this extension when a project
needs to send redacted `EvalReport` payloads to an internal endpoint, Braintrust,
Langfuse, LangSmith, or another eval platform through a gateway.

The extension does not own runtime tracing. Use
`@veryfront/ext-observability-opentelemetry` for OpenTelemetry spans, metrics,
and service monitoring.

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

`runEval` enriches export context with the active runtime `traceId` and `spanId`
when OpenTelemetry is active and the caller did not pass an explicit
`context.trace`.

## Required contract

`EvalReportExporterRegistry` is seeded by Veryfront bootstrap. The extension
requires that registry during setup and registers one `EvalReportExporter` per
configured endpoint. Teardown unregisters only the exporter ids that this
extension registered.

## Capabilities

- **net `*`:** sends eval reports to the configured endpoint.
- **env:** reads the four `VERYFRONT_EVAL_HTTP_EXPORTER_*` variables listed
  above when explicit factory configuration is not set.
