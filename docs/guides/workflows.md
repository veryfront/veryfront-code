---
title: "Workflows"
description: "DAG-based multi-step workflows with branching and parallelism."
order: 10
---

# Workflows

DAG-based multi-step workflows with branching and parallelism.

## Define a workflow

Create a file in `workflows/`:

```ts
// workflows/content-pipeline.ts
import { workflow, step } from "veryfront/workflow";

export default workflow({
  id: "content-pipeline",
  steps: [
    step("research", { agent: "researcher" }),
    step("write", { agent: "writer" }),
    step("review", { agent: "editor" }),
  ],
});
```

Steps run in order. Each step's output is available to the next step via the workflow context.

## Steps

A step runs an agent or a tool:

```ts
// Run an agent
step("research", { agent: "researcher" })

// Run a tool
step("fetch-data", { tool: "webScraper" })

// With custom input
step("summarize", {
  agent: "writer",
  input: (ctx) => `Summarize this: ${ctx.results.research}`,
})
```

### Step options

| Property | Type | Description |
|----------|------|-------------|
| `agent` | `string \| Agent` | Agent to run (by ID or instance) |
| `tool` | `string \| Tool` | Tool to execute (by ID or instance) |
| `input` | `string \| object \| (ctx) => unknown` | Step input |
| `checkpoint` | `boolean` | Persist state after this step |
| `retry` | `RetryConfig` | Retry on failure |
| `timeout` | `string \| number` | Step timeout |
| `skip` | `(ctx) => boolean` | Skip this step conditionally |

## Parallel execution

Run steps concurrently:

```ts
import { workflow, step, parallel } from "veryfront/workflow";

export default workflow({
  id: "report",
  steps: [
    step("gather", { agent: "researcher" }),
    parallel("analyze", [
      step("sentiment", { tool: "sentimentAnalyzer" }),
      step("entities", { tool: "entityExtractor" }),
      step("summary", { agent: "summarizer" }),
    ]),
    step("compile", { agent: "writer" }),
  ],
});
```

All three analysis steps run at the same time. The `"compile"` step waits for all of them to finish.

### Parallel strategies

```ts
parallel("race-check", steps, { strategy: "race" })       // First to finish wins
parallel("best-effort", steps, { strategy: "allSettled" }) // Continue even if some fail
parallel("all-required", steps, { strategy: "all" })       // Default — all must succeed
```

## Branching

Use `branch` for conditional paths:

```ts
import { workflow, step, branch } from "veryfront/workflow";

export default workflow({
  id: "support",
  steps: [
    step("classify", { agent: "classifier" }),
    branch("route", {
      condition: (ctx) => ctx.results.classify.category === "billing",
      then: [step("billing", { agent: "billing-agent" })],
      else: [step("technical", { agent: "tech-agent" })],
    }),
    step("respond", { agent: "responder" }),
  ],
});
```

Shorthand helpers:

```ts
import { when, unless } from "veryfront/workflow";

when("needs-approval", (ctx) => ctx.results.classify.sensitive, [
  step("review", { agent: "reviewer" }),
])

unless("is-cached", (ctx) => ctx.cache.has(key), [
  step("fetch", { tool: "fetcher" }),
])
```

## Human-in-the-loop

Pause a workflow until a human approves or rejects:

```ts
import { workflow, step, waitForApproval } from "veryfront/workflow";

export default workflow({
  id: "publish",
  steps: [
    step("draft", { agent: "writer" }),
    waitForApproval("editor-review", {
      message: "Please review the draft before publishing.",
      timeout: "24h",
    }),
    step("publish", { tool: "publisher" }),
  ],
});
```

The workflow pauses at `waitForApproval` and resumes when an approver responds. If the timeout expires, the workflow fails.

### Wait for events

Pause until an external event arrives:

```ts
import { waitForEvent } from "veryfront/workflow";

waitForEvent("payment-confirmed", {
  event: "payment.completed",
  timeout: "1h",
})
```

## Loops

Repeat steps based on conditions:

```ts
import { loop, doWhile, times, map } from "veryfront/workflow";

// Repeat while condition is true
loop("refine", (ctx) => ctx.results.review.score < 0.9, [
  step("rewrite", { agent: "writer" }),
  step("review", { agent: "reviewer" }),
])

// Execute once, then repeat while true
doWhile("poll", (ctx) => !ctx.results.check.done, [
  step("check", { tool: "statusChecker" }),
  delay("wait", "5s"),
])

// Fixed iterations
times("generate", 3, [
  step("variant", { agent: "writer" }),
])

// Map over array items
map("process", (ctx) => ctx.input.urls, [
  step("scrape", { tool: "webScraper" }),
])
```

## Workflow configuration

```ts
import { workflow, step } from "veryfront/workflow";
import { z } from "zod";

export default workflow({
  id: "pipeline",
  description: "Content generation pipeline",
  version: "1.0.0",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ article: z.string() }),
  timeout: "30m",
  retry: { maxAttempts: 3, backoff: "exponential" },
  steps: ({ input }) => [
    step("research", {
      agent: "researcher",
      input: input.topic,
    }),
    step("write", { agent: "writer" }),
  ],
  onError: (error, ctx) => console.error("Failed:", error),
  onComplete: (result) => console.log("Done:", result),
});
```

## React hooks

Track workflow progress from the client:

```tsx
'use client'
import { useWorkflow, useWorkflowStart } from "veryfront/workflow";

export default function PipelineDashboard() {
  const { start, runId } = useWorkflowStart({ workflow: "pipeline" });
  const { status, steps } = useWorkflow({ runId });

  return (
    <div>
      <button onClick={() => start({ topic: "AI agents" })}>Run Pipeline</button>
      <p>Status: {status}</p>
      {steps.map((s) => (
        <div key={s.name}>{s.name}: {s.status}</div>
      ))}
    </div>
  );
}
```

## Next

- [Multi-Agent](./multi-agent.md) — compose agents in workflows and tools
- [Providers](./providers.md) — configure the LLM providers that power your agents

## Related

- [`veryfront/workflow`](../reference/workflow.md) — workflow API reference
