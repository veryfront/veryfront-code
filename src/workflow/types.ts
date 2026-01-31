import type { z } from "zod";
import type { Agent } from "#veryfront/agent";
import type { Tool } from "#veryfront/tool";
import type { BlobRef, BlobStorage } from "./blob/types.ts";

export type WorkflowStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type WorkflowNodeType =
  | "step"
  | "parallel"
  | "map"
  | "branch"
  | "wait"
  | "subWorkflow"
  | "loop";

export interface RetryConfig {
  maxAttempts?: number;
  backoff?: "fixed" | "linear" | "exponential";
  initialDelay?: number;
  maxDelay?: number;
  retryIf?: (error: Error) => boolean;
}

export interface BaseNodeConfig {
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export interface StepNodeConfig extends BaseNodeConfig {
  type: "step";
  agent?: string | Agent;
  tool?: string | Tool;
  input?: string | Record<string, unknown> | ((context: WorkflowContext) => unknown);
}

export interface ParallelNodeConfig extends BaseNodeConfig {
  type: "parallel";
  nodes: WorkflowNode[];
  strategy?: "all" | "race" | "allSettled";
}

export interface BranchNodeConfig extends BaseNodeConfig {
  type: "branch";
  condition: (context: WorkflowContext) => boolean | Promise<boolean>;
  then: WorkflowNode[];
  else?: WorkflowNode[];
}

export interface WaitNodeConfig extends BaseNodeConfig {
  type: "wait";
  waitType: "approval" | "event";
  message?: string;
  payload?: unknown | ((context: WorkflowContext) => unknown);
  approvers?: string[];
  eventName?: string;
}

export interface SubWorkflowNodeConfig extends BaseNodeConfig {
  type: "subWorkflow";
  workflow: string | WorkflowDefinition;
  input?: unknown | ((context: WorkflowContext) => unknown);
  output?: (result: unknown) => unknown;
}

export interface MapNodeConfig extends BaseNodeConfig {
  type: "map";
  items: unknown[] | ((context: WorkflowContext) => unknown[] | Promise<unknown[]>);
  processor: WorkflowNode | WorkflowDefinition;
  concurrency?: number;
}

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

export type WorkflowNodeConfig =
  | StepNodeConfig
  | ParallelNodeConfig
  | MapNodeConfig
  | BranchNodeConfig
  | WaitNodeConfig
  | SubWorkflowNodeConfig
  | LoopNodeConfig;

export interface LoopExecutionContext {
  iteration: number;
  totalIterations: number;
  previousResults: unknown[];
  isFirstIteration: boolean;
  isLastAllowedIteration: boolean;
}

export interface WorkflowNode {
  id: string;
  config: WorkflowNodeConfig;
  dependsOn?: string[];
}

export interface WorkflowContext {
  input: unknown;
  [nodeId: string]: unknown;
}

export interface BlobResolver {
  getText(ref: BlobRef): Promise<string | null>;
  getBytes(ref: BlobRef): Promise<Uint8Array | null>;
  getStream(ref: BlobRef): Promise<ReadableStream | null>;
  stat(ref: BlobRef): Promise<BlobRef | null>;
  delete(ref: BlobRef): Promise<void>;
}

export interface StepBuilderContext<TInput = unknown> {
  input: TInput;
  context: WorkflowContext;
  blobStorage?: BlobStorage;
  blob?: BlobResolver;
}

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

export interface Workflow<TInput = unknown, TOutput = unknown> {
  definition: WorkflowDefinition<TInput, TOutput>;
  id: string;
  version?: string;
}

export interface NodeState {
  nodeId: string;
  status: NodeStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  attempt: number;
  startedAt?: Date;
  completedAt?: Date;
}

export interface Checkpoint {
  id: string;
  nodeId: string;
  timestamp: Date;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
}

export interface PendingApproval {
  id: string;
  nodeId: string;
  message: string;
  payload: unknown;
  approvers?: string[];
  requestedAt: Date;
  expiresAt?: Date;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedBy?: string;
  decidedAt?: Date;
  comment?: string;
}

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
  error?: {
    message: string;
    stack?: string;
    nodeId?: string;
  };
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ApprovalDecision {
  approved: boolean;
  approver: string;
  comment?: string;
}

export interface WorkflowJob {
  runId: string;
  workflowId: string;
  input: unknown;
  priority?: number;
  createdAt: Date;
}

export interface RunFilter {
  workflowId?: string;
  status?: WorkflowStatus | WorkflowStatus[];
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

export type DurationString = string;

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

  const validBackoffs: ReadonlySet<NonNullable<RetryConfig["backoff"]>> = new Set([
    "fixed",
    "linear",
    "exponential",
  ]);

  if (validBackoffs.has(backoff)) return;

  throw new Error(
    `Invalid backoff strategy: ${backoff}. Must be one of: ${[...validBackoffs].join(", ")}`,
  );
}

export function generateId(prefix: string = "wf"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}
