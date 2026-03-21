import { z } from "zod";

export const JobStatusSchema = z.enum([
  "submitted",
  "working",
  "completed",
  "failed",
  "canceled",
]);

export const CronJobStatusSchema = z.enum(["active", "paused", "deleting"]);
export const JobKindSchema = z.enum(["knowledge_ingest"]).nullable();

export const ReservedJobTargetFamilySchema = z.enum(["task:*", "workflow:*", "deploy:*"]);

export const PageInfoSchema = z.object({
  self: z.string().nullable(),
  first: z.literal(null),
  next: z.string().nullable(),
  prev: z.string().nullable(),
});

const JsonObjectSchema = z.record(z.unknown());
const KnowledgeIngestSkipReasonSchema = z.enum([
  "hidden_path",
  "ignored_directory",
  "unsupported_file_type",
]);
const KnowledgeIngestFailureReasonSchema = z.enum(["parser_error", "upload_error"]);

export const KnowledgeIngestFileResultSchema = z.object({
  source: z.string(),
  localSourcePath: z.string(),
  outputPath: z.string(),
  remotePath: z.string(),
  slug: z.string(),
  sourceType: z.string(),
  summary: z.string(),
  stats: JsonObjectSchema,
  warnings: z.array(z.string()),
});

export const KnowledgeIngestSkippedFileResultSchema = z.object({
  source: z.string(),
  localSourcePath: z.string().nullable(),
  reason: KnowledgeIngestSkipReasonSchema,
  message: z.string(),
});

export const KnowledgeIngestFailedFileResultSchema = z.object({
  source: z.string(),
  localSourcePath: z.string(),
  reason: KnowledgeIngestFailureReasonSchema,
  message: z.string(),
});

export const KnowledgeIngestJobResultMetadataSchema = z.object({
  requested_count: z.number().int().nonnegative(),
  source_mode: z.enum(["explicit_sources", "path_prefix"]),
  knowledge_path: z.string(),
});

export const KnowledgeIngestJobResultCountsSchema = z.object({
  requested_count: z.number().int().nonnegative(),
  ingested_count: z.number().int().nonnegative(),
  skipped_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
});

export const KnowledgeIngestJobResultSchema = z.object({
  kind: z.literal("knowledge_ingest"),
  version: z.literal(1),
  metadata: KnowledgeIngestJobResultMetadataSchema,
  summary: KnowledgeIngestJobResultCountsSchema,
  ingested: z.array(KnowledgeIngestFileResultSchema),
  skipped: z.array(KnowledgeIngestSkippedFileResultSchema),
  failed: z.array(KnowledgeIngestFailedFileResultSchema),
});

export const JobResultSchema = z
  .discriminatedUnion("kind", [
    KnowledgeIngestJobResultSchema,
    z.object({
      kind: z.literal("value"),
      value: z.unknown(),
    }),
    z.object({
      kind: z.literal("artifacts"),
      artifacts: z.array(z.unknown()),
    }),
  ])
  .nullable();

export const JobResultSummarySchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("knowledge_ingest"),
      state: z.enum(["success", "partial_success", "failed"]),
      requested_count: z.number().int().nonnegative(),
      ingested_count: z.number().int().nonnegative(),
      skipped_count: z.number().int().nonnegative(),
      failed_count: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal("value"),
    }),
    z.object({
      kind: z.literal("artifacts"),
      artifact_count: z.number().int().nonnegative(),
    }),
  ])
  .nullable();

const BaseJobSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  environment_id: z.string().uuid().nullable(),
  branch_id: z.string().uuid().nullable().optional().default(null),
  cron_job_id: z.string().uuid().nullable(),
  batch_id: z.string().uuid().nullable(),
  name: z.string(),
  status: JobStatusSchema,
  target: z.string(),
  config: JsonObjectSchema,
  context_id: z.string().uuid().nullable(),
  timeout_seconds: z.number(),
  backoff_limit: z.number(),
  exit_code: z.number().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const JobSchema = BaseJobSchema.extend({
  failed_reason: z.string().nullable().optional().default(null),
  kind: JobKindSchema.optional().default(null),
  failure_detail: z.string().nullable().optional().default(null),
  result_summary: JobResultSummarySchema.optional().default(null),
  result: JobResultSchema.optional().default(null),
});

export const JobListItemSchema = BaseJobSchema.extend({
  kind: JobKindSchema.optional().default(null),
  failure_detail: z.string().nullable().optional().default(null),
  result_summary: JobResultSummarySchema.optional().default(null),
});

export const PaginatedJobsResponseSchema = z.object({
  data: z.array(JobListItemSchema),
  page_info: PageInfoSchema,
});

export const JobEventSchema = z.object({
  timestamp: z.string(),
  level: z.string(),
  message: z.string(),
  service: z.string(),
  trace_id: z.string().optional(),
  request_id: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const JobEventsResponseSchema = z.object({
  entries: z.array(JobEventSchema),
  next_cursor: z.string().nullable(),
  stats: z.object({
    bytes_processed: z.number(),
    lines_processed: z.number(),
    query_time_ms: z.number(),
  }),
});

export const JobLogsResponseSchema = z.object({
  logs: z.string().nullable(),
});

export const KnowledgeIngestBatchSourceSchema = z.object({
  label: z.string(),
  path: z.string().nullable(),
  upload_id: z.string().uuid().nullable(),
  remote_path: z.string().nullable(),
  warning_count: z.number().int().nonnegative(),
});

export const JobBatchStatusCountsSchema = z.object({
  submitted: z.number().int().nonnegative(),
  working: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
});

export const JobBatchResultSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("knowledge_ingest"),
      total_count: z.number().int().nonnegative(),
      completed_count: z.number().int().nonnegative(),
      processing: z.array(KnowledgeIngestBatchSourceSchema),
      completed: z.array(KnowledgeIngestBatchSourceSchema),
      remaining: z.array(KnowledgeIngestBatchSourceSchema),
      remaining_label: z.enum(["Remaining Files", "Not Ingested Files"]),
    }),
  ])
  .nullable();

export const JobBatchSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  target: z.string().nullable(),
  job_count: z.number().int().nonnegative(),
  status_counts: JobBatchStatusCountsSchema,
  created_at: z.string(),
  updated_at: z.string(),
  result: JobBatchResultSchema,
});

export const JobTargetDefinitionSchema = z.object({
  target: z.string(),
  family: z.string(),
  description: z.string(),
  input_schema: JsonObjectSchema,
  output_schema: JsonObjectSchema.nullable(),
});

export const JobTargetDefinitionsResponseSchema = z.object({
  reserved_families: z.array(ReservedJobTargetFamilySchema),
  data: z.array(JobTargetDefinitionSchema),
});

export const CronJobSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  environment_id: z.string().uuid().nullable(),
  branch_id: z.string().uuid().nullable().optional().default(null),
  name: z.string(),
  status: CronJobStatusSchema,
  target: z.string(),
  schedule: z.string(),
  timezone: z.string(),
  config: JsonObjectSchema,
  timeout_seconds: z.number(),
  backoff_limit: z.number(),
  concurrency_policy: z.string(),
  last_scheduled_at: z.string().nullable(),
  last_successful_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const PaginatedCronJobsResponseSchema = z.object({
  data: z.array(CronJobSchema),
  page_info: PageInfoSchema,
});

export type JobStatus = z.infer<typeof JobStatusSchema>;
export type CronJobStatus = z.infer<typeof CronJobStatusSchema>;
export type JobKind = z.infer<typeof JobKindSchema>;
export type ReservedJobTargetFamily = z.infer<typeof ReservedJobTargetFamilySchema>;

export type KnowledgeIngestFileResult = z.infer<typeof KnowledgeIngestFileResultSchema>;
export type KnowledgeIngestSkippedFileResult = z.infer<
  typeof KnowledgeIngestSkippedFileResultSchema
>;
export type KnowledgeIngestFailedFileResult = z.infer<typeof KnowledgeIngestFailedFileResultSchema>;
export type KnowledgeIngestJobResultMetadata = z.infer<
  typeof KnowledgeIngestJobResultMetadataSchema
>;
export type KnowledgeIngestJobResultCounts = z.infer<typeof KnowledgeIngestJobResultCountsSchema>;
export type KnowledgeIngestJobResult = z.infer<typeof KnowledgeIngestJobResultSchema>;
export type JobResult = z.infer<typeof JobResultSchema>;
export type JobResultSummary = z.infer<typeof JobResultSummarySchema>;
export type Job = z.infer<typeof JobSchema>;
export type JobListItem = z.infer<typeof JobListItemSchema>;
export type PaginatedJobsResponse = z.infer<typeof PaginatedJobsResponseSchema>;
export type JobEvent = z.infer<typeof JobEventSchema>;
export type JobEventsResponse = z.infer<typeof JobEventsResponseSchema>;
export type JobLogsResponse = z.infer<typeof JobLogsResponseSchema>;

export type KnowledgeIngestBatchSource = z.infer<typeof KnowledgeIngestBatchSourceSchema>;
export type JobBatchStatusCounts = z.infer<typeof JobBatchStatusCountsSchema>;
export type JobBatchResult = z.infer<typeof JobBatchResultSchema>;
export type JobBatch = z.infer<typeof JobBatchSchema>;

export type JobTargetDefinition = z.infer<typeof JobTargetDefinitionSchema>;
export type JobTargetDefinitionsResponse = z.infer<typeof JobTargetDefinitionsResponseSchema>;

export type CronJob = z.infer<typeof CronJobSchema>;
export type PaginatedCronJobsResponse = z.infer<typeof PaginatedCronJobsResponseSchema>;
