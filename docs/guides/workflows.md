---
title: "Workflows"
description: "DAG-based multi-step workflows with branching and parallelism."
order: 26
---

A workflow is a file in `workflows/` that declares ordered steps. Each step runs an agent or a tool. The workflow runtime passes outputs between steps.

Use workflows for multi-step work that needs ordering, branching, parallelism, retries, timeouts, or approvals.

Workflow files are definitions. Starting a workflow creates a workflow run. On
the Veryfront platform, that workflow run is backed by a job so it can be
queued, retried, canceled, logged, and observed in the Jobs panel.

| Concept      | Meaning                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| Workflow     | The definition stored in `workflows/`.                                                   |
| Workflow run | The canonical public execution record for a started workflow.                            |
| Job          | The durable backing execution record that queues and dispatches the workflow run.        |
| Cron job     | A schedule that creates workflow runs over time when its target starts with `workflow:`. |

## Prerequisites

- A Veryfront project with the `workflows/` directory available (see
  [Create a project](../getting-started/create-a-project.md)).
- Any agents or tools referenced by a step are defined in `agents/` or
  `tools/` (see [Agents](./agents.md) and [Tools](./tools.md)).
- A provider configured for any agents the workflow uses
  (see [Providers](./providers.md)).

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

Define workflows in `workflows/`, then start them from the surface that owns the user or system event.

| Start point | Use when |
| ----------- | -------- |
| API route | A user action or webhook starts the run. |
| Agent tool | An agent decides whether to start the run. |
| Task | Background work starts the run. |
| Client UI | The UI calls an API route that starts the run. |

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

The route returns the workflow run ID:

```json
{ "runId": "run_..." }
```

Inside an agent tool, start the workflow from `execute`:

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
  inputSchema: z.object({
    topic: z.string().describe("Article topic"),
  }),
  execute: async ({ topic }) => {
    const handle = await workflows.start("content-pipeline", { topic });
    return { runId: handle.runId };
  },
});
```

Use `handle.result()` only when the caller should wait for completion. Return the `runId` when the workflow can continue in the background.

## Schedule a workflow

Use a cron job with a `workflow:<workflow-id>` target when a workflow must run on a schedule. See [Jobs and cron jobs](./jobs.md) for the scheduling API and event monitoring.

Each scheduled trigger creates a workflow run backed by a job.

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

## Workflow configuration

```ts
import { z } from "zod";
import { step, workflow } from "veryfront/workflow";

export default workflow({
  id: "pipeline",
  description: "Content generation pipeline",
  version: "1.0.0",
  inputSchema: z.object({
    topic: z.string().describe("Content topic"),
  }),
  outputSchema: z.object({
    article: z.string().describe("Generated article body"),
  }),
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

## Verify it worked

Start the workflow from the start route, then poll the run state until it
reaches a terminal status:

```bash
RUN=$(curl -s http://localhost:3000/api/start-content-workflow \
  -H "Content-Type: application/json" \
  -d '{"topic":"AI agents"}' | jq -r .runId)

while true; do
  STATE=$(curl -s "http://localhost:3000/api/workflows/runs/$RUN")
  STATUS=$(echo "$STATE" | jq -r '.status')
  echo "status=$STATUS"
  case "$STATUS" in
    completed|failed|cancelled) break ;;
  esac
  sleep 2
done
```

A working run reaches `status: "completed"` and exposes a `nodeStates` map with one `completed` entry per step. If `status` ends in `failed`, inspect the matching node entry in `nodeStates` for the underlying error.

## Next

- [Workflows: loops, blob storage, React hooks](./workflows-advanced.md): repeat-until-done loops, large-artifact storage, and React progress hooks
- [Multi-agent](./multi-agent.md): compose agents in workflows and tools
- [Providers](./providers.md): configure the LLM providers that power your agents

## Related

- [`veryfront/workflow`](../api-reference/veryfront/workflow.md): workflow API reference
