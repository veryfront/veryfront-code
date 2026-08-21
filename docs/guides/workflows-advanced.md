---
title: "Workflows: loops, blob storage, React hooks"
description: "Repeat steps based on conditions, store large workflow artifacts, and track workflow progress from a React client."
order: 27
---

Three patterns that reach past a single-pass DAG: looping until a condition is
met, storing artifacts that are too large to thread through step inputs, and
surfacing workflow progress in a React UI. Pick the section that matches what
the base workflow can't do yet.

## Prerequisites

- A working workflow defined and runnable per [Workflows](./workflows.md).
- For React hooks: a client page that can render React components and an API
  route that matches the hook's `apiBase`.

## Loops

Repeat steps based on conditions:

```ts
import { delay, doWhile, loop, map, times } from "veryfront/workflow";

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

`loop` checks the condition before each iteration. `doWhile` runs the body once
before checking. `times` runs a fixed number of iterations. `map` runs the body
once per item in an array.

## Blob storage

For large workflow artifacts (uploaded files, generated reports, intermediate
datasets), configure `blobStorage` on the executor with a host-provided storage
adapter. The public workflow export exposes the executor integration point.
Storage implementations come from the host runtime: typical hosts wire S3, GCS,
or Vercel Blob behind this adapter.

Without `blobStorage`, large values still flow through step inputs and outputs
in memory, which becomes the bottleneck once individual artifacts exceed a few
hundred kilobytes.

## React hooks

Track workflow progress from the client when your app exposes workflow API
routes that match the hook's `apiBase`:

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
      <button onClick={() => start({ topic: "AI agents" })}>
        Run Pipeline
      </button>
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

`useWorkflowStart` posts to `${apiBase}/${workflowId}/start`. `useWorkflow`
subscribes to `${apiBase}/runs/${runId}` and keeps `status` and `nodeStates` in
sync with the server's run state.

### Serve the hook routes

Nothing serves those paths by default. Mount `createWorkflowHandler` on a
catch-all route to answer all of them at once:

```ts theme={null}
// app/api/workflows/[...path]/route.ts
import { createWorkflowHandler } from "veryfront/workflow";
import { workflows } from "../../../../lib/workflows.ts";

export const { GET, POST } = createWorkflowHandler(workflows);
```

Pass the same client the rest of the app starts workflows with. A client created
inside the route file would carry its own in-memory backend and would not see
those runs.

The handler covers every path the hooks call:

| Method        | Path                                   | Hook               |
| ------------- | -------------------------------------- | ------------------ |
| `POST`        | `/{workflowId}/start`                  | `useWorkflowStart` |
| `GET`         | `/runs`                                | `useWorkflowList`  |
| `GET`         | `/runs/{runId}`                        | `useWorkflow`      |
| `GET`         | `/runs/{runId}/events`                 | SSE clients        |
| `POST`        | `/runs/{runId}/cancel`                 | `useWorkflow`      |
| `POST`        | `/runs/{runId}/retry`                  | `useWorkflow`      |
| `GET`, `POST` | `/runs/{runId}/approvals/{approvalId}` | `useApproval`      |

Mounting somewhere else means telling both sides. Pass `basePath` to the handler
and the matching `apiBase` to every hook.

### Stream run events

Use the SSE route when a dashboard, operator, or CI client needs durable progress
without polling the run endpoint:

```ts
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function observeWorkflowRun(runId: string): EventSource {
  const events = new EventSource(`/api/workflows/runs/${runId}/events`);

  events.addEventListener("snapshot", (message) => {
    const run = JSON.parse((message as MessageEvent).data);
    console.log(run.status, run.nodeStates);
    if (TERMINAL_RUN_STATUSES.has(run.status)) events.close();
  });

  for (
    const name of [
      "step.started",
      "step.completed",
      "step.failed",
      "step.skipped",
      "run.status",
    ]
  ) {
    events.addEventListener(name, (message) => {
      const event = JSON.parse((message as MessageEvent).data);
      console.log(name, event);
      if (event.type === "run.status" && TERMINAL_RUN_STATUSES.has(event.status)) {
        events.close();
      }
    });
  }

  events.addEventListener("error", (event) => {
    if (event instanceof MessageEvent) {
      console.error(JSON.parse(event.data));
      events.close();
    }
  });

  return events;
}
```

The first frame is always `snapshot`. It uses the same public run projection as
`GET /runs/{runId}`. Later frames use these shapes:

| Event            | Data                                                                |
| ---------------- | ------------------------------------------------------------------- |
| `step.started`   | `{ type: "step.started", runId, nodeId, attempt }`                  |
| `step.completed` | `{ type: "step.completed", runId, nodeId, attempt }`                |
| `step.failed`    | `{ type: "step.failed", runId, nodeId, attempt, error? }`           |
| `step.skipped`   | `{ type: "step.skipped", runId, nodeId }`                           |
| `run.status`     | `{ type: "run.status", runId, status, error? }`                     |
| `error`          | `{ code: "workflow_observation_failed", message, retryable: true }` |

Top-level sequential nodes persist `running` before their side effect starts and
persist their settled state before dependents execute. Parallel nodes start as a
batch and settle after the batch joins. Top-level composites report their own
boundaries; synthetic child graphs do not replace the durable root state.

The same boundaries keep `currentNodes` on the run current. While a run is
`running` it names the batch in flight, so a run that stops making progress
shows which step it is on from its persisted state alone. While the run is
`waiting` it names the node the run is parked on, which can be a child of a
composite. It is empty once the run completes. A failed run keeps the nodes in
its terminal batch that failed or were still running. A cancelled run keeps the
last recorded value, so both terminal states still name where execution stopped.

A terminal snapshot closes immediately. A terminal `run.status` frame is the last
transition frame. Cancelling the response or aborting the request releases the
backend observation. An observation failure sends the sanitized `error` frame and
then closes.

Native `EventSource` reconnects automatically when a transport disconnects or a
successful SSE response reaches EOF. The helper calls `close()` for terminal runs
to avoid reconnecting to an already-finished run. A transport failure dispatches
a plain `Event`, which keeps the native reconnect behavior. The server's named
`error` frame dispatches a `MessageEvent`; the helper closes it so the caller can
decide when to retry from a fresh snapshot.

A new connection receives a fresh snapshot and future transitions. It does not
replay transitions that are already represented by that snapshot. A missing run
returns 404. A custom backend that does not implement atomic run observation
returns 501.

## Verify it worked

For loops, run the workflow with an input that triggers the loop condition (a
low review score, an unfinished check, an array of URLs). The dev-server log
shows the loop body executing once per iteration. The final run status reaches
`completed` after the condition flips.

For blob storage, configure an adapter, run a workflow that writes a large
artifact, and ensure the storage backend received it. The step output should
reference a blob handle rather than the inline payload.

For React hooks, mount the handler as shown above, render the dashboard
component, select **Run Pipeline**, and ensure the status string moves through
`running` to `completed` while individual `nodeStates` entries update. A status
that never leaves its initial value usually means the hook routes are not
mounted, so every poll is answering 404.
