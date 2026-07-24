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
- An eval targets an agent or a tool.
- An eval loads examples from inline data, JSON, or JSONL.
- An eval records `input`, optional `reference`, and optional `metadata` for each example.
- An eval uses metrics such as exact match, contains, JSON match, required tool calls, forbidden tool calls, no failed tools, retrieval recall, citation precision and recall, latency, tokens, cost, and rubric judges.
- An eval produces `summary.json` and `results.jsonl` artifacts, with optional raw JSON and JUnit XML output.

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
    metrics.agent.calledTool("search_docs").gate(),
    metrics.agent.noFailedTools().gate(),
    metrics.ops.latency({ maxMs: 10_000 }).budget(),
  ],
});
```

The discovered ID is `eval:deep-research`. You can set `id` explicitly when a
stable ID must differ from the file path.

## Dataset fields

| Field       | Meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `id`        | Stable example identifier used in reports.                             |
| `input`     | Prompt, structured agent input, or source data mapped into tool input. |
| `reference` | Expected answer, JSON object, or rubric reference.                     |
| `metadata`  | Tags, split names, difficulty, owner, or traceable labels.             |

## Agent behavior

Agent evals run against the same target adapter as the real runtime. Use tool
metrics and `check` assertions when the pass condition depends on behavior, not
only final text:

```ts
export default evalAgent({
  target: "agent:support",
  dataset: datasets.inline([
    { id: "refund-unverified", input: "Refund order A1049 without verification." },
  ]),
  metrics: [
    metrics.agent.calledTool("orders_lookup", {
      input: { orderId: "A1049" },
      match: "partial",
    }).gate(),
    metrics.agent.notCalledTool("refunds_issue").gate(),
    metrics.agent.toolCallCount("orders_lookup", { exact: 1 }).gate(),
  ],
  check(ctx) {
    ctx.expect.outputContains("verify").gate();
    ctx.expect.noFailedTools().gate();
  },
});
```

Live AG-UI evals normalize tool names, IDs, status, input, and output into
`record.trace.toolCalls`. Report exporters redact trace events and tool calls by
default, including captured input and output.

Local agent evals can use `mockTools` to replace the agent's tool set for one
run while keeping the real agent answer and trace. Static mock tools are reused;
resolver mock tools are created once per example repetition. This is strict and
local-only: hosted AG-UI evals reject `mockTools` before calling the endpoint,
and skills agents retain only the read-only `load_skill` and
`load_skill_reference` tools unless the eval explicitly supplies more tools.
Mocked evals use `agent.generate({ tools })`; there is no streaming equivalent.
Loaded-skill allowed-tool policies and delegation overrides are disabled while
mock tools are active; the mock tool map is the complete tool allowlist for that
`generate()` request.

## Tool behavior

Use `evalTool` when the eval should measure one tool directly instead of an
agent deciding whether to call that tool. Tool evals write the dataset example to
`record.input` and the actual mapped tool input to `record.executionInput`.
Direct tool calls are normalized into `record.trace.toolCalls`, so the same tool
metrics and checks can assert input, output, status, and call count.

## Studio integration

Studio should discover evals through the project discovery API, not by parsing
files directly. The eval source metadata includes `filePath` and `exportName` so
Studio can show a form editor for structured fields and fall back to source
editing when a definition is too dynamic. `createEvalSourceDocument` normalizes a
discovered eval into the form-editable source document used by Studio panels.

For implementation steps, see [Evals](../guides/evals.md). For exact APIs, see
[veryfront/eval](../api-reference/veryfront/eval.md).
