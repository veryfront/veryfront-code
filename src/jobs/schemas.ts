import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";

export const getJobStatusSchema = defineSchema((v) =>
  v.enum(
    [
      "submitted",
      "working",
      "completed",
      "failed",
      "canceled",
    ] as const,
  )
);

export const getCronJobStatusSchema = defineSchema((v) =>
  v.enum(["active", "paused", "deleting"] as const)
);

export const getJobKindSchema = defineSchema((v) =>
  v.enum(["knowledge_ingest"] as const).nullable()
);

export const getReservedJobTargetFamilySchema = defineSchema((v) =>
  v.enum(["task:*", "workflow:*", "deploy:*"] as const)
);

export const getPageInfoSchema = defineSchema((v) =>
  v.object({
    self: v.string().nullable(),
    first: v.literal(null),
    next: v.string().nullable(),
    prev: v.string().nullable(),
  })
);

// Internal helper schemas (not exported as getters)
const jsonObjectSchema = (v: SchemaValidator) => v.record(v.string(), v.unknown());

const knowledgeIngestSkipReasonSchema = (v: SchemaValidator) =>
  v.enum(
    [
      "hidden_path",
      "ignored_directory",
      "unsupported_file_type",
    ] as const,
  );

const knowledgeIngestFailureReasonSchema = (v: SchemaValidator) =>
  v.enum(["parser_error", "upload_error"] as const);

export const getKnowledgeIngestFileResultSchema = defineSchema((v) =>
  v.object({
    source: v.string(),
    localSourcePath: v.string(),
    outputPath: v.string(),
    remotePath: v.string(),
    slug: v.string(),
    sourceType: v.string(),
    summary: v.string(),
    stats: jsonObjectSchema(v),
    warnings: v.array(v.string()),
  })
);

export const getKnowledgeIngestSkippedFileResultSchema = defineSchema((v) =>
  v.object({
    source: v.string(),
    localSourcePath: v.string().nullable(),
    reason: knowledgeIngestSkipReasonSchema(v),
    message: v.string(),
  })
);

export const getKnowledgeIngestFailedFileResultSchema = defineSchema((v) =>
  v.object({
    source: v.string(),
    localSourcePath: v.string(),
    reason: knowledgeIngestFailureReasonSchema(v),
    message: v.string(),
  })
);

export const getKnowledgeIngestJobResultMetadataSchema = defineSchema((v) =>
  v.object({
    requested_count: v.number().int().nonnegative(),
    source_mode: v.enum(["explicit_sources", "path_prefix"] as const),
    knowledge_path: v.string(),
  })
);

export const getKnowledgeIngestJobResultCountsSchema = defineSchema((v) =>
  v.object({
    requested_count: v.number().int().nonnegative(),
    ingested_count: v.number().int().nonnegative(),
    skipped_count: v.number().int().nonnegative(),
    failed_count: v.number().int().nonnegative(),
  })
);

export const getKnowledgeIngestJobResultSchema = defineSchema((v) =>
  v.object({
    kind: v.literal("knowledge_ingest"),
    version: v.literal(1),
    metadata: getKnowledgeIngestJobResultMetadataSchema(),
    summary: getKnowledgeIngestJobResultCountsSchema(),
    ingested: v.array(getKnowledgeIngestFileResultSchema()),
    skipped: v.array(getKnowledgeIngestSkippedFileResultSchema()),
    failed: v.array(getKnowledgeIngestFailedFileResultSchema()),
  })
);

export const getJobResultSchema = defineSchema((v) =>
  v
    .discriminatedUnion("kind", [
      getKnowledgeIngestJobResultSchema(),
      v.object({
        kind: v.literal("value"),
        value: v.unknown(),
      }),
      v.object({
        kind: v.literal("artifacts"),
        artifacts: v.array(v.unknown()),
      }),
    ])
    .nullable()
);

export const getJobResultSummarySchema = defineSchema((v) =>
  v
    .discriminatedUnion("kind", [
      v.object({
        kind: v.literal("knowledge_ingest"),
        state: v.enum(["success", "partial_success", "failed"] as const),
        requested_count: v.number().int().nonnegative(),
        ingested_count: v.number().int().nonnegative(),
        skipped_count: v.number().int().nonnegative(),
        failed_count: v.number().int().nonnegative(),
      }),
      v.object({
        kind: v.literal("value"),
      }),
      v.object({
        kind: v.literal("artifacts"),
        artifact_count: v.number().int().nonnegative(),
      }),
    ])
    .nullable()
);

const getBaseJobSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    project_id: v.string().uuid(),
    environment_id: v.string().uuid().nullable(),
    branch_id: v.string().nullable().optional(),
    cron_job_id: v.string().uuid().nullable(),
    batch_id: v.string().uuid().nullable(),
    name: v.string(),
    status: getJobStatusSchema(),
    target: v.string(),
    config: jsonObjectSchema(v),
    context_id: v.string().uuid().nullable(),
    timeout_seconds: v.number(),
    backoff_limit: v.number(),
    exit_code: v.number().nullable(),
    started_at: v.string().nullable(),
    completed_at: v.string().nullable(),
    created_by: v.string().uuid().nullable(),
    created_at: v.string(),
    updated_at: v.string(),
  })
);

export const getJobSchema = defineSchema((_v) =>
  getBaseJobSchema().extend({
    failed_reason: _v.string().nullable().optional(),
    kind: getJobKindSchema().optional().default(null),
    failure_detail: _v.string().nullable().optional().default(null),
    result_summary: getJobResultSummarySchema().optional().default(null),
    result: getJobResultSchema().optional().default(null),
  })
);

export const getJobListItemSchema = defineSchema((_v) =>
  getBaseJobSchema().extend({
    kind: getJobKindSchema().optional().default(null),
    failure_detail: _v.string().nullable().optional().default(null),
    result_summary: getJobResultSummarySchema().optional().default(null),
  })
);

export const getPaginatedJobsResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getJobListItemSchema()),
    page_info: getPageInfoSchema(),
  })
);

export const getJobEventSchema = defineSchema((v) =>
  v.object({
    timestamp: v.string(),
    level: v.string(),
    message: v.string(),
    service: v.string(),
    trace_id: v.string().optional(),
    request_id: v.string().optional(),
    metadata: v.record(v.string(), v.string()).optional(),
  })
);

export const getJobEventsResponseSchema = defineSchema((v) =>
  v.object({
    entries: v.array(getJobEventSchema()),
    next_cursor: v.string().nullable(),
    stats: v.object({
      bytes_processed: v.number(),
      lines_processed: v.number(),
      query_time_ms: v.number(),
    }),
  })
);

export const getJobLogsResponseSchema = defineSchema((v) =>
  v.object({
    logs: v.string().nullable(),
  })
);

export const getKnowledgeIngestBatchSourceSchema = defineSchema((v) =>
  v.object({
    label: v.string(),
    path: v.string().nullable(),
    upload_id: v.string().uuid().nullable(),
    remote_path: v.string().nullable(),
    warning_count: v.number().int().nonnegative(),
  })
);

export const getKnowledgeIngestBatchSourceWithMessageSchema = defineSchema((_v) =>
  getKnowledgeIngestBatchSourceSchema().extend({
    message: _v.string(),
  })
);

export const getJobBatchStatusCountsSchema = defineSchema((v) =>
  v.object({
    submitted: v.number().int().nonnegative(),
    working: v.number().int().nonnegative(),
    completed: v.number().int().nonnegative(),
    failed: v.number().int().nonnegative(),
    canceled: v.number().int().nonnegative(),
  })
);

export const getJobBatchResultSchema = defineSchema((v) =>
  v
    .discriminatedUnion("kind", [
      v.object({
        kind: v.literal("knowledge_ingest"),
        total_count: v.number().int().nonnegative(),
        completed_count: v.number().int().nonnegative(),
        skipped_count: v.number().int().nonnegative(),
        failed_count: v.number().int().nonnegative(),
        processing: v.array(getKnowledgeIngestBatchSourceSchema()),
        completed: v.array(getKnowledgeIngestBatchSourceSchema()),
        skipped: v.array(getKnowledgeIngestBatchSourceWithMessageSchema()),
        failed: v.array(getKnowledgeIngestBatchSourceWithMessageSchema()),
        remaining: v.array(getKnowledgeIngestBatchSourceSchema()),
        remaining_label: v.enum(["Remaining Files", "Not Ingested Files"] as const),
      }),
    ])
    .nullable()
);

export const getJobBatchSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    project_id: v.string().uuid(),
    target: v.string().nullable(),
    job_count: v.number().int().nonnegative(),
    status_counts: getJobBatchStatusCountsSchema(),
    created_at: v.string(),
    updated_at: v.string(),
    result: getJobBatchResultSchema(),
  })
);

export const getJobTargetDefinitionSchema = defineSchema((v) =>
  v.object({
    target: v.string(),
    family: v.string(),
    description: v.string(),
    input_schema: jsonObjectSchema(v),
    output_schema: jsonObjectSchema(v).nullable(),
  })
);

export const getJobTargetDefinitionsResponseSchema = defineSchema((v) =>
  v.object({
    reserved_families: v.array(getReservedJobTargetFamilySchema()),
    data: v.array(getJobTargetDefinitionSchema()),
  })
);

export const getCronJobSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    project_id: v.string().uuid(),
    environment_id: v.string().uuid().nullable(),
    branch_id: v.string().nullable().optional(),
    name: v.string(),
    status: getCronJobStatusSchema(),
    target: v.string(),
    schedule: v.string(),
    timezone: v.string(),
    config: jsonObjectSchema(v),
    timeout_seconds: v.number(),
    backoff_limit: v.number(),
    concurrency_policy: v.string(),
    last_scheduled_at: v.string().nullable(),
    last_successful_at: v.string().nullable(),
    created_by: v.string().uuid().nullable(),
    created_at: v.string(),
    updated_at: v.string(),
  })
);

export const getPaginatedCronJobsResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getCronJobSchema()),
    page_info: getPageInfoSchema(),
  })
);

// Backward-compat aliases
export const JobStatusSchema = lazySchema(getJobStatusSchema);
export const CronJobStatusSchema = lazySchema(getCronJobStatusSchema);
export const JobKindSchema = lazySchema(getJobKindSchema);
export const ReservedJobTargetFamilySchema = lazySchema(getReservedJobTargetFamilySchema);
export const PageInfoSchema = lazySchema(getPageInfoSchema);
export const KnowledgeIngestFileResultSchema = lazySchema(getKnowledgeIngestFileResultSchema);
export const KnowledgeIngestSkippedFileResultSchema = lazySchema(
  getKnowledgeIngestSkippedFileResultSchema,
);
export const KnowledgeIngestFailedFileResultSchema = lazySchema(
  getKnowledgeIngestFailedFileResultSchema,
);
export const KnowledgeIngestJobResultMetadataSchema = lazySchema(
  getKnowledgeIngestJobResultMetadataSchema,
);
export const KnowledgeIngestJobResultCountsSchema = lazySchema(
  getKnowledgeIngestJobResultCountsSchema,
);
export const KnowledgeIngestJobResultSchema = lazySchema(getKnowledgeIngestJobResultSchema);
export const JobResultSchema = lazySchema(getJobResultSchema);
export const JobResultSummarySchema = lazySchema(getJobResultSummarySchema);
export const JobSchema = lazySchema(getJobSchema);
export const JobListItemSchema = lazySchema(getJobListItemSchema);
export const PaginatedJobsResponseSchema = lazySchema(getPaginatedJobsResponseSchema);
export const JobEventSchema = lazySchema(getJobEventSchema);
export const JobEventsResponseSchema = lazySchema(getJobEventsResponseSchema);
export const JobLogsResponseSchema = lazySchema(getJobLogsResponseSchema);
export const KnowledgeIngestBatchSourceSchema = lazySchema(getKnowledgeIngestBatchSourceSchema);
export const KnowledgeIngestBatchSourceWithMessageSchema = lazySchema(
  getKnowledgeIngestBatchSourceWithMessageSchema,
);
export const JobBatchStatusCountsSchema = lazySchema(getJobBatchStatusCountsSchema);
export const JobBatchResultSchema = lazySchema(getJobBatchResultSchema);
export const JobBatchSchema = lazySchema(getJobBatchSchema);
export const JobTargetDefinitionSchema = lazySchema(getJobTargetDefinitionSchema);
export const JobTargetDefinitionsResponseSchema = lazySchema(getJobTargetDefinitionsResponseSchema);
export const CronJobSchema = lazySchema(getCronJobSchema);
export const PaginatedCronJobsResponseSchema = lazySchema(getPaginatedCronJobsResponseSchema);

// Inferred types
export type JobStatus = InferSchema<ReturnType<typeof getJobStatusSchema>>;
export type CronJobStatus = InferSchema<ReturnType<typeof getCronJobStatusSchema>>;
export type JobKind = InferSchema<ReturnType<typeof getJobKindSchema>>;
export type ReservedJobTargetFamily = InferSchema<
  ReturnType<typeof getReservedJobTargetFamilySchema>
>;

export type KnowledgeIngestFileResult = InferSchema<
  ReturnType<typeof getKnowledgeIngestFileResultSchema>
>;
export type KnowledgeIngestSkippedFileResult = InferSchema<
  ReturnType<typeof getKnowledgeIngestSkippedFileResultSchema>
>;
export type KnowledgeIngestFailedFileResult = InferSchema<
  ReturnType<typeof getKnowledgeIngestFailedFileResultSchema>
>;
export type KnowledgeIngestJobResultMetadata = InferSchema<
  ReturnType<typeof getKnowledgeIngestJobResultMetadataSchema>
>;
export type KnowledgeIngestJobResultCounts = InferSchema<
  ReturnType<typeof getKnowledgeIngestJobResultCountsSchema>
>;
export type KnowledgeIngestJobResult = InferSchema<
  ReturnType<typeof getKnowledgeIngestJobResultSchema>
>;
export type JobResult = InferSchema<ReturnType<typeof getJobResultSchema>>;
export type JobResultSummary = InferSchema<ReturnType<typeof getJobResultSummarySchema>>;
export type Job = InferSchema<ReturnType<typeof getJobSchema>>;
export type JobListItem = InferSchema<ReturnType<typeof getJobListItemSchema>>;
export type PaginatedJobsResponse = InferSchema<ReturnType<typeof getPaginatedJobsResponseSchema>>;
export type JobEvent = InferSchema<ReturnType<typeof getJobEventSchema>>;
export type JobEventsResponse = InferSchema<ReturnType<typeof getJobEventsResponseSchema>>;
export type JobLogsResponse = InferSchema<ReturnType<typeof getJobLogsResponseSchema>>;

export type KnowledgeIngestBatchSource = InferSchema<
  ReturnType<typeof getKnowledgeIngestBatchSourceSchema>
>;
export type KnowledgeIngestBatchSourceWithMessage = InferSchema<
  ReturnType<typeof getKnowledgeIngestBatchSourceWithMessageSchema>
>;
export type JobBatchStatusCounts = InferSchema<ReturnType<typeof getJobBatchStatusCountsSchema>>;
export type JobBatchResult = InferSchema<ReturnType<typeof getJobBatchResultSchema>>;
export type JobBatch = InferSchema<ReturnType<typeof getJobBatchSchema>>;

export type JobTargetDefinition = InferSchema<ReturnType<typeof getJobTargetDefinitionSchema>>;
export type JobTargetDefinitionsResponse = InferSchema<
  ReturnType<typeof getJobTargetDefinitionsResponseSchema>
>;

export type CronJob = InferSchema<ReturnType<typeof getCronJobSchema>>;
export type PaginatedCronJobsResponse = InferSchema<
  ReturnType<typeof getPaginatedCronJobsResponseSchema>
>;
