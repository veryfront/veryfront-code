---
title: "Workflows: loops, blob storage, React hooks"
description: "Repeat steps based on conditions, store large workflow artifacts, and track workflow progress from a React client."
order: 26
---

Three patterns that reach past a single-pass DAG: looping until a condition is met, storing artifacts that are too large to thread through step inputs, and surfacing workflow progress in a React UI. Pick the section that matches what the base workflow can't do yet.

## Prerequisites

- A working workflow defined and runnable per [Workflows](./workflows.md).
- For React hooks: a client page that can render React components and an API route that matches the hook's `apiBase`.

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

`loop` checks the condition before each iteration. `doWhile` runs the body once before checking. `times` runs a fixed number of iterations. `map` runs the body once per item in an array.

## Blob storage

For large workflow artifacts (uploaded files, generated reports, intermediate datasets), configure `blobStorage` on the executor with a host-provided storage adapter. The public workflow export exposes the executor integration point. Storage implementations come from the host runtime: typical hosts wire S3, GCS, or Vercel Blob behind this adapter.

Without `blobStorage`, large values still flow through step inputs and outputs in memory, which becomes the bottleneck once individual artifacts exceed a few hundred kilobytes.

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

`useWorkflowStart` posts to `${apiBase}/${workflowId}/start`. `useWorkflow` subscribes to `${apiBase}/runs/${runId}` and keeps `status` and `nodeStates` in sync with the server's run state.

## Verify it worked

For loops, run the workflow with an input that triggers the loop condition (a low review score, an unfinished check, an array of URLs). The dev-server log shows the loop body executing once per iteration. The final run status reaches `completed` after the condition flips.

For blob storage, configure an adapter, run a workflow that writes a large artifact, and confirm the storage backend received it. The step output should reference a blob handle rather than the inline payload.

For React hooks, render the dashboard component above, click **Run Pipeline**, and confirm the status string moves through `running` to `completed` while individual `nodeStates` entries update.

## Next

- [Workflows](./workflows.md): core workflow API (define, run, branch, parallel, human approval)
- [Multi-agent](./multi-agent.md): compose agents in workflows and tools

## Related

- [`veryfront/workflow`](../reference/veryfront/workflow.md): workflow API reference
