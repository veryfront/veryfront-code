---
title: "Jobs & Cron Jobs"
description: "Run project-scoped background work now or on a schedule through the Veryfront platform."
order: 15.5
---

# Jobs & Cron Jobs

Use Veryfront jobs for durable, project-scoped background work.

- A **job** runs once.
- A **cron job** runs on a schedule and creates jobs over time.
- A **target** is the named capability being executed.
- **events** are the canonical user-visible output stream.
- **logs** are raw debugging output.
- A **batch** groups related jobs together.

## How users create jobs

Today there are two main creation paths:

1. **Programmatic**: create jobs through the public REST API, MCP tools, or the `veryfront/jobs` SDK.
2. **Studio-first product flows**: some first-party features, such as knowledge ingestion, create jobs for you and then expose them in the Jobs panel.

Studio is not yet a general-purpose UI for authoring arbitrary custom job targets. If you want to create your own one-off jobs or cron jobs directly, the public SDK and API are the intended entry points.

## Setup

```ts
import { createJobsClient } from "veryfront/jobs";

const jobs = createJobsClient({
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "dreamy-haven",
});
```

If you are already running inside a Veryfront request context, the client can also pick up request-scoped auth and project context automatically.

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
    file_count: 1,
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

Use target discovery if you want to know what first-party contracts exist today:

```ts
const targets = await jobs.targets.list();

for (const definition of targets.data) {
  console.log(definition.target, definition.description);
}
```

This is the public source of truth for first-party target contracts such as `task:knowledge-ingest`.

## Work with batches

If one user action fans out into multiple related jobs, Veryfront can group them with a shared `batch_id`.

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
    file_count: 1,
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

Use the **SDK / API / MCP** when:

- you need to create jobs directly
- you need cron scheduling
- you are building automation or agent-driven project operations

## Related

- [`veryfront/jobs`](../reference/jobs.md) - API reference for the jobs client
- [CLI Knowledge Ingestion](./cli-knowledge-ingestion.md) - first-party knowledge ingestion flow that creates jobs
- [MCP Server](./mcp-server.md) - expose or consume programmatic automation through MCP
