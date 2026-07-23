import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { getJsonValueSchema, getTimestampSchema } from "#veryfront/schemas/primitives.ts";

const MAX_IDENTIFIER_LENGTH = 4_096;
const MAX_SHORT_TEXT_LENGTH = 16_384;
const MAX_LOG_LENGTH = 16 * 1024 * 1024;
const MAX_COLLECTION_ITEMS = 10_000;

const boundedIdentifier = (v: SchemaValidator) => v.string().min(1).max(MAX_IDENTIFIER_LENGTH);

// Keep the established public `unknown` field types while validating wire
// values as bounded JSON.
const boundedJsonValue = (): Schema<unknown> => getJsonValueSchema() as Schema<unknown>;

/** Canonical durable run kind. */
export type RunKind = "agent" | "workflow" | "task" | "eval";

/** Canonical durable run status. */
export type RunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

/** Canonical durable run owner. */
export interface RunOwner {
  /** Ownership scope for the run. */
  kind: "conversation" | "project";
  /** Identifier of the owning conversation or project. */
  id: string;
}

/** Runtime target kind recorded on task and workflow runs. */
export type RunRuntimeTargetKind = "main_branch" | "environment" | "preview_branch";

/** Trigger kind recorded on scheduled or externally-started runs. */
export type RunTriggerKind = "manual" | "schedule" | "webhook" | "api";

/** Error payload recorded for failed task and workflow runs. */
export interface RunExecutionError {
  /** User-readable failure message. */
  message: string;
  /** Stable error code when the runtime supplies one. */
  code?: string;
  /** Structured JSON-compatible failure detail. */
  detail?: unknown;
}

/** Canonical durable run. */
export interface Run {
  /** Stable run identifier. */
  run_id: string;
  /** Runtime primitive executed by this run. */
  kind: RunKind;
  /** Current durable status. */
  status: RunStatus;
  /** Conversation or project that owns the run. */
  owner: RunOwner;
  /** Parent run identifier for a child run. */
  parent_run_id: string | null;
  /** Root run identifier for the execution tree. */
  root_run_id: string;
  /** Reason a run is waiting, when available. */
  waiting_reason: string | null;
  /** JSON-compatible runtime metadata. */
  metadata: unknown;
  /** Executed target, such as `task:sync-data`. */
  target: string | null;
  /** Workflow definition identifier when the run executes a workflow. */
  workflow_id: string | null;
  /** Schedule definition identifier when a schedule created the run. */
  schedule_id: string | null;
  /** Batch identifier for grouped runs. */
  batch_id: string | null;
  /** Selected runtime target kind. */
  runtime_target_kind: RunRuntimeTargetKind | null;
  /** Selected runtime environment identifier. */
  runtime_target_environment_id: string | null;
  /** Selected preview branch identifier. */
  runtime_target_branch_id: string | null;
  /** JSON-compatible run input. */
  input: unknown;
  /** JSON-compatible run configuration. */
  config: unknown;
  /** JSON-compatible run output. */
  output: unknown;
  /** Failure information for a failed run. */
  error: RunExecutionError | null;
  /** Captured textual logs when included in the run record. */
  logs: string | null;
  /** JSON-compatible artifacts associated with the run. */
  artifacts: unknown[];
  /** Execution duration in milliseconds. */
  duration_ms: number | null;
  /** Process-style exit code when one exists. */
  exit_code: number | null;
  /** Runtime-specific start mode. */
  start_mode: string | null;
  /** Configured timeout in seconds. */
  timeout_seconds: number | null;
  /** Configured retry backoff limit. */
  backoff_limit: number | null;
  /** Trigger category that created the run. */
  trigger_kind: RunTriggerKind | null;
  /** Trigger identifier that created the run. */
  trigger_id: string | null;
  /** Actor identifier that created the run. */
  created_by: string | null;
  /** ISO 8601 timestamp of the latest update. */
  updated_at: string;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 execution start timestamp. */
  started_at: string | null;
  /** ISO 8601 completion timestamp. */
  completed_at: string | null;
}

/** Response returned when a run is accepted. */
export interface CreateRunResponse {
  /** Whether the API accepted the run. */
  accepted: boolean;
  /** Whether the request resolved to an existing idempotent run. */
  duplicate?: boolean;
  /** Accepted or existing run record. */
  run: Run;
}

/** Response returned when a run is cancelled. */
export interface CancelRunResponse {
  /** Whether cancellation was applied. */
  cancelled: boolean;
  /** Updated run record. */
  run: Run;
}

/** Event emitted by a run. */
export interface RunEvent {
  /** Monotonic event identifier within the run. */
  event_id: number;
  /** Stable event category. */
  event_type: string;
  /** JSON-compatible event payload. */
  payload: unknown;
  /** ISO 8601 event creation timestamp. */
  created_at: string;
}

/** Cursor links returned with a page of runs or run events. */
export interface RunPageInfo {
  /** Cursor for the current page. */
  self: string | null;
  /** Cursor for the first page. The Runs API currently represents it as null. */
  first: null;
  /** Cursor for the next page. */
  next: string | null;
  /** Cursor for the previous page. */
  prev: string | null;
}

/** Paginated run event response. */
export interface RunEventList {
  /** Events in this page. */
  data: RunEvent[];
  /** Cursor links for this page. */
  page_info: RunPageInfo;
}

/** Paginated project run response. */
export interface RunList {
  /** Runs in this page. */
  data: Run[];
  /** Cursor links for this page. */
  page_info: RunPageInfo;
}

export const getRunKindSchema = defineSchema<RunKind>((v) =>
  v.enum(["agent", "workflow", "task", "eval"] as const)
);

export const getRunStatusSchema = defineSchema<RunStatus>((v) =>
  v.enum(["pending", "running", "waiting", "completed", "failed", "cancelled"] as const)
);

export const getRunOwnerSchema = defineSchema<RunOwner>((v) =>
  v.object({
    kind: v.enum(["conversation", "project"] as const),
    id: boundedIdentifier(v),
  }).strip()
);

export const getRunRuntimeTargetKindSchema = defineSchema<RunRuntimeTargetKind>((v) =>
  v.enum(["main_branch", "environment", "preview_branch"] as const)
);

export const getRunTriggerKindSchema = defineSchema<RunTriggerKind>((v) =>
  v.enum(["manual", "schedule", "webhook", "api"] as const)
);

export const getRunExecutionErrorSchema = defineSchema<RunExecutionError>((v) =>
  v.object({
    message: v.string().min(1).max(MAX_SHORT_TEXT_LENGTH),
    code: v.string().min(1).max(256).optional(),
    detail: boundedJsonValue().optional(),
  }).strip()
);

export const getRunSchema = defineSchema<Run>((v) =>
  v.object({
    run_id: boundedIdentifier(v),
    kind: getRunKindSchema(),
    status: getRunStatusSchema(),
    owner: getRunOwnerSchema(),
    parent_run_id: boundedIdentifier(v).nullable(),
    root_run_id: boundedIdentifier(v),
    waiting_reason: v.string().max(MAX_SHORT_TEXT_LENGTH).nullable(),
    metadata: boundedJsonValue().nullable(),
    target: boundedIdentifier(v).nullable(),
    workflow_id: boundedIdentifier(v).nullable(),
    schedule_id: boundedIdentifier(v).nullable(),
    batch_id: boundedIdentifier(v).nullable(),
    runtime_target_kind: getRunRuntimeTargetKindSchema().nullable(),
    runtime_target_environment_id: boundedIdentifier(v).nullable(),
    runtime_target_branch_id: boundedIdentifier(v).nullable(),
    input: boundedJsonValue().nullable(),
    config: boundedJsonValue().nullable(),
    output: boundedJsonValue().nullable(),
    error: getRunExecutionErrorSchema().nullable(),
    logs: v.string().max(MAX_LOG_LENGTH).nullable(),
    artifacts: v.array(boundedJsonValue()).max(MAX_COLLECTION_ITEMS),
    duration_ms: v.number().int().nonnegative().nullable(),
    exit_code: v.number().int().nonnegative().nullable(),
    start_mode: v.string().max(256).nullable(),
    timeout_seconds: v.number().int().nonnegative().nullable(),
    backoff_limit: v.number().int().nonnegative().nullable(),
    trigger_kind: getRunTriggerKindSchema().nullable(),
    trigger_id: boundedIdentifier(v).nullable(),
    created_by: boundedIdentifier(v).nullable(),
    updated_at: getTimestampSchema(),
    created_at: getTimestampSchema(),
    started_at: getTimestampSchema().nullable(),
    completed_at: getTimestampSchema().nullable(),
  }).strip() as Schema<Run>
);

export const getCreateRunResponseSchema = defineSchema<CreateRunResponse>((v) =>
  v.object({
    accepted: v.boolean(),
    duplicate: v.boolean().optional(),
    run: getRunSchema(),
  }).strip()
);

export const getCancelRunResponseSchema = defineSchema<CancelRunResponse>((v) =>
  v.object({
    cancelled: v.boolean(),
    run: getRunSchema(),
  }).strip()
);

export const getRunEventSchema = defineSchema<RunEvent>((v) =>
  v.object({
    event_id: v.number().int().nonnegative(),
    event_type: v.string().min(1).max(256),
    payload: boundedJsonValue(),
    created_at: getTimestampSchema(),
  }).strip() as Schema<RunEvent>
);

export const getPageInfoSchema = defineSchema<RunPageInfo>((v) =>
  v.object({
    self: v.string().max(MAX_SHORT_TEXT_LENGTH).nullable(),
    first: v.literal(null),
    next: v.string().max(MAX_SHORT_TEXT_LENGTH).nullable(),
    prev: v.string().max(MAX_SHORT_TEXT_LENGTH).nullable(),
  }).strip()
);

export const getRunEventListSchema = defineSchema<RunEventList>((v) =>
  v.object({
    data: v.array(getRunEventSchema()).max(MAX_COLLECTION_ITEMS),
    page_info: getPageInfoSchema(),
  }).strip()
);

export const getRunListSchema = defineSchema<RunList>((v) =>
  v.object({
    data: v.array(getRunSchema()).max(MAX_COLLECTION_ITEMS),
    page_info: getPageInfoSchema(),
  }).strip()
);

/** Zod schema for a canonical durable run. */
export const RunSchema: Schema<Run> = lazySchema(getRunSchema);
/** Zod schema for a create-run response. */
export const CreateRunResponseSchema: Schema<CreateRunResponse> = lazySchema(
  getCreateRunResponseSchema,
);
/** Zod schema for a cancel-run response. */
export const CancelRunResponseSchema: Schema<CancelRunResponse> = lazySchema(
  getCancelRunResponseSchema,
);
/** Zod schema for a run event. */
export const RunEventSchema: Schema<RunEvent> = lazySchema(getRunEventSchema);
/** Zod schema for a paginated run-event response. */
export const RunEventListSchema: Schema<RunEventList> = lazySchema(getRunEventListSchema);
/** Zod schema for a paginated project-run response. */
export const RunListSchema: Schema<RunList> = lazySchema(getRunListSchema);
