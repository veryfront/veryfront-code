---
title: "Workflows"
description: "DAG-based multi-step workflows with branching and parallelism."
order: 18
---

# Workflows

DAG-based multi-step workflows with branching and parallelism.

## Define a workflow

Create a file in `workflows/`:

```ts
// workflows/content-pipeline.ts
import { step, workflow } from "veryfront/workflow";

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

## Start a workflow

Define workflows in `workflows/`, then start them from the surface that owns the user or system event. Common start points are:

- an API route, when a user action or webhook starts the run
- an agent tool, when an agent should decide whether to start the run
- a task, when a scheduled job or background process starts the run
- a client component, when the app exposes a workflow-start API route

Use `createWorkflowClient()` to register and start a workflow from server code:

```ts
// app/api/start-content-workflow/route.ts
import { getAgent, getAllAgentIds } from "veryfront/agent";
import { toolRegistry } from "veryfront/tool";
import { createWorkflowClient } from "veryfront/workflow";
import contentPipeline from "../../../workflows/content-pipeline.ts";

const agentRegistry = {
  get: getAgent,
  list: getAllAgentIds,
};

const workflows = createWorkflowClient({
  executor: {
    stepExecutor: {
      agentRegistry,
      toolRegistry,
    },
  },
});

workflows.register(contentPipeline);

export async function POST(request: Request) {
  const input = await request.json();
  const handle = await workflows.start("content-pipeline", input);

  return Response.json({ runId: handle.runId });
}
```

Ensure every `agent` and `tool` used by the workflow exists in `agents/` or `tools/`, then call the route:

```bash
curl http://localhost:3000/api/start-content-workflow \
  -H "Content-Type: application/json" \
  -d '{"topic":"AI agents"}'
```

The response contains the workflow run ID:

```json
{ "runId": "run_..." }
```

Call the API route from a client component:

```tsx
"use client";
import { useState } from "react";

export default function StartContentWorkflow() {
  const [runId, setRunId] = useState<string | null>(null);

  async function startWorkflow() {
    const response = await fetch("/api/start-content-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "AI agents" }),
    });
    const data = await response.json();
    setRunId(data.runId);
  }

  return (
    <button type="button" onClick={startWorkflow}>
      {runId ? `Run ${runId}` : "Start workflow"}
    </button>
  );
}
```

Inside an agent tool, start the workflow from the tool's `execute` function:

```ts
// tools/start-content-workflow.ts
import { z } from "zod";
import { getAgent, getAllAgentIds } from "veryfront/agent";
import { tool, toolRegistry } from "veryfront/tool";
import { createWorkflowClient } from "veryfront/workflow";
import contentPipeline from "../workflows/content-pipeline.ts";

const agentRegistry = {
  get: getAgent,
  list: getAllAgentIds,
};

const workflows = createWorkflowClient({
  executor: {
    stepExecutor: {
      agentRegistry,
      toolRegistry,
    },
  },
});
workflows.register(contentPipeline);

export default tool({
  description: "Start the article workflow for a topic",
  inputSchema: z.object({ topic: z.string() }),
  execute: async ({ topic }) => {
    const handle = await workflows.start("content-pipeline", { topic });
    return { runId: handle.runId };
  },
});
```

Use `handle.result()` only when the caller should wait for completion. Return the `runId` when the workflow can continue in the background.

## Steps

A step runs an agent or a tool:

```ts
// Run an agent
step("research", { agent: "researcher" });

// Run a tool
step("fetch-data", { tool: "webScraper" });

// With custom input
step("summarize", {
  agent: "writer",
  input: (ctx) => `Summarize this: ${ctx.results.research}`,
});
```

### Step options

| Property     | Type                                   | Description                         |
| ------------ | -------------------------------------- | ----------------------------------- |
| `agent`      | `string \| Agent`                      | Agent to run (by ID or instance)    |
| `tool`       | `string \| Tool`                       | Tool to execute (by ID or instance) |
| `input`      | `string \| object \| (ctx) => unknown` | Step input                          |
| `checkpoint` | `boolean`                              | Persist state after this step       |
| `retry`      | `RetryConfig`                          | Retry on failure                    |
| `timeout`    | `string \| number`                     | Step timeout                        |
| `skip`       | `(ctx) => boolean`                     | Skip this step conditionally        |

## Parallel execution

Run steps concurrently:

```ts
import { parallel, step, workflow } from "veryfront/workflow";

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
parallel("race-check", steps, { strategy: "race" }); // First to finish wins
parallel("best-effort", steps, { strategy: "allSettled" }); // Continue even if some fail
parallel("all-required", steps, { strategy: "all" }); // Default: all must succeed
```

## Branching

Use `branch` for conditional paths:

```ts
import { branch, step, workflow } from "veryfront/workflow";

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
import { unless, when } from "veryfront/workflow";

when("needs-approval", (ctx) => ctx.results.classify.sensitive, [
  step("review", { agent: "reviewer" }),
]);

unless("is-cached", (ctx) => ctx.cache.has(key), [
  step("fetch", { tool: "fetcher" }),
]);
```

## Human-in-the-loop

Pause a workflow until a human approves or rejects:

```ts
import { step, waitForApproval, workflow } from "veryfront/workflow";

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
});
```

## Loops

Repeat steps based on conditions:

```ts
import { doWhile, loop, map, times } from "veryfront/workflow";

// Repeat while condition is true
loop("refine", (ctx) => ctx.results.review.score < 0.9, [
  step("rewrite", { agent: "writer" }),
  step("review", { agent: "reviewer" }),
]);

// Execute once, then repeat while true
doWhile("poll", (ctx) => !ctx.results.check.done, [
  step("check", { tool: "statusChecker" }),
  delay("wait", "5s"),
]);

// Fixed iterations
times("generate", 3, [
  step("variant", { agent: "writer" }),
]);

// Map over array items
map("process", (ctx) => ctx.input.urls, [
  step("scrape", { tool: "webScraper" }),
]);
```

## Workflow configuration

```ts
import { z } from "zod";
import { step, workflow } from "veryfront/workflow";

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

## Blob storage

For large workflow artifacts, configure `blobStorage` on the executor with a
host-provided storage adapter. The public workflow export exposes the executor
integration point. Storage implementations come from the host runtime.

## React hooks

Track workflow progress from the client when your app exposes workflow API routes that match the hook's `apiBase`:

```tsx
"use client";
import { useWorkflow, useWorkflowStart } from "veryfront/workflow";

export default function PipelineDashboard() {
  const { start, lastRunId } = useWorkflowStart({
    workflowId: "pipeline",
    apiBase: "/api/workflows",
  });

  return (
    <div>
      <button onClick={() => start({ topic: "AI agents" })}>Run Pipeline</button>
      {lastRunId ? <WorkflowStatus runId={lastRunId} /> : null}
    </div>
  );
}

function WorkflowStatus({ runId }: { runId: string }) {
  const { status, nodeStates } = useWorkflow({ runId });

  return (
    <div>
      <p>Status: {status}</p>
      {Object.entries(nodeStates).map(([id, state]) => <div key={id}>{id}: {state.status}</div>)}
    </div>
  );
}
```

## Next

- [Multi-agent](./multi-agent.md): compose agents in workflows and tools
- [Providers](./providers.md): configure the LLM providers that power your agents

## Related

- [`veryfront/workflow`](../reference/veryfront/workflow.md): workflow API reference
