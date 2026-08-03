# @veryfront/ext-eval-report-mlflow

> **Category:** Eval export | **Requires:** `EvalReportExporterRegistry` | **Optional**

Registers the `mlflow` eval report exporter. Configure `MLFLOW_TRACKING_URI` to
select it automatically for CLI evals. Use this extension when completed
Veryfront `EvalReport` payloads should be written to MLflow Tracking as one run
per eval execution.

> **npm packaging note:** CLI usage is bundled into the root `veryfront`
> package, so `veryfront eval` works without installing a
> separate package. The standalone `@veryfront/ext-eval-report-mlflow` package
> is intentionally not published until npm trusted publishing is configured for
> that new package.

The exporter is generic. It logs Veryfront report data such as pass/fail counts,
metric pass rates, duration summaries, usage/tokens/cost fields, and redacted
report artifacts. Project-specific extraction, such as reading a domain label
from a ServiceNow ticket or support-agent response, must happen in the eval
adapter or metric before export. The MLflow exporter only consumes the normalized
`EvalReport` shape.

## Environment-only usage

No `veryfront.config.ts` entry is required for the common CLI path. Set
`MLFLOW_TRACKING_URI` and `veryfront eval` automatically exports every
completed eval report to MLflow.

Run every discovered eval:

```bash
mlflow server --host 127.0.0.1 --port 5000 --serve-artifacts

MLFLOW_TRACKING_URI=http://127.0.0.1:5000 \
veryfront eval
```

For the normal single-server `--serve-artifacts` setup, no separate artifact
endpoint is required.

`--export mlflow` remains available when one command should explicitly select
the exporter. `VERYFRONT_EVAL_EXPORTERS` is useful in CI when the job should
make the selection visible or choose a different exporter. Either takes
precedence over automatic MLflow selection. `VERYFRONT_EVAL_EXPORT` remains a
legacy singular fallback when `VERYFRONT_EVAL_EXPORTERS` is unset.

For example:

```bash
MLFLOW_TRACKING_URI=http://localhost:5001 \
VERYFRONT_EVAL_EXPORTERS=mlflow \
veryfront eval eval:service-now-classification
```

## Environment variables

| Variable                                        | Required | Description                                                                                                                   |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `MLFLOW_TRACKING_URI`                           | Yes      | MLflow Tracking server URI. The exporter is not registered unless this is set.                                                |
| `MLFLOW_EXPERIMENT_NAME`                        | No       | Experiment name. Defaults from project/eval context, then `veryfront-evals`.                                                  |
| `MLFLOW_RUN_NAME`                               | No       | Run name. Defaults to `<eval-id>-<run-id>`.                                                                                   |
| `MLFLOW_ARTIFACTS_URI`                          | No       | HTTP(S) MLflow artifact proxy endpoint used when the run artifact root is not directly writable as HTTP(S).                   |
| `MLFLOW_ARTIFACTS_PORT`                         | No       | Local convenience port used to derive the artifact proxy URI from `MLFLOW_TRACKING_URI` when `MLFLOW_ARTIFACTS_URI` is unset. |
| `MLFLOW_TRACKING_TOKEN`                         | No       | Bearer token sent to MLflow Tracking REST endpoints. Prefer this over embedding credentials in `MLFLOW_TRACKING_URI`.         |
| `MLFLOW_TRACKING_USERNAME`                      | No       | Username for basic auth to MLflow Tracking REST endpoints. Use with `MLFLOW_TRACKING_PASSWORD`.                               |
| `MLFLOW_TRACKING_PASSWORD`                      | No       | Password for basic auth to MLflow Tracking REST endpoints. Use with `MLFLOW_TRACKING_USERNAME`.                               |
| `MLFLOW_OAUTH_TOKEN_URL`                        | No       | OAuth 2.0 client-credentials token endpoint. Set with the next two variables.                                                 |
| `MLFLOW_OAUTH_CLIENT_ID`                        | No       | OAuth 2.0 client ID.                                                                                                          |
| `MLFLOW_OAUTH_CLIENT_SECRET`                    | No       | OAuth 2.0 client secret.                                                                                                      |
| `MLFLOW_OAUTH_SCOPE`                            | No       | Optional OAuth client-credentials scope.                                                                                      |
| `MLFLOW_EXPORT_ARTIFACTS`                       | No       | `true` by default. Set to `false` to export the run, metrics, parameters, and tags without report artifacts.                  |
| `MLFLOW_REQUEST_TIMEOUT_MS`                     | No       | Per-request timeout in milliseconds. Defaults to `10000`; must be `1`–`60000`.                                                |
| `MLFLOW_RETRY_ATTEMPTS`                         | No       | Retries for safe reads, artifact `PUT`s, and run-status updates. Defaults to `2`; must be `0`–`5`.                            |
| `MLFLOW_RETRY_DELAY_MS`                         | No       | Initial exponential-backoff delay in milliseconds. Defaults to `250`; must be `0`–`5000`.                                     |
| `MLFLOW_RUN_URL_TEMPLATE`                       | No       | Optional HTTPS tracking-UI URL with `{experimentId}` and `{runId}`; `{trackingUri}` is also available.                        |
| `VERYFRONT_EVAL_EXPORTERS`                      | No       | Comma- or whitespace-separated exporter ids that override automatic MLflow selection. Use `mlflow` for this extension.        |
| `VERYFRONT_EVAL_EXPORT`                         | No       | Legacy singular exporter override used only when `VERYFRONT_EVAL_EXPORTERS` is unset.                                         |
| `VERYFRONT_EVAL_EXPORT_REQUIRED`                | No       | Set to `true` in CI to make a missing or failed selected exporter fail `veryfront eval`; local default is best-effort.        |
| `VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EVIDENCE` | No       | CLI redaction opt-in for metric evidence. Leave unset or false unless evidence contains only safe labels or aggregates.       |

`MLFLOW_TRACKING_URI`, OAuth endpoints, artifact proxies, and run URL templates
must use HTTPS except for `localhost` or a loopback IP. None may contain
embedded username/password credentials. Use `MLFLOW_TRACKING_TOKEN`,
`MLFLOW_TRACKING_USERNAME`/`MLFLOW_TRACKING_PASSWORD`, or the complete OAuth
client-credentials set. OAuth takes precedence over the other methods, and
credentials are not persisted in eval report export receipts.

MLflow requests time out and retry only operations that can safely be repeated:
reads, artifact uploads to the same path, run updates, and recovery searches.
`runs/create` is never blindly retried. Each run carries the deterministic
`veryfront.export_id` tag, so a lost create response is recovered by searching
for that identity before any metrics are written. A run URL template is useful
for any MLflow-compatible UI whose links differ from the stock MLflow route:

```bash
MLFLOW_RUN_URL_TEMPLATE='{trackingUri}/ml/experiments/{experimentId}/runs/{runId}' \
veryfront eval --export mlflow
```

This template is generic configuration, not a provider integration.

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
      id: "mlflow",
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
- Uploads through the tracking server itself when it returns a proxied
  `mlflow-artifacts:/...` root, which is the normal local `--serve-artifacts`
  setup.
- Uploads through an explicit HTTP(S) MLflow artifact proxy configured with
  `MLFLOW_ARTIFACTS_URI` for a distinct artifact server or an object-store-backed
  root.
- Local artifact proxy derivation from `MLFLOW_ARTIFACTS_PORT`. For example,
  `MLFLOW_TRACKING_URI=http://localhost:5001` and
  `MLFLOW_ARTIFACTS_PORT=5600` derive
  `http://localhost:5600/api/2.0/mlflow-artifacts/artifacts`.

After upload, the exporter calls MLflow `artifacts/list` for the
`veryfront-eval` path and includes a sanitized verification receipt
(`verified` plus any `missing` paths) recording which uploaded paths the
tracking API reported. The uploads themselves are the source of truth for
success: because `artifacts/list` responses vary across MLflow deployments
(path prefixing, pagination, artifact-store backends), a mismatch — or a
listing endpoint that errors — is logged as a warning and reflected in the
receipt and the run's `artifacts.verified` tag, but never fails an export that
otherwise succeeded. Artifact contents are never exported in receipts, logs, or
issue evidence.

It does not upload directly to local filesystem artifact roots or vendor storage
schemes such as `dbfs://`, `gs://`, `wasbs://`, or similar backend-specific
URIs. For object storage, run an MLflow artifact proxy and point
`MLFLOW_ARTIFACTS_URI` at that HTTP(S) endpoint.

Set `MLFLOW_EXPORT_ARTIFACTS=false` when an MLflow deployment exposes a
backend-specific artifact root but no HTTP(S) artifact proxy. The exporter then
still creates and finishes the MLflow run and sends its aggregate metrics,
parameters, and tags; it intentionally skips report uploads and records
`artifacts.logged=false` on the run.

## Future vendor exporters

MLflow is one eval-report exporter behind the shared
`EvalReportExporterRegistry` contract. Braintrust, Langfuse, LangSmith, or other
vendors should be implemented as sibling `@veryfront/ext-eval-report-*`
extensions with their own exporter ids instead of adding project-specific logic
to the MLflow exporter.
