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
  schedulable?: boolean;
  run: (ctx: TaskContext) => Promise<unknown> | unknown;
}
```

| Field          | Required | Description                                      |
| -------------- | -------- | ------------------------------------------------ |
| `name`         | No       | Human-readable name                              |
| `description`  | No       | What the task does                               |
| `inputSchema`  | No       | JSON-schema-like input contract for APIs and UIs |
| `outputSchema` | No       | JSON-schema-like output contract                 |
| `schedulable`  | No       | Whether it can be used as a schedule target      |
| `run`          | Yes      | The function to execute                          |

## Task context

The `run` function receives a `TaskContext`:

```ts
interface TaskContext {
  env: Record<string, string>;
  config: Record<string, unknown>;
  projectId?: string;
}
```

- **`env`**: filtered environment variables (use `envAllowlist` to restrict)
- **`config`**: run configuration (passed when run in the cloud)
- **`projectId`**: project identifier (available in cloud context)

## Discovery

Tasks are discovered automatically from the `tasks/` directory:

```
tasks/
  sync-data.ts           → task ID: "sync-data"
  reports/weekly.ts      → task ID: "reports-weekly"
```

File extensions `.ts`, `.tsx`, `.js`, `.jsx` are supported. Test files and `node_modules` are ignored.

## Running tasks

### CLI

```bash
veryfront task sync-data
```

Task IDs come from files under `tasks/`.

### As a cloud run

Tasks with `schedulable: true` can be targeted by runs and schedules:

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
