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

const job = await jobs.knowledge.ingestByUploadIds({
  uploadIds: ["00000000-0000-0000-0000-000000000000"],
});

const events = await jobs.events(job.id);
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `CronJobSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L372) |
| `CronJobStatusSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L337) |
| `JobBatchResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L368) |
| `JobBatchSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L369) |
| `JobBatchStatusCountsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L367) |
| `JobEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L360) |
| `JobEventsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L361) |
| `JobKindSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L338) |
| `JobListItemSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L358) |
| `JobLogsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L362) |
| `JobResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L355) |
| `JobResultSummarySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L356) |
| `JobSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L357) |
| `JobStatusSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L336) |
| `JobTargetDefinitionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L370) |
| `JobTargetDefinitionsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L371) |
| `KnowledgeIngestBatchSourceSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L363) |
| `KnowledgeIngestBatchSourceWithMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L364) |
| `KnowledgeIngestFailedFileResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L345) |
| `KnowledgeIngestFileResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L341) |
| `KnowledgeIngestJobResultCountsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L351) |
| `KnowledgeIngestJobResultMetadataSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L348) |
| `KnowledgeIngestJobResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L354) |
| `KnowledgeIngestSkippedFileResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L342) |
| `PageInfoSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L340) |
| `PaginatedCronJobsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L373) |
| `PaginatedJobsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L359) |
| `ReservedJobTargetFamilySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L339) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createJobsClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L562) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontJobsClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L156) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateCronJobInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L104) |
| `CreateJobInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L68) |
| `CronJob` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L425) |
| `CronJobStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L377) |
| `Job` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L403) |
| `JobBatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L418) |
| `JobBatchResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L417) |
| `JobBatchStatusCounts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L416) |
| `JobEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L406) |
| `JobEventsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L407) |
| `JobKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L378) |
| `JobListItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L404) |
| `JobLogsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L408) |
| `JobResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L401) |
| `JobResultSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L402) |
| `JobStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L376) |
| `JobTargetDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L420) |
| `JobTargetDefinitionsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L421) |
| `KnowledgeIngestBatchSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L410) |
| `KnowledgeIngestBatchSourceWithMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L413) |
| `KnowledgeIngestByUploadIdsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L86) |
| `KnowledgeIngestByUploadPathsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L90) |
| `KnowledgeIngestByUploadPrefixInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L94) |
| `KnowledgeIngestFailedFileResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L389) |
| `KnowledgeIngestFileResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L383) |
| `KnowledgeIngestJobOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L78) |
| `KnowledgeIngestJobResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L398) |
| `KnowledgeIngestSkippedFileResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L386) |
| `ListBatchJobsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L98) |
| `ListCronJobsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L116) |
| `ListJobEventsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L62) |
| `ListJobsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L53) |
| `PaginatedCronJobsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L426) |
| `PaginatedJobsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L405) |
| `ProjectScopedOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L49) |
| `ReservedJobTargetFamily` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/schemas.ts#L379) |
| `UpdateCronJobInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L123) |
| `VeryfrontJobsClientConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/jobs/jobs-client.ts#L42) |

## Related

User guides:

- [jobs](../../guides/jobs.md): Schedule and run background jobs

Architecture:

- [09-jobs-and-tasks](../../architecture/09-jobs-and-tasks.md): Jobs and tasks runtime
