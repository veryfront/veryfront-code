---
title: "Evals"
description: "Define and run quality checks for agents."
order: 40
---

Evals are project-defined quality checks in `evals/`. Run them locally with
`veryfront eval <eval-id>` and store JSON or JUnit reports in CI.

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
  --report .veryfront/evals/deep-research.json \
  --junit .veryfront/evals/deep-research.xml
```

Use JSON mode for automation:

```bash
veryfront eval deep-research --json
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
metrics.agent.noFailedTools().gate();
metrics.ops.latency({ maxMs: 10_000 }).budget();
metrics.ops.tokens({ maxTotal: 4_000 }).budget();
metrics.ops.cost({ maxUsd: 0.05 }).budget();
```

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
project-scoped API state. The adapter reads AG-UI events into
`record.trace.events`, records tool starts as `record.trace.toolCalls`, and puts
the parsed text at `record.output.text`.

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

The registry redacts inputs, outputs, references, traces, metric evidence,
metric explanations, and metadata unless the export context explicitly allows
each field. Runtime monitoring remains separate: use
`veryfront/extensions/observability` and the OpenTelemetry extension for spans,
traces, metrics, and service monitoring. When OpenTelemetry is active, `runEval`
adds the active `traceId` and `spanId` to export context unless you pass
`context.trace` explicitly.

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
  --report .veryfront/evals/deep-research.json \
  --junit .veryfront/evals/deep-research.xml \
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
