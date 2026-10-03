---
title: "Runs"
description: "Run project-scoped task, workflow, and eval definitions through the Veryfront platform."
order: 31
---

Veryfront runs are durable, project-scoped executions. Tasks, workflows, and
evals are definitions. A run is what executes one of those definitions.

- A **task run** executes a `task:<task-id>` target.
- A **workflow run** executes a `workflow:<workflow-id>` target.
- An **eval run** executes the built-in `task:eval` target with its
  `eval:<eval-id>` definition ID in `config.eval_id`.
- A **target** names the capability being executed, for example
  `task:knowledge-ingest`, `workflow:content-pipeline`, or `task:eval`.
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

## Run input and output

`input` on task, workflow and eval runs is any JSON value: an object, an
array, a string, a number, a boolean or `null`. A task reads it as
`ctx.input` and its execution settings as `ctx.config`. A task run created
without `input`, or with `input: null`, gives the task `ctx.input` equal to
`ctx.config`, so tasks that read business data from `config` keep working. A
task that needs a nullable input should wrap it, for example
`{ "value": null }`.

```ts
await runs.createTaskRun({
  projectId: "22222222-2222-4222-8222-222222222222",
  target: "task:classify-ticket",
  input: ["INV-7731", "Harbor Office"],
  config: { urgent: true },
});
```

A run's `input` and `output` read back as the same JSON values. When the
target declares an input or output schema, the run also carries
`input_schema_sha256` and `output_schema_sha256`: the sha256 of the canonical
JSON Schema it was admitted against. They are `null` when the target declares
no schema, and absent on API versions that predate them.

See [Run input and output](./run-input-output.md) for what each run kind
stores, declared schemas, rejected input, `null` output, and JSON
serialization.

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
});
```

The deprecated `startMode` option remains accepted for source compatibility,
but task-based eval runs ignore it.

`createEvalRun()` sends a task run with target `task:eval` and places the
provided eval target in `config.eval_id`. Direct `POST /runs` callers should use
the same shape. New `kind: "eval"` requests are rejected. Runs created before
this change with kind `eval` remain available through read and list APIs.

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

### Output size limit

A run's final `output` is capped at 1,048,576 bytes (1 MiB), measured as the
UTF-8 byte length of its JSON serialization. Exactly 1 MiB is stored unchanged.
A successful task, workflow, or agent result over the limit is never truncated.
The run ends `failed` with `output: null` and this error:

```json
{
  "code": "OUTPUT_TOO_LARGE",
  "message": "Run output is 1048577 bytes, over the limit of 1048576 bytes",
  "detail": { "size_bytes": 1048577, "limit_bytes": 1048576 }
}
```

If execution has already failed, its original error is preserved and any
oversized result attached to that failure is discarded.

The runtime checks task and workflow results before it sends them, so an
oversized result never leaves the runtime. The Veryfront API applies the same
limit when it stores any run's final output, including agent runs.

A delegating agent still receives a compact summary of a child run's result,
not the child's full output. The `summary` and `structured` modes limit returned
text to 64,000 characters, including the truncation marker. To return more data, write it somewhere durable
and return a reference to it.

## List project runs

```ts
const page = await runs.list({ limit: 50 });
console.log(page.data.map((run) => run.run_id));
```

## Typed Runs contract SDK

`veryfront/runs/target` publishes the typed SDK for the Runs target contract that
the npm package pins. It has one method per contract operation, and its request
and response types come from that pinned contract. The SDK sends every request
through the canonical Veryfront API transport from `createRunsApiTransport`,
which owns the origin, credentials, retries, body limits and telemetry. Set
`authMode: "api-key"` to send a project API key as `X-API-Key`. The legacy client at
`veryfront/runs` stays available until consumers switch over.

```ts
import {
  createRunsApiTransport,
  createRunsSdk,
  type RunsContractComponents,
  type RunsOutput,
} from "veryfront/runs/target";

const sdk = createRunsSdk({
  transport: createRunsApiTransport({
    baseUrl: "https://api.veryfront.com",
    getToken: () => process.env.VERYFRONT_API_TOKEN!,
  }),
});

const run: RunsOutput<"getRun"> = await sdk.getRun({
  path: { run_id: "11111111-1111-4111-8111-111111111111" },
});
const children = await sdk.listRunChildRuns({ path: { run_id: run.id } });
for await (const frame of sdk.streamRunEvents({ path: { run_id: run.id } })) {
  console.log(frame.id, frame.event);
}

type Run = RunsContractComponents["schemas"]["Run"];
```

The package ships the pinned contract as TypeScript types, not runtime
validators. An app that consumes the SDK at its own boundary uses these types
instead of copying the contract, for example `RunsOutput<"getRun">` or
`RunsContractComponents["schemas"]["Run"]`. If it also validates responses at
runtime, it types each validator against them. Then a contract change that
removes or retypes a field fails to compile. A new optional field still
compiles, so update the validator when the pinned contract changes. Error
responses reject with a `VeryfrontError`, and `runsProblemOf(error)` returns the
RFC 9457 problem body.

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
