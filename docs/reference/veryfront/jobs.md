---
title: "veryfront/jobs"
description: "Jobs module for durable project-scoped background execution. Provides a public SDK surface for one-off jobs, cron jobs, batch summaries, job target discovery, and the canonical split between user-visible `events` and raw debugging `logs`."
order: 14
---

# veryfront/jobs

Jobs module for durable project-scoped background execution. Provides a public SDK surface for one-off jobs, cron jobs, batch summaries, job target discovery, and the canonical split between user-visible `events` and raw debugging `logs`.

## Import

```ts
import {
  createJobsClient,
  CronJobSchema,
  CronJobStatusSchema,
  JobBatchResultSchema,
  JobBatchSchema,
  JobBatchStatusCountsSchema,
} from "veryfront/jobs";
```

## Examples

```ts
import { VeryfrontJobsClient } from "veryfront/jobs";

const jobs = new VeryfrontJobsClient({
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "my-project",
});

const job = await jobs.create({
  name: "Ingest 1 file",
  target: "task:knowledge-ingest",
  config: {
    upload_ids: ["00000000-0000-0000-0000-000000000000"],
  },
});

const events = await jobs.events(job.id);
```

## Exports

### Components

| Name | Description |
|------|-------------|
| `CronJobSchema` |  |
| `CronJobStatusSchema` |  |
| `JobBatchResultSchema` |  |
| `JobBatchSchema` |  |
| `JobBatchStatusCountsSchema` |  |
| `JobEventSchema` |  |
| `JobEventsResponseSchema` |  |
| `JobKindSchema` |  |
| `JobListItemSchema` |  |
| `JobLogsResponseSchema` |  |
| `JobResultSchema` |  |
| `JobResultSummarySchema` |  |
| `JobSchema` |  |
| `JobStatusSchema` |  |
| `JobTargetDefinitionSchema` |  |
| `JobTargetDefinitionsResponseSchema` |  |
| `KnowledgeIngestBatchSourceSchema` |  |
| `KnowledgeIngestBatchSourceWithMessageSchema` |  |
| `KnowledgeIngestFailedFileResultSchema` |  |
| `KnowledgeIngestFileResultSchema` |  |
| `KnowledgeIngestJobResultCountsSchema` |  |
| `KnowledgeIngestJobResultMetadataSchema` |  |
| `KnowledgeIngestJobResultSchema` |  |
| `KnowledgeIngestSkippedFileResultSchema` |  |
| `PageInfoSchema` |  |
| `PaginatedCronJobsResponseSchema` |  |
| `PaginatedJobsResponseSchema` |  |
| `ReservedJobTargetFamilySchema` |  |

### Functions

| Name | Description |
|------|-------------|
| `createJobsClient` |  |

### Classes

| Name | Description |
|------|-------------|
| `VeryfrontJobsClient` |  |

### Types

| Name | Description |
|------|-------------|
| `CreateCronJobInput` |  |
| `CreateJobInput` |  |
| `CronJob` |  |
| `CronJobStatus` |  |
| `Job` |  |
| `JobBatch` |  |
| `JobBatchResult` |  |
| `JobBatchStatusCounts` |  |
| `JobEvent` |  |
| `JobEventsResponse` |  |
| `JobKind` |  |
| `JobListItem` |  |
| `JobLogsResponse` |  |
| `JobResult` |  |
| `JobResultSummary` |  |
| `JobStatus` |  |
| `JobTargetDefinition` |  |
| `JobTargetDefinitionsResponse` |  |
| `KnowledgeIngestBatchSource` |  |
| `KnowledgeIngestBatchSourceWithMessage` |  |
| `KnowledgeIngestFailedFileResult` |  |
| `KnowledgeIngestFileResult` |  |
| `KnowledgeIngestJobResult` |  |
| `KnowledgeIngestSkippedFileResult` |  |
| `ListBatchJobsOptions` |  |
| `ListCronJobsOptions` |  |
| `ListJobEventsOptions` |  |
| `ListJobsOptions` |  |
| `PaginatedCronJobsResponse` |  |
| `PaginatedJobsResponse` |  |
| `ProjectScopedOptions` |  |
| `ReservedJobTargetFamily` |  |
| `UpdateCronJobInput` |  |
| `VeryfrontJobsClientConfig` |  |

## Related

User guides:

- [jobs](../../guides/jobs.md): Schedule and run background jobs

Architecture:

- [20-jobs-and-tasks](../../architecture/20-jobs-and-tasks.md): Jobs and tasks runtime
