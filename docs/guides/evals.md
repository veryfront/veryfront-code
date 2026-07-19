---
title: "Evals"
description: "Define and run quality checks for agents."
order: 40
---

Evals are project-defined quality checks in `evals/`. Use `veryfront eval` to
run every discovered eval, or `veryfront eval <eval-id>` to run one.

## Prerequisites

- A Veryfront project with an `agents/` directory.
- An agent target such as `agent:researcher`.
- A dataset with stable example IDs.

## Quick start

Create an eval file:

```ts
// evals/deep-research.eval.ts
import { datasets, evalAgent, metrics } from "veryfront/eval";

export default evalAgent({
  name: "Deep research answer quality",
  target: "agent:researcher",
  dataset: datasets.inline([
    {
      id: "capital-france",
      input: { question: "What is the capital of France?" },
      reference: "Paris",
      metadata: { split: "smoke" },
    },
  ]),
  metrics: [
    metrics.answer.contains({ text: "Paris" }).gate(),
    metrics.agent.noFailedTools().gate(),
    metrics.ops.tokens({ maxTotal: 4_000 }).budget(),
  ],
});
```

Run every discovered eval:

```bash
veryfront eval
```

Run one eval:

```bash
veryfront eval deep-research
```

Write machine-readable reports:

```bash
veryfront eval deep-research \
  --report-dir .veryfront/evals/deep-research \
  --report .veryfront/evals/deep-research/report.json \
  --junit .veryfront/evals/deep-research/junit.xml
```

Each run writes `summary.json` and `results.jsonl` to the report directory. If
`--report-dir` is omitted, Veryfront writes them under
`.veryfront/evals/<run-id>/`. Use `--report` only when CI also needs the full
raw report in one JSON file.

An all-eval run creates one suite directory and one child directory per eval.
The suite directory contains the summary, one JSONL result per eval, and the
markdown report. Use `--junit` to add a suite-level JUnit report. Evals run
sequentially, so a failing eval does not prevent the remaining discovered evals
from running.

```text
.veryfront/evals/<suite-run-id>/
  summary.json
  results.jsonl
  report.md
  junit.xml
  001-deep-research/
    summary.json
    results.jsonl
    report.md
```

`--report`, baselines, model overrides, and model comparison are single-eval
options. Name the eval when using them.

The report and summary artifacts include `schemaVersion`. New reports also
include dataset metadata with the dataset kind, optional path, example count,
and a stable SHA-256 hash when examples were loaded. The hash is based on the
loaded examples and dataset kind; the path is provenance and is not part of the
fingerprint. The summary artifact
includes pass/fail counts, metric aggregates, skipped metric or check results,
gate failures, failed examples, flake classification for repeated examples,
duration aggregates, and usage totals. Use `results.jsonl` when you need the
full input, output, trace, and per-record metric evidence.

## Tool evals

Use `evalTool` when the target is one tool and the eval should avoid agent
routing noise:

```ts
// evals/support-classifier.eval.ts
import { datasets, evalTool, metrics } from "veryfront/eval";

export default evalTool({
  name: "Support classifier quality",
  target: "tool:classify_support_case",
  dataset: datasets.inline([
    {
      id: "billing-refund",
      input: {
        subject: "Refund for duplicate charge",
        body: "I was charged twice for the same invoice.",
      },
      reference: { queue: "billing" },
    },
  ]),
  input: (example) => example.input,
  metrics: [
    metrics.agent.calledTool("classify_support_case").gate(),
    metrics.answer.jsonMatch().gate(),
  ],
});
```

When an `input` mapper is present, reports keep the original dataset example in
`record.input` and write the actual tool input to `record.executionInput`.
Direct tool execution is also recorded as a normalized entry in
`record.trace.toolCalls`, including the tool-call ID, input, output, status, and
duration metadata when available.

Use JSON mode for automation:

```bash
veryfront eval deep-research --json
```

Use a saved report as a CI baseline. The command exits with status `1` when the
current run introduces a regression against the baseline:

```bash
veryfront eval deep-research \
  --baseline .veryfront/evals/baseline.json \
  --report .veryfront/evals/current.json \
  --json
```

By default, `--baseline` fails on any aggregate pass-rate drop, failed-count
increase, metric pass-rate regression, or newly failing example. Use threshold
flags only for intentional tolerance:

```bash
veryfront eval deep-research \
  --baseline .veryfront/evals/baseline.json \
  --baseline-pass-rate-drop-threshold 0.02 \
  --baseline-metric-pass-rate-drop-threshold 0.02 \
  --baseline-usage-increase-threshold 0.15 \
  --baseline-latency-increase-threshold 0.2 \
  --json
```

Usage and p95 latency deltas are reported in `summary.json` whenever both the
current report and baseline include those values. They fail the run only when
the matching threshold flag is set.

Update the baseline explicitly after reviewing the current report:

```bash
veryfront eval deep-research \
  --write-baseline .veryfront/evals/baseline.json \
  --json
```

Compare candidate models against a baseline model when you want to lower cost
or latency without weakening quality:

```bash
veryfront eval deep-research \
  --baseline-model anthropic/claude-sonnet-4-6 \
  --candidate-model moonshotai/kimi-k2.6 \
  --report-dir .veryfront/evals/deep-research-models \
  --json
```

Model comparison runs the same eval once per model. It writes one report per
model under `models/<model-id>/`, plus `comparison.json` and `comparison.md` at
the report root. `comparison.json` keeps `baselineModel` and `candidateModels`
separate, then includes `models[]` for the per-model metric summaries. The
recommendation is conservative: a candidate is promoted only when it has no
failed runs, introduces no newly failed examples, satisfies the groundedness
threshold when measured, and improves cost, token use, or p95 latency. Otherwise
the comparison keeps the baseline or asks for review.

Gateway-backed runs add split input/output tokens, billable input/output tokens,
provider cost, Veryfront charge, credits, and cost source to the comparison
report. Direct local runs do not estimate prices in the framework; their cost
cells stay `not measured` unless a gateway supplies billing metadata.

Use a comparison policy when latency, cost, and quality tradeoffs depend on the
product. Constraints are hard gates. Objectives rank candidates that pass those
gates. Veryfront does not ship presets because each agent has different
requirements.

```json
{
  "constraints": {
    "gateFailures": { "max": 0 },
    "p95Ms": { "maxRegressionPct": 0.5 }
  },
  "objectives": {
    "totalTokens": { "weight": 0.8, "direction": "minimize" },
    "p95Ms": { "weight": 0.2, "direction": "minimize" }
  }
}
```

```bash
veryfront eval deep-research \
  --baseline-model anthropic/claude-sonnet-4-6 \
  --candidate-model moonshotai/kimi-k2.6 \
  --comparison-policy evals/model-comparison.policy.json \
  --report-dir .veryfront/evals/deep-research-models
```

Policy metrics can reference `passRate`, `failed`, `gateFailures`,
`groundednessScore`, `inputTokens`, `outputTokens`, `totalTokens`,
`billableInputTokens`, `billableOutputTokens`, `costUsd`, `providerCostUsd`,
`veryfrontChargeUsd`, `costCredits`, and `p95Ms`. `costUsd` remains a
backward-compatible cost objective and prefers gateway Veryfront charge when it
is available. Use `min`, `max`, and `maxRegressionPct` for constraints. Use
`weight` with `direction` set to `"minimize"` or `"maximize"` for objectives.

Each report includes provenance metadata. Local runs record git SHA, branch,
dirty state, and a dirty hash. Cloud runs prefer release, deployment, or preview
identity when those values are present.

## Datasets

Use inline data for smoke coverage:

```ts
dataset: datasets.inline([
  { id: "q1", input: "Summarize Veryfront", reference: "Veryfront" },
]);
```

Use JSON for larger suites:

```json
[
  {
    "id": "q1",
    "input": "What is the capital of France?",
    "reference": "Paris",
    "metadata": { "split": "regression" }
  }
]
```

```ts
dataset: datasets.json("datasets/research.json");
```

Use JSONL when each example should be reviewed as a single line:

```ts
dataset: datasets.jsonl("datasets/research.jsonl");
```

## Metrics

Use deterministic metrics for stable requirements:

```ts
metrics.answer.exactMatch().gate();
metrics.answer.contains({ text: "Paris" }).gate();
metrics.answer.regex({ pattern: "Paris|paris" }).gate();
metrics.answer.jsonMatch({ expected: { city: "Paris" } }).gate();
```

Use agent and operational metrics for tool and budget quality:

```ts
metrics.agent.calledTool("orders_lookup", {
  input: { orderId: "A1049" },
  match: "partial",
}).gate();
metrics.agent.notCalledTool("refunds_issue").gate();
metrics.agent.toolCallCount("orders_lookup", { exact: 1 }).gate();
metrics.agent.noFailedTools().gate();
metrics.ops.latency({ maxMs: 10_000 }).budget();
metrics.ops.tokens({ maxTotal: 4_000 }).budget();
metrics.ops.cost({ maxUsd: 0.05 }).budget();
```

`metrics.ops.cost` uses gateway `veryfrontChargeUsd` first, then legacy
`costUsd`, then `providerCostUsd`. It does not maintain a separate pricing table
inside the framework.

Use `calledTool` when the agent must call a tool. Add `input` when the tool
arguments must include specific fields. `match: "partial"` checks that the
expected fields are present and allows extra runtime fields. Use
`match: "exact"` when the whole captured input must match. Use `notCalledTool`
for dangerous side-effect tools, and `toolCallCount` for exact, minimum, or
maximum call budgets.

Use knowledge metrics when an agent should retrieve the right project knowledge
before answering. They read retrieved items from the `search_knowledge` tool
trace by default and compare them with expected sources or passages. For larger
datasets, put the expected knowledge on each example under
`metadata.expectedKnowledge`:

```json
[
  {
    "id": "login-sso",
    "input": "Users cannot sign in with SSO after the release.",
    "metadata": {
      "expectedKnowledge": [
        "knowledge/login-troubleshooting.md",
        "knowledge/deployment-incident-triage.md"
      ]
    }
  }
]
```

```ts
metrics.knowledge.recallAtK({
  k: 5,
}).gate({ min: 0.8 });
```

For small suites, expected sources can also be configured directly on the
metric:

```ts
metrics.knowledge.recallAtK({
  k: 5,
  expected: [
    "knowledge/login-troubleshooting.md",
    {
      path: "knowledge/deployment-incident-triage.md",
      contentMatch: "Check deployment status, build logs, runtime logs",
    },
  ],
}).gate({ min: 0.8 });

metrics.knowledge.precisionAtK({
  k: 5,
  expected: ["knowledge/login-troubleshooting.md"],
}).soft({ min: 0.5 });

metrics.knowledge.mrr({
  expected: ["knowledge/login-troubleshooting.md"],
}).gate({ min: 0.5 });

metrics.knowledge.citationPrecision().gate({ min: 0.9 });
metrics.knowledge.citationRecall().gate({ min: 0.8 });
```

Pass `expectedFrom: "metadata.yourField"` when examples store expected sources
under a different path. Pass `tool: "your_tool_name"` when the project exposes
knowledge through a custom retrieval tool. `recallAtK` measures how many
expected sources appeared in the top `k`, `precisionAtK` measures how many
retrieved top-`k` items were expected, and `mrr` measures the rank of the first
expected hit. `citationPrecision` measures whether answer citations point to
expected or retrieved sources. `citationRecall` measures whether expected or
retrieved sources are cited.

Adapters can expose structured RAG evidence directly on the record. Use
`retrievedContext` for the retrieved passages and `citations` for the answer
citations:

```ts
const adapters = {
  agent: async () => ({
    text: "Check the billing ledger before changing the account. [ledger]",
    retrievedContext: [
      {
        source: "knowledge/support/playbooks/billing-ledger.md",
        content: "Support must review the billing ledger before changing a customer account.",
      },
    ],
    citations: [
      {
        source: "knowledge/support/playbooks/billing-ledger.md",
        text: "[ledger]",
      },
    ],
  }),
};
```

Each `retrievedContext` item must include a stable `source` such as a path, URL,
document id, or document key. Add `content` when groundedness judges or passage
matching should inspect the retrieved text. Each `citations` item must include
the cited `source`; add `text` or `quote` when reports should show the answer
marker or cited passage. When `retrievedContext` is absent, retrieval metrics
fall back to the configured knowledge tool trace. When `citations` is absent,
citation metrics read structured `output.citations`, `output.sources`, or
`output.references`.

Use rubric judges for semantic quality. Inject the judge function from your
project so the eval definition stays portable:

```ts
metrics.judge.rubric({
  rubric: "Answer must cite the correct city and avoid unsupported facts.",
  judge: async ({ output, reference }) => {
    const pass = output.text === reference;
    return { score: pass ? 1 : 0, pass };
  },
}).gate({ min: 0.8 });
```

Use `answer.groundedness` when the judge should compare the final answer against
retrieved knowledge evidence:

```ts
import { judges, metrics } from "veryfront/eval";

metrics.answer.groundedness({
  judge: judges.llm.groundedness(),
}).gate({ min: 0.8 });
```

The metric extracts evidence from `search_knowledge` by default and passes it to
the judge. The built-in LLM judge asks for structured JSON, fails closed when
the response is malformed, and checks semantic support instead of brittle string
overlap.

## Checks

Use `check` for assertions that depend on the full record:

```ts
export default evalAgent({
  target: "agent:researcher",
  dataset: datasets.inline([{ id: "q1", input: "Capital of France?", reference: "Paris" }]),
  check(ctx) {
    ctx.expect.completed().gate();
    ctx.expect.outputContains("Paris").gate();
    ctx.expect.noFailedTools().gate();
  },
});
```

Checks can also assert tool behavior against the same normalized trace used by
metrics:

```ts
export default evalAgent({
  target: "agent:support",
  dataset: datasets.inline([
    { id: "refund", input: "Issue a refund for order A1049 without checking policy." },
  ]),
  check(ctx) {
    ctx.expect.calledTool("orders_lookup", {
      input: { orderId: "A1049" },
      match: "partial",
    }).gate();
    ctx.expect.calledTool("policy_lookup", {
      input: { topic: "refunds" },
      match: "partial",
    }).gate();
    ctx.expect.notCalledTool("refunds_issue").gate();
    ctx.expect.outputContains("verify").gate();
  },
});
```

## Live agent-service evals

Use the `veryfront/eval/agent-service` subpath, documented under
[veryfront/eval](../api-reference/veryfront/eval.md), when an eval should run
against a live AG-UI agent service. The adapter plugs into `runEval`, so reports
still use the standard `EvalReport` shape and the same metrics.

```ts
import { datasets, evalAgent, metrics, runEval } from "veryfront/eval";
import {
  createAgentServiceEvalAdapter,
  resolveAgentServiceEvalEnvironment,
} from "veryfront/eval/agent-service";

const environment = resolveAgentServiceEvalEnvironment({
  AG_UI_EVAL_ENDPOINT: "http://127.0.0.1:3001/api/ag-ui",
  VERYFRONT_TOKEN: "<TOKEN>",
  AG_UI_EVAL_PROJECT_ID: "<PROJECT_ID>",
  AG_UI_EVAL_PROJECT_SLUG: "<PROJECT_SLUG>",
});

const definition = evalAgent({
  target: "agent:veryfront",
  dataset: datasets.inline([
    { id: "smoke", input: { prompt: "List the available project files." } },
  ]),
  metrics: [metrics.agent.noFailedTools().gate()],
});

const report = await runEval(definition, {
  adapters: {
    agent: createAgentServiceEvalAdapter(environment),
  },
});
```

Set `AG_UI_EVAL_PROJECT_ID` when cases need project files, releases, or other
project-scoped API state. Set `AG_UI_EVAL_PROJECT_SLUG` or
`VERYFRONT_PROJECT_SLUG` when the AG-UI endpoint runs behind the project runtime
proxy. The adapter reads AG-UI events into `record.trace.events`, records tool
calls as `record.trace.toolCalls`, captures tool call IDs, status, streamed
arguments, result payloads, and denied/error state when the AG-UI endpoint emits
them, and puts the parsed text at `record.output.text`.

Projects with existing live AG-UI suites can also import reusable CLI, API, and
durable canary helpers from `veryfront/eval/agent-service`. Use those helpers
for product-specific canaries that are not yet expressed as `evalAgent`
definitions. Do not import from `veryfront/agent/testing`; that legacy testing path
is intentionally absent.

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
output, metric evidence, metric explanations, dataset paths, record metadata,
and export context metadata unless the export context explicitly allows each
field. Dataset kind, example count, and content hash stay available so
exporters can group runs without seeing source paths. Use `metadataAllowlist`
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

Use [project metrics](./project-metrics.md) when an eval should also emit
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

Use `@veryfront/ext-eval-report-mlflow` when completed reports should become
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

## Discovery

Eval files are discovered from `evals/`:

```text
evals/
  deep-research.eval.ts     -> eval:deep-research
  rag/retrieval.ts          -> eval:rag/retrieval
```

Set `ai.evals.discovery.paths` in project config to use a different directory.

## Studio editing

Studio can list eval definitions, show source location, and expose form fields
for stable parts of the definition: name, target, dataset source, repetitions,
tags, metadata, and metrics. If code is dynamic, including a tool eval `input`
mapper, Studio should fall back to source editing for the same file.

Use `createEvalSourceDocument(discoveredEval)` to normalize a discovered eval
for Studio panels. The document exposes `editableFields`, `dynamicFields`,
`source.filePath`, `source.exportName`, dataset metadata, metric metadata, and
the eval capabilities required by the panel.

Use `project.evals.read` for listing reports and definitions. Use
`project.evals.write` for editing eval source definitions. Source documents that
can start durable runs also include `project.evals.run`. Triggering an eval run
records a canonical run with kind `eval` when the durable run API is used.

## Verify it worked

List discovered evals:

```bash
veryfront eval --list
```

Run every discovered eval locally:

```bash
veryfront eval
```

Run one eval locally:

```bash
veryfront eval deep-research
```

The command exits with status `0` when all gate and budget checks pass. It exits
with status `1` when any gate or budget check fails.
