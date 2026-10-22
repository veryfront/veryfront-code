---
title: "Export eval reports"
description: "Send evaluation evidence to configured reporting systems and inspect the exported result."
---

Export a completed evaluation to the reporting system your team uses. First [define and run an eval](/code/guides/evals); its local reports provide the baseline evidence for checking an export.

## Export reports

Use `veryfront/extensions/eval` when reports need to flow to an external eval
platform. The registry supports multiple exporters, so Braintrust, Langfuse, and
LangSmith exporters can coexist behind the same contract. `runEval` can export a
completed report through selected exporters and includes export receipts or
failures in `report.exports`.
Veryfront bootstrap seeds the registry for project extensions. Standalone
scripts can create and register a local registry explicitly.

```ts
import { datasets, evalAgent, metrics, runEval } from "veryfront/eval";
import {
  createEvalReportExporterRegistry,
  EvalReportExporterRegistryName,
} from "veryfront/extensions/eval";
import { register } from "veryfront/extensions/contracts";

const registry = createEvalReportExporterRegistry();
register(EvalReportExporterRegistryName, registry);

registry.register({
  id: "custom-eval-platform",
  async export(report, context) {
    await fetch("https://evals.example.com/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report, context }),
    });
  },
});

const definition = evalAgent({
  target: "agent:support",
  dataset: datasets.inline([
    { id: "q1", input: "Capital of France?", reference: "Paris", metadata: { dataset: "smoke" } },
  ]),
  metrics: [metrics.answer.exactMatch().gate()],
});

const adapters = {
  agent: async () => ({ text: "Paris", completed: true }),
};

const report = await runEval(definition, {
  adapters,
  export: {
    registry,
    exporterIds: ["custom-eval-platform"],
    context: {
      projectReference: "support-agent",
      sourcePath: "evals/support.ts",
      redaction: {
        includeInputs: false,
        includeOutputs: false,
        includeReferences: false,
        includeTraces: false,
        includeMetricEvidence: false,
        includeMetricExplanations: false,
        includeDatasetPath: false,
        metadataAllowlist: ["dataset"],
      },
    },
  },
});
```

The registry redacts inputs, outputs, references, traces, tool-call input and
output, metric evidence, metric explanations, dataset paths, dataset content
hashes, record metadata, and export context metadata unless the export context
explicitly allows each field. Dataset kind and example count stay available so
exporters can group runs without seeing source paths, and
`includeDatasetHash: true` opts back into the deterministic content hash for
destinations trusted to correlate dataset content. Use `metadataAllowlist`
only for metadata keys the destination is allowed to receive. Runtime monitoring
remains separate: use `veryfront/extensions/observability` and the OpenTelemetry
extension for spans,
traces, metrics, and service monitoring. When OpenTelemetry is active, `runEval`
adds the active `traceId` and `spanId` to export context unless you pass
`context.trace` explicitly.

Eval exports are explicit data exports, not ambient telemetry. Exporters receive
the completed `EvalReport` plus `EvalReportExportContext` only when the eval run
selects an exporter id or passes an export registry. This is the right hook for
Langfuse, LangSmith, Braintrust, or an internal gateway that translates the
redacted report into a vendor-specific API shape. Regular OpenTelemetry settings
such as `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_METRICS_ENABLED`, and
`OTEL_TRACES_ENABLED` do not route eval reports to those vendors; they only
control runtime trace and metric export.

Use [project metrics](/code/guides/project-metrics) when an eval should also emit
aggregate dashboard signals such as `vf_eval_result_total` or
`vf_eval_duration_ms`. Keep report exports for rich per-case eval data, and keep
project metrics to low-cardinality counters, histograms, and gauges.

Use `@veryfront/ext-eval-report-http` when an eval gateway endpoint should
receive reports without adding a vendor SDK:

```ts
import extEvalReportHttp from "@veryfront/ext-eval-report-http";
import { defineConfig } from "veryfront";

export default defineConfig({
  extensions: [
    extEvalReportHttp({
      exporters: [
        {
          id: "eval-gateway",
          url: "https://evals.example.com/reports",
          token: "<TOKEN>",
        },
      ],
    }),
  ],
});
```

### Gateway mapping strategy

Keep vendor-specific SDKs and schemas behind your HTTP gateway. Veryfront sends
one redacted payload shape, `{ report, context }`, and the gateway maps that
payload to the destination API:

| Destination      | Gateway mapping                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Braintrust       | Map `report.runId`, `definitionId`, `target`, summary scores, and each redacted record to an experiment run or span row. Put `context.trace.traceId` and `context.trace.spanId` in metadata for correlation. |
| Langfuse         | Map each record to a trace observation or score event. Use the redacted input/output fields only when the export policy allows them, and attach receipts from the Langfuse response to `report.exports`.     |
| LangSmith        | Map the report to a dataset run and records to examples or feedback rows. Keep references, evidence, explanations, and metadata omitted unless the allowlist permits them.                                   |
| Internal gateway | Store the full redacted Veryfront report shape, then fan out to vendor adapters asynchronously. Return a receipt with `externalRunId`, `url`, or sanitized metadata.                                         |

Gateways should treat `context.trace` as correlation metadata. It is not span
export, does not include logs or metric streams, and does not replace ambient
OpenTelemetry export.

Use `veryfront/extensions/ext-eval-report-mlflow` when completed reports should become
MLflow Tracking runs. The CLI path can be environment-only: set
`MLFLOW_TRACKING_URI` to activate the extension and select the default `mlflow`
exporter for the run.

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
veryfront eval deep-research --export mlflow
```

For authenticated MLflow Tracking servers, keep credentials out of
`MLFLOW_TRACKING_URI`. Use `MLFLOW_TRACKING_TOKEN` for bearer auth or
`MLFLOW_TRACKING_USERNAME` / `MLFLOW_TRACKING_PASSWORD` for basic auth. Standard
OAuth client credentials are also supported through
`MLFLOW_OAUTH_TOKEN_URL`, `MLFLOW_OAUTH_CLIENT_ID`,
`MLFLOW_OAUTH_CLIENT_SECRET`, and an optional `MLFLOW_OAUTH_SCOPE`.

Programmatic transport overrides do not inherit host credentials. When an
extension config sets `trackingUri`, `fetch`, or `oauthTokenUrl`, provide its
`trackingToken`, basic-auth fields, or complete OAuth client-credentials fields
in that same config. A custom `fetch` also requires `trackingUri` in that config.
For example, migrate a configured endpoint that previously relied on
`MLFLOW_TRACKING_TOKEN` to an explicit tenant-scoped token:

```ts
import extEvalReportMlflow from "veryfront/extensions/ext-eval-report-mlflow";
import { defineConfig, getEnv } from "veryfront";

export default defineConfig({
  extensions: [
    extEvalReportMlflow({
      trackingUri: "https://tenant-mlflow.example",
      trackingToken: getEnv("TENANT_MLFLOW_TOKEN"),
    }),
  ],
});
```

A configured `trackingUri` also does not inherit `MLFLOW_ARTIFACTS_URI`,
`MLFLOW_ARTIFACTS_PORT`, `MLFLOW_EXPERIMENT_NAME`, `MLFLOW_RUN_NAME`, or
`MLFLOW_RUN_URL_TEMPLATE`. If that deployment needs an artifact proxy, set
`artifactsUri` or `artifactsPort` in the same extension config. Set
`experimentName`, `runName`, and `runUrlTemplate` there when the deployment
needs explicit run naming or a custom tracking UI route.

Automatic CLI selection follows `MLFLOW_TRACKING_URI` only. After migrating a
configured endpoint away from that variable, select the exporter explicitly
with `--export mlflow` or `VERYFRONT_EVAL_EXPORTERS=mlflow`; otherwise
`veryfront eval` registers the exporter but exports nothing.

```bash
veryfront eval deep-research --export mlflow
```

When `MLFLOW_TRACKING_URI` is configured, `veryfront eval` automatically exports
every completed eval report to MLflow. Set `VERYFRONT_EVAL_EXPORTERS=mlflow`
explicitly when CI should make that selection visible in its environment:

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
VERYFRONT_EVAL_EXPORTERS=mlflow \
VERYFRONT_EVAL_EXPORT_REQUIRED=true \
veryfront eval deep-research
```

`--export` wins over `VERYFRONT_EVAL_EXPORTERS` when both are set. The legacy
singular `VERYFRONT_EVAL_EXPORT` is used only when
`VERYFRONT_EVAL_EXPORTERS` is unset. Without either selector,
`MLFLOW_TRACKING_URI` selects the fixed `mlflow` exporter automatically.

From the CLI, pass comma-separated exporter ids. Export failures are reported in
the JSON report and do not prevent local report or JUnit files from being
written. That best-effort behavior is the local default. CI can make a selected
export a quality gate with `--require-export` or
`VERYFRONT_EVAL_EXPORT_REQUIRED=true`; artifacts are still written before the
command exits non-zero.

Remote MLflow endpoints, OAuth token endpoints, artifact proxies, and optional
run URL templates must use HTTPS. Plain HTTP remains supported only for local
`localhost` or loopback MLflow development servers. Requests use bounded
timeouts and retry only safe operations. The exporter does not blindly retry a
run creation; it recovers a lost create response using the deterministic
`veryfront.export_id` run tag.

```bash
veryfront eval deep-research \
  --report-dir .veryfront/evals/deep-research \
  --report .veryfront/evals/deep-research/report.json \
  --junit .veryfront/evals/deep-research/junit.xml \
  --export braintrust,langfuse \
  --json
```

MLflow artifact uploads support HTTP(S) run artifact roots directly. For
`mlflow-artifacts:/...` roots use the tracking server itself by default, so a
normal local `mlflow server --serve-artifacts` setup needs only
`MLFLOW_TRACKING_URI`. For a distinct artifact server or object-store-backed
root, configure `MLFLOW_ARTIFACTS_URI`; `MLFLOW_ARTIFACTS_PORT` derives it from
`MLFLOW_TRACKING_URI` for a local server on another port. v1 does not upload
directly to local filesystem roots or backend-specific schemes such as `dbfs://`,
`gs://`, `wasbs://`, or similar URIs. After upload, the exporter makes a
best-effort retrieval check through
MLflow `artifacts/list` for the `veryfront-eval` path and stores only the
sanitized `verified`/`missing` paths in the export receipt. The check is
non-fatal: because `artifacts/list` responses vary across MLflow deployments, a
mismatch or a failing listing endpoint is logged as a warning rather than
failing an export whose uploads already succeeded.

When a tracking service provides no HTTP(S) artifact proxy, set
`MLFLOW_EXPORT_ARTIFACTS=false`. Veryfront still sends the MLflow run's
aggregate metrics, parameters, and tags, then skips report-artifact upload
without relying on a backend-specific storage API. This is not needed for a
normal local `mlflow server --serve-artifacts` setup.

The MLflow exporter logs generic aggregate metrics from the normalized
`EvalReport`; it does not know project-specific label formats. If a project
wants generic classification aggregates such as accuracy, macro precision,
macro recall, macro F1, per-category counts, or confusion counts, extract safe
labels inside the eval metric and place them in metric evidence:

```ts
{
  name: "intent.classification",
  pass: true,
  evidence: {
    expectedCategory: "billing",
    predictedCategory: "billing",
  },
}
```

Metric evidence is redacted by default. Opt in only when the evidence contains
safe aggregate labels rather than private prompts, outputs, customer records, or
tool payloads:

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EVIDENCE=true \
veryfront eval deep-research --export mlflow
```

Programmatic eval runs can use the same redaction opt-in through export context:

```ts
const report = await runEval(definition, {
  adapters,
  export: {
    exporterIds: ["mlflow"],
    context: {
      redaction: {
        includeMetricEvidence: true,
      },
    },
  },
});
```

Braintrust should follow the same contract as a sibling
`@veryfront/ext-eval-report-*` exporter, for example a future
`@veryfront/ext-eval-report-braintrust`, instead of being special-cased in
project eval definitions or the MLflow exporter.


## Verify the export

Compare the destination record with the local report for the same eval and run. Check example counts, failed checks, and available usage fields. Missing credentials or an exporter failure must be resolved before treating the external report as complete.

## Related

- [Compare eval runs and models](/code/guides/eval-comparison): Baselines and selection criteria.
