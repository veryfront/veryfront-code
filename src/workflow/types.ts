/**
 * Workflow type definitions
 *
 * Re-exports schema types and defines interfaces with functions/methods.
 */

import type { z } from "zod";
import type { Agent } from "#veryfront/agent";
import type { Tool } from "#veryfront/tool";
import type { BlobRef, BlobStorage } from "./blob/types.ts";

// Re-export schema types (Checkpoint excluded - defined locally to use WorkflowContext interface)
export type {
  ApprovalDecision,
  ApprovalStatus,
  BackoffStrategy,
  LoopExecutionContext,
  NodeState,
  NodeStatus,
  ParallelStrategy,
  PendingApproval,
  RetryConfig,
  RunFilter,
  WaitType,
  WorkflowError,
  WorkflowJob,
  WorkflowNodeType,
  WorkflowStatus,
} from "./schemas/index.ts";

// Import for use in interfaces
import type {
  LoopExecutionContext,
  NodeState,
  ParallelStrategy,
  PendingApproval,
  RetryConfig,
  WaitType,
  WorkflowError,
  WorkflowStatus,
} from "./schemas/index.ts";

// Duration string type alias
export type DurationString = string;

/**
 * Workflow context - accumulates node outputs during execution
 */
export interface WorkflowContext {
  input: unknown;
  [nodeId: string]: unknown;
}

/**
 * Checkpoint - defined locally to use WorkflowContext interface
 * (Zod inference doesn't handle index signatures with required properties well)
 */
export interface Checkpoint {
  id: string;
  nodeId: string;
  timestamp: Date;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
}

/**
 * Blob resolver interface
 */
export interface BlobResolver {
  getText(ref: BlobRef): Promise<string | null>;
  getBytes(ref: BlobRef): Promise<Uint8Array | null>;
  getStream(ref: BlobRef): Promise<ReadableStream | null>;
  stat(ref: BlobRef): Promise<BlobRef | null>;
  delete(ref: BlobRef): Promise<void>;
}

/**
 * Step builder context
 */
export interface StepBuilderContext<TInput = unknown> {
  input: TInput;
  context: WorkflowContext;
  blobStorage?: BlobStorage;
  blob?: BlobResolver;
}

/**
 * Base node configuration (shared by all node types)
 */
export interface BaseNodeConfig {
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Step node configuration
 */
export interface StepNodeConfig extends BaseNodeConfig {
  type: "step";
  agent?: string | Agent;
  tool?: string | Tool;
  input?: string | Record<string, unknown> | ((context: WorkflowContext) => unknown);
}

/**
 * Parallel node configuration
 */
export interface ParallelNodeConfig extends BaseNodeConfig {
  type: "parallel";
  nodes: WorkflowNode[];
  strategy?: ParallelStrategy;
}

/**
 * Branch node configuration
 */
export interface BranchNodeConfig extends BaseNodeConfig {
  type: "branch";
  condition: (context: WorkflowContext) => boolean | Promise<boolean>;
  then: WorkflowNode[];
  else?: WorkflowNode[];
}

/**
 * Wait node configuration
 */
export interface WaitNodeConfig extends BaseNodeConfig {
  type: "wait";
  waitType: WaitType;
  message?: string;
  payload?: unknown | ((context: WorkflowContext) => unknown);
  approvers?: string[];
  eventName?: string;
}

/**
 * Sub-workflow node configuration
 */
export interface SubWorkflowNodeConfig extends BaseNodeConfig {
  type: "subWorkflow";
  workflow: string | WorkflowDefinition;
  input?: unknown | ((context: WorkflowContext) => unknown);
  output?: (result: unknown) => unknown;
}

/**
 * Map node configuration
 */
export interface MapNodeConfig extends BaseNodeConfig {
  type: "map";
  items: unknown[] | ((context: WorkflowContext) => unknown[] | Promise<unknown[]>);
  processor: WorkflowNode | WorkflowDefinition;
  concurrency?: number;
}

/**
 * Loop node configuration
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
 * Union of all workflow node configurations
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
 * Workflow node
 */
export interface WorkflowNode {
  id: string;
  config: WorkflowNodeConfig;
  dependsOn?: string[];
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  description?: string;
  version?: string;
  inputSchema?: z.ZodSchema<TInput>;
  outputSchema?: z.ZodSchema<TOutput>;
  retry?: RetryConfig;
  timeout?: string | number;
  introspect?: boolean;
  steps: WorkflowNode[] | ((context: StepBuilderContext<TInput>) => WorkflowNode[]);
  onError?: (error: Error, context: WorkflowContext) => void | Promise<void>;
  onComplete?: (result: TOutput, context: WorkflowContext) => void | Promise<void>;
}

/**
 * Workflow instance
 */
export interface Workflow<TInput = unknown, TOutput = unknown> {
  definition: WorkflowDefinition<TInput, TOutput>;
  id: string;
  version?: string;
}

/**
 * Workflow run state
 */
export interface WorkflowRun<TInput = unknown, TOutput = unknown> {
  id: string;
  workflowId: string;
  version?: string;
  status: WorkflowStatus;
  input: TInput;
  output?: TOutput;
  nodeStates: Record<string, NodeState>;
  currentNodes: string[];
  context: WorkflowContext;
  checkpoints: Checkpoint[];
  pendingApprovals: PendingApproval[];
  error?: WorkflowError;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// Utility functions

/**
 * Parse duration string to milliseconds
 */
export function parseDuration(duration: string | number): number {
  if (typeof duration === "number") {
    if (duration < 0) throw new Error(`Duration cannot be negative: ${duration}`);
    return duration;
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
  if (!match || !match[1] || !match[2]) throw new Error(`Invalid duration format: ${duration}`);

  const num = parseFloat(match[1]);
  if (num <= 0) throw new Error(`Duration must be positive: ${duration}`);

  switch (match[2]) {
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
      throw new Error(`Unknown duration unit: ${match[2]}`);
  }
}

/**
 * Validate retry configuration
 */
export function validateRetryConfig(config: RetryConfig): void {
  const { maxAttempts, initialDelay, maxDelay, backoff } = config;

  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
    throw new Error(`maxAttempts must be a positive integer, got: ${maxAttempts}`);
  }

  if (initialDelay !== undefined && initialDelay < 0) {
    throw new Error(`initialDelay cannot be negative: ${initialDelay}`);
  }

  if (maxDelay !== undefined && maxDelay < 0) {
    throw new Error(`maxDelay cannot be negative: ${maxDelay}`);
  }

  if (initialDelay !== undefined && maxDelay !== undefined && initialDelay > maxDelay) {
    throw new Error(`initialDelay (${initialDelay}) cannot be greater than maxDelay (${maxDelay})`);
  }

  if (backoff === undefined) return;

  const validBackoffs = new Set(["fixed", "linear", "exponential"]);

  if (validBackoffs.has(backoff)) return;

  throw new Error(
    `Invalid backoff strategy: ${backoff}. Must be one of: ${[...validBackoffs].join(", ")}`,
  );
}

/**
 * Generate a unique workflow ID
 */
export function generateId(prefix: string = "wf"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}
