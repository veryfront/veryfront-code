---
title: "Jobs and cron jobs"
description: "Run project-scoped background work now or on a schedule through the Veryfront platform."
order: 21
---

# Jobs and cron jobs

Use Veryfront jobs for durable, project-scoped background work.

- A **job** runs once.
- A **cron job** runs on a schedule and creates jobs over time.
- A **target** is the named capability being executed.
- **events** are the canonical user-visible output stream.
- **logs** are raw debugging output.
- A **batch** groups related jobs together.

## Prerequisites

- A Veryfront Cloud project and a `VERYFRONT_API_TOKEN`. Set
  `VERYFRONT_PROJECT_ID` or `VERYFRONT_PROJECT_SLUG` to identify the project
  (see [Configuration](./configuration.md)).
- A task or other targetable capability the job should run (see
  [Tasks](./tasks.md)).

## How users create jobs

Users create jobs through two main paths:

1. **Programmatic**: create jobs through the public REST API or the `veryfront/jobs` SDK.
2. **Studio-first product flows**: some first-party features, such as knowledge
   ingestion, create jobs for you and then expose them in the Jobs panel.

Studio exposes jobs created by first-party product flows. Author custom one-off
jobs and cron jobs through the public SDK or API. For MCP access, wrap the jobs
client in your own tools.

## Setup

```ts
import { createJobsClient } from "veryfront/jobs";

const jobs = createJobsClient({
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "dreamy-haven",
});
```

If you are already running inside a Veryfront request context, the client can also pick up request-scoped auth and project context automatically.

Verify the connection before creating jobs:

```ts
const targets = await jobs.targets.list();
console.log(targets.data.map((target) => target.target));
```

This call is read-only and confirms that the token, project reference, and API endpoint resolve correctly.

## Create a one-off job

```ts
import { createJobsClient } from "veryfront/jobs";

const jobs = createJobsClient({
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "dreamy-haven",
});

const job = await jobs.create({
  name: "Ingest 1 file to knowledge base",
  target: "task:knowledge-ingest",
  config: {
    upload_ids: ["11111111-1111-4111-8111-111111111111"],
  },
});

console.log(job.id);
console.log(job.status);
```

## Observe a job

Prefer `events()` for progress and user-visible activity:

```ts
const events = await jobs.events(job.id);

for (const entry of events.entries) {
  console.log(entry.timestamp, entry.level, entry.message);
}
```

Use `logs()` only when you need raw debugging output:

```ts
const logs = await jobs.logs(job.id);
console.log(logs.logs);
```

## Inspect supported first-party targets

Use target discovery to list first-party contracts:

```ts
const targets = await jobs.targets.list();

for (const definition of targets.data) {
  console.log(definition.target, definition.description);
}
```

This is the public source of truth for first-party target contracts such as `task:knowledge-ingest`.
The `config` object is target-specific. Use target discovery to inspect the
fields the selected target accepts.

## Work with batches

If one user action fans out into multiple related jobs, Veryfront Code can group them with a shared `batch_id`.

```ts
const batch = await jobs.batches.get("22222222-2222-4222-8222-222222222222");
console.log(batch.job_count, batch.status_counts);

const batchJobs = await jobs.batches.listJobs(batch.id, { limit: 50 });
console.log(batchJobs.data.map((job) => job.name));
```

## Create a cron job

```ts
const cronJob = await jobs.cron.create({
  name: "Nightly knowledge sync",
  target: "task:knowledge-ingest",
  schedule: "0 2 * * *",
  timezone: "Europe/Stockholm",
  config: {
    upload_ids: ["11111111-1111-4111-8111-111111111111"],
  },
});

console.log(cronJob.id);
console.log(cronJob.schedule);
```

You can later inspect or update it:

```ts
const cronJob = await jobs.cron.get("33333333-3333-4333-8333-333333333333");
await jobs.cron.update(cronJob.id, { status: "paused" });
await jobs.cron.trigger(cronJob.id);
```

## Choosing between Studio and the API

Use **Studio** when:

- you are using a first-party flow that already creates jobs for you
- you want to inspect status, events, batches, and retries visually

Use the **SDK / API** when:

- you need to create jobs directly
- you need cron scheduling
- you are building automation or agent-driven project operations

## Verify it worked

After creating a job, watch its status and event stream:

```ts
const job = await jobs.create({ name: "Test job", target: "task:sync-data" });
console.log("created", job.id);

// Poll status until terminal
while (true) {
  const { status } = await jobs.get(job.id);
  if (status === "succeeded" || status === "failed") break;
  await new Promise((r) => setTimeout(r, 2000));
}

// Read the canonical event stream
const events = await jobs.events(job.id);
for (const entry of events.entries) {
  console.log(entry);
}
```

A working setup ends with `status: "succeeded"` and an event log whose
entries describe the run. The same job should also appear in Studio under
the jobs panel.

## Next

- [Tasks](./tasks.md): define background task functions
- [MCP server](./mcp-server.md): expose job operations through MCP tools

## Related

- [`veryfront/jobs`](../reference/veryfront/jobs.md): API reference for the jobs client
- [CLI-first knowledge ingestion](./cli-knowledge-ingestion.md): first-party knowledge ingestion flow that creates jobs
