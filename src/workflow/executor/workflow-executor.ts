/**************************
 * Workflow Executor
 *
 * Main orchestrator for executing durable workflows
 **************************/

import { logger as baseLogger, sleep } from "#veryfront/utils";
import {
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  RESOURCE_NOT_FOUND,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import type {
  BlobResolver,
  StepBuilderContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowGraphAdmission,
  WorkflowNode,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { generateId, parseDurationWithLabel, parsePositiveDurationWithLabel } from "../types.ts";
import { hasLockSupport, updateRunIfStatus, type WorkflowBackend } from "../backends/types.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { env as getProcessEnv, unrefTimer } from "#veryfront/compat/process.ts";
import { mergeInjectedWorkflowEnv } from "#veryfront/runs/runtime-env.ts";
import { DAGExecutor } from "./dag-executor.ts";
import { CheckpointManager } from "./checkpoint-manager.ts";
import { runWithWorkflowTenant, StepExecutor, type StepExecutorConfig } from "./step-executor.ts";
import { isBlobRef } from "../blob/guards.ts";
import type { BlobStorage } from "../blob/types.ts";
import {
  captureWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import {
  executeWorkflowRunControl,
  type WorkflowRunControlExecutionFence,
} from "../runtime/workflow-run-control.ts";
import {
  captureWorkflowDefinition,
  captureWorkflowDefinitions,
  captureWorkflowNodes,
  captureWorkflowStaticValue,
  cloneCapturedWorkflowStaticValue,
} from "./workflow-definition-snapshot.ts";
import { throwIfAbortedWithCleanup } from "./abortable-operation.ts";
import { MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS } from "../limits.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { toPublicWorkflowRun, toPublicWorkflowRuns } from "../runtime/public-run.ts";
import {
  checkpointContainsTimedWaitWake,
  getTimedWaitWakeNodeId,
  getTimedWorkflowWait,
  reconcileTimedWorkflowWait,
  type TimedWorkflowWaitRegistration,
} from "../runtime/timed-wait-reconciliation.ts";
import { WORKFLOW_RUNTIME_STATE_VERSION, type WorkflowProjectionState } from "../runtime-state.ts";
import { captureCanonicalWorkflowGraphIdentity } from "./dag/graph-identity.ts";

const logger = baseLogger.component("workflow-executor");

/** Default polling interval for waiting on workflow result */
const DEFAULT_RESULT_POLL_INTERVAL_MS = 1_000;

/** Default max time waitForResult() polls before giving up (5 minutes) */
const DEFAULT_RESULT_WAIT_TIMEOUT_MS = 5 * 60 * 1_000;

/** Time allowed for an aborted graph to finish its cooperative cleanup. */
const DEFAULT_CANCELLATION_GRACE_PERIOD_MS = 1_000;

type WorkflowExecutorLifecycleState = "open" | "closing" | "closed";

interface ActiveWorkflowExecution extends WorkflowRunControlExecutionFence {
  readonly runId: string;
  readonly controller: AbortController;
}

interface ScheduledTimedWaitRegistration extends TimedWorkflowWaitRegistration {
  readonly key: string;
  timerId?: ReturnType<typeof setTimeout>;
}

function timedWaitRegistrationKey(runId: string, nodeId: string): string {
  return JSON.stringify([runId, nodeId]);
}

type ShutdownCancellationOutcome = "cancelled" | "terminal" | "handed-off";

function isTerminalRun(run: WorkflowRun): boolean {
  return run.status === "completed" || run.status === "failed" || run.status === "cancelled";
}

async function runLifecycleObservers(
  label: string,
  callbacks: Array<() => void | Promise<void>>,
): Promise<void> {
  const outcomes = await Promise.allSettled(
    callbacks.map((callback) => Promise.resolve().then(callback)),
  );
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : []
  );
  if (failures.length > 0) throw new AggregateError(failures, label);
}

function supportsExecutionOwnership(backend: WorkflowBackend): boolean {
  return typeof backend.updateRunIfStatusAndWorker === "function" &&
    typeof backend.saveCheckpointIfStatusAndWorker === "function" &&
    typeof backend.savePendingApprovalIfStatusAndWorker === "function";
}

/**
 * Workflow executor configuration
 */
export interface WorkflowExecutorConfig {
  /** Backend for persistence */
  backend: WorkflowBackend;
  /** Blob storage for large data */
  blobStorage?: BlobStorage;
  /** Step executor configuration */
  stepExecutor?: StepExecutorConfig;
  /** Maximum concurrent parallel executions */
  maxConcurrency?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Positive safe-integer lock duration in portable timer range (default: 30000). */
  lockDuration?: number;
  /** Positive safe-integer heartbeat interval in portable timer range (default: 10000). */
  heartbeatInterval?: number;
  /** Enable distributed locking (default: true if backend supports it) */
  enableLocking?: boolean;
  /** Positive safe-integer result wait timeout in portable timer range (default: 300000). */
  resultWaitTimeout?: number;
  /** Non-negative safe-integer cleanup grace in portable timer range (default: 1000). */
  cancellationGracePeriod?: number;
  /** Callback when workflow starts */
  onStart?: (run: WorkflowRun) => void | Promise<void>;
  /** Callback when workflow completes */
  onComplete?: (run: WorkflowRun) => void | Promise<void>;
  /** Callback when workflow fails */
  onError?: (run: WorkflowRun, error: Error) => void | Promise<void>;
  /** Callback when workflow is waiting */
  onWaiting?: (run: WorkflowRun, nodeId: string) => void | Promise<void>;
}

/** Controller for a running workflow. */
export interface WorkflowHandle<TOutput = unknown> {
  /** Run ID */
  runId: string;
  /** Wait for background workflow execution and cleanup to finish */
  settled(): Promise<void>;
  /** Get current status */
  status(): Promise<WorkflowRun>;
  /** Wait for completion and get the result; a signal cancels only this wait. */
  result(signal?: AbortSignal): Promise<TOutput>;
  /** Cancel the workflow */
  cancel(): Promise<void>;
}

/**
 * One-shot capability for an executor operation admitted before shutdown.
 *
 * @internal WorkflowClient uses this to preserve its own pre-close admission
 * across asynchronous persistence readiness. No executor API accepts a
 * caller-supplied token, so a structurally forged object cannot bypass close.
 */
export interface WorkflowExecutorAdmission<T> {
  /** Consume the captured operation at most once; repeated calls share it. */
  consume(): Promise<T>;
  /** Relinquish an unused admission. Safe to call repeatedly. */
  release(): void;
}

interface WorkflowExecutorAdmissionController {
  reserveStart<TInput, TOutput>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): WorkflowExecutorAdmission<WorkflowHandle<TOutput>>;
  reserveResume(
    runId: string,
    fromCheckpoint?: string,
    expectedWorkerId?: string,
    existingLockId?: string,
  ): WorkflowExecutorAdmission<void>;
  reserveCancel(runId: string): WorkflowExecutorAdmission<void>;
}

interface CapturedWorkflowStart<TInput, TOutput> {
  readonly workflow: WorkflowDefinition<TInput, TOutput>;
  readonly workflowId: string;
  readonly input: TInput;
  readonly runId?: string;
}

const WORKFLOW_START_OPTION_KEYS = new Set(["runId"]);

function captureWorkflowIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS || value.trim() !== value
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `${label} must be a canonical non-empty string of at most ${MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS} code units`,
    });
  }
  return value;
}

function captureWorkflowStartRunId(options: unknown): string | undefined {
  if (options === undefined) return undefined;
  if (
    typeof options !== "object" || options === null || Array.isArray(options) ||
    isProxyWithoutHooks(options)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Workflow start options must be a plain record" });
  }
  const prototype = Object.getPrototypeOf(options) as object | null;
  if (
    prototype !== null &&
    (isProxyWithoutHooks(prototype) || Object.getPrototypeOf(prototype) !== null)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Workflow start options must be a plain record" });
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length > WORKFLOW_START_OPTION_KEYS.size) {
    throw INVALID_ARGUMENT.create({ detail: "Workflow start options contain unsupported fields" });
  }
  let runId: string | undefined;
  for (const key of keys) {
    if (typeof key !== "string" || !WORKFLOW_START_OPTION_KEYS.has(key)) {
      throw INVALID_ARGUMENT.create({
        detail: "Workflow start options contain unsupported fields",
      });
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(options, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      throw INVALID_ARGUMENT.create({
        detail: "Workflow start options must contain only enumerable data properties",
      });
    }
    if (descriptor.value !== undefined) {
      runId = captureWorkflowIdentifier(descriptor.value, "Workflow run ID");
    }
  }
  return runId;
}

const executorAdmissionControllers = new WeakMap<
  WorkflowExecutor,
  WorkflowExecutorAdmissionController
>();

function requireAdmissionController(
  executor: WorkflowExecutor,
): WorkflowExecutorAdmissionController {
  const controller = executorAdmissionControllers.get(executor);
  if (controller) return controller;
  throw INVALID_ARGUMENT.create({ detail: "Workflow executor admission owner is invalid" });
}

/** @internal Reserve a client-owned start without extending WorkflowExecutor's public surface. */
export function reserveWorkflowStart<TInput, TOutput>(
  executor: WorkflowExecutor,
  workflowId: string,
  input: TInput,
  options?: { runId?: string },
): WorkflowExecutorAdmission<WorkflowHandle<TOutput>> {
  return requireAdmissionController(executor).reserveStart<TInput, TOutput>(
    workflowId,
    input,
    options,
  );
}

/** @internal Reserve a client-owned resume without a caller-forgeable bypass token. */
export function reserveWorkflowResume(
  executor: WorkflowExecutor,
  runId: string,
  fromCheckpoint?: string,
  expectedWorkerId?: string,
  existingLockId?: string,
): WorkflowExecutorAdmission<void> {
  return requireAdmissionController(executor).reserveResume(
    runId,
    fromCheckpoint,
    expectedWorkerId,
    existingLockId,
  );
}

/** @internal Reserve a client-owned cancellation without a caller-forgeable bypass token. */
export function reserveWorkflowCancel(
  executor: WorkflowExecutor,
  runId: string,
): WorkflowExecutorAdmission<void> {
  return requireAdmissionController(executor).reserveCancel(runId);
}

/**
 * Workflow Executor class
 *
 * Main entry point for executing workflows. Handles:
 * - Starting new workflow runs
 * - Resuming from checkpoints
 * - Coordinating DAG execution
 * - Managing workflow lifecycle
 */
export class WorkflowExecutor {
  private config: WorkflowExecutorConfig;
  private stepExecutor: StepExecutor;
  private checkpointManager: CheckpointManager;
  private dagExecutor: DAGExecutor;
  // deno-lint-ignore no-explicit-any -- type-erased registry: register() accepts WorkflowDefinition<TInput, TOutput> with arbitrary type params
  private workflows = new Map<string, WorkflowDefinition<any, any>>();
  private blobResolver?: BlobResolver;
  private activeRunExecutions = new Map<AbortController, ActiveWorkflowExecution>();
  private currentRunExecutions = new Map<string, ActiveWorkflowExecution>();
  private cancellationUpdates = new Map<string, Promise<void>>();
  private timedWaits = new Map<string, ScheduledTimedWaitRegistration>();
  private timedWaitReconciliations = new Map<string, Promise<void>>();
  private shutdownCancellationUpdates = new Map<
    ActiveWorkflowExecution,
    Promise<ShutdownCancellationOutcome>
  >();
  private activeOperations = new Set<Promise<unknown>>();
  private pendingAdmissions = new Set<Promise<void>>();
  private activeExecutions = new Set<Promise<void>>();
  private lifecycleState: WorkflowExecutorLifecycleState = "open";
  private lifecycleAbortController = new AbortController();
  private shutdownExecutions = new Set<ActiveWorkflowExecution>();
  private shutdownGlobalRunIds = new Set<string>();
  private shutdownReason?: Error;
  private destroyPromise?: Promise<void>;

  /** Default lock duration: 30 seconds */
  private static readonly DEFAULT_LOCK_DURATION = 30_000;
  /** Heartbeat interval for long-running workflow liveness tracking */
  private static readonly HEARTBEAT_INTERVAL_MS = 10_000;

  constructor(config: WorkflowExecutorConfig) {
    const {
      maxConcurrency = 10,
      debug = false,
      lockDuration = WorkflowExecutor.DEFAULT_LOCK_DURATION,
      heartbeatInterval = WorkflowExecutor.HEARTBEAT_INTERVAL_MS,
      resultWaitTimeout,
      cancellationGracePeriod,
      stepExecutor,
      ...rest
    } = config;
    const validatedLockDuration = parsePositiveDurationWithLabel(
      lockDuration,
      "WorkflowExecutor lockDuration",
    );
    const validatedHeartbeatInterval = parsePositiveDurationWithLabel(
      heartbeatInterval,
      "WorkflowExecutor heartbeatInterval",
    );
    if (validatedHeartbeatInterval > Math.floor(validatedLockDuration / 3)) {
      throw INVALID_ARGUMENT.create({
        detail:
          "WorkflowExecutor heartbeatInterval must be no greater than one third of lockDuration",
      });
    }
    if (rest.enableLocking !== false && !hasLockSupport(rest.backend)) {
      throw ORCHESTRATION_ERROR.create({
        detail:
          "WorkflowExecutor locking requires backend acquireLock, extendLock, releaseLock, and lock-fenced update methods",
      });
    }
    const validatedResultWaitTimeout = resultWaitTimeout === undefined
      ? undefined
      : parsePositiveDurationWithLabel(
        resultWaitTimeout,
        "WorkflowExecutor resultWaitTimeout",
      );
    const validatedCancellationGracePeriod = cancellationGracePeriod === undefined
      ? undefined
      : parseDurationWithLabel(
        cancellationGracePeriod,
        "WorkflowExecutor cancellationGracePeriod",
      );

    this.config = {
      ...rest,
      stepExecutor,
      maxConcurrency,
      debug,
      lockDuration: validatedLockDuration,
      heartbeatInterval: validatedHeartbeatInterval,
      resultWaitTimeout: validatedResultWaitTimeout,
      cancellationGracePeriod: validatedCancellationGracePeriod,
    };

    this.stepExecutor = new StepExecutor({
      cancellationGracePeriod: validatedCancellationGracePeriod,
      ...stepExecutor,
      blobStorage: this.config.blobStorage,
    });

    this.checkpointManager = new CheckpointManager({
      backend: this.config.backend,
      debug: this.config.debug,
    });

    this.dagExecutor = new DAGExecutor({
      stepExecutor: this.stepExecutor,
      checkpointManager: this.checkpointManager,
      maxConcurrency: this.config.maxConcurrency,
      cancellationGracePeriod: validatedCancellationGracePeriod,
      debug: this.config.debug,
      // waiting state is handled by executeAsync() after DAG execution returns with waiting: true
      onWaiting: () => {},
    });

    executorAdmissionControllers.set(this, {
      reserveStart: <TInput, TOutput>(
        workflowId: string,
        input: TInput,
        options?: { runId?: string },
      ) => {
        const captured = this.captureStart<TInput, TOutput>(workflowId, input, options);
        return this.reserveOperation(
          "start a workflow",
          () => this.startRun(captured),
        );
      },
      reserveResume: (
        runId: string,
        fromCheckpoint?: string,
        expectedWorkerId?: string,
        existingLockId?: string,
      ) =>
        this.reserveOperation(
          "resume a workflow",
          () => this.resumeOperation(runId, fromCheckpoint, expectedWorkerId, existingLockId),
        ),
      reserveCancel: (runId: string) =>
        this.reserveOperation(
          "cancel a workflow",
          () =>
            this.cancelRun(
              runId,
              ORCHESTRATION_ERROR.create({
                detail: `Workflow run "${runId}" was cancelled`,
              }),
            ),
        ),
    });

    const bs = this.config.blobStorage;
    if (!bs) return;

    const resolveIfBlob = <T>(
      ref: unknown,
      fn: (id: string) => Promise<T>,
      fallback: T,
    ): Promise<T> => {
      return isBlobRef(ref) ? fn(ref.id) : Promise.resolve(fallback);
    };

    this.blobResolver = {
      getText: (ref) => resolveIfBlob(ref, (id) => bs.getText(id), null),
      getBytes: (ref) => resolveIfBlob(ref, (id) => bs.getBytes(id), null),
      getStream: (ref) => resolveIfBlob(ref, (id) => bs.getStream(id), null),
      stat: (ref) => resolveIfBlob(ref, (id) => bs.stat(id), null),
      delete: (ref) => resolveIfBlob(ref, (id) => bs.delete(id), undefined),
    };
  }

  /**
   * Register a workflow definition
   */
  register<TInput, TOutput>(workflow: WorkflowDefinition<TInput, TOutput>): void {
    this.assertOpen("register workflows");
    const captured = captureWorkflowDefinition(workflow);
    if (this.workflows.has(captured.id)) {
      throw INVALID_ARGUMENT.create({
        detail: `Workflow already registered: ${captured.id}`,
      });
    }
    this.workflows.set(captured.id, captured);
  }

  /** Validate and register a workflow batch without partial mutation. */
  registerAll(workflows: readonly WorkflowDefinition[]): void {
    this.assertOpen("register workflows");
    const captured = captureWorkflowDefinitions(workflows);
    for (const workflow of captured) {
      if (this.workflows.has(workflow.id)) {
        throw INVALID_ARGUMENT.create({
          detail: `Workflow already registered: ${workflow.id}`,
        });
      }
    }
    for (const workflow of captured) this.workflows.set(workflow.id, workflow);
  }

  /**
   * Get a registered workflow
   */
  // deno-lint-ignore no-explicit-any -- type-erased registry lookup
  getWorkflow(id: string): WorkflowDefinition<any, any> | undefined {
    const workflow = this.workflows.get(id);
    return workflow === undefined ? undefined : captureWorkflowDefinition(workflow);
  }

  /**
   * Start a new workflow run
   */
  start<TInput, TOutput>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): Promise<WorkflowHandle<TOutput>> {
    const captured = this.captureStart<TInput, TOutput>(workflowId, input, options);
    return this.reserveOperation(
      "start a workflow",
      () => this.startRun(captured),
    ).consume();
  }

  private captureStart<TInput, TOutput>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): CapturedWorkflowStart<TInput, TOutput> {
    this.assertOpen("start a workflow");
    const capturedWorkflowId = captureWorkflowIdentifier(workflowId, "Workflow ID");
    const workflow = this.workflows.get(capturedWorkflowId) as
      | WorkflowDefinition<TInput, TOutput>
      | undefined;
    if (!workflow) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Workflow not found: ${capturedWorkflowId}` });
    }

    const capturedInput = captureWorkflowStaticValue(input, "Workflow start input");
    const parsedInput = workflow.inputSchema === undefined
      ? capturedInput
      : workflow.inputSchema.parse(capturedInput);
    const durableInput = captureWorkflowStaticValue(parsedInput, "Workflow parsed input") as TInput;
    const runId = captureWorkflowStartRunId(options);
    return Object.freeze({
      workflow,
      workflowId: capturedWorkflowId,
      input: durableInput,
      ...(runId === undefined ? {} : { runId }),
    });
  }

  private async startRun<TInput, TOutput>(
    captured: CapturedWorkflowStart<TInput, TOutput>,
  ): Promise<WorkflowHandle<TOutput>> {
    const { workflow, workflowId, runId } = captured;
    // Detach once more at the persistence boundary so neither schema-owned
    // values nor a custom backend can share the admission snapshot used to
    // construct another durable field.
    const runInput = cloneCapturedWorkflowStaticValue(
      captured.input,
      "Workflow run input",
    ) as TInput;
    const contextInput = cloneCapturedWorkflowStaticValue(
      captured.input,
      "Workflow context input",
    ) as TInput;

    // Capture current tenant context for multi-tenant run execution.
    // When a workflow is started from an API route, the request context
    // carries the tenant info (slug, token, etc.). We persist it on the run
    // so that worker processes can restore the context when executing runs.
    const requestCtx = getCurrentRequestContext();
    const tenant = requestCtx
      ? {
        projectSlug: requestCtx.projectSlug,
        token: requestCtx.token,
        projectId: requestCtx.projectId,
        productionMode: requestCtx.productionMode ?? false,
        releaseId: requestCtx.releaseId ?? null,
        branch: requestCtx.branch ?? null,
        environmentName: requestCtx.environmentName ?? null,
      }
      : undefined;
    const injectedProjectEnv = mergeInjectedWorkflowEnv(undefined, getProcessEnv());
    const executionWorkerId = supportsExecutionOwnership(this.config.backend)
      ? `run-execution:${generateId("exec")}`
      : undefined;

    const run: WorkflowRun<TInput, TOutput> = {
      id: runId ?? generateId("run"),
      workflowId,
      version: workflow.version,
      status: "pending",
      input: runInput,
      nodeStates: {},
      currentNodes: [],
      context: {
        input: contextInput,
        ...(injectedProjectEnv ? { env: injectedProjectEnv } : {}),
      },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      workerId: executionWorkerId,
      sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      _tenant: tenant,
      _runtimeStateVersion: WORKFLOW_RUNTIME_STATE_VERSION,
      _workflowProjection: { context: {} },
    };

    await this.config.backend.createRun(run);

    const settled = this.launchExecution(run.id, undefined, executionWorkerId).catch((error) => {
      logger.error("Workflow failed", { runId: run.id }, error);
    });

    return this.createHandle<TOutput>(run.id, settled);
  }

  /**
   * Resume a paused/waiting workflow
   */
  resume(
    runId: string,
    fromCheckpoint?: string,
    expectedWorkerId?: string,
    existingLockId?: string,
  ): Promise<void> {
    return this.reserveOperation(
      "resume a workflow",
      () => this.resumeOperation(runId, fromCheckpoint, expectedWorkerId, existingLockId),
    ).consume();
  }

  private async resumeOperation(
    runId: string,
    fromCheckpoint?: string,
    expectedWorkerId?: string,
    existingLockId?: string,
  ): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

    // A run execution owns its run for the lifetime of its immutable worker id.
    // If persisted ownership has moved on (e.g. a new owner reclaimed a stalled
    // run), this execution must not resume it and clobber the new owner's work.
    if (expectedWorkerId !== undefined && run.workerId !== expectedWorkerId) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Cannot resume workflow run because execution ownership has changed",
      });
    }
    const executionWorkerId = expectedWorkerId ?? run.workerId;

    await runWithWorkflowSourceIntegrationPolicy(
      run,
      () => this.resumeRun(run, fromCheckpoint, executionWorkerId, existingLockId),
    );
  }

  private async resumeRun(
    run: WorkflowRun,
    fromCheckpoint?: string,
    expectedWorkerId?: string,
    existingLockId?: string,
  ): Promise<void> {
    const runId = run.id;

    if (run.status !== "waiting" && run.status !== "pending" && run.status !== "running") {
      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot resume workflow run "${runId}": current status is "${run.status}". ` +
          `Only runs in "waiting", "pending", or "running" status can be resumed.`,
      });
    }

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Workflow not found: ${run.workflowId}` });
    }
    this.assertWorkflowRunVersion(run, workflow);

    // A waiting run already contains the authoritative event/approval handoff
    // in its persisted context and node states. Restoring an older checkpoint
    // here can erase that decision immediately before execution resumes.
    // Explicit checkpoint recovery still restores the requested snapshot, and
    // pending/running recovery retains the existing latest-checkpoint behavior.
    const wakeNodeId = fromCheckpoint === undefined ? getTimedWaitWakeNodeId(run) : null;
    let resumeInfo = run.status === "waiting" && fromCheckpoint === undefined
      ? null
      : await this.checkpointManager.prepareResume(
        runId,
        Array.isArray(workflow.steps)
          ? this.resolveNodes(workflow, run.context)
          : (context) => this.resolveNodes(workflow, context),
        fromCheckpoint,
        workflow.version ?? null,
      );
    if (
      wakeNodeId && resumeInfo &&
      !checkpointContainsTimedWaitWake(run, resumeInfo.checkpoint, wakeNodeId)
    ) {
      // A pre-wait checkpoint is older than the durable deadline decision. It
      // cannot erase the completed delay. A later checkpoint that contains the
      // exact wake remains eligible for normal crash recovery.
      resumeInfo = null;
    }

    if (fromCheckpoint && !resumeInfo) {
      throw RESOURCE_NOT_FOUND.create({
        detail: `Checkpoint "${fromCheckpoint}" not found for run "${runId}". ` +
          `Cannot resume from non-existent checkpoint.`,
      });
    }

    if (resumeInfo) {
      const restored = await updateRunIfStatus(
        this.config.backend,
        runId,
        [run.status],
        {
          status: "running",
          context: resumeInfo.context,
          nodeStates: resumeInfo.nodeStates,
          ...(resumeInfo.workflowProjection === undefined
            ? {}
            : { _workflowProjection: resumeInfo.workflowProjection }),
        },
        expectedWorkerId,
        existingLockId,
      );
      if (!restored) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Cannot resume workflow run because execution ownership or status changed",
        });
      }
    }

    await this.launchExecution(
      runId,
      undefined,
      expectedWorkerId,
      existingLockId,
      resumeInfo?.nodes,
      resumeInfo?.graphAdmission,
    );
  }

  /**
   * Execute a workflow run asynchronously
   *
   * Uses distributed locking (when backend supports it) to prevent
   * concurrent execution of the same workflow run.
   */
  executeAsync(
    runId: string,
    startFromNode?: string,
    expectedWorkerId?: string,
  ): Promise<void> {
    this.assertOpen("execute a workflow");
    return this.launchExecution(runId, startFromNode, expectedWorkerId);
  }

  private async executeOperation(
    runId: string,
    startFromNode?: string,
    expectedWorkerId?: string,
    existingLockId?: string,
    capturedNodes?: WorkflowNode[],
    capturedGraphAdmission?: WorkflowGraphAdmission,
  ): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    if (expectedWorkerId !== undefined && run.workerId !== expectedWorkerId) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Cannot execute workflow run because execution ownership has changed",
      });
    }
    const executionWorkerId = expectedWorkerId ?? run.workerId;

    await runWithWorkflowSourceIntegrationPolicy(
      run,
      () =>
        this.executeRun(
          run,
          startFromNode,
          executionWorkerId,
          existingLockId,
          capturedNodes,
          capturedGraphAdmission,
        ),
    );
  }

  private async executeRun(
    run: WorkflowRun,
    startFromNode?: string,
    expectedWorkerId?: string,
    existingLockId?: string,
    capturedNodes?: WorkflowNode[],
    capturedGraphAdmission?: WorkflowGraphAdmission,
  ): Promise<void> {
    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Workflow not found: ${run.workflowId}` });
    }
    this.assertWorkflowRunVersion(run, workflow);

    await executeWorkflowRunControl({
      backend: this.config.backend,
      run,
      expectedWorkerId,
      existingLockId,
      enableLocking: this.config.enableLocking,
      lockDuration: this.config.lockDuration ?? WorkflowExecutor.DEFAULT_LOCK_DURATION,
      heartbeatInterval: this.config.heartbeatInterval ?? WorkflowExecutor.HEARTBEAT_INTERVAL_MS,
      waitForCancellationUpdate: (runId) => this.waitForCancellationUpdate(runId),
      waitForCancellationGrace: (operation) => this.waitForCancellationGrace(operation),
      registerController: (runId, controller, fence) => {
        const execution = Object.freeze({ runId, controller, ...fence });
        this.activeRunExecutions.set(controller, execution);
        this.currentRunExecutions.set(runId, execution);
        if (this.lifecycleState !== "open") {
          this.shutdownExecutions.add(execution);
          void this.cancelExecutionForShutdown(
            execution,
            ORCHESTRATION_ERROR.create({
              detail: `Workflow run "${runId}" was cancelled because the executor is closing`,
            }),
          ).catch((error) => {
            logger.error("Failed to persist workflow cancellation during executor shutdown", {
              runId,
            }, error);
          });
        }
      },
      clearController: (runId, controller) => {
        const execution = this.activeRunExecutions.get(controller);
        if (execution?.runId === runId) this.activeRunExecutions.delete(controller);
        if (this.currentRunExecutions.get(runId)?.controller === controller) {
          this.currentRunExecutions.delete(runId);
        }
      },
      isCurrentExecution: (runId, controller) => this.isCurrentExecution(runId, controller),
      execute: ({ controller, signal, ownership }) => {
        const admission = capturedNodes === undefined
          ? this.resolveNodeAdmission(workflow, run.context, run._workflowProjection)
          : {
            nodes: capturedNodes,
            graphAdmission: capturedGraphAdmission,
          };
        const nodes = admission.nodes;
        const runWithTenantContext: WorkflowRun = run._tenant
          ? {
            ...run,
            context: { ...run.context, _tenant: run._tenant },
          }
          : run;

        return runWithWorkflowTenant(run._tenant, () =>
          this.executeWithTimeout(
            () =>
              this.dagExecutor.execute(
                nodes,
                runWithTenantContext,
                startFromNode,
                signal,
                ownership,
                admission.graphAdmission,
              ),
            workflow.timeout,
            controller,
          ));
      },
      prepareOutput: (output) => {
        return workflow.outputSchema ? workflow.outputSchema.parse(output) : output;
      },
      onStart: (startedRun) => {
        this.clearTimedWaitsForRun(startedRun.id);
        return this.config.onStart?.(toPublicWorkflowRun(startedRun));
      },
      onComplete: async (finalRun) => {
        this.clearTimedWaitsForRun(finalRun.id);
        const publicRun = toPublicWorkflowRun(finalRun);
        await runLifecycleObservers("Workflow completion observer failed", [
          ...(workflow.onComplete
            ? [() => workflow.onComplete!(publicRun.output, publicRun.context)]
            : []),
          ...(this.config.onComplete ? [() => this.config.onComplete!(publicRun)] : []),
        ]);
      },
      onError: async (errorRun, error, _context) => {
        this.clearTimedWaitsForRun(errorRun.id);
        await this.notifyWorkflowFailure(workflow, errorRun, error);
      },
      onWaiting: async (waitingRun, nodeId) => {
        await this.config.onWaiting?.(toPublicWorkflowRun(waitingRun), nodeId);
        this.scheduleTimedWaits(waitingRun);
      },
    });
  }

  private notifyWorkflowFailure(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    error: Error,
  ): Promise<void> {
    const publicRun = toPublicWorkflowRun(run);
    return runLifecycleObservers("Workflow failure observer failed", [
      ...(workflow.onError ? [() => workflow.onError!(error, publicRun.context)] : []),
      ...(this.config.onError ? [() => this.config.onError!(publicRun, error)] : []),
    ]);
  }

  private scheduleTimedWaits(run: WorkflowRun): void {
    this.clearTimedWaitsForRun(run.id);
    if (this.lifecycleState !== "open" || run.status !== "waiting") return;

    for (const [nodeId, state] of Object.entries(run.nodeStates)) {
      const timedWait = getTimedWorkflowWait(run, nodeId, state);
      if (!timedWait) continue;

      const key = timedWaitRegistrationKey(run.id, nodeId);
      const registration: ScheduledTimedWaitRegistration = { ...timedWait, key };
      const timerId = setTimeout(
        () => this.enqueueTimedWaitReconciliation(registration),
        Math.max(0, timedWait.deadline - Date.now()),
      );
      registration.timerId = timerId;
      this.timedWaits.set(key, registration);
      unrefTimer(timerId);
    }
  }

  private enqueueTimedWaitReconciliation(
    registration: ScheduledTimedWaitRegistration,
  ): Promise<void> {
    if (this.timedWaits.get(registration.key) !== registration) return Promise.resolve();
    this.timedWaits.delete(registration.key);

    const previous = this.timedWaitReconciliations.get(registration.runId);
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(() => this.reconcileTimedWait(registration));
    this.timedWaitReconciliations.set(registration.runId, operation);
    const cleanup = () => {
      if (this.timedWaitReconciliations.get(registration.runId) === operation) {
        this.timedWaitReconciliations.delete(registration.runId);
      }
    };
    const observed = operation.then(cleanup, (error) => {
      try {
        logger.error("Failed to reconcile timed workflow wait", {
          runId: registration.runId,
          nodeId: registration.nodeId,
        }, error);
      } finally {
        cleanup();
      }
    });
    return observed;
  }

  private async reconcileTimedWait(registration: ScheduledTimedWaitRegistration): Promise<void> {
    if (this.lifecycleState !== "open") return;

    const outcome = await reconcileTimedWorkflowWait(this.config.backend, registration);
    if (outcome.status === "not-due") {
      if (outcome.run) this.scheduleTimedWaits(outcome.run);
      return;
    }
    if (outcome.status === "unchanged") return;
    if (outcome.status === "awakened") {
      if (this.lifecycleState !== "open") return;
      await this.resumeOperation(outcome.run.id, undefined, outcome.run.workerId);
      return;
    }
    if (outcome.status !== "failed") return;

    this.clearTimedWaitsForRun(outcome.run.id);
    const workflow = this.workflows.get(outcome.run.workflowId);
    if (!workflow) return;
    try {
      await this.notifyWorkflowFailure(workflow, outcome.run, outcome.error);
    } catch (observerError) {
      logger.error("Workflow failure observer failed after timed wait persistence", {
        runId: outcome.run.id,
      }, observerError);
    }
  }

  private clearTimedWaitsForRun(runId: string): void {
    for (const [key, registration] of this.timedWaits) {
      if (registration.runId !== runId) continue;
      if (registration.timerId !== undefined) clearTimeout(registration.timerId);
      this.timedWaits.delete(key);
    }
  }

  private prepareTimedWaitShutdown(): void {
    for (const registration of this.timedWaits.values()) {
      if (registration.timerId !== undefined) clearTimeout(registration.timerId);
    }
    this.timedWaits.clear();
  }

  /**
   * Resolve workflow nodes from definition
   */
  private resolveNodes(workflow: WorkflowDefinition, context: WorkflowContext): WorkflowNode[] {
    return this.resolveNodeAdmission(workflow, context).nodes;
  }

  private resolveNodeAdmission(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    workflowProjection: WorkflowProjectionState = { context: {} },
  ): { nodes: WorkflowNode[]; graphAdmission: WorkflowGraphAdmission } {
    const stepsEvaluationContext = captureWorkflowStaticValue(
      context,
      `Workflow "${workflow.id}" steps evaluation context`,
    );
    const stepsEvaluationProjection = captureWorkflowStaticValue(
      workflowProjection,
      `Workflow "${workflow.id}" steps evaluation projection`,
    );
    const callbackContext = cloneCapturedWorkflowStaticValue(
      stepsEvaluationContext,
      `Workflow "${workflow.id}" steps callback context`,
    );
    // Definition evaluation is admission, not execution. Give dynamic builders
    // an isolated snapshot so ambient mutation cannot rewrite durable run state.
    const rawNodes = Array.isArray(workflow.steps) ? workflow.steps : workflow.steps(
      {
        input: callbackContext.input,
        context: callbackContext,
        blobStorage: this.config.blobStorage,
        blob: this.blobResolver,
      } satisfies StepBuilderContext,
    );
    const nodes = captureWorkflowNodes(rawNodes, `Workflow "${workflow.id}"`, {
      emptyElementName: "step",
    });
    return {
      nodes,
      graphAdmission: {
        stepsEvaluationContext: cloneCapturedWorkflowStaticValue(
          stepsEvaluationContext,
          `Workflow "${workflow.id}" durable steps evaluation context`,
        ),
        stepsEvaluationProjection: cloneCapturedWorkflowStaticValue(
          stepsEvaluationProjection,
          `Workflow "${workflow.id}" durable steps evaluation projection`,
        ),
        graphIdentity: captureCanonicalWorkflowGraphIdentity(nodes),
        workflowVersion: workflow.version ?? null,
      },
    };
  }

  private assertWorkflowRunVersion(
    run: WorkflowRun,
    workflow: WorkflowDefinition,
  ): void {
    if ((run.version ?? null) === (workflow.version ?? null)) return;
    throw ORCHESTRATION_ERROR.create({
      detail: `Cannot resume workflow run "${run.id}" because definition version changed from ` +
        `"${run.version ?? "unversioned"}" to "${workflow.version ?? "unversioned"}"`,
    });
  }

  /**
   * Execute with optional timeout
   *
   * Uses Promise.race() to properly handle timeout cleanup.
   * The timeout is always cleared in the finally block to prevent memory leaks.
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: string | number | undefined,
    executionController: AbortController,
  ): Promise<T> {
    executionController.signal.throwIfAborted();
    const operation = Promise.resolve().then(fn);
    const fencedOperation = operation.then((value) => {
      executionController.signal.throwIfAborted();
      return value;
    });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(executionController.signal.reason);
      if (executionController.signal.aborted) rejectAbort();
      else executionController.signal.addEventListener("abort", rejectAbort, { once: true });
    });

    if (timeout !== undefined) {
      const timeoutMs = parsePositiveDurationWithLabel(timeout, "Workflow timeout");
      const timeoutError = TIMEOUT_ERROR.create({
        detail: `Workflow timed out after ${timeoutMs}ms`,
      });
      timeoutId = setTimeout(() => {
        if (!executionController.signal.aborted) executionController.abort(timeoutError);
      }, timeoutMs);
    }

    try {
      return await Promise.race([fencedOperation, abortPromise]);
    } catch (error) {
      if (executionController.signal.aborted) {
        const cleanup = await this.waitForCancellationSettlement(fencedOperation);
        throwIfAbortedWithCleanup(
          executionController.signal,
          cleanup?.status === "rejected" ? [cleanup.reason] : [],
          "Workflow execution",
        );
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (rejectAbort) executionController.signal.removeEventListener("abort", rejectAbort);
    }
  }

  private async waitForCancellationGrace(operation: Promise<unknown>): Promise<void> {
    await this.waitForCancellationSettlement(operation);
  }

  private async waitForCancellationSettlement(
    operation: Promise<unknown>,
  ): Promise<PromiseSettledResult<unknown> | undefined> {
    const gracePeriod = Math.max(
      0,
      this.config.cancellationGracePeriod ?? DEFAULT_CANCELLATION_GRACE_PERIOD_MS,
    );
    let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const settled = operation.then(
      (value): PromiseFulfilledResult<unknown> => ({ status: "fulfilled", value }),
      (reason): PromiseRejectedResult => ({ status: "rejected", reason }),
    );
    const graceExpired = new Promise<undefined>((resolve) => {
      graceTimeoutId = setTimeout(() => resolve(undefined), gracePeriod);
    });

    try {
      return await Promise.race([settled, graceExpired]);
    } finally {
      if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);
    }
  }

  private isCurrentExecution(runId: string, controller: AbortController): boolean {
    return this.currentRunExecutions.get(runId)?.controller === controller;
  }

  private abortRunExecutions(runId: string, reason: Error): void {
    for (const execution of this.activeRunExecutions.values()) {
      if (execution.runId === runId) execution.controller.abort(reason);
    }
  }

  /**
   * Create a handle for a workflow run
   */
  private createHandle<TOutput>(runId: string, settled: Promise<void>): WorkflowHandle<TOutput> {
    return {
      runId,
      settled: () => settled,
      status: () =>
        this.trackOperation("read workflow status", async () => {
          const run = await this.config.backend.getRun(runId);
          if (!run) {
            throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
          }
          return toPublicWorkflowRun(run);
        }),
      result: (signal) =>
        this.trackOperation(
          "wait for a workflow result",
          () =>
            this.waitForResult<TOutput>(
              runId,
              signal
                ? AbortSignal.any([signal, this.lifecycleAbortController.signal])
                : this.lifecycleAbortController.signal,
            ),
        ),
      cancel: () => this.cancel(runId),
    };
  }

  /**
   * Wait for workflow result
   */
  private async waitForResult<TOutput>(
    runId: string,
    signal?: AbortSignal,
    pollInterval = DEFAULT_RESULT_POLL_INTERVAL_MS,
    timeoutMs = this.config.resultWaitTimeout ?? DEFAULT_RESULT_WAIT_TIMEOUT_MS,
  ): Promise<TOutput> {
    signal?.throwIfAborted();
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const run = await this.config.backend.getRun(runId);
      signal?.throwIfAborted();
      if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

      if (run.status === "completed") {
        return toPublicWorkflowRun(run).output as TOutput;
      }
      if (run.status === "failed") {
        throw ORCHESTRATION_ERROR.create({ detail: run.error?.message || "Workflow failed" });
      }
      if (run.status === "cancelled") {
        throw ORCHESTRATION_ERROR.create({ detail: "Workflow was cancelled" });
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw TIMEOUT_ERROR.create({
          detail: `Timed out after ${timeoutMs}ms waiting for workflow run "${runId}" to reach a ` +
            `terminal state (last status: "${run.status}").`,
        });
      }

      await sleep(Math.min(pollInterval, remaining), signal);
    }
  }

  /**
   * Cancel a workflow run
   */
  cancel(runId: string): Promise<void> {
    return this.reserveOperation(
      "cancel a workflow",
      () =>
        this.cancelRun(
          runId,
          ORCHESTRATION_ERROR.create({ detail: `Workflow run "${runId}" was cancelled` }),
        ),
    ).consume();
  }

  private cancelRun(runId: string, reason: Error): Promise<void> {
    const existingUpdate = this.cancellationUpdates.get(runId);
    if (existingUpdate) {
      this.abortRunExecutions(runId, reason);
      return existingUpdate;
    }

    const cancellationUpdate = Promise.resolve().then(async () => {
      const run = await this.config.backend.getRun(runId);
      if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

      if (run.status === "cancelled") return;

      if (run.status === "completed" || run.status === "failed") {
        this.clearTimedWaitsForRun(runId);
        throw ORCHESTRATION_ERROR.create({
          detail: `Cannot cancel workflow run "${runId}": run has already ${run.status}. ` +
            `Only active runs (pending, running, waiting) can be cancelled.`,
        });
      }

      const cancelled = await updateRunIfStatus(
        this.config.backend,
        runId,
        ["pending", "running", "waiting"],
        {
          status: "cancelled",
          completedAt: new Date(),
        },
        run.workerId,
      );
      if (cancelled) return;

      const latest = await this.config.backend.getRun(runId);
      if (!latest) {
        throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
      }
      if (latest.status === "cancelled") return;
      if (latest.status === "completed" || latest.status === "failed") {
        this.clearTimedWaitsForRun(runId);
        throw ORCHESTRATION_ERROR.create({
          detail: `Cannot cancel workflow run "${runId}": run has already ${latest.status}.`,
        });
      }
      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot cancel workflow run "${runId}": execution ownership changed.`,
      });
    });
    this.cancellationUpdates.set(runId, cancellationUpdate);

    this.abortRunExecutions(runId, reason);

    cancellationUpdate.then(
      () => {
        this.clearTimedWaitsForRun(runId);
        if (this.cancellationUpdates.get(runId) === cancellationUpdate) {
          this.cancellationUpdates.delete(runId);
        }
      },
      () => {
        if (this.cancellationUpdates.get(runId) === cancellationUpdate) {
          this.cancellationUpdates.delete(runId);
        }
      },
    );
    return cancellationUpdate;
  }

  private cancelExecutionForShutdown(
    execution: ActiveWorkflowExecution,
    reason: Error,
  ): Promise<ShutdownCancellationOutcome> {
    const existingUpdate = this.shutdownCancellationUpdates.get(execution);
    if (existingUpdate) {
      execution.controller.abort(reason);
      return existingUpdate;
    }

    const cancellationUpdate = Promise.resolve().then(async () => {
      const run = await this.config.backend.getRun(execution.runId);
      if (!run) return "terminal" as const;
      if (isTerminalRun(run)) return "terminal" as const;

      if (
        execution.expectedWorkerId !== undefined &&
        run.workerId !== execution.expectedWorkerId
      ) {
        return "handed-off" as const;
      }

      const cancelled = await updateRunIfStatus(
        this.config.backend,
        execution.runId,
        ["pending", "running", "waiting"],
        {
          status: "cancelled",
          completedAt: new Date(),
        },
        execution.expectedWorkerId,
        execution.lockId,
      );
      if (cancelled) return "cancelled" as const;

      const latest = await this.config.backend.getRun(execution.runId);
      if (!latest || isTerminalRun(latest)) return "terminal" as const;
      if (
        execution.expectedWorkerId !== undefined &&
        latest.workerId !== execution.expectedWorkerId
      ) {
        return "handed-off" as const;
      }
      if (execution.lockId !== undefined) return "handed-off" as const;

      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot cancel workflow run "${execution.runId}" during shutdown: ` +
          "the admitted execution fence was rejected without an ownership handoff",
      });
    });
    this.shutdownCancellationUpdates.set(execution, cancellationUpdate);
    execution.controller.abort(reason);

    cancellationUpdate.then(
      () => {
        if (this.shutdownCancellationUpdates.get(execution) === cancellationUpdate) {
          this.shutdownCancellationUpdates.delete(execution);
        }
      },
      () => {
        if (this.shutdownCancellationUpdates.get(execution) === cancellationUpdate) {
          this.shutdownCancellationUpdates.delete(execution);
        }
      },
    );
    return cancellationUpdate;
  }

  private async waitForCancellationUpdate(runId: string): Promise<void> {
    const updates: Promise<unknown>[] = [];
    const globalUpdate = this.cancellationUpdates.get(runId);
    if (globalUpdate) updates.push(globalUpdate);
    for (const [execution, update] of this.shutdownCancellationUpdates) {
      if (execution.runId === runId) updates.push(update);
    }
    await Promise.all(updates);
  }

  /**
   * Get workflow run status
   */
  getStatus(runId: string): Promise<WorkflowRun | null> {
    return this.trackOperation(
      "read workflow status",
      async () => {
        const run = await this.config.backend.getRun(runId);
        return run ? toPublicWorkflowRun(run) : null;
      },
    );
  }

  /**
   * List workflow runs
   */
  listRuns(options?: {
    workflowId?: string;
    status?: WorkflowStatus | WorkflowStatus[];
    limit?: number;
  }): Promise<WorkflowRun[]> {
    return this.trackOperation(
      "list workflow runs",
      async () =>
        toPublicWorkflowRuns(
          await this.config.backend.listRuns({
            workflowId: options?.workflowId,
            status: options?.status,
            limit: options?.limit,
          }),
        ),
    );
  }

  /** Cancel active work, wait for cooperative cleanup, and reject future operations. */
  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;

    if (this.lifecycleState === "open") {
      this.lifecycleState = "closing";
      this.shutdownReason = ORCHESTRATION_ERROR.create({
        detail: "Workflow executor is closing",
      });
      this.lifecycleAbortController.abort(this.shutdownReason);
    }

    const attempt = this.performDestroyAttempt(this.shutdownReason!);
    this.destroyPromise = attempt;
    attempt.then(
      () => {},
      () => {
        if (this.destroyPromise === attempt) this.destroyPromise = undefined;
      },
    );
    return attempt;
  }

  private async performDestroyAttempt(shutdownReason: Error): Promise<void> {
    const failures: unknown[] = [];
    const attemptedExecutions = new Set<ActiveWorkflowExecution>();
    const attemptedGlobalRunIds = new Set<string>();

    while (true) {
      this.prepareTimedWaitShutdown();
      for (const execution of this.activeRunExecutions.values()) {
        this.shutdownExecutions.add(execution);
      }
      for (const runId of this.cancellationUpdates.keys()) {
        this.shutdownGlobalRunIds.add(runId);
      }

      const executionsToCancel = [...this.shutdownExecutions].filter((execution) =>
        !attemptedExecutions.has(execution)
      );
      for (const execution of executionsToCancel) attemptedExecutions.add(execution);
      const executionCancellations = await Promise.allSettled(
        executionsToCancel.map((execution) =>
          this.cancelExecutionForShutdown(execution, shutdownReason)
        ),
      );
      for (let index = 0; index < executionCancellations.length; index++) {
        const outcome = executionCancellations[index]!;
        if (outcome.status === "rejected") failures.push(outcome.reason);
        else this.shutdownExecutions.delete(executionsToCancel[index]!);
      }

      const globalRunIdsToCancel = [...this.shutdownGlobalRunIds].filter((runId) =>
        !attemptedGlobalRunIds.has(runId)
      );
      for (const runId of globalRunIdsToCancel) attemptedGlobalRunIds.add(runId);
      const globalCancellations = await Promise.allSettled(
        globalRunIdsToCancel.map((runId) => this.cancelRun(runId, shutdownReason)),
      );
      for (const outcome of globalCancellations) {
        if (outcome.status === "rejected") failures.push(outcome.reason);
      }

      const pending = [
        ...this.pendingAdmissions,
        ...this.activeOperations,
        ...this.activeExecutions,
        ...this.shutdownCancellationUpdates.values(),
        ...this.timedWaitReconciliations.values(),
      ];
      if (pending.length > 0) await Promise.allSettled(pending);

      this.prepareTimedWaitShutdown();
      for (const execution of this.activeRunExecutions.values()) {
        this.shutdownExecutions.add(execution);
      }
      for (const runId of this.cancellationUpdates.keys()) {
        this.shutdownGlobalRunIds.add(runId);
      }
      const hasUnattemptedExecution = [...this.shutdownExecutions].some((execution) =>
        !attemptedExecutions.has(execution)
      );
      const hasUnattemptedGlobalCancellation = [...this.shutdownGlobalRunIds].some((runId) =>
        !attemptedGlobalRunIds.has(runId)
      );
      if (
        hasUnattemptedExecution || hasUnattemptedGlobalCancellation ||
        this.pendingAdmissions.size > 0 ||
        this.activeOperations.size > 0 ||
        this.activeExecutions.size > 0 ||
        this.timedWaitReconciliations.size > 0
      ) {
        continue;
      }
      break;
    }

    const unresolvedRunIds = new Set<string>();
    for (const execution of this.shutdownExecutions) {
      try {
        const run = await this.config.backend.getRun(execution.runId);
        if (
          !run || isTerminalRun(run) ||
          (execution.expectedWorkerId !== undefined &&
            run.workerId !== execution.expectedWorkerId)
        ) {
          this.shutdownExecutions.delete(execution);
        } else {
          unresolvedRunIds.add(execution.runId);
        }
      } catch (error) {
        failures.push(error);
        unresolvedRunIds.add(execution.runId);
      }
    }
    for (const runId of this.shutdownGlobalRunIds) {
      try {
        const run = await this.config.backend.getRun(runId);
        if (!run || isTerminalRun(run)) {
          this.shutdownGlobalRunIds.delete(runId);
        } else {
          unresolvedRunIds.add(runId);
        }
      } catch (error) {
        failures.push(error);
        unresolvedRunIds.add(runId);
      }
    }

    if (unresolvedRunIds.size > 0) {
      failures.push(
        ORCHESTRATION_ERROR.create({
          detail: `Workflow executor could not persist terminal shutdown state for run(s): ${
            [...unresolvedRunIds].join(", ")
          }`,
        }),
      );
      throw new AggregateError(failures, "Failed to destroy workflow executor cleanly");
    }

    this.lifecycleState = "closed";
  }

  private launchExecution(
    runId: string,
    startFromNode?: string,
    expectedWorkerId?: string,
    existingLockId?: string,
    capturedNodes?: WorkflowNode[],
    capturedGraphAdmission?: WorkflowGraphAdmission,
  ): Promise<void> {
    const execution = this.executeOperation(
      runId,
      startFromNode,
      expectedWorkerId,
      existingLockId,
      capturedNodes,
      capturedGraphAdmission,
    );
    this.activeExecutions.add(execution);
    execution.then(
      () => this.activeExecutions.delete(execution),
      () => this.activeExecutions.delete(execution),
    );
    return execution;
  }

  private reserveOperation<T>(
    operation: string,
    callback: () => Promise<T>,
  ): WorkflowExecutorAdmission<T> {
    this.assertOpen(operation);
    const gate = Promise.withResolvers<void>();
    this.pendingAdmissions.add(gate.promise);
    let state: "reserved" | "consumed" | "released" = "reserved";
    let consumedPromise: Promise<T> | undefined;
    let releasedPromise: Promise<T> | undefined;

    const settleGate = () => {
      if (!this.pendingAdmissions.delete(gate.promise)) return;
      gate.resolve();
    };
    const consume = (): Promise<T> => {
      if (state === "consumed") return consumedPromise!;
      if (state === "released") {
        releasedPromise ??= Promise.reject(
          ORCHESTRATION_ERROR.create({
            detail: `Cannot ${operation}: workflow executor admission was released`,
          }),
        );
        return releasedPromise;
      }

      state = "consumed";
      // Transfer accounting without a close race: the operation enters the
      // active set before its reservation gate is removed.
      consumedPromise = this.trackAdmittedOperation(callback);
      settleGate();
      return consumedPromise;
    };
    const release = (): void => {
      if (state !== "reserved") return;
      state = "released";
      settleGate();
    };

    return Object.freeze({ consume, release });
  }

  private trackOperation<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    this.assertOpen(operation);
    return this.trackAdmittedOperation(callback);
  }

  private trackAdmittedOperation<T>(callback: () => Promise<T>): Promise<T> {
    const deferred = Promise.withResolvers<T>();
    const promise = deferred.promise;
    this.activeOperations.add(promise);
    promise.then(
      () => this.activeOperations.delete(promise),
      () => this.activeOperations.delete(promise),
    );
    try {
      deferred.resolve(callback());
    } catch (error) {
      deferred.reject(error);
    }
    return promise;
  }

  private assertOpen(operation: string): void {
    if (this.lifecycleState === "open") return;
    throw ORCHESTRATION_ERROR.create({
      detail: `Cannot ${operation}: workflow executor is ${this.lifecycleState}`,
    });
  }
}
