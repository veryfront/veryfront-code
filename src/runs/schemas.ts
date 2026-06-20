import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getRunKindSchema = defineSchema((v) =>
  v.enum(["agent", "workflow", "task", "eval"] as const)
);

export const getRunStatusSchema = defineSchema((v) =>
  v.enum(["pending", "running", "waiting", "completed", "failed", "cancelled"] as const)
);

export const getRunOwnerSchema = defineSchema((v) =>
  v.object({
    kind: v.enum(["conversation", "project"] as const),
    id: v.string(),
  })
);

export const getRunRuntimeTargetKindSchema = defineSchema((v) =>
  v.enum(["main_branch", "environment", "preview_branch"] as const)
);

export const getRunTriggerKindSchema = defineSchema((v) =>
  v.enum(["manual", "schedule", "webhook", "api"] as const)
);

export const getRunExecutionErrorSchema = defineSchema((v) =>
  v.object({
    message: v.string(),
    code: v.string().optional(),
    detail: v.unknown().optional(),
  })
);

export const getRunSchema = defineSchema((v) =>
  v.object({
    run_id: v.string(),
    kind: getRunKindSchema(),
    status: getRunStatusSchema(),
    owner: getRunOwnerSchema(),
    parent_run_id: v.string().nullable(),
    root_run_id: v.string(),
    waiting_reason: v.string().nullable(),
    metadata: v.unknown().nullable(),
    target: v.string().nullable(),
    workflow_id: v.string().nullable(),
    schedule_id: v.string().nullable(),
    batch_id: v.string().nullable(),
    runtime_target_kind: getRunRuntimeTargetKindSchema().nullable(),
    runtime_target_environment_id: v.string().nullable(),
    runtime_target_branch_id: v.string().nullable(),
    input: v.unknown().nullable(),
    config: v.unknown().nullable(),
    output: v.unknown().nullable(),
    error: getRunExecutionErrorSchema().nullable(),
    logs: v.string().nullable(),
    artifacts: v.array(v.unknown()),
    duration_ms: v.number().int().nullable(),
    exit_code: v.number().int().nullable(),
    start_mode: v.string().nullable(),
    timeout_seconds: v.number().int().nullable(),
    backoff_limit: v.number().int().nullable(),
    trigger_kind: getRunTriggerKindSchema().nullable(),
    trigger_id: v.string().nullable(),
    created_by: v.string().nullable(),
    updated_at: v.string(),
    created_at: v.string(),
    started_at: v.string().nullable(),
    completed_at: v.string().nullable(),
  })
);

export const getCreateRunResponseSchema = defineSchema((v) =>
  v.object({
    accepted: v.boolean(),
    duplicate: v.boolean().optional(),
    run: getRunSchema(),
  })
);

export const getCancelRunResponseSchema = defineSchema((v) =>
  v.object({
    cancelled: v.boolean(),
    run: getRunSchema(),
  })
);

export const getRunEventSchema = defineSchema((v) =>
  v.object({
    event_id: v.number(),
    event_type: v.string(),
    payload: v.unknown(),
    created_at: v.string(),
  })
);

export const getPageInfoSchema = defineSchema((v) =>
  v.object({
    self: v.string().nullable(),
    first: v.literal(null),
    next: v.string().nullable(),
    prev: v.string().nullable(),
  })
);

export const getRunEventListSchema = defineSchema((v) =>
  v.object({
    data: v.array(getRunEventSchema()),
    page_info: getPageInfoSchema(),
  })
);

export const getRunListSchema = defineSchema((v) =>
  v.object({
    data: v.array(getRunSchema()),
    page_info: getPageInfoSchema(),
  })
);

/** Zod schema for a canonical durable run. */
export const RunSchema = lazySchema(getRunSchema);
/** Zod schema for a create-run response. */
export const CreateRunResponseSchema = lazySchema(getCreateRunResponseSchema);
/** Zod schema for a cancel-run response. */
export const CancelRunResponseSchema = lazySchema(getCancelRunResponseSchema);
/** Zod schema for a run event. */
export const RunEventSchema = lazySchema(getRunEventSchema);
/** Zod schema for a paginated run-event response. */
export const RunEventListSchema = lazySchema(getRunEventListSchema);
/** Zod schema for a paginated project-run response. */
export const RunListSchema = lazySchema(getRunListSchema);

/** Canonical durable run kind. */
export type RunKind = InferSchema<ReturnType<typeof getRunKindSchema>>;
/** Canonical durable run status. */
export type RunStatus = InferSchema<ReturnType<typeof getRunStatusSchema>>;
/** Canonical durable run owner. */
export type RunOwner = InferSchema<ReturnType<typeof getRunOwnerSchema>>;
/** Runtime target kind recorded on task and workflow runs. */
export type RunRuntimeTargetKind = InferSchema<ReturnType<typeof getRunRuntimeTargetKindSchema>>;
/** Trigger kind recorded on scheduled or externally-started runs. */
export type RunTriggerKind = InferSchema<ReturnType<typeof getRunTriggerKindSchema>>;
/** Error payload recorded for failed task and workflow runs. */
export type RunExecutionError = InferSchema<ReturnType<typeof getRunExecutionErrorSchema>>;
/** Canonical durable run. */
export type Run = InferSchema<ReturnType<typeof getRunSchema>>;
/** Response returned when a run is accepted. */
export type CreateRunResponse = InferSchema<ReturnType<typeof getCreateRunResponseSchema>>;
/** Response returned when a run is cancelled. */
export type CancelRunResponse = InferSchema<ReturnType<typeof getCancelRunResponseSchema>>;
/** Event emitted by a run. */
export type RunEvent = InferSchema<ReturnType<typeof getRunEventSchema>>;
/** Paginated run event response. */
export type RunEventList = InferSchema<ReturnType<typeof getRunEventListSchema>>;
/** Paginated project run response. */
export type RunList = InferSchema<ReturnType<typeof getRunListSchema>>;
