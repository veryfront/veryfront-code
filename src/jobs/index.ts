/**
 * Jobs module for durable project-scoped background execution.
 *
 * Provides a public SDK surface for one-off jobs, cron jobs, batch summaries,
 * job target discovery, and the canonical split between user-visible `events`
 * and raw debugging `logs`.
 *
 * Task definitions run as job runs with `task:<task-id>` targets. Workflow
 * definitions run as workflow runs with `workflow:<workflow-id>` targets and
 * are backed by jobs for queueing and dispatch.
 *
 * @module
 *
 * @example
 * ```ts
 * import { VeryfrontJobsClient } from "veryfront/jobs";
 *
 * const jobs = new VeryfrontJobsClient({
 *   authToken: process.env.VERYFRONT_API_TOKEN,
 *   projectReference: "my-project",
 * });
 *
 * const job = await jobs.knowledge.ingestByUploadIds({
 *   uploadIds: ["00000000-0000-0000-0000-000000000000"],
 * });
 *
 * const events = await jobs.events(job.id);
 * ```
 */

export {
  type CreateCronJobInput,
  type CreateJobInput,
  createJobsClient,
  type KnowledgeIngestByUploadIdsInput,
  type KnowledgeIngestByUploadPathsInput,
  type KnowledgeIngestByUploadPrefixInput,
  type KnowledgeIngestJobOptions,
  type ListBatchJobsOptions,
  type ListCronJobsOptions,
  type ListJobEventsOptions,
  type ListJobsOptions,
  type ProjectScopedOptions,
  type UpdateCronJobInput,
  VeryfrontJobsClient,
  type VeryfrontJobsClientConfig,
} from "./jobs-client.ts";
export {
  type CronJob,
  CronJobSchema,
  type CronJobStatus,
  CronJobStatusSchema,
  type Job,
  type JobBatch,
  type JobBatchResult,
  JobBatchResultSchema,
  JobBatchSchema,
  type JobBatchStatusCounts,
  JobBatchStatusCountsSchema,
  type JobEvent,
  JobEventSchema,
  type JobEventsResponse,
  JobEventsResponseSchema,
  type JobKind,
  JobKindSchema,
  type JobListItem,
  JobListItemSchema,
  type JobLogsResponse,
  JobLogsResponseSchema,
  type JobResult,
  JobResultSchema,
  type JobResultSummary,
  JobResultSummarySchema,
  JobSchema,
  type JobStatus,
  JobStatusSchema,
  type JobTargetDefinition,
  JobTargetDefinitionSchema,
  type JobTargetDefinitionsResponse,
  JobTargetDefinitionsResponseSchema,
  type KnowledgeIngestBatchSource,
  KnowledgeIngestBatchSourceSchema,
  type KnowledgeIngestBatchSourceWithMessage,
  KnowledgeIngestBatchSourceWithMessageSchema,
  type KnowledgeIngestFailedFileResult,
  KnowledgeIngestFailedFileResultSchema,
  type KnowledgeIngestFileResult,
  KnowledgeIngestFileResultSchema,
  type KnowledgeIngestJobResult,
  KnowledgeIngestJobResultCountsSchema,
  KnowledgeIngestJobResultMetadataSchema,
  KnowledgeIngestJobResultSchema,
  type KnowledgeIngestSkippedFileResult,
  KnowledgeIngestSkippedFileResultSchema,
  PageInfoSchema,
  type PaginatedCronJobsResponse,
  PaginatedCronJobsResponseSchema,
  type PaginatedJobsResponse,
  PaginatedJobsResponseSchema,
  type ReservedJobTargetFamily,
  ReservedJobTargetFamilySchema,
} from "./schemas.ts";
