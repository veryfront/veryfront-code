/**
 * Workflow module schemas
 *
 * Schemas for workflow status, nodes, and execution state.
 */

import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/**
 * Workflow status schema
 */
export const getWorkflowStatusSchema = defineSchema((v) =>
  v.enum(
    [
      "pending",
      "running",
      "waiting",
      "completed",
      "failed",
      "cancelled",
    ] as const,
  )
);

/**
 * Node status schema
 */
export const getNodeStatusSchema = defineSchema((v) =>
  v.enum(
    [
      "pending",
      "running",
      "completed",
      "failed",
      "skipped",
    ] as const,
  )
);

/**
 * Workflow node type schema
 */
export const getWorkflowNodeTypeSchema = defineSchema((v) =>
  v.enum(
    [
      "step",
      "parallel",
      "map",
      "branch",
      "wait",
      "subWorkflow",
      "loop",
    ] as const,
  )
);

/**
 * Backoff strategy schema
 */
export const getBackoffStrategySchema = defineSchema((v) =>
  v.enum(["fixed", "linear", "exponential"] as const)
);

/**
 * Retry config schema
 */
export const getRetryConfigSchema = defineSchema((v) =>
  v.object({
    maxAttempts: v.number().int().positive().optional(),
    backoff: getBackoffStrategySchema().optional(),
    initialDelay: v.number().nonnegative().optional(),
    maxDelay: v.number().nonnegative().optional(),
    // retryIf is a function, can't be in schema
  })
);

/**
 * Loop execution context schema
 */
export const getLoopExecutionContextSchema = defineSchema((v) =>
  v.object({
    iteration: v.number().int().nonnegative(),
    totalIterations: v.number().int().nonnegative(),
    previousResults: v.array(v.unknown()),
    isFirstIteration: v.boolean(),
    isLastAllowedIteration: v.boolean(),
  })
);

/**
 * Node state schema
 */
export const getNodeStateSchema = defineSchema((v) =>
  v.object({
    nodeId: v.string(),
    status: getNodeStatusSchema(),
    input: v.unknown().optional(),
    output: v.unknown().optional(),
    error: v.string().optional(),
    attempt: v.number().int().nonnegative(),
    startedAt: v.date().optional(),
    completedAt: v.date().optional(),
  })
);

/**
 * Workflow context schema (allows any additional node outputs)
 */
export const getWorkflowContextSchema = defineSchema((v) =>
  v
    .object({
      input: v.unknown(),
    })
    .passthrough()
);

/**
 * Checkpoint schema
 */
export const getCheckpointSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    nodeId: v.string(),
    timestamp: v.date(),
    context: getWorkflowContextSchema(),
    nodeStates: v.record(v.string(), getNodeStateSchema()),
  })
);

/**
 * Approval status schema
 */
export const getApprovalStatusSchema = defineSchema((v) =>
  v.enum(
    [
      "pending",
      "approved",
      "rejected",
      "expired",
    ] as const,
  )
);

/**
 * Pending approval schema
 */
export const getPendingApprovalSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    nodeId: v.string(),
    message: v.string(),
    payload: v.unknown(),
    approvers: v.array(v.string()).optional(),
    requestedAt: v.date(),
    expiresAt: v.date().optional(),
    status: getApprovalStatusSchema(),
    decidedBy: v.string().optional(),
    decidedAt: v.date().optional(),
    comment: v.string().optional(),
  })
);

/**
 * Workflow error schema
 */
export const getWorkflowErrorSchema = defineSchema((v) =>
  v.object({
    message: v.string(),
    stack: v.string().optional(),
    nodeId: v.string().optional(),
  })
);

/**
 * Approval decision schema
 */
export const getApprovalDecisionSchema = defineSchema((v) =>
  v.object({
    approved: v.boolean(),
    approver: v.string(),
    comment: v.string().optional(),
  })
);

/**
 * Workflow job schema
 */
export const getWorkflowJobSchema = defineSchema((v) =>
  v.object({
    runId: v.string(),
    workflowId: v.string(),
    input: v.unknown(),
    priority: v.number().optional(),
    createdAt: v.date(),
  })
);

/**
 * Run filter schema
 */
export const getRunFilterSchema = defineSchema((v) =>
  v.object({
    workflowId: v.string().optional(),
    status: v.union([getWorkflowStatusSchema(), v.array(getWorkflowStatusSchema())]).optional(),
    createdAfter: v.date().optional(),
    createdBefore: v.date().optional(),
    limit: v.number().int().positive().optional(),
    offset: v.number().int().nonnegative().optional(),
  })
);

/**
 * Parallel strategy schema
 */
export const getParallelStrategySchema = defineSchema((v) =>
  v.enum(["all", "race", "allSettled"] as const)
);

/**
 * Wait type schema
 */
export const getWaitTypeSchema = defineSchema((v) => v.enum(["approval", "event"] as const));

// Backward-compat aliases (consumed by schemas/index.ts and other unmigrated callers)
export const WorkflowStatusSchema = lazySchema(getWorkflowStatusSchema);
export const NodeStatusSchema = lazySchema(getNodeStatusSchema);
export const WorkflowNodeTypeSchema = lazySchema(getWorkflowNodeTypeSchema);
export const BackoffStrategySchema = lazySchema(getBackoffStrategySchema);
export const RetryConfigSchema = lazySchema(getRetryConfigSchema);
export const LoopExecutionContextSchema = lazySchema(getLoopExecutionContextSchema);
export const NodeStateSchema = lazySchema(getNodeStateSchema);
export const WorkflowContextSchema = lazySchema(getWorkflowContextSchema);
export const CheckpointSchema = lazySchema(getCheckpointSchema);
export const ApprovalStatusSchema = lazySchema(getApprovalStatusSchema);
export const PendingApprovalSchema = lazySchema(getPendingApprovalSchema);
export const WorkflowErrorSchema = lazySchema(getWorkflowErrorSchema);
export const ApprovalDecisionSchema = lazySchema(getApprovalDecisionSchema);
export const WorkflowJobSchema = lazySchema(getWorkflowJobSchema);
export const RunFilterSchema = lazySchema(getRunFilterSchema);
export const ParallelStrategySchema = lazySchema(getParallelStrategySchema);
export const WaitTypeSchema = lazySchema(getWaitTypeSchema);

// Inferred types
export type WorkflowStatus = InferSchema<ReturnType<typeof getWorkflowStatusSchema>>;
export type NodeStatus = InferSchema<ReturnType<typeof getNodeStatusSchema>>;
export type WorkflowNodeType = InferSchema<ReturnType<typeof getWorkflowNodeTypeSchema>>;
export type BackoffStrategy = InferSchema<ReturnType<typeof getBackoffStrategySchema>>;
export type RetryConfig = InferSchema<ReturnType<typeof getRetryConfigSchema>> & {
  retryIf?: (error: Error) => boolean;
};
export type LoopExecutionContext = InferSchema<ReturnType<typeof getLoopExecutionContextSchema>>;
export type NodeState = InferSchema<ReturnType<typeof getNodeStateSchema>>;
// Checkpoint type is defined in ../types.ts (requires WorkflowContext interface)
export type ApprovalStatus = InferSchema<ReturnType<typeof getApprovalStatusSchema>>;
export type PendingApproval = InferSchema<ReturnType<typeof getPendingApprovalSchema>>;
export type WorkflowError = InferSchema<ReturnType<typeof getWorkflowErrorSchema>>;
export type ApprovalDecision = InferSchema<ReturnType<typeof getApprovalDecisionSchema>>;
export type WorkflowJob = InferSchema<ReturnType<typeof getWorkflowJobSchema>>;
export type RunFilter = InferSchema<ReturnType<typeof getRunFilterSchema>>;
export type ParallelStrategy = InferSchema<ReturnType<typeof getParallelStrategySchema>>;
export type WaitType = InferSchema<ReturnType<typeof getWaitTypeSchema>>;
