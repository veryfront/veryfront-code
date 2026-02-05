/**
 * Workflow module schemas
 *
 * Schemas for workflow status, nodes, and execution state.
 */

import { z } from "zod";

/**
 * Workflow status schema
 */
export const WorkflowStatusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Node status schema
 */
export const NodeStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

/**
 * Workflow node type schema
 */
export const WorkflowNodeTypeSchema = z.enum([
  "step",
  "parallel",
  "map",
  "branch",
  "wait",
  "subWorkflow",
  "loop",
]);

/**
 * Backoff strategy schema
 */
export const BackoffStrategySchema = z.enum(["fixed", "linear", "exponential"]);

/**
 * Retry config schema
 */
export const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().optional(),
  backoff: BackoffStrategySchema.optional(),
  initialDelay: z.number().nonnegative().optional(),
  maxDelay: z.number().nonnegative().optional(),
  // retryIf is a function, can't be in schema
});

/**
 * Loop execution context schema
 */
export const LoopExecutionContextSchema = z.object({
  iteration: z.number().int().nonnegative(),
  totalIterations: z.number().int().nonnegative(),
  previousResults: z.array(z.unknown()),
  isFirstIteration: z.boolean(),
  isLastAllowedIteration: z.boolean(),
});

/**
 * Node state schema
 */
export const NodeStateSchema = z.object({
  nodeId: z.string(),
  status: NodeStatusSchema,
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  attempt: z.number().int().nonnegative(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
});

/**
 * Workflow context schema (allows any additional node outputs)
 */
export const WorkflowContextSchema = z
  .object({
    input: z.unknown(),
  })
  .passthrough();

/**
 * Checkpoint schema
 */
export const CheckpointSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  timestamp: z.date(),
  context: WorkflowContextSchema,
  nodeStates: z.record(NodeStateSchema),
});

/**
 * Approval status schema
 */
export const ApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);

/**
 * Pending approval schema
 */
export const PendingApprovalSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  message: z.string(),
  payload: z.unknown(),
  approvers: z.array(z.string()).optional(),
  requestedAt: z.date(),
  expiresAt: z.date().optional(),
  status: ApprovalStatusSchema,
  decidedBy: z.string().optional(),
  decidedAt: z.date().optional(),
  comment: z.string().optional(),
});

/**
 * Workflow error schema
 */
export const WorkflowErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
  nodeId: z.string().optional(),
});

/**
 * Approval decision schema
 */
export const ApprovalDecisionSchema = z.object({
  approved: z.boolean(),
  approver: z.string(),
  comment: z.string().optional(),
});

/**
 * Workflow job schema
 */
export const WorkflowJobSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  input: z.unknown(),
  priority: z.number().optional(),
  createdAt: z.date(),
});

/**
 * Run filter schema
 */
export const RunFilterSchema = z.object({
  workflowId: z.string().optional(),
  status: z.union([WorkflowStatusSchema, z.array(WorkflowStatusSchema)]).optional(),
  createdAfter: z.date().optional(),
  createdBefore: z.date().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

/**
 * Parallel strategy schema
 */
export const ParallelStrategySchema = z.enum(["all", "race", "allSettled"]);

/**
 * Wait type schema
 */
export const WaitTypeSchema = z.enum(["approval", "event"]);

// Inferred types
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type WorkflowNodeType = z.infer<typeof WorkflowNodeTypeSchema>;
export type BackoffStrategy = z.infer<typeof BackoffStrategySchema>;
export type RetryConfig = z.infer<typeof RetryConfigSchema> & {
  retryIf?: (error: Error) => boolean;
};
export type LoopExecutionContext = z.infer<typeof LoopExecutionContextSchema>;
export type NodeState = z.infer<typeof NodeStateSchema>;
// Checkpoint type is defined in ../types.ts (requires WorkflowContext interface)
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;
export type WorkflowError = z.infer<typeof WorkflowErrorSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type WorkflowJob = z.infer<typeof WorkflowJobSchema>;
export type RunFilter = z.infer<typeof RunFilterSchema>;
export type ParallelStrategy = z.infer<typeof ParallelStrategySchema>;
export type WaitType = z.infer<typeof WaitTypeSchema>;
