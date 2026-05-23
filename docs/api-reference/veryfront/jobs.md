---
title: "veryfront/jobs"
description: "Jobs module for durable project-scoped background execution. Provides a public SDK surface for one-off jobs, cron jobs, batch summaries, job target discovery, and the canonical split between user-visible `events` and raw debugging `logs`. Task definitions run as job runs with `task:<task-id>` targets. Workflow definitions run as workflow runs with `workflow:<workflow-id>` targets and are backed by jobs for queueing and dispatch."
order: 13
---

Jobs module for durable project-scoped background execution. Provides a public SDK surface for one-off jobs, cron jobs, batch summaries, job target discovery, and the canonical split between user-visible `events` and raw debugging `logs`. Task definitions run as job runs with `task:<task-id>` targets. Workflow definitions run as workflow runs with `workflow:<workflow-id>` targets and are backed by jobs for queueing and dispatch.

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

const job = await jobs.knowledge.ingestByUploadIds({
  uploadIds: ["00000000-0000-0000-0000-000000000000"],
});

const events = await jobs.events(job.id);
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `CronJobSchema` | Zod schema for cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L400) |
| `CronJobStatusSchema` | Zod schema for cron job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L340) |
| `JobBatchResultSchema` | Zod schema for job batch result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L392) |
| `JobBatchSchema` | Zod schema for job batch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L394) |
| `JobBatchStatusCountsSchema` | Zod schema for job batch status counts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L390) |
| `JobEventSchema` | Zod schema for job event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L378) |
| `JobEventsResponseSchema` | Zod schema for job events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L380) |
| `JobKindSchema` | Zod schema for job kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L342) |
| `JobListItemSchema` | Zod schema for job list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L374) |
| `JobLogsResponseSchema` | Zod schema for job logs response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L382) |
| `JobResultSchema` | Zod schema for job result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L368) |
| `JobResultSummarySchema` | Zod schema for job result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L370) |
| `JobSchema` | Zod schema for job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L372) |
| `JobStatusSchema` | Zod schema for job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L338) |
| `JobTargetDefinitionSchema` | Zod schema for job target definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L396) |
| `JobTargetDefinitionsResponseSchema` | Zod schema for job target definitions response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L398) |
| `KnowledgeIngestBatchSourceSchema` | Zod schema for knowledge ingest batch source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L384) |
| `KnowledgeIngestBatchSourceWithMessageSchema` | Zod schema for knowledge ingest batch source with message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L386) |
| `KnowledgeIngestFailedFileResultSchema` | Zod schema for knowledge ingest failed file result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L354) |
| `KnowledgeIngestFileResultSchema` | Zod schema for knowledge ingest file result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L348) |
| `KnowledgeIngestJobResultCountsSchema` | Zod schema for knowledge ingest job result counts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L362) |
| `KnowledgeIngestJobResultMetadataSchema` | Zod schema for knowledge ingest job result metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L358) |
| `KnowledgeIngestJobResultSchema` | Zod schema for knowledge ingest job result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L366) |
| `KnowledgeIngestSkippedFileResultSchema` | Zod schema for knowledge ingest skipped file result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L350) |
| `PageInfoSchema` | Zod schema for page info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L346) |
| `PaginatedCronJobsResponseSchema` | Zod schema for paginated cron jobs response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L402) |
| `PaginatedJobsResponseSchema` | Zod schema for paginated jobs response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L376) |
| `ReservedJobTargetFamilySchema` | Zod schema for reserved job target family. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L344) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createJobsClient` | Create jobs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L602) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontJobsClient` | Implement veryfront jobs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L181) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateCronJobInput` | Input payload for create cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L127) |
| `CreateJobInput` | Input payload for create job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L87) |
| `CronJob` | Public API contract for cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L478) |
| `CronJobStatus` | Public API contract for cron job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L408) |
| `Job` | Public API contract for job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L443) |
| `JobBatch` | Public API contract for job batch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L468) |
| `JobBatchResult` | Result returned from job batch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L466) |
| `JobBatchStatusCounts` | Public API contract for job batch status counts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L464) |
| `JobEvent` | Event emitted for job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L449) |
| `JobEventsResponse` | Response payload for job events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L451) |
| `JobKind` | Public API contract for job kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L410) |
| `JobListItem` | Public API contract for job list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L445) |
| `JobLogsResponse` | Response payload for job logs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L453) |
| `JobResult` | Result returned from job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L439) |
| `JobResultSummary` | Public API contract for job result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L441) |
| `JobRuntimeTargetKind` | Runtime target for a job or cron job definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L77) |
| `JobRuntimeTargetOptions` | Runtime target fields accepted by job creation APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L80) |
| `JobStatus` | Public API contract for job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L406) |
| `JobTargetDefinition` | Definition for job target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L471) |
| `JobTargetDefinitionsResponse` | Response payload for job target definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L473) |
| `KnowledgeIngestBatchSource` | Public API contract for knowledge ingest batch source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L456) |
| `KnowledgeIngestBatchSourceWithMessage` | Message shape for knowledge ingest batch source with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L460) |
| `KnowledgeIngestByUploadIdsInput` | Input payload for knowledge ingest by upload IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L105) |
| `KnowledgeIngestByUploadPathsInput` | Input payload for knowledge ingest by upload paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L110) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L115) |
| `KnowledgeIngestFailedFileResult` | Result returned from knowledge ingest failed file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L425) |
| `KnowledgeIngestFileResult` | Result returned from knowledge ingest file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L417) |
| `KnowledgeIngestJobOptions` | Options accepted by knowledge ingest job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L97) |
| `KnowledgeIngestJobResult` | Result returned from knowledge ingest job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L435) |
| `KnowledgeIngestSkippedFileResult` | Result returned from knowledge ingest skipped file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L421) |
| `ListBatchJobsOptions` | Options accepted by list batch jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L120) |
| `ListCronJobsOptions` | Options accepted by list cron jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L139) |
| `ListJobEventsOptions` | Options accepted by list job events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L70) |
| `ListJobsOptions` | Options accepted by list jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L60) |
| `PaginatedCronJobsResponse` | Response payload for paginated cron jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L480) |
| `PaginatedJobsResponse` | Response payload for paginated jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L447) |
| `ProjectScopedOptions` | Options accepted by project scoped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L55) |
| `ReservedJobTargetFamily` | Public API contract for reserved job target family. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L412) |
| `UpdateCronJobInput` | Input payload for update cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L147) |
| `VeryfrontJobsClientConfig` | Configuration used by veryfront jobs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L47) |
