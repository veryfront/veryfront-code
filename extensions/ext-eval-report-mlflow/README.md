# @veryfront/ext-eval-report-mlflow

> **Category:** Eval export | **Requires:** `EvalReportExporterRegistry` | **Optional**

Registers the `mlflow` eval report exporter. The exporter id is fixed to
`mlflow`; it is not configurable by extension config or environment variable.
Use this extension when completed Veryfront `EvalReport` payloads should be
written to MLflow Tracking as one run per eval execution.

The exporter is generic. It logs Veryfront report data such as pass/fail counts,
metric pass rates, duration summaries, usage/tokens/cost fields, and redacted
report artifacts. Project-specific extraction, such as reading a domain label
from a ServiceNow ticket or support-agent response, must happen in the eval
adapter or metric before export. The MLflow exporter only consumes the normalized
`EvalReport` shape.

## Environment-only usage

No `veryfront.config.ts` entry is required for the common CLI path. Set
`MLFLOW_TRACKING_URI` to activate the first-party extension, then select the
`mlflow` exporter for the eval run.

Select the exporter per command:

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
veryfront eval eval:service-now-classification --export mlflow
```

Or select it entirely from the environment:

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
VERYFRONT_EVAL_EXPORTERS=mlflow \
veryfront eval eval:service-now-classification
```

`--export mlflow` is explicit for one CLI invocation. `VERYFRONT_EVAL_EXPORTERS`
is useful in CI when every eval command in the job should export to the same
backend. If both are set, the CLI flag wins. `VERYFRONT_EVAL_EXPORT` remains a
legacy singular fallback when `VERYFRONT_EVAL_EXPORTERS` is unset.

## Environment variables

| Variable                                        | Required | Description                                                                                                                  |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MLFLOW_TRACKING_URI`                           | Yes      | MLflow Tracking server URI. The exporter is not registered unless this is set.                                               |
| `MLFLOW_EXPERIMENT_NAME`                        | No       | Experiment name. Defaults from project/eval context, then `veryfront-evals`.                                                 |
| `MLFLOW_RUN_NAME`                               | No       | Run name. Defaults to `<eval-id>-<run-id>`.                                                                                  |
| `MLFLOW_ARTIFACTS_URI`                          | No       | HTTP(S) MLflow artifact proxy endpoint used when the run artifact root is not directly writable as HTTP(S).                  |
| `MLFLOW_TRACKING_TOKEN`                         | No       | Bearer token sent to MLflow Tracking REST endpoints. Prefer this over embedding credentials in `MLFLOW_TRACKING_URI`.        |
| `MLFLOW_TRACKING_USERNAME`                      | No       | Username for basic auth to MLflow Tracking REST endpoints. Use with `MLFLOW_TRACKING_PASSWORD`.                              |
| `MLFLOW_TRACKING_PASSWORD`                      | No       | Password for basic auth to MLflow Tracking REST endpoints. Use with `MLFLOW_TRACKING_USERNAME`.                              |
| `VERYFRONT_EVAL_EXPORTERS`                      | No       | Comma- or whitespace-separated exporter ids selected by the CLI when `--export` is omitted. Use `mlflow` for this extension. |
| `VERYFRONT_EVAL_EXPORT`                         | No       | Legacy singular exporter env var used only when `VERYFRONT_EVAL_EXPORTERS` is unset.                                         |
| `VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EVIDENCE` | No       | CLI redaction opt-in for metric evidence. Leave unset or false unless evidence contains only safe labels or aggregates.      |

`MLFLOW_TRACKING_URI` must be an HTTP(S) URI without embedded username/password
credentials. Use `MLFLOW_TRACKING_TOKEN` or
`MLFLOW_TRACKING_USERNAME`/`MLFLOW_TRACKING_PASSWORD` for authenticated tracking
servers so credentials are not persisted in eval report export receipts.

## Config usage

Use config when a project wants to pin optional MLflow settings in code.
Registration is still gated by `MLFLOW_TRACKING_URI` in v1, so set that
environment variable even when config supplies other fields.

```ts
import extEvalReportMlflow from "@veryfront/ext-eval-report-mlflow";
import { defineConfig } from "veryfront";

export default defineConfig({
  extensions: [
    extEvalReportMlflow({
      experimentName: "support-agent-classification",
    }),
  ],
});
```

Then select the exporter when running the eval:

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
veryfront eval eval:service-now-classification --export mlflow
```

## Redaction and classification aggregates

Eval exports are redacted by default before any exporter receives the report.
Inputs, outputs, references, traces, tool-call payloads, metric evidence, metric
explanations, and record metadata stay out of exported artifacts unless the eval
export context explicitly allows them.

The MLflow exporter can emit generic classification aggregate metrics when a
metric or check result includes normalized category evidence:

```ts
{
  name: "intent.classification",
  pass: true,
  evidence: {
    expectedCategory: "billing",
    predictedCategory: "billing",
    confidence: 0.94,
  },
}
```

Supported evidence keys are `expectedCategory`, `expectedLabel`, or `expected`
for the expected class, and `predictedCategory`, `predictedLabel`, or
`predicted` for the predicted class. Because metric evidence is redacted by
default, enable it only when those evidence fields are safe to export:

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EVIDENCE=true \
veryfront eval eval:service-now-classification --export mlflow
```

Programmatic eval runs can use the same redaction opt-in through export context:

```ts
await runEval(definition, {
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

Do not put private prompts, full model outputs, customer records, or vendor API
payloads into metric evidence just to produce classification aggregates. Extract
safe labels in the eval metric and export only those labels.

## Artifacts

The exporter uploads these artifacts under `veryfront-eval/`:

- `report.json`
- `summary.json`
- `results.jsonl`

v1 artifact transport supports:

- Direct `PUT` uploads when the MLflow run artifact root is `http://` or
  `https://`.
- Uploads through an explicit HTTP(S) MLflow artifact proxy configured with
  `MLFLOW_ARTIFACTS_URI` when the tracking server returns a proxied root such as
  `mlflow-artifacts:/...` or an object-store-backed root.

It does not upload directly to local filesystem artifact roots or vendor storage
schemes such as `dbfs://`, `gs://`, `wasbs://`, or similar backend-specific
URIs. For object storage, run an MLflow artifact proxy and point
`MLFLOW_ARTIFACTS_URI` at that HTTP(S) endpoint.

## Future vendor exporters

MLflow is one eval-report exporter behind the shared
`EvalReportExporterRegistry` contract. Braintrust, Langfuse, LangSmith, or other
vendors should be implemented as sibling `@veryfront/ext-eval-report-*`
extensions with their own exporter ids instead of adding project-specific logic
to the MLflow exporter.
