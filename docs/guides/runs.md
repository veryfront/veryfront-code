---
title: "Runs"
description: "Run project-scoped task, workflow, and eval definitions through the Veryfront platform."
order: 31
---

Veryfront runs are durable, project-scoped executions. Tasks, workflows, and
evals are definitions. A run is what executes one of those definitions.

- A **task run** executes a `task:<task-id>` target.
- A **workflow run** executes a `workflow:<workflow-id>` target.
- An **eval run** executes an `eval:<eval-id>` target.
- A **target** names the capability being executed, for example
  `task:knowledge-ingest`, `workflow:content-pipeline`, or
  `eval:deep-research`.
- **events** are the canonical user-visible output stream.
- The run record stores the terminal execution shape directly: `target`,
  `input`, `config`, `output`, `error`, `logs`, `artifacts`, `duration_ms`,
  and `exit_code`.
- Runtime adapters such as process execution are implementation details.

## Prerequisites

- A Veryfront Cloud project and a `VERYFRONT_API_TOKEN`. Set
  `VERYFRONT_PROJECT_ID` or `VERYFRONT_PROJECT_SLUG` to identify the project
  (see [Configuration](./configuration.md)).
- A task, workflow, or eval definition the run should execute.

## Setup

Use the runs SDK for one-off task, workflow, and eval execution:

```ts
import { createRunsClient } from "veryfront/runs";

const runs = createRunsClient({
  authToken: "<TOKEN>",
  projectReference: "dreamy-haven",
});
```

If you are already running inside a Veryfront request context, the client can
also pick up request-scoped auth and project context automatically.

If one client serves concurrent requests, configure `requestIdentityProvider`
to return the current request's token and project reference together. The
legacy `setRequestToken()` and `setProjectReference()` methods are only safe on
a client that serves one request at a time.

Set bounded request lifecycles through `requestPolicy`:

```ts
const controller = new AbortController();
const boundedRuns = createRunsClient({
  authToken: "<TOKEN>",
  projectReference: "dreamy-haven",
  requestPolicy: {
    signal: controller.signal,
    timeoutMs: 10_000,
    totalTimeoutMs: 30_000,
    maxResponseBytes: 8 * 1024 * 1024,
  },
});
```

## Create a task run

```ts
const accepted = await runs.createTaskRun({
  projectId: "22222222-2222-4222-8222-222222222222",
  name: "Sync data",
  target: "task:sync-data",
  config: { batchSize: 100 },
});

console.log(accepted.run.run_id);
console.log(accepted.run.status);
```

## Create a workflow run

```ts
await runs.createWorkflowRun({
  projectId: "22222222-2222-4222-8222-222222222222",
  workflowId: "content-pipeline",
  target: "workflow:content-pipeline",
  input: { topic: "AI agents" },
});
```

## Create an eval run

```ts
await runs.createEvalRun({
  projectId: "22222222-2222-4222-8222-222222222222",
  target: "eval:deep-research",
  input: { dataset: "smoke" },
  config: { repetitions: 2 },
  startMode: "manual",
});
```

## Observe a run

Prefer `events()` for progress and user-visible activity:

```ts
const events = await runs.events(accepted.run.run_id);

for (const entry of events.data) {
  console.log(entry.event_id, entry.event_type, entry.payload);
}
```

Read the current run summary:

```ts
const run = await runs.get(accepted.run.run_id);
console.log(run.status);
console.log(run.output);
```

Cancel a non-terminal run:

```ts
await runs.cancel(accepted.run.run_id);
```

## List project runs

```ts
const page = await runs.list({ limit: 50 });
console.log(page.data.map((run) => run.run_id));
```

## Scheduling

Schedules are definitions that create runs later. One-time and cron-style
schedules belong to the platform scheduling API, not to task or workflow
definitions. Scheduler and runtime-adapter details stay behind the platform API.

## Verify it worked

After creating a run, watch its status and event stream:

```ts
const accepted = await runs.createTaskRun({
  projectId: "22222222-2222-4222-8222-222222222222",
  name: "Test run",
  target: "task:sync-data",
});
console.log("created", accepted.run.run_id);

// Poll status until terminal, with a fixed attempt budget.
let terminal = false;
for (let attempt = 0; attempt < 60; attempt++) {
  const { status } = await runs.get(accepted.run.run_id);
  if (status === "completed" || status === "failed" || status === "cancelled") {
    terminal = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
if (!terminal) {
  throw new Error("Run did not reach a terminal state within two minutes");
}

// Read the canonical event stream
const events = await runs.events(accepted.run.run_id);
for (const entry of events.data) {
  console.log(entry);
}
```

A working setup ends with `status: "completed"` and an event log whose entries
describe the run.
