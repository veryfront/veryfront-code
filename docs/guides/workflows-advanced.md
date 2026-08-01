---
title: "Workflows: loops, storage, React, and agent control"
description: "Repeat steps, store large workflow artifacts, track progress in React, and migrate bidirectional agent control."
order: 27
---

Patterns that reach past a single-pass DAG: looping until a condition is met,
storing large artifacts, surfacing workflow progress in React, and retaining
agent-control state safely across WebSocket reconnects. Pick the section that
matches what the base workflow can't do yet.

## Prerequisites

- A working workflow defined and runnable per [Workflows](./workflows.md).
- For React hooks: a client page that can render React components and an API
  route that matches the hook's `apiBase`.
- For bidirectional Claude Code control: a server route that can upgrade a
  request to a WebSocket and a terminal run callback that owns cleanup.

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

`BlobStorage.list` is an optional capability. `LocalBlobStorage` provides an
exhaustive list; `VeryfrontCloudBlobStorage` intentionally does not advertise
listing until the uploads API exposes a stable exhaustive pagination contract.
Feature-detect `list` rather than substituting an empty or partial result. Cloud
requests, uploads, and downloads use the configured positive `requestTimeout`
(30 seconds by default).

Without `blobStorage`, large values still flow through step inputs and outputs
in memory, which becomes the bottleneck once individual artifacts exceed a few
hundred kilobytes.

## React hooks

Track workflow progress from the client when your app exposes workflow API
routes that match the hook's `apiBase`:

```tsx
"use client";
import { useWorkflow, useWorkflowStart } from "veryfront/workflow/react";

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

## Migrate bidirectional Claude Code control

Use one `AgentControllerRegistry` for the lifetime of the server process or
worker that owns the runs. Pass it to `createWebSocketHandler`; callbacks now
receive an immutable registration containing the current publisher generation,
the stable run registration, and the run-scoped controller handle.

```ts
import {
  type AgentControllerHandle,
  AgentControllerRegistry,
  type AgentControllerRunRegistration,
  createWebSocketHandler,
} from "veryfront/workflow/claude-code";

const registry = new AgentControllerRegistry();
const liveRuns = new Map<string, AgentControllerRunRegistration>();
const controls = new Map<string, AgentControllerHandle>();

export const handleClaudeCodeSocket = createWebSocketHandler({
  registry,
  getRunId: (request) => new URL(request.url).searchParams.get("runId"),
  onConnection(registration) {
    liveRuns.set(registration.runId, registration.run);
    controls.set(registration.runId, registration.controller);
  },
  onClose(registration) {
    // The run may reconnect, so do not release it merely because this socket closed.
    controls.delete(registration.runId);
  },
});

export function finishRun(runId: string): void {
  const run = liveRuns.get(runId);
  if (!run) return;
  liveRuns.delete(runId);
  controls.delete(runId);
  registry.releaseRun(run);
}
```

Replace direct `AgentController` construction and manual publisher handler
cleanup with the registry. A replacement connection synchronously retires the
old publisher generation, so keep and pass the exact registration returned by
the registry rather than looking up by run ID during cleanup. Call
`registry.detach(registration)` only when manually detaching a current socket;
call `registry.releaseRun(registration.run)` only when the workflow run has
terminally ended. Close the registry during server or worker shutdown.

Approval decisions now require both correlation values exposed by the React
hook. Pass them through unchanged:

```tsx
{
  pendingApprovals.map((approval) => (
    <div key={approval.requestId}>
      <button onClick={() => approve(approval.toolCallId, approval.requestId)}>
        Approve
      </button>
      <button onClick={() => reject(approval.toolCallId, approval.requestId, "Not allowed")}>
        Reject
      </button>
    </div>
  ));
}
```

Do not remove a pending approval when a command is merely sent. The hook keeps
it until the server returns an accepted acknowledgement for the same run,
command, request, and tool-call identity; rejected or interrupted delivery can
then be retried safely.

## Verify it worked

For loops, run the workflow with an input that triggers the loop condition (a
low review score, an unfinished check, an array of URLs). The dev-server log
shows the loop body executing once per iteration. The final run status reaches
`completed` after the condition flips.

For blob storage, configure an adapter, run a workflow that writes a large
artifact, and confirm the storage backend received it. The step output should
reference a blob handle rather than the inline payload.

For React hooks, render the dashboard component above, select **Run Pipeline**,
and confirm the status string moves through `running` to `completed` while
individual `nodeStates` entries update.

For bidirectional control, connect a client, start an approval, disconnect, and
reconnect with the same run ID. Confirm the same `requestId` is replayed, a
callback captured from the retired connection is rejected, and the approval is
removed only after an accepted acknowledgement with the exact correlation.
After the run becomes terminal, call `releaseRun()` with the retained run
registration and confirm that no controller remains in the registry.
