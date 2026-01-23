/**
 * Veryfront Workflow Types
 *
 * Core type definitions for durable, DAG-based agentic workflows
 */

import type { z } from "zod";
import type { Agent } from "#veryfront/agent";
import type { Tool } from "#veryfront/tool";
import type { BlobRef, BlobStorage } from "./blob/types.ts";

// ============================================================================
// Workflow Status
// ============================================================================

/**
 * Status of a workflow run
 */
export type WorkflowStatus =
  | "pending" // Created but not started
  | "running" // Currently executing
  | "waiting" // Paused, waiting for approval/event
  | "completed" // Successfully finished
  | "failed" // Failed with error
  | "cancelled"; // Cancelled by user

/**
 * Status of a single node in the workflow
 */
export type NodeStatus =
  | "pending" // Not yet executed
  | "running" // Currently executing
  | "completed" // Successfully finished
  | "failed" // Failed with error
  | "skipped"; // Skipped due to condition

// ============================================================================
// Workflow Node Types
// ============================================================================

/**
 * Types of nodes in a workflow DAG
 */
export type WorkflowNodeType =
  | "step" // Single agent or tool execution
  | "parallel" // Parallel execution of multiple nodes
  | "map" // Dynamic fan-out/map-reduce
  | "branch" // Conditional branching
  | "wait" // Wait for approval or event
  | "subWorkflow" // Nested workflow execution
  | "loop"; // Iterative execution until condition is met

/**
 * Retry configuration for a step
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Backoff strategy */
  backoff?: "fixed" | "linear" | "exponential";
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay between retries */
  maxDelay?: number;
  /** Custom function to determine if error is retryable */
  retryIf?: (error: Error) => boolean;
}

/**
 * Base configuration for all workflow nodes
 */
export interface BaseNodeConfig {
  /** Whether to checkpoint after this node */
  checkpoint?: boolean;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Timeout for this node */
  timeout?: string | number;
  /** Condition to skip this node */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Step node configuration (agent or tool execution)
 */
export interface StepNodeConfig extends BaseNodeConfig {
  type: "step";
  /** Agent ID or agent instance to execute */
  agent?: string | Agent;
  /** Tool ID or tool instance to execute */
  tool?: string | Tool | undefined;
  /** Input for the agent/tool - can be static or computed from context */
  input?:
    | string
    | Record<string, unknown>
    | ((context: WorkflowContext) => unknown);
}

/**
 * Parallel node configuration (concurrent execution)
 */
export interface ParallelNodeConfig extends BaseNodeConfig {
  type: "parallel";
  /** Nodes to execute in parallel */
  nodes: WorkflowNode[];
  /** How to handle parallel completion */
  strategy?: "all" | "race" | "allSettled";
}

/**
 * Branch node configuration (conditional execution)
 */
export interface BranchNodeConfig extends BaseNodeConfig {
  type: "branch";
  /** Condition to evaluate */
  condition: (context: WorkflowContext) => boolean | Promise<boolean>;
  /** Nodes to execute if condition is true */
  then: WorkflowNode[];
  /** Nodes to execute if condition is false */
  else?: WorkflowNode[];
}

/**
 * Wait node configuration (approval or event)
 */
export interface WaitNodeConfig extends BaseNodeConfig {
  type: "wait";
  /** Type of wait */
  waitType: "approval" | "event";
  /** Message to display for approval */
  message?: string;
  /** Payload to include with approval request */
  payload?: unknown | ((context: WorkflowContext) => unknown);
  /** Allowed approvers (email or user IDs) */
  approvers?: string[];
  /** Event name to wait for (for event type) */
  eventName?: string;
}

/**
 * Sub-workflow node configuration
 */
export interface SubWorkflowNodeConfig extends BaseNodeConfig {
  type: "subWorkflow";
  /** Workflow ID or workflow definition to execute */
  workflow: string | WorkflowDefinition;
  /** Input for the sub-workflow */
  input?: unknown | ((context: WorkflowContext) => unknown);
  /** Transform the sub-workflow output */
  output?: (result: unknown) => unknown;
}

/**
 * Map node configuration (dynamic fan-out)
 */
export interface MapNodeConfig extends BaseNodeConfig {
  type: "map";
  /** Collection to iterate over (array) */
  items: unknown[] | ((context: WorkflowContext) => unknown[] | Promise<unknown[]>);
  /** Node or workflow to execute for each item */
  processor: WorkflowNode | WorkflowDefinition;
  /** Maximum concurrent executions */
  concurrency?: number;
}

/**
 * Union of all node configurations
 */
export type WorkflowNodeConfig =
  | StepNodeConfig
  | ParallelNodeConfig
  | MapNodeConfig
  | BranchNodeConfig
  | WaitNodeConfig
  | SubWorkflowNodeConfig
  | LoopNodeConfig;

/**
 * Loop node configuration (imported from DSL)
 * Re-exported here for the union type
 */
export interface LoopNodeConfig extends BaseNodeConfig {
  type: "loop";
  while: (context: WorkflowContext, loop: LoopExecutionContext) => boolean | Promise<boolean>;
  steps:
    | WorkflowNode[]
    | ((context: WorkflowContext, loop: LoopExecutionContext) => WorkflowNode[]);
  maxIterations: number;
  onMaxIterations?: (
    context: WorkflowContext,
    loop: LoopExecutionContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  onComplete?: (
    context: WorkflowContext,
    loop: LoopExecutionContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  iterationTimeout?: string | number;
  delay?: number | string;
}

/**
 * Loop execution context passed to loop callbacks
 */
export interface LoopExecutionContext {
  iteration: number;
  totalIterations: number;
  previousResults: unknown[];
  isFirstIteration: boolean;
  isLastAllowedIteration: boolean;
}

/**
 * A node in the workflow DAG
 */
export interface WorkflowNode {
  /** Unique node ID within the workflow */
  id: string;
  /** Node configuration */
  config: WorkflowNodeConfig;
  /** Dependencies (node IDs that must complete before this node) */
  dependsOn?: string[];
}

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Workflow context - accumulated data during execution
 */
export interface WorkflowContext {
  /** Input provided when workflow was started */
  input: unknown;
  /** Results from each completed node, keyed by node ID */
  [nodeId: string]: unknown;
}

/**
 * Helper to resolve BlobRefs into actual content.
 */
export interface BlobResolver {
  /** Get blob content as text. */
  getText(ref: BlobRef): Promise<string | null>;
  /** Get blob content as Uint8Array. */
  getBytes(ref: BlobRef): Promise<Uint8Array | null>;
  /** Get blob content as ReadableStream. */
  getStream(ref: BlobRef): Promise<ReadableStream | null>;
  /** Get blob metadata. */
  stat(ref: BlobRef): Promise<BlobRef | null>;
  /** Delete blob data. */
  delete(ref: BlobRef): Promise<void>;
}

/**
 * Step builder function context
 */
export interface StepBuilderContext<TInput = unknown> {
  /** Original workflow input */
  input: TInput;
  /** Accumulated context from previous steps */
  context: WorkflowContext;
  /** Blob storage access (if configured) */
  blobStorage?: BlobStorage;
  /** Helper to resolve BlobRefs to content */
  blob?: BlobResolver;
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition<
  TInput = unknown,
  TOutput = unknown,
> {
  /** Unique workflow identifier */
  id: string;
  /** Optional description */
  description?: string;
  /** Optional version */
  version?: string;
  /** Input validation schema */
  inputSchema?: z.ZodSchema<TInput>;
  /** Output validation schema */
  outputSchema?: z.ZodSchema<TOutput>;
  /** Default retry configuration for all steps */
  retry?: RetryConfig;
  /** Default timeout for the entire workflow */
  timeout?: string | number;
  /**
   * Allow the registry to execute the step builder for metadata extraction.
   * Set to true only if step construction is pure and has no side effects.
   */
  introspect?: boolean;
  /** Workflow steps - can be static or dynamic based on input */
  steps:
    | WorkflowNode[]
    | ((context: StepBuilderContext<TInput>) => WorkflowNode[]);
  /** Error handler */
  onError?: (error: Error, context: WorkflowContext) => void | Promise<void>;
  /** Completion handler */
  onComplete?: (
    result: TOutput,
    context: WorkflowContext,
  ) => void | Promise<void>;
}

/**
 * Created workflow with execution methods
 * (interface moved from dsl/workflow.ts to break circular dependency)
 */
export interface Workflow<TInput = unknown, TOutput = unknown> {
  /** Workflow definition */
  definition: WorkflowDefinition<TInput, TOutput>;
  /** Workflow ID */
  id: string;
  /** Workflow version */
  version?: string;
}

// ============================================================================
// Workflow Run State
// ============================================================================

/**
 * State of a single node during execution
 */
export interface NodeState {
  /** Node ID */
  nodeId: string;
  /** Current status */
  status: NodeStatus;
  /** Input provided to the node */
  input?: unknown;
  /** Output produced by the node */
  output?: unknown;
  /** Error message if failed */
  error?: string;
  /** Current attempt number (for retries) */
  attempt: number;
  /** When execution started */
  startedAt?: Date;
  /** When execution completed */
  completedAt?: Date;
}

/**
 * Checkpoint for workflow resume
 */
export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string;
  /** Node ID where checkpoint was created */
  nodeId: string;
  /** When checkpoint was created */
  timestamp: Date;
  /** Context at checkpoint time */
  context: WorkflowContext;
  /** Node states at checkpoint time */
  nodeStates: Record<string, NodeState>;
}

/**
 * Pending approval request
 */
export interface PendingApproval {
  /** Unique approval ID */
  id: string;
  /** Node ID that requested approval */
  nodeId: string;
  /** Message for the approver */
  message: string;
  /** Payload with context for the approver */
  payload: unknown;
  /** Allowed approvers (if restricted) */
  approvers?: string[];
  /** When approval was requested */
  requestedAt: Date;
  /** When approval expires */
  expiresAt?: Date;
  /** Current approval status */
  status: "pending" | "approved" | "rejected" | "expired";
  /** Who approved/rejected */
  decidedBy?: string;
  /** When decision was made */
  decidedAt?: Date;
  /** Optional comment from approver */
  comment?: string;
}

/**
 * Workflow run - tracks execution of a workflow instance
 */
export interface WorkflowRun<TInput = unknown, TOutput = unknown> {
  /** Unique run ID */
  id: string;
  /** Workflow definition ID */
  workflowId: string;
  /** Workflow version */
  version?: string;
  /** Current status */
  status: WorkflowStatus;
  /** Input provided when started */
  input: TInput;
  /** Final output (when completed) */
  output?: TOutput;

  // Execution state
  /** State of each node in the workflow */
  nodeStates: Record<string, NodeState>;
  /** Currently executing node IDs */
  currentNodes: string[];
  /** Accumulated context */
  context: WorkflowContext;

  // Durability
  /** Checkpoints for resume */
  checkpoints: Checkpoint[];
  /** Pending approvals */
  pendingApprovals: PendingApproval[];

  // Error state
  /** Error information if failed */
  error?: {
    message: string;
    stack?: string;
    nodeId?: string;
  };

  // Timing
  /** When run was created */
  createdAt: Date;
  /** When execution started */
  startedAt?: Date;
  /** When execution completed */
  completedAt?: Date;
}

// ============================================================================
// Approval Decision
// ============================================================================

/**
 * Decision on a pending approval
 */
export interface ApprovalDecision {
  /** Whether the approval was granted */
  approved: boolean;
  /** Who made the decision */
  approver: string;
  /** Optional comment */
  comment?: string;
}

// ============================================================================
// Workflow Job (for queue-based execution)
// ============================================================================

/**
 * Job for queue-based workflow execution
 */
export interface WorkflowJob {
  /** Run ID */
  runId: string;
  /** Workflow ID */
  workflowId: string;
  /** Input data */
  input: unknown;
  /** Priority (higher = more urgent) */
  priority?: number;
  /** When job was created */
  createdAt: Date;
}

// ============================================================================
// Run Filter (for querying runs)
// ============================================================================

/**
 * Filter options for listing workflow runs
 */
export interface RunFilter {
  /** Filter by workflow ID */
  workflowId?: string;
  /** Filter by status */
  status?: WorkflowStatus | WorkflowStatus[];
  /** Filter by creation date (after) */
  createdAfter?: Date;
  /** Filter by creation date (before) */
  createdBefore?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ============================================================================
// Duration parsing utility type
// ============================================================================

/**
 * Duration string format: "1h", "30m", "2d", etc.
 */
export type DurationString = string;

/**
 * Parse duration string to milliseconds
 *
 * @throws Error if duration is invalid, zero, or negative
 */
export function parseDuration(duration: string | number): number {
  if (typeof duration === "number") {
    if (duration < 0) {
      throw new Error(`Duration cannot be negative: ${duration}`);
    }
    return duration;
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = match[1];
  const unit = match[2];

  if (!value || !unit) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const num = parseFloat(value);

  // Reject zero and negative values
  if (num <= 0) {
    throw new Error(`Duration must be positive: ${duration}`);
  }

  switch (unit) {
    case "ms":
      return num;
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Validate retry configuration
 *
 * @throws Error if retry config has invalid values
 */
export function validateRetryConfig(config: RetryConfig): void {
  if (config.maxAttempts !== undefined) {
    if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1) {
      throw new Error(`maxAttempts must be a positive integer, got: ${config.maxAttempts}`);
    }
  }

  if (config.initialDelay !== undefined) {
    if (config.initialDelay < 0) {
      throw new Error(`initialDelay cannot be negative: ${config.initialDelay}`);
    }
  }

  if (config.maxDelay !== undefined) {
    if (config.maxDelay < 0) {
      throw new Error(`maxDelay cannot be negative: ${config.maxDelay}`);
    }
  }

  if (config.initialDelay !== undefined && config.maxDelay !== undefined) {
    if (config.initialDelay > config.maxDelay) {
      throw new Error(
        `initialDelay (${config.initialDelay}) cannot be greater than maxDelay (${config.maxDelay})`,
      );
    }
  }

  if (config.backoff !== undefined) {
    const validBackoffs = new Set(["fixed", "linear", "exponential"]);
    if (!validBackoffs.has(config.backoff)) {
      throw new Error(
        `Invalid backoff strategy: ${config.backoff}. Must be one of: ${
          [...validBackoffs].join(", ")
        }`,
      );
    }
  }
}

/**
 * Generate a unique ID for workflow runs, nodes, etc.
 */
export function generateId(prefix: string = "wf"): string {
  const randomPart = crypto.randomUUID().slice(0, 12);
  return `${prefix}_${randomPart}`;
}
