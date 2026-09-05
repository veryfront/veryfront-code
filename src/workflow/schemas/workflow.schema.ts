/**
 * Workflow module schemas
 *
 * Schemas for workflow status, nodes, and execution state.
 */

import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { MAX_WORKFLOW_RUN_LIST_LIMIT, MAX_WORKFLOW_RUN_LIST_OFFSET } from "../limits.ts";

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
    /** Internal identity for one execution of a reusable wait node. */
    _waitInstanceId: v.string().optional(),
    /** Internal owner path for a node produced inside a sub-workflow. */
    _subWorkflowOwnerPath: v.string().optional(),
    /** Child states this composite had actively parked when it last suspended. */
    _activeCompositeChildIds: v.array(v.string()).optional(),
    /** Child states a runtime-defined composite produced before it completed. */
    _completedCompositeChildIds: v.array(v.string()).optional(),
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
    // Set when the approval notifier failed: the approval exists but approvers
    // were not informed. Surfaced so operators can re-notify instead of the
    // workflow silently hanging until expiry.
    notificationError: v.string().optional(),
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
    /** Structured answer, validated against the wait node's responseSchema. */
    data: v.unknown().optional(),
  })
);

/**
 * Internal workflow queue item schema
 */
export const getWorkflowQueueItemSchema = defineSchema((v) =>
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
    limit: v.number().int().positive().max(MAX_WORKFLOW_RUN_LIST_LIMIT).optional(),
    offset: v.number().int().nonnegative().max(MAX_WORKFLOW_RUN_LIST_OFFSET).optional(),
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
export const WorkflowQueueItemSchema = lazySchema(getWorkflowQueueItemSchema);
export const RunFilterSchema = lazySchema(getRunFilterSchema);
export const ParallelStrategySchema = lazySchema(getParallelStrategySchema);
export const WaitTypeSchema = lazySchema(getWaitTypeSchema);

// Inferred types
/** Public API contract for workflow status. */
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
export type WorkflowQueueItem = InferSchema<ReturnType<typeof getWorkflowQueueItemSchema>>;
export type RunFilter = InferSchema<ReturnType<typeof getRunFilterSchema>>;
export type ParallelStrategy = InferSchema<ReturnType<typeof getParallelStrategySchema>>;
export type WaitType = InferSchema<ReturnType<typeof getWaitTypeSchema>>;
