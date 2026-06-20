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
`project.evals.write` for editing eval source definitions. Triggering an eval run
also records a canonical run with kind `eval` when the durable run API is used.

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
