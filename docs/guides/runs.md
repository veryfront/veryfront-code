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
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "dreamy-haven",
});
```

If you are already running inside a Veryfront request context, the client can
also pick up request-scoped auth and project context automatically.

Client configuration is captured when the client is constructed. Later
mutation of the configuration object does not change its URL, credentials,
project, or retry policy. An explicit API URL must be an absolute HTTP(S) base
URL without embedded credentials, a query, or a fragment.

For an application that serves more than one project or credential, derive an
isolated client instead of mutating one shared client:

```ts
const projectRuns = runs.withRequestContext({
  authToken: requestCredential,
  projectReference: requestProject,
});

const page = await projectRuns.list();
```

`setRequestToken()` and `setProjectReference()` remain available for backward
compatibility, but they mutate the client and are deprecated for concurrent
request handling.

## Input guarantees

The client validates request inputs before making a network call:

- IDs, cursors, names, and targets must be non-empty canonical strings.
- Pagination and retry-related counts must be safe integers in their valid
  ranges.
- `input` and `config` values must be bounded, acyclic, data-only JSON objects.
- Knowledge ingest selections must be non-empty.
- API response schemas validate timestamps, non-negative counters, and coherent
  runtime-target fields.

Invalid inputs fail locally and do not consume a retry attempt.

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

### Select a runtime target

Runtime target fields are validated as one coherent tuple:

| `runtimeTargetKind` | Required identifier          | Other identifier   |
| ------------------- | ---------------------------- | ------------------ |
| `main_branch`       | None                         | Must be absent     |
| `environment`       | `runtimeTargetEnvironmentId` | Branch absent      |
| `preview_branch`    | `runtimeTargetBranchId`      | Environment absent |

For example:

```ts
await runs.createTaskRun({
  projectId: "22222222-2222-4222-8222-222222222222",
  target: "task:sync-data",
  runtimeTargetKind: "environment",
  runtimeTargetEnvironmentId: "44444444-4444-4444-8444-444444444444",
});
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

// Poll status until terminal
while (true) {
  const { status } = await runs.get(accepted.run.run_id);
  if (status === "completed" || status === "failed" || status === "cancelled") {
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}

// Read the canonical event stream
const events = await runs.events(accepted.run.run_id);
for (const entry of events.data) {
  console.log(entry);
}
```

A working setup ends with `status: "completed"` and an event log whose entries
describe the run.
