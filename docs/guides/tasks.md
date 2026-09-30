---
title: "Tasks"
description: "Define background task functions that can run locally or as cloud runs."
order: 30
---

Tasks are user-defined functions in `tasks/`. Run them locally with `veryfront task <name>` or in the cloud as task runs.

## Prerequisites

- A Veryfront project with the `tasks/` directory available (see
  [Create project](../getting-started/create-project.md)).
- For cloud execution: a `VERYFRONT_API_TOKEN` and a project reference
  (see [Configuration](./configuration.md)).

## Quick start

Create a task file:

```ts
// tasks/sync-data.ts
export default {
  name: "Sync external data",
  description: "Pull latest records from the external API",
  schedulable: true,

  async run(ctx) {
    const response = await fetch("https://api.example.com/records");
    const data = await response.json();
    return { synced: data.length };
  },
};
```

Run it locally:

```bash
veryfront task sync-data
```

## Task definition

A task file exports a `TaskDefinition` object as its default export:

```ts
import type { Schema } from "veryfront/extensions/schema";
import type { ScheduleIntegrationRequirementConfig } from "veryfront/schedule";
import type { TaskContext } from "veryfront/task";

interface TaskDefinition {
  name?: string;
  description?: string;
  inputSchema?: Schema<unknown> | Record<string, unknown>;
  outputSchema?: Schema<unknown> | Record<string, unknown>;
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
  schedulable?: boolean;
  run: (ctx: TaskContext) => Promise<unknown> | unknown;
}
```

| Field                     | Required | Description                                      |
| ------------------------- | -------- | ------------------------------------------------ |
| `name`                    | No       | Human-readable name                              |
| `description`             | No       | What the task does                               |
| `inputSchema`             | No       | Input contract, validated at run time            |
| `outputSchema`            | No       | Output contract, validated at run time           |
| `integrationRequirements` | No       | Integration access required by scheduled runs    |
| `schedulable`             | No       | Scheduling eligibility metadata for APIs and UIs |
| `run`                     | Yes      | The function to execute                          |

Use `integrationRequirements` when a scheduled task needs specific provider
scopes or resources before it can run:

```ts
export default {
  name: "Sync Slack channel",
  schedulable: true,
  integrationRequirements: [{
    integration: "slack",
    requiredScopes: ["channels:read"],
    resources: [{ kind: "channel", id: "C012345" }],
  }],
  async run(ctx) {
    return { ok: true };
  },
};
```

Veryfront reads this field from task metadata only. It does not infer
requirements from task source code.

## Task context

The `run` function receives a `TaskContext`:

```ts
interface TaskContext {
  env: Record<string, string>;
  config: Record<string, unknown>;
  input?: unknown;
  runId?: string;
  projectId?: string;
  environmentId?: string;
  signal?: AbortSignal;
}
```

- **`env`**: filtered environment variables (use `envAllowlist` to restrict)
- **`config`**: run configuration, meaning execution settings (passed when run
  in the cloud)
- **`input`**: business input submitted with the run as `request.input`. It can
  be any JSON value: an object, array, string, number, or boolean. When the
  run was created without input, or with `null` input, `ctx.input` falls back
  to `ctx.config`
- **`runId`**: public run identifier for platform-executed tasks. Derive a stable
  key for each external operation, such as `${ctx.runId}:charge-order`, to avoid
  collisions between different writes in one run. It is absent for local
  `veryfront task <name>` runs
- **`projectId`**: project identifier (available in cloud context)
- **`environmentId`**: runtime-target environment identifier, when selected
- **`signal`**: optional cooperative cancellation signal

Use `ctx.input` for the data a task works on and `ctx.config` for settings
that control how it runs. Tasks that read business data from `ctx.config`
keep working: a run created with only `config` sees the same object in
`ctx.input`. To move such a task to `ctx.input`, read `ctx.input` and create
new runs with `input` instead of `config`. See
[Run input and output](./run-input-output.md) for how the return value becomes
the run's output.

```ts
import type { TaskContext } from "veryfront/task";

export default {
  name: "Classify ticket",
  run(ctx: TaskContext) {
    const { ticketText } = ctx.input as { ticketText: string };
    return { category: ticketText.includes("invoice") ? "billing" : "other" };
  },
};
```

Reserved control variables are never copied into `ctx.env`: every variable
prefixed `TENANT_` and a fixed set of framework `VERYFRONT_` control keys (API
token, API URLs, project identity, branch ref, and the injected-payload
variable itself). Other project-defined `VERYFRONT_` names are not filtered
solely because of that prefix. Cloud project variables are carried through the
`VERYFRONT_TASK_ENV_JSON` payload and merged over visible host variables. That
payload must be a JSON object; if it is malformed, execution fails before the
task function runs instead of continuing with missing configuration.

`envAllowlist` applies to both visible host variables and injected project
variables. Without an allowlist, local tasks receive non-reserved host
variables; use an allowlist when a task should see only a minimal set.

When execution is tied to an HTTP request or another cancellable runtime,
Veryfront passes that cancellation signal through `ctx.signal`. A signal that
is already aborted prevents the task from starting. Long-running task code
should pass the signal to cancellable operations such as `fetch`; JavaScript
functions that ignore the signal cannot be forcibly terminated by the task
runner.

For project task runs, `timeout_seconds` defaults to 300 and bounds the whole
run from its first start, including any retry attempts. The runtime aborts
`ctx.signal` at the supplied deadline and reports a timeout even if the task
ignores the signal. The run fails with `RUN_TIMEOUT`. Code that ignores cancellation
can continue executing inside the runtime process after the response returns;
a timeout does not roll back side effects.

### Retries

A project task run is retried under its `backoff_limit` (default 3), so it
makes at most `backoff_limit + 1` attempts. Only two failures start another
attempt, after an exponential backoff:

- The runtime never started the task: the connection was refused, or the
  runtime answered HTTP 503 because it was shutting down and admitted no new
  work.
- The task threw `RetryableError`.

Any other thrown error fails the run at once. A network error after the
request was sent, or an HTTP 502 (a proxy also answers it when the runtime
stops mid-request), is never retried, because the task may already have run. No
retry starts when its backoff would pass the `timeout_seconds` deadline; the
run then fails with the last attempt's error. `ctx.attempt` is the 1-based
attempt number.

```ts
import { RetryableError, type TaskContext } from "veryfront/task";

export default {
  name: "Sync invoices",
  async run(ctx: TaskContext) {
    const response = await fetch("https://api.example.com/invoices", { signal: ctx.signal });
    if (response.status === 503) {
      throw new RetryableError(`Upstream unavailable on attempt ${ctx.attempt}`);
    }
    return await response.json();
  },
};
```

A retried task runs again from the start, so make its side effects safe to
repeat.

## Declared schemas

`inputSchema` and `outputSchema` accept a JSON Schema object or a schema from
`defineSchema`. The runtime validates against them once, when the task runs.
This release is the warning phase: only submitted `input` that violates
`inputSchema` fails. Every other mismatch is recorded on the run and logged
once as a warning, and the run behaves as before. The enforcement phase, which
fails those mismatches too, follows in a later release.

| Case                                                                                           | Result                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submitted `input` violates `inputSchema`                                                       | Fails. `run()` is never called. The run ends `failed` with `error.code: "INPUT_VALIDATION_FAILED"`, the validation errors in `error.detail`, and `output: null`. |
| Config-only run (no `input`) whose `config` violates `inputSchema`                             | Warns. `run()` receives `config` as before. `metadata.schema_violation.phase` is `"input"`.                                                                      |
| `run()` returns a value that violates `outputSchema`                                           | Warns. The run completes with the returned value unchanged as `output`. `metadata.schema_violation.phase` is `"output"`.                                         |
| A raw JSON Schema that no registered validator can compile, or an output validator that throws | Warns. The schema is not enforced and is never reported as enforced: `metadata.schema_violation.reason` is `"schema_uncompilable"`.                              |
| The execution result lacks the admitted output schema identity                                 | Warns. The platform, not the runtime, records it. The run completes. `metadata.schema_violation.phase` is `"identity"`.                                          |

When submitted `input` is valid, `run.input` keeps the submitted value and
`ctx.input` receives the parsed value, with schema defaults and transforms
applied. When the returned value is valid, `output` is the parsed value: a
`defineSchema` object schema drops keys it does not declare, with no warning,
so declare every key the output should keep. An invalid value is stored as
returned.
Validation applies to the value `run()` returns, before any output filtering
on reads. Access control and read filtering are unchanged.

A recorded mismatch has this shape. A run keeps the first mismatch detected,
with at most 20 errors:

```json
{
  "phase": "output",
  "reason": "invalid",
  "schema_sha256": "<64 hex characters>",
  "errors": [{ "path": "/confidence", "message": "must be number" }],
  "detected_at": "2026-09-30T00:00:00.000Z"
}
```

The runtime records `reason` `invalid` or `schema_uncompilable` for the
`input` and `output` phases. The platform records the `identity` phase, with
`reason` `identity_missing` or `identity_mismatch`, when it finalizes the run. Each run records `input_schema_sha256` and
`output_schema_sha256`: the lowercase sha256 hex of the canonical JSON Schema
(a `defineSchema` schema converted to JSON Schema, object keys sorted at every
depth, serialized without whitespace). A task without that schema records
`null`. Runs created before identities existed are never revalidated.

## Waiting on child runs

Tasks do not support durable child-dependency waiting. Using `await` inside
`run(ctx)` does not checkpoint the task or put its run into
`status: "waiting"` with `waiting_reason: "child_run"` and `waiting_on`.
Local awaiting is unchanged: the task runner awaits the function's returned
promise, but cannot resume that promise after a process restart.

## Discovery

Tasks are discovered automatically from the `tasks/` directory:

```text
tasks/
  sync-data.ts           → task ID: "sync-data"
  reports/weekly.ts      → task ID: "reports/weekly"
```

Canonical project-runtime discovery supports `.ts` and `.tsx` task modules.
The deprecated standalone `discoverTasks` helper also accepts `.js` and
`.jsx` and skips test files and `node_modules`. Task IDs preserve nested path
segments and use `/` on every supported operating system.

## Running tasks

### CLI

```bash
veryfront task sync-data
```

Task IDs come from files under `tasks/`.

### As a cloud run

Set `schedulable: true` when a task should be presented as eligible for
schedule targeting. Runs and schedules identify it with the same stable task
ID:

```ts
import { VeryfrontRunsClient } from "veryfront/runs";

const runs = new VeryfrontRunsClient({
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "my-project",
});

await runs.createTaskRun({
  projectId: "00000000-0000-4000-8000-000000000000",
  name: "Daily sync",
  target: "task:sync-data",
  config: { batchSize: 100 },
});
```

To send business input over REST, add `input` to the request next to `config`:

```bash
curl -X POST "$VERYFRONT_API_URL/runs" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"task","owner":{"kind":"project","id":"<PROJECT_ID>"},"request":{"target":"task:sync-data","input":{"since":"2026-01-01"},"config":{"batchSize":100}}}'
```

See [Runs](./runs.md) for run creation and event monitoring.

Task code can await a request or promise during its current process execution. Tasks do not expose
a durable child-run waiting contract: if a run must pause, survive process replacement, and resume
after independently durable child runs finish, define that orchestration as a workflow and use
`waitForRuns`.

## Verify it worked

Run the task locally first:

```bash
veryfront task sync-data
```

A passing task prints any `console.log` output, exits with status `0`, and
returns the value you returned from `run` as the final JSON line.

For cloud execution, create a run that targets the task and check Studio for
a `completed` status. See the verification block in [Runs](./runs.md) for the
SDK-driven check.
