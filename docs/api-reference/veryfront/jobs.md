---
title: "veryfront/jobs"
description: "Durable background jobs, cron jobs, and task runs."
order: 13
---

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
| `CronJobSchema` | Zod schema for cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L399) |
| `CronJobStatusSchema` | Zod schema for cron job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L339) |
| `JobBatchResultSchema` | Zod schema for job batch result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L391) |
| `JobBatchSchema` | Zod schema for job batch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L393) |
| `JobBatchStatusCountsSchema` | Zod schema for job batch status counts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L389) |
| `JobEventSchema` | Zod schema for job event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L377) |
| `JobEventsResponseSchema` | Zod schema for job events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L379) |
| `JobKindSchema` | Zod schema for job kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L341) |
| `JobListItemSchema` | Zod schema for job list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L373) |
| `JobLogsResponseSchema` | Zod schema for job logs response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L381) |
| `JobResultSchema` | Zod schema for job result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L367) |
| `JobResultSummarySchema` | Zod schema for job result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L369) |
| `JobSchema` | Zod schema for job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L371) |
| `JobStatusSchema` | Zod schema for job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L337) |
| `JobTargetDefinitionSchema` | Zod schema for job target definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L395) |
| `JobTargetDefinitionsResponseSchema` | Zod schema for job target definitions response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L397) |
| `KnowledgeIngestBatchSourceSchema` | Zod schema for knowledge ingest batch source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L383) |
| `KnowledgeIngestBatchSourceWithMessageSchema` | Zod schema for knowledge ingest batch source with message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L385) |
| `KnowledgeIngestFailedFileResultSchema` | Zod schema for knowledge ingest failed file result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L353) |
| `KnowledgeIngestFileResultSchema` | Zod schema for knowledge ingest file result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L347) |
| `KnowledgeIngestJobResultCountsSchema` | Zod schema for knowledge ingest job result counts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L361) |
| `KnowledgeIngestJobResultMetadataSchema` | Zod schema for knowledge ingest job result metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L357) |
| `KnowledgeIngestJobResultSchema` | Zod schema for knowledge ingest job result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L365) |
| `KnowledgeIngestSkippedFileResultSchema` | Zod schema for knowledge ingest skipped file result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L349) |
| `PageInfoSchema` | Zod schema for page info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L345) |
| `PaginatedCronJobsResponseSchema` | Zod schema for paginated cron jobs response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L401) |
| `PaginatedJobsResponseSchema` | Zod schema for paginated jobs response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L375) |
| `ReservedJobTargetFamilySchema` | Zod schema for reserved job target family. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L343) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createJobsClient` | Create jobs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L601) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontJobsClient` | Implement veryfront jobs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L180) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateCronJobInput` | Input payload for create cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L126) |
| `CreateJobInput` | Input payload for create job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L86) |
| `CronJob` | Public API contract for cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L477) |
| `CronJobStatus` | Public API contract for cron job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L407) |
| `Job` | Public API contract for job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L442) |
| `JobBatch` | Public API contract for job batch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L467) |
| `JobBatchResult` | Result returned from job batch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L465) |
| `JobBatchStatusCounts` | Public API contract for job batch status counts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L463) |
| `JobEvent` | Event emitted for job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L448) |
| `JobEventsResponse` | Response payload for job events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L450) |
| `JobKind` | Public API contract for job kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L409) |
| `JobListItem` | Public API contract for job list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L444) |
| `JobLogsResponse` | Response payload for job logs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L452) |
| `JobResult` | Result returned from job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L438) |
| `JobResultSummary` | Public API contract for job result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L440) |
| `JobRuntimeTargetKind` | Runtime target for a job or cron job definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L76) |
| `JobRuntimeTargetOptions` | Runtime target fields accepted by job creation APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L79) |
| `JobStatus` | Public API contract for job status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L405) |
| `JobTargetDefinition` | Definition for job target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L470) |
| `JobTargetDefinitionsResponse` | Response payload for job target definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L472) |
| `KnowledgeIngestBatchSource` | Public API contract for knowledge ingest batch source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L455) |
| `KnowledgeIngestBatchSourceWithMessage` | Message shape for knowledge ingest batch source with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L459) |
| `KnowledgeIngestByUploadIdsInput` | Input payload for knowledge ingest by upload IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L104) |
| `KnowledgeIngestByUploadPathsInput` | Input payload for knowledge ingest by upload paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L109) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L114) |
| `KnowledgeIngestFailedFileResult` | Result returned from knowledge ingest failed file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L424) |
| `KnowledgeIngestFileResult` | Result returned from knowledge ingest file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L416) |
| `KnowledgeIngestJobOptions` | Options accepted by knowledge ingest job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L96) |
| `KnowledgeIngestJobResult` | Result returned from knowledge ingest job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L434) |
| `KnowledgeIngestSkippedFileResult` | Result returned from knowledge ingest skipped file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L420) |
| `ListBatchJobsOptions` | Options accepted by list batch jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L119) |
| `ListCronJobsOptions` | Options accepted by list cron jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L138) |
| `ListJobEventsOptions` | Options accepted by list job events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L69) |
| `ListJobsOptions` | Options accepted by list jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L59) |
| `PaginatedCronJobsResponse` | Response payload for paginated cron jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L479) |
| `PaginatedJobsResponse` | Response payload for paginated jobs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L446) |
| `ProjectScopedOptions` | Options accepted by project scoped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L54) |
| `ReservedJobTargetFamily` | Public API contract for reserved job target family. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L411) |
| `UpdateCronJobInput` | Input payload for update cron job. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L146) |
| `VeryfrontJobsClientConfig` | Configuration used by veryfront jobs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L46) |
