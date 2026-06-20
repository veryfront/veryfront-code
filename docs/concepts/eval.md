---
title: "Eval"
description: "How evals define repeatable quality checks for agents."
order: 34
---

An eval defines a repeatable quality check for an agent. It names the target,
dataset, metrics, thresholds, and report shape that prove whether the agent still
behaves as expected.

Use evals when model behavior must be measured across examples, not just checked
with one deterministic unit test.

## Characteristics

- An eval has a stable ID.
- An eval targets an agent in V1.
- An eval loads examples from inline data, JSON, or JSONL.
- An eval records `input`, optional `reference`, and optional `metadata` for each example.
- An eval uses metrics such as exact match, contains, JSON match, no failed tools, latency, tokens, cost, and rubric judges.
- An eval produces a report with records, metric summaries, pass rate, and optional JUnit XML output.

## Boundary

An eval is the definition. An eval run is one execution of that definition. A
report is the result of the run. Durable eval runs use run kind `eval` and target
IDs such as `eval:deep-research`.

Keep evals separate from tests. Tests protect deterministic code behavior. Evals
measure probabilistic agent behavior, retrieval behavior, tool behavior, and
operational budgets across datasets.

## Source files

Eval files live in `evals/` and export an eval definition:

```ts
// evals/deep-research.eval.ts
import { datasets, evalAgent, metrics } from "veryfront/eval";

export default evalAgent({
  name: "Deep research answer quality",
  target: "agent:researcher",
  dataset: datasets.inline([
    {
      id: "capital-france",
      input: "What is the capital of France?",
      reference: "Paris",
      metadata: { category: "geography" },
    },
  ]),
  metrics: [
    metrics.answer.contains({ text: "Paris" }).gate(),
    metrics.agent.noFailedTools().gate(),
    metrics.ops.latency({ maxMs: 10_000 }).budget(),
  ],
});
```

The discovered ID is `eval:deep-research`. You can set `id` explicitly when a
stable ID must differ from the file path.

## Dataset fields

| Field       | Meaning                                                    |
| ----------- | ---------------------------------------------------------- |
| `id`        | Stable example identifier used in reports.                 |
| `input`     | Prompt or structured input sent to the target agent.       |
| `reference` | Expected answer, JSON object, or rubric reference.         |
| `metadata`  | Tags, split names, difficulty, owner, or traceable labels. |

## Studio integration

Studio should discover evals through the project discovery API, not by parsing
files directly. The eval source metadata includes `filePath` and `exportName` so
Studio can show a form editor for structured fields and fall back to source
editing when a definition is too dynamic. `createEvalSourceDocument` normalizes a
discovered eval into the form-editable source document used by Studio panels.

For implementation steps, see [Evals](../guides/evals.md). For exact APIs, see
[veryfront/eval](../api-reference/veryfront/eval.md).
