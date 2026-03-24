---
title: "veryfront/jobs"
description: "Project-scoped jobs and cron jobs with events, logs, batches, and target discovery."
order: 13.5
---

# veryfront/jobs

Project-scoped jobs and cron jobs with events, logs, batches, and target discovery.

## Import

```ts
import { createJobsClient, VeryfrontJobsClient } from "veryfront/jobs";
```

## Examples

### Create a one-off job

```ts
import { createJobsClient } from "veryfront/jobs";

const jobs = createJobsClient({
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "dreamy-haven",
});

const job = await jobs.create({
  name: "Ingest 1 file",
  target: "task:knowledge-ingest",
  config: {
    file_count: 1,
    upload_ids: ["11111111-1111-4111-8111-111111111111"],
  },
});

const events = await jobs.events(job.id);
console.log(events.entries);
```

### Create a cron job

```ts
const cronJob = await jobs.cron.create({
  name: "Nightly knowledge sync",
  target: "task:knowledge-ingest",
  schedule: "0 2 * * *",
  timezone: "UTC",
  config: {
    file_count: 1,
    upload_ids: ["11111111-1111-4111-8111-111111111111"],
  },
});
```

## API

### `createJobsClient(config?)`

Create a project-scoped jobs client.

**Returns:** `VeryfrontJobsClient`

### `new VeryfrontJobsClient(config?)`

Instantiate the jobs client directly.

**Returns:** `VeryfrontJobsClient`

### `jobs.create(input)`

Create a one-off job.

**Returns:** `Promise<Job>`

### `jobs.list(options?)`

List jobs for a project.

**Returns:** `Promise<PaginatedJobsResponse>`

### `jobs.get(jobId, options?)`

Get a single job.

**Returns:** `Promise<Job>`

### `jobs.events(jobId, options?)`

Get canonical user-visible operational output for a job.

**Returns:** `Promise<JobEventsResponse>`

### `jobs.logs(jobId, options?)`

Get raw debugging logs for a job.

**Returns:** `Promise<JobLogsResponse>`

### `jobs.cancel(jobId, options?)`

Cancel a submitted or running job.

**Returns:** `Promise<Job>`

### `jobs.cron.create(input)`

Create a recurring cron job.

**Returns:** `Promise<CronJob>`

### `jobs.cron.list(options?)`

List cron jobs for a project.

**Returns:** `Promise<PaginatedCronJobsResponse>`

### `jobs.cron.get(cronJobId, options?)`

Get a single cron job.

**Returns:** `Promise<CronJob>`

### `jobs.cron.update(cronJobId, input)`

Update a cron job.

**Returns:** `Promise<CronJob>`

### `jobs.cron.delete(cronJobId, options?)`

Delete a cron job.

**Returns:** `Promise<CronJob>`

### `jobs.cron.trigger(cronJobId, options?)`

Trigger a cron job immediately, creating a job run.

**Returns:** `Promise<Job>`

### `jobs.batches.get(batchId, options?)`

Get an aggregate batch summary for related jobs.

**Returns:** `Promise<JobBatch>`

### `jobs.batches.listJobs(batchId, options?)`

List jobs in a specific batch.

**Returns:** `Promise<PaginatedJobsResponse>`

### `jobs.targets.list(options?)`

List reserved job target families and first-party target definitions.

**Returns:** `Promise<JobTargetDefinitionsResponse>`

### `jobs.targets.get(target, options?)`

Get one first-party target definition.

**Returns:** `Promise<JobTargetDefinition>`

## Type Reference

### `VeryfrontJobsClientConfig`

| Property | Type | Description |
| -------- | ---- | ----------- |
| `apiUrl?` | `string` | Base URL for the Veryfront API. Defaults to `VERYFRONT_API_URL` or the hosted API. |
| `authToken?` | `string` | Explicit auth token or API key. Defaults to request-scoped auth or `VERYFRONT_API_TOKEN`. |
| `projectReference?` | `string` | Project slug or ID used for project-scoped requests. Defaults to request-scoped project or `VERYFRONT_PROJECT_SLUG`. |
| `retry?` | `Partial<RetryConfig>` | Retry behavior for failed HTTP requests. |

### `CreateJobInput`

| Property | Type | Description |
| -------- | ---- | ----------- |
| `name` | `string` | Job name. |
| `target` | `string` | Job target, for example `task:knowledge-ingest`. |
| `environmentId?` | `string` | Optional environment scope. |
| `batchId?` | `string` | Optional batch grouping identifier. |
| `config?` | `Record<string, unknown>` | Target-specific configuration payload. |
| `timeoutSeconds?` | `number` | Optional timeout override. |
| `backoffLimit?` | `number` | Optional retry count override. |
| `projectReference?` | `string` | Optional per-call project override. |

### `CreateCronJobInput`

| Property | Type | Description |
| -------- | ---- | ----------- |
| `name` | `string` | Cron job name. |
| `target` | `string` | Job target, for example `task:knowledge-ingest`. |
| `schedule` | `string` | Five-field cron expression. |
| `timezone?` | `string` | Optional timezone. Defaults to `UTC`. |
| `environmentId?` | `string` | Optional environment scope. |
| `config?` | `Record<string, unknown>` | Target-specific configuration payload. |
| `timeoutSeconds?` | `number` | Optional timeout override. |
| `backoffLimit?` | `number` | Optional retry count override. |
| `concurrencyPolicy?` | `"Allow" \| "Forbid" \| "Replace"` | Cron overlap policy. |
| `projectReference?` | `string` | Optional per-call project override. |

## Exports

### Functions

| Name | Description |
| ---- | ----------- |
| `createJobsClient` | Create a project-scoped jobs client. |

### Classes

| Name | Description |
| ---- | ----------- |
| `VeryfrontJobsClient` | Public client for one-off jobs, cron jobs, batches, targets, events, and logs. |

### Types

| Name | Description |
| ---- | ----------- |
| `CreateCronJobInput` | Input shape for `jobs.cron.create()`. |
| `CreateJobInput` | Input shape for `jobs.create()`. |
| `CronJob` | Public cron job resource. |
| `Job` | Public one-off job resource. |
| `JobBatch` | Aggregate summary for related jobs. |
| `JobEventsResponse` | Canonical user-visible event stream. |
| `JobLogsResponse` | Raw debugging log response. |
| `JobTargetDefinition` | Public first-party target definition. |
| `PaginatedCronJobsResponse` | Paginated cron job list response. |
| `PaginatedJobsResponse` | Paginated job list response. |
| `VeryfrontJobsClientConfig` | Client configuration. |

## Related

- [Jobs & Cron Jobs](../guides/jobs.md) - guide for creating and observing jobs
- [`veryfront/workflow`](./workflow.md) - higher-level orchestration for application logic
- [`veryfront/mcp`](./mcp.md) - expose or consume jobs-related automation through MCP
