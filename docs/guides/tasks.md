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
interface TaskDefinition {
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
  schedulable?: boolean;
  run: (ctx: TaskContext) => Promise<unknown> | unknown;
}
```

| Field                     | Required | Description                                      |
| ------------------------- | -------- | ------------------------------------------------ |
| `name`                    | No       | Human-readable name                              |
| `description`             | No       | What the task does                               |
| `inputSchema`             | No       | JSON-schema-like input contract for APIs and UIs |
| `outputSchema`            | No       | JSON-schema-like output contract                 |
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
  projectId?: string;
  environmentId?: string;
  signal?: AbortSignal;
}
```

- **`env`**: filtered environment variables (use `envAllowlist` to restrict)
- **`config`**: run configuration (passed when run in the cloud)
- **`projectId`**: project identifier (available in cloud context)
- **`environmentId`**: runtime-target environment identifier, when selected
- **`signal`**: optional cooperative cancellation signal

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

See [Runs](./runs.md) for run creation and event monitoring.

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
