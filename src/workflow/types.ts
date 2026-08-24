/**
 * Workflow type definitions
 *
 * Re-exports schema types and defines interfaces with functions/methods.
 */

import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { Agent } from "#veryfront/agent/types.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import type { ScheduleIntegrationRequirementConfig } from "#veryfront/schedule/types.ts";
import type { BlobRef, BlobStorage } from "./blob/types.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { WorkflowProjectionState } from "./runtime-state.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES,
  MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
} from "./limits.ts";

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
  WorkflowNodeType,
  WorkflowQueueItem,
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

/**
 * Workflow context containing JSON-representable input and node outputs.
 *
 * A run that suspends is persisted as JSON, so anything a step writes here has
 * to survive `JSON.stringify` unchanged. A `Date`, `Map`, or class instance
 * does not: it is readable in memory and comes back as something else after a
 * resume, which makes the type a later step sees depend on whether the run
 * happened to pause. `serializeWorkflowContext` enforces this at the
 * persistence boundary.
 */
export interface WorkflowContext {
  input: unknown;
  env?: Record<string, string>;
  _tenant?: CapturedTenantContext;
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
  /** @internal Framework-only public projection ownership sidecar. */
  _workflowProjection?: WorkflowProjectionState;
  /** @internal Validated root snapshot for resuming a descendant checkpoint. */
  _resumeEnvelope?: CheckpointResumeEnvelope;
}

/** @internal Serializable identity of one admitted workflow graph node. */
export interface WorkflowGraphIdentityNode {
  readonly id: string;
  readonly type: WorkflowNodeConfig["type"];
  readonly dependsOn: readonly string[] | null;
  readonly composite: WorkflowGraphCompositeIdentity | null;
}

/** @internal Serializable identity of statically visible composite descendants. */
export type WorkflowGraphCompositeIdentity =
  | {
    readonly kind: "parallel";
    readonly strategy: ParallelStrategy | null;
    readonly nodes: readonly WorkflowGraphIdentityNode[];
  }
  | {
    readonly kind: "branch";
    readonly then: readonly WorkflowGraphIdentityNode[];
    readonly else: readonly WorkflowGraphIdentityNode[] | null;
  }
  | {
    readonly kind: "loop";
    readonly dynamic: boolean;
    readonly nodes: readonly WorkflowGraphIdentityNode[] | null;
  }
  | {
    readonly kind: "map";
    readonly processorKind: "node" | "workflow";
    readonly processorId: string;
    readonly processorVersion: string | null;
    readonly dynamic: boolean;
    readonly nodes: readonly WorkflowGraphIdentityNode[] | null;
  }
  | {
    readonly kind: "subWorkflow";
    readonly workflowId: string;
    readonly workflowVersion: string | null;
    readonly dynamic: boolean;
    readonly nodes: readonly WorkflowGraphIdentityNode[] | null;
  };

export type WorkflowGraphIdentity = readonly WorkflowGraphIdentityNode[];

/** @internal Durable root graph admission captured before any admitted node runs. */
export interface WorkflowGraphAdmission {
  readonly stepsEvaluationContext: WorkflowContext;
  readonly stepsEvaluationProjection: WorkflowProjectionState;
  readonly graphIdentity: WorkflowGraphIdentity;
  readonly workflowVersion: string | null;
}

/** @internal Durable root snapshot synthesized by the owning composite stack. */
export interface CheckpointResumeEnvelope {
  readonly schemaVersion: 2;
  /** Root composite/node that owns this resumable transaction. */
  readonly ownerNodeId: string;
  readonly context: WorkflowContext;
  readonly nodeStates: Record<string, NodeState>;
  readonly workflowProjection: WorkflowProjectionState;
  /** Original root graph-admission snapshot; never derived from post-node context. */
  readonly graphAdmission: WorkflowGraphAdmission;
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
  /**
   * Human-readable purpose for this node, surfaced through workflow metadata so
   * a run view can label the step with something an operator understands rather
   * than its id.
   */
  description?: string;
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
  /**
   * Explicit identities allowed to decide the approval. When omitted, the
   * authenticated host boundary is responsible for supplying the caller's
   * canonical identity to the approval API.
   */
  approvers?: string[];
  eventName?: string;
  /**
   * Shape a human's structured answer must satisfy. Validated when the decision
   * is submitted, so a non-conformant answer is refused rather than persisted.
   * Held in the registered definition rather than the run record -- a schema is
   * not serializable.
   */
  responseSchema?: Schema<unknown>;
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
  /** Required for a persisted run to be safely resumed after its initial start admission. */
  version?: string;
  inputSchema?: Schema<TInput>;
  outputSchema?: Schema<TOutput>;
  /** Explicit integration scopes and resources required by scheduled runs. */
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
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
 * Captured tenant context for multi-tenant workflow execution.
 * Allows tools and framework utilities to access the current tenant
 * without explicit parameter passing.
 */
export interface CapturedTenantContext {
  /** Project slug identifying the tenant */
  projectSlug: string;
  /** OAuth token for API access */
  token: string;
  /** Optional project ID (UUID) */
  projectId?: string;
  /** Whether running in production mode */
  productionMode: boolean;
  /** Release ID for production deployments */
  releaseId?: string | null;
  /** Branch name or ID for preview mode */
  branch?: string | null;
  /** Environment name associated with this tenant context */
  environmentName?: string | null;
}

/**
 * Workflow run state
 */
export interface WorkflowRun<TInput = unknown, TOutput = unknown> {
  id: string;
  workflowId: string;
  /** Immutable definition version; persisted recovery requires a non-null exact match. */
  version?: string;
  status: WorkflowStatus;
  input: TInput;
  output?: TOutput;
  nodeStates: Record<string, NodeState>;
  /**
   * Nodes the run is occupied with right now: the top-level batch it is
   * executing while `running`, the node it is parked on while `waiting` (which
   * can be a child of a composite), and empty once it completes. A failed run
   * keeps the nodes in its terminal batch that failed or were still running. A
   * cancelled run keeps the last recorded value, so both terminal states still
   * name where execution stopped.
   */
  currentNodes: string[];
  context: WorkflowContext;
  checkpoints: Checkpoint[];
  pendingApprovals: PendingApproval[];
  error?: WorkflowError;
  createdAt: Date;
  startedAt?: Date;
  /** Last heartbeat timestamp for liveness detection in distributed workers */
  heartbeatAt?: Date;
  completedAt?: Date;
  /** Exact source-owned integration restriction captured when this run was created. */
  readonly sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  /** Worker ID for distributed execution */
  workerId?: string;
  /** Captured tenant context for multi-tenant job execution */
  _tenant?: CapturedTenantContext;
  /**
   * @internal W3C `traceparent` of the most recent execution's `workflow.run`
   * span. A run that parks and resumes traces once per execution; the next
   * execution links back to this so the executions stay joined.
   */
  _traceContext?: string;
  /** @internal Immutable durable provenance model version. */
  _runtimeStateVersion?: number;
  /** @internal Framework-only public projection ownership sidecar. */
  _workflowProjection?: WorkflowProjectionState;
}

// Utility functions

import { INVALID_ARGUMENT } from "#veryfront/errors";

const arrayIsArray = Array.isArray;
const cryptoObject = crypto;
const cryptoRandomUUID = crypto.randomUUID;
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/;
const GENERATED_ID_SUFFIX_CODE_UNITS = 13;
const numberIsSafeInteger = Number.isSafeInteger;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;
const regExpExec = RegExp.prototype.exec;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const stringTrim = String.prototype.trim;
const StringConstructor = String;

function defineArrayElement<T>(values: T[], index: number, value: T): void {
  objectDefineProperty(values, index, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Whether a value is a non-empty approval identity without surrounding whitespace. */
export function isCanonicalApprovalIdentity(value: unknown): value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS ||
    reflectApply(stringTrim, value, []) !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index++) {
    const code = reflectApply(stringCharCodeAt, value, [index]) as number;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

/** Validate and snapshot an optional explicit approval allowlist. */
export function captureApprovalApprovers(
  value: unknown,
  label = "Approval approvers",
): string[] | undefined {
  if (value === undefined) return undefined;
  if (isProxyWithoutHooks(value) || !arrayIsArray(value)) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must be a non-empty array of canonical strings`,
    });
  }

  const keys = reflectOwnKeys(value);
  const lengthDescriptor = reflectGetOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && objectHasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : undefined;
  if (
    !numberIsSafeInteger(length) || (length as number) < 1 ||
    (length as number) > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES ||
    keys.length !== (length as number) + 1
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `${label} must be a dense non-empty array with at most ${MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES} canonical strings`,
    });
  }

  const captured: string[] = [];
  const seen = new SetConstructor<string>();
  for (let index = 0; index < (length as number); index++) {
    const descriptor = reflectGetOwnPropertyDescriptor(value, StringConstructor(index));
    if (
      descriptor?.enumerable !== true ||
      !objectHasOwn(descriptor, "value")
    ) {
      throw INVALID_ARGUMENT.create({
        detail:
          `${label} must be a dense non-empty array with at most ${MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES} canonical strings`,
      });
    }
    const approver = descriptor.value;
    if (!isCanonicalApprovalIdentity(approver)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `${label} must contain canonical strings of at most ${MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS} code units without control characters`,
      });
    }
    if (reflectApply(setHas, seen, [approver])) {
      throw INVALID_ARGUMENT.create({
        detail: `${label} must not contain duplicate identities`,
      });
    }
    reflectApply(setAdd, seen, [approver]);
    defineArrayElement(captured, captured.length, approver);
  }
  return objectFreeze(captured) as string[];
}

/**
 * Maximum retry attempts accepted by executable workflow nodes.
 *
 * This matches the loop iteration ceiling and prevents configurations that can
 * consume effectively unbounded worker time or overflow exponential backoff
 * arithmetic before the configured maximum delay is applied.
 */
export const MAX_WORKFLOW_RETRY_ATTEMPTS = 100;

const DURATION_UNIT_MILLISECONDS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

const VALID_BACKOFF_STRATEGIES = ["fixed", "linear", "exponential"] as const;
const VALID_BACKOFF_SET: ReadonlySet<string> = new Set(VALID_BACKOFF_STRATEGIES);

/**
 * Parse duration string to milliseconds
 */
export function parseDuration(duration: string | number): number {
  return parseDurationWithLabel(duration, "Duration");
}

/**
 * Parse a duration with a boundary-specific label for actionable errors.
 *
 * @internal
 */
export function parseDurationWithLabel(
  duration: string | number,
  label: string,
): number {
  if (typeof duration === "number") {
    if (duration < 0) {
      throw INVALID_ARGUMENT.create({ detail: `${label} cannot be negative: ${duration}` });
    }
    if (!numberIsSafeInteger(duration)) {
      throw INVALID_ARGUMENT.create({
        detail: `${label} must be a safe integer number of milliseconds, got: ${duration}`,
      });
    }
    if (duration > MAX_TIMER_DELAY_MS) {
      throw INVALID_ARGUMENT.create({
        detail: `${label} cannot exceed ${MAX_TIMER_DELAY_MS} milliseconds, got: ${duration}`,
      });
    }
    return duration === 0 ? 0 : duration;
  }

  const match = reflectApply(regExpExec, DURATION_PATTERN, [duration]) as
    | RegExpExecArray
    | null;
  if (!match || !match[1] || !match[2]) {
    throw INVALID_ARGUMENT.create({
      detail: label === "Duration"
        ? `Invalid duration format: ${duration}`
        : `Invalid duration format for ${label}: ${duration}`,
    });
  }

  const value = +match[1];
  if (value <= 0) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be positive: ${duration}` });
  }

  const milliseconds = value *
    DURATION_UNIT_MILLISECONDS[match[2] as keyof typeof DURATION_UNIT_MILLISECONDS];

  if (!numberIsSafeInteger(milliseconds)) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must resolve to a safe integer number of milliseconds, got: ${duration}`,
    });
  }
  if (milliseconds > MAX_TIMER_DELAY_MS) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} cannot exceed ${MAX_TIMER_DELAY_MS} milliseconds, got: ${duration}`,
    });
  }

  return milliseconds;
}

/**
 * Parse a duration that represents a timeout or interval and therefore cannot
 * use zero to mean "disabled".
 *
 * @internal
 */
export function parsePositiveDurationWithLabel(
  duration: string | number,
  label: string,
): number {
  const milliseconds = parseDurationWithLabel(duration, label);
  if (milliseconds === 0) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be greater than zero` });
  }
  return milliseconds;
}

/**
 * Validate retry configuration
 */
export function validateRetryConfig(config: RetryConfig, label = "Retry"): void {
  const fields = inspectRetryConfig(config, label);
  const { maxAttempts, initialDelay, maxDelay, backoff, retryIf } = fields;

  if (
    maxAttempts !== undefined &&
    (typeof maxAttempts !== "number" || !numberIsSafeInteger(maxAttempts) || maxAttempts < 1)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} maxAttempts must be a positive integer, got: ${
        typeof maxAttempts === "number" ? maxAttempts : typeof maxAttempts
      }`,
    });
  }

  if (
    typeof maxAttempts === "number" &&
    maxAttempts > MAX_WORKFLOW_RETRY_ATTEMPTS
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `${label} maxAttempts cannot exceed ${MAX_WORKFLOW_RETRY_ATTEMPTS}, got: ${maxAttempts}`,
    });
  }

  validateRetryDelay(initialDelay, "initialDelay", label);
  validateRetryDelay(maxDelay, "maxDelay", label);

  if (
    typeof initialDelay === "number" && typeof maxDelay === "number" &&
    initialDelay > maxDelay
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `initialDelay (${initialDelay}) cannot be greater than maxDelay (${maxDelay})`,
    });
  }

  if (retryIf !== undefined && typeof retryIf !== "function") {
    throw INVALID_ARGUMENT.create({
      detail: `${label} retryIf must be a function`,
    });
  }

  if (backoff === undefined) return;

  if (typeof backoff === "string" && reflectApply(setHas, VALID_BACKOFF_SET, [backoff])) return;

  throw INVALID_ARGUMENT.create({
    detail: `Invalid backoff strategy. Must be one of: fixed, linear, exponential`,
  });
}

interface InspectedRetryConfig {
  readonly maxAttempts?: unknown;
  readonly initialDelay?: unknown;
  readonly maxDelay?: unknown;
  readonly backoff?: unknown;
  readonly retryIf?: unknown;
}

function inspectRetryConfig(value: unknown, label: string): InspectedRetryConfig {
  if (
    typeof value !== "object" || value === null || arrayIsArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be a plain record` });
  }

  let prototype: object | null;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be a plain record` });
  }
  if (prototype !== objectPrototype && prototype !== null) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be a plain record` });
  }

  const read = (key: keyof InspectedRetryConfig): unknown => {
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!objectHasOwn(descriptor, "value")) {
      throw INVALID_ARGUMENT.create({
        detail: `${label} must contain only own data properties`,
      });
    }
    return descriptor.value;
  };

  return {
    maxAttempts: read("maxAttempts"),
    initialDelay: read("initialDelay"),
    maxDelay: read("maxDelay"),
    backoff: read("backoff"),
    retryIf: read("retryIf"),
  };
}

function validateRetryDelay(
  delay: unknown,
  field: "initialDelay" | "maxDelay",
  label: string,
): void {
  if (delay === undefined) return;

  if (typeof delay !== "number") {
    throw INVALID_ARGUMENT.create({
      detail: `${label} ${field} must be a non-negative safe integer`,
    });
  }
  if (delay < 0) {
    throw INVALID_ARGUMENT.create({ detail: `${field} cannot be negative: ${delay}` });
  }
  if (!numberIsSafeInteger(delay)) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} ${field} must be a non-negative safe integer, got: ${delay}`,
    });
  }
  if (delay > MAX_TIMER_DELAY_MS) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} ${field} cannot exceed ${MAX_TIMER_DELAY_MS}, got: ${delay}`,
    });
  }
}

/**
 * Generate a unique workflow ID
 */
export function generateId(prefix: string = "wf"): string {
  if (
    !isCanonicalApprovalIdentity(prefix) ||
    prefix.length > MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS - GENERATED_ID_SUFFIX_CODE_UNITS
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow ID prefix must be a canonical string",
    });
  }
  const uuid = reflectApply(cryptoRandomUUID, cryptoObject, []) as string;
  return `${prefix}_${reflectApply(stringSlice, uuid, [0, 12])}`;
}
