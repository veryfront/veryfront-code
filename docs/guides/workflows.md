---
title: "Workflows"
description: "DAG-based multi-step workflows with branching and parallelism."
order: 26
---

A workflow is a file in `workflows/` that declares ordered steps. Each step runs an agent or a tool. The workflow runtime passes outputs between steps.

Use workflows for multi-step work that needs ordering, branching, parallelism, retries, timeouts, or approvals.

Workflow files are definitions. Starting a workflow creates a workflow run. On
the Veryfront platform, that workflow run is backed by a runtime adapter so it can be
queued, retried, canceled, logged, and observed in the Runs panel.

| Concept         | Meaning                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Workflow        | The definition stored in `workflows/`.                                                                   |
| Workflow run    | The canonical public execution record for a started workflow.                                            |
| Runtime adapter | The implementation detail that dispatches the workflow run to a runtime target or infrastructure worker. |
| Schedule        | A trigger definition that creates workflow runs over time when its target starts with `workflow:`.       |

## Prerequisites

- A Veryfront project with the `workflows/` directory available (see
  [Create project](../getting-started/create-project.md)).
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
  integrationRequirements: [{
    integration: "slack",
    requiredScopes: ["channels:read"],
    resources: [{ kind: "channel", id: "C012345" }],
  }],
  steps: [
    step("research", { agent: "researcher" }),
    step("write", { agent: "writer" }),
    step("review", { agent: "editor" }),
  ],
});
```

Steps run in order. Each step's output is available to the next step via the workflow context.
Use `integrationRequirements` only for explicit access that scheduled workflow
runs require. Veryfront does not infer integration requirements from workflow
steps, nested workflows, agents, tools, or source text.

### Nested workflows

When using `subWorkflow`, child node IDs are scoped to that sub-workflow while
the run is executing. A child ID must not collide with a node ID in an enclosing
workflow. Keep sibling sub-workflows' child IDs distinct as well; completed child
state is retained for resuming the owning sub-workflow and is never reused by a
different sibling.

## Workflow context persistence

Workflow context must be JSON-representable. Veryfront stores suspended workflow
runs as JSON, and the memory backend applies the same persistence contract as
durable backends so local development and production read back the same values.

Use plain JSON values in step output: strings, numbers, booleans, null, arrays,
and plain objects. Values that JSON cannot encode, such as `BigInt` or circular
references, fail persistence with a redacted context path. Veryfront keeps the
fixed `input` and `step` structure and array indices, but replaces runtime
object keys with `<redacted>` so payload identifiers do not enter logs.

Some JavaScript values can be stored only after JSON rewrites them. By default,
Veryfront logs a warning and persists the normalized JSON value:

| Value written to context | Value read back from context        |
| ------------------------ | ----------------------------------- |
| `new Date(0)`            | `"1970-01-01T00:00:00.000Z"`        |
| `new Map([["a", 1]])`    | `{}`                                |
| `{ missing: undefined }` | `{}`                                |
| `Number.NaN`             | `null`                              |
| Class instance           | Plain object with enumerable fields |

On edge hosts that cannot identify proxies without invoking project hooks,
default mode still warns for built-ins that Veryfront can identify from native
slots. It cannot safely distinguish every class instance from a proxy-backed
plain object, so use `strictContext` when persistence must reject every value
whose identity cannot be verified.

Enable `strictContext` on a built-in backend to reject these lossy values
instead of warning and normalizing:

```ts
import { MemoryBackend, RedisBackend } from "veryfront/workflow";

const backend = new MemoryBackend({ strictContext: true });
const durableBackend = new RedisBackend({ url: Deno.env.get("REDIS_URL")!, strictContext: true });
```

## Start a workflow

Define workflows in `workflows/`, then start them from the surface that owns the user or system event.

| Start point | Use when                                       |
| ----------- | ---------------------------------------------- |
| API route   | A user action or webhook starts the run.       |
| Agent tool  | An agent decides whether to start the run.     |
| Task        | Background work starts the run.                |
| Client UI   | The UI calls an API route that starts the run. |

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
  -H "Cookie: __Host-vf_csrf=local-check" \
  -H "x-csrf-token: local-check" \
  -d '{"topic":"AI agents"}'
```

The route returns the workflow run ID:

```json
{ "runId": "run_..." }
```

Inside an agent tool, start the workflow from `execute`:

```ts
// tools/start-content-workflow.ts
import { getAgent, getAllAgentIds } from "veryfront/agent";
import { defineSchema } from "veryfront/schemas";
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
  inputSchema: defineSchema((v) =>
    v.object({
      topic: v.string().describe("Article topic"),
    })
  )(),
  execute: async ({ topic }) => {
    const handle = await workflows.start("content-pipeline", { topic });
    return { runId: handle.runId };
  },
});
```

Use `handle.result()` only when the caller should wait for completion. Return the `runId` when the workflow can continue in the background.

`handle.result()` polls the run and resolves with the workflow output once the
run completes. It throws a timeout error if the run has not reached a terminal
state after 5 minutes. Set the `resultWaitTimeout` executor option, in
milliseconds, on `createWorkflowClient` to change that limit.

## Schedule a workflow

Use a schedule with a `workflow:<workflow-id>` target when a workflow must run on a schedule. See [Runs](./runs.md) for run creation and event monitoring.

Each scheduled trigger creates a workflow run backed by the selected runtime adapter.

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

### Structured approval responses

Set `responseSchema` when the decision must carry structured data, such as a
selected option or an edited value:

```ts
// workflows/publish.ts
import { defineSchema } from "veryfront/schemas";
import { step, waitForApproval, workflow } from "veryfront/workflow";

export default workflow({
  id: "publish",
  steps: [
    step("draft", { agent: "writer" }),
    waitForApproval("editor-review", {
      message: "Review the draft and choose a channel.",
      responseSchema: defineSchema((v) =>
        v.object({
          channel: v.string().describe("Publish channel"),
        })
      )(),
    }),
    step("publish", {
      tool: "publisher",
      input: (ctx) => ctx["editor-review"],
    }),
  ],
});
```

Submit the decision through the workflow client. The structured answer is the
fifth argument to `approve()` and `reject()`, after the optional comment:

```ts
const [pending] = await workflows.getPendingApprovals(runId);

await workflows.approve(runId, pending.id, "editor@example.com", "Ship it", {
  channel: "blog",
});
```

The submitted `data` is validated against the wait node's `responseSchema`
before it is persisted. A non-conformant answer is refused with an error and
the approval stays pending. Validation only covers wait nodes declared in a
static step list. When a workflow's `steps`, or the `steps` of a nested loop,
is a function, the node list depends on runtime state, so no schema can be
resolved for the decision and the answer is accepted unvalidated. After
approval, the decision lands in the workflow context under the wait node's id,
so later steps read `ctx["editor-review"]` as
`{ approved, approver, comment, data, decidedAt }`.

The approval endpoint served by `createWorkflowHandler` accepts a JSON body of
the shape `{ approved, approver, comment?, data? }`. The body-level `approver`
is compatibility input, not an identity claim. The handler replaces it with
the authenticated identity returned by its server-side `authorize` callback,
and that server-derived identity is what the workflow context persists. See
[Workflows: advanced](./workflows-advanced.md) for the handler routes.

### Wait for events

Pause until an external event arrives, and deliver the event through the
workflow client. The run resumes as soon as an event with the matching name
reaches its mailbox:

```ts
import { tool } from "veryfront/tool";
import { createWorkflowClient, dependsOn, step, waitForEvent, workflow } from "veryfront/workflow";

const fulfillment = tool<
  { orderId: string },
  { orderId: string; status: "fulfilled" }
>({
  id: "fulfillment",
  description: "Fulfill a paid order",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string" } },
    required: ["orderId"],
    additionalProperties: false,
  },
  execute: async ({ orderId }) => ({ orderId, status: "fulfilled" }),
});

const workflows = createWorkflowClient();

workflows.register(workflow({
  id: "order-fulfillment",
  steps: [
    waitForEvent("payment-confirmed", {
      eventName: "payment.completed",
      timeout: "1h",
    }),
    dependsOn(
      step("fulfill", { tool: fulfillment, input: { orderId: "ord_1" } }),
      "payment-confirmed",
    ),
  ],
}));

const handle = await workflows.start("order-fulfillment", { orderId: "ord_1" });
const runId = handle.runId;

// Later - from a webhook handler or any process sharing the same backend:
await workflows.publishEvent(runId, "payment.completed", { amount: 4200 });
```

Events are buffered per run, so publishing before the node parks is safe: the
wait consumes the buffered event as soon as it exists. `publishEvent` resolves
to what it did with the event:

| Outcome             | Meaning                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"delivered"`       | A wait matched, its node completed, and the run moved on.                                                                                                                                              |
| `"buffered"`        | No wait matched yet. The event is held until one does.                                                                                                                                                 |
| `"run-terminal"`    | The run has already finished, so the event was discarded rather than buffered.                                                                                                                         |
| `"delivery-failed"` | A wait matched but delivery failed. Both were rolled back, so the run is still parked; call `retryEventDelivery(runId, eventName)` to retry the same buffered envelope without publishing a duplicate. |

A run's mailbox holds a bounded number of unconsumed events. Because an event
is removed only when a wait takes it, none of them can be dropped safely, so a
publish past the bound rejects rather than silently discarding an event some
wait has not parked for yet. Reaching that bound means events are being
published to a run that never consumes them.

The payload lands in the workflow context under the wait node's id, so later
steps read `ctx["payment-confirmed"]` as `{ eventName, payload, receivedAt }`.

Read what a run is parked on with `getPendingEventWaits(runId)`, which returns
the node id, the event name, and the deadline derived from `timeout`.

A `timeout` is enforced. When it elapses before the event arrives, the run
fails with an error naming the node and the event it waited for. The deadline
is measured from when the wait node started. Omit `timeout` to wait
indefinitely. `delay(id, duration)` uses the same machinery and completes its
node once the duration elapses. Canceling a run resolves its pending event
waits, so a canceled run no longer reports itself as parked.

Durable event waits require a backend that implements them. The built-in
`MemoryBackend` does; `RedisBackend` does not currently implement the durable
event-wait method group. Use `hasEventWaitSupport(backend)` to check a custom
backend before relying on `waitForEvent` or `delay`.

`publishEvent` is run-scoped. There is no broadcast by workflow id.

## Workflow configuration

```ts
import { defineSchema } from "veryfront/schemas";
import { step, workflow } from "veryfront/workflow";

export default workflow({
  id: "pipeline",
  description: "Content generation pipeline",
  version: "1.0.0",
  inputSchema: defineSchema((v) =>
    v.object({
      topic: v.string().describe("Content topic"),
    })
  )(),
  outputSchema: defineSchema((v) =>
    v.object({
      article: v.string().describe("Generated article body"),
    })
  )(),
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

`createWorkflowClient()` stores runs in memory, private to the client that
started them. A second client, in another route file or the same file on a
later request, does not see them. Verify the run from the request that started
it, and add a persistent backend before reading run state from anywhere else.

Add a route that starts the workflow, waits for it, and reads the finished run
back through the same client:

```ts
// app/api/verify-content-workflow/route.ts
import { getAgent, getAllAgentIds } from "veryfront/agent";
import { toolRegistry } from "veryfront/tool";
import { createWorkflowClient } from "veryfront/workflow";
import contentPipeline from "../../../workflows/content-pipeline.ts";

const workflows = createWorkflowClient({
  executor: {
    stepExecutor: {
      agentRegistry: { get: getAgent, list: getAllAgentIds },
      toolRegistry,
    },
  },
});

workflows.register(contentPipeline);

export async function POST(request: Request) {
  const input = await request.json();
  const handle = await workflows.start("content-pipeline", input);
  await handle.settled();

  const run = await workflows.getRun(handle.runId);
  return Response.json({ status: run?.status, nodeStates: run?.nodeStates });
}
```

Call it:

```bash
curl -s http://localhost:3000/api/verify-content-workflow \
  -H "Content-Type: application/json" \
  -H "Cookie: __Host-vf_csrf=local-check" \
  -H "x-csrf-token: local-check" \
  -d '{"topic":"AI agents"}' \
  | jq '{status, nodes: (.nodeStates | to_entries | map({(.key): .value.status}))}'
```

A working run reaches `status: "completed"` and exposes a `nodeStates` map with one `completed` entry per step:

```json
{
  "status": "completed",
  "nodes": [{ "research": "completed" }, { "write": "completed" }, { "review": "completed" }]
}
```

If `status` ends in `failed`, inspect the matching node entry in `nodeStates` for the underlying error.

To read run state from a different request (a status endpoint, a dashboard, or
the `useWorkflow` hook), give every client the same persistent backend, such as
`RedisBackend`, instead of the default in-memory one. Run state written by one
in-memory client is not readable from any other.

## Remove old terminal workflow runs

Use `reapTerminalRuns` from a periodic maintenance process to delete old
completed, failed, and cancelled workflow runs. Waiting and active runs are
never eligible. The cutoff is exclusive, and each call deletes at most `limit`
runs. The sweep does not modify workflow definitions, schedules, tasks,
webhooks, or prompts.

Run the scheduler as one long-lived maintenance process. Before its first
start, stop every workflow worker. Restart the workers only after the initial
repair finishes, and keep this process running so every scheduled sweep reuses
the same backend.

```ts
import { reapTerminalRuns, RedisBackend } from "veryfront/workflow";

const redisUrl = Deno.env.get("REDIS_URL");
if (!redisUrl) throw new Error("Set REDIS_URL before running workflow retention");

const backend = new RedisBackend({ url: redisUrl });
const retentionAgeMs = 30 * 24 * 60 * 60 * 1000;
const sweepIntervalMs = 24 * 60 * 60 * 1000;

async function runSweep(): Promise<void> {
  const completedBefore = new Date(Date.now() - retentionAgeMs);
  while (true) {
    const result = await reapTerminalRuns(backend, {
      completedBefore,
      limit: 100,
    });
    if (!result.supported) {
      throw new Error("The configured workflow backend does not support terminal-run retention");
    }
    if (!result.hasMore) break;
  }
}

async function runScheduler(): Promise<never> {
  while (true) {
    await runSweep();
    await new Promise<void>((resolve) => setTimeout(resolve, sweepIntervalMs));
  }
}

try {
  await runScheduler();
} finally {
  await backend.destroy();
}
```

The backend verifies the run identity, terminal status, completion time, and
mutation revision in the same operation that deletes its state. A failed run
that starts retrying, or receives another state patch after the sweep reads it,
is retained. A failed run with accepted retry work still queued or pending is
not selected. In that case, or when Redis must resume bounded queue cleanup,
`hasMore` is `false` so the loop does not immediately reselect the refreshed
run. The next scheduled maintenance invocation can retry it. After deletion,
reads return the existing not-found result; this retention API does not create
tombstones.

Redis stores a completion-time index and reads at most `limit + 1` candidate
records per sweep without hydrating run input, output, or context. Completion
times use numeric Redis scores, so ordering stays chronological for every valid
JavaScript `Date`. One deletion script cleans at most 100 indexed stream
messages for a run, then defers final deletion if more remain. Each call
requests one run-key `SCAN` page with `COUNT 100` and reads at most 100 queue
entries during repair. Redis completes both repair cycles before
returning candidates. Once both finish, that backend instance queries the
completed index directly and does not restart repair between deletion batches.
A new backend instance performs its own bounded repair. The queue cycle uses a
fixed stream high-water mark, so current queue traffic does not keep the
one-time repair open forever.

Before a new Redis maintenance backend starts its first retention sweep,
stop every workflow worker. Run the repair until `hasMore` becomes `false`, then
restart workers on the version that provides retention and keep the maintenance
backend long-lived. Repeat this drain if you replace the maintenance backend.
The repair requeues Redis pending deliveries that the maintenance process does
not own, so running it beside active workers can duplicate their work. During
repair, `hasMore` can be `true` even when one sweep examines no eligible runs.
