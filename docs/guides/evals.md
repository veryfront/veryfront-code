---
title: "Evals"
description: "Define and run quality checks for agents."
order: 40
---

Evals are project-defined quality checks in `evals/`. Run them locally with
`veryfront eval <eval-id>` and store report artifacts in CI.

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

Run it:

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

The summary artifact includes pass/fail counts, metric aggregates, skipped
metric or check results, gate failures, failed examples, flake classification
for repeated examples, duration aggregates, and usage totals. Use
`results.jsonl` when you need the full input, output, trace, and per-record
metric evidence.

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

Update the baseline explicitly after reviewing the current report:

```bash
veryfront eval deep-research \
  --write-baseline .veryfront/evals/baseline.json \
  --json
```

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
```

Pass `expectedFrom: "metadata.yourField"` when examples store expected sources
under a different path. Pass `tool: "your_tool_name"` when the project exposes
knowledge through a custom retrieval tool. `recallAtK` measures how many
expected sources appeared in the top `k`, `precisionAtK` measures how many
retrieved top-`k` items were expected, and `mrr` measures the rank of the first
expected hit.

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
metrics.answer.groundedness({
  judge: async ({ output, evidence, sources }) => {
    const score = await judgeGrounding({ output, evidence, sources });
    return { score, pass: score >= 0.8 };
  },
}).gate({ min: 0.8 });
```

The helper extracts evidence from `search_knowledge` by default and passes it to
your judge. This keeps model choice and credentials in project code while the
eval report uses the standard Veryfront metric shape.

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
definitions. Do not import `veryfront/agent/testing`; that legacy testing path
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
        metadataAllowlist: ["dataset"],
      },
    },
  },
});
```

The registry redacts inputs, outputs, references, traces, tool-call input and
output, metric evidence, metric explanations, and metadata unless the export
context explicitly allows each field. Runtime monitoring remains separate: use
`veryfront/extensions/observability` and the OpenTelemetry extension for spans,
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

From the CLI, pass comma-separated exporter ids. Export failures are reported in
the JSON report and do not prevent local report or JUnit files from being
written.

```bash
veryfront eval deep-research \
  --report-dir .veryfront/evals/deep-research \
  --report .veryfront/evals/deep-research/report.json \
  --junit .veryfront/evals/deep-research/junit.xml \
  --export braintrust,langfuse \
  --json
```

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
tags, metadata, and metrics. If code is dynamic, Studio should fall back to
source editing for the same file.

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

Run the eval locally:

```bash
veryfront eval deep-research
```

The command exits with status `0` when all gate and budget checks pass. It exits
with status `1` when any gate or budget check fails.
