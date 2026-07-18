/**************************
 * Workflow Executor
 *
 * Main orchestrator for executing durable workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import {
  ensureError,
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  RESOURCE_NOT_FOUND,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import type {
  BlobResolver,
  NodeState,
  StepBuilderContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { generateId, parseDuration } from "../types.ts";
import { hasLockSupport, type WorkflowBackend } from "../backends/types.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { env as getProcessEnv } from "#veryfront/compat/process.ts";
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

const logger = baseLogger.component("workflow-executor");

/** Default polling interval for waiting on workflow result */
const DEFAULT_RESULT_POLL_INTERVAL_MS = 1_000;

/** Default max time waitForResult() polls before giving up (5 minutes) */
const DEFAULT_RESULT_WAIT_TIMEOUT_MS = 5 * 60 * 1_000;

/** Time allowed for an aborted graph to finish its cooperative cleanup. */
const DEFAULT_CANCELLATION_GRACE_PERIOD_MS = 1_000;

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
  /** Lock duration in milliseconds for distributed execution (default: 30000) */
  lockDuration?: number;
  /** Heartbeat and remote-cancellation poll interval in milliseconds (default: 10000) */
  heartbeatInterval?: number;
  /** Enable distributed locking (default: true if backend supports it) */
  enableLocking?: boolean;
  /** Max time result()/waitForResult waits for a terminal state (default: 300000) */
  resultWaitTimeout?: number;
  /** Max milliseconds to wait for aborted execution to settle before detaching it (default: 1000) */
  cancellationGracePeriod?: number;
  /** Callback when workflow starts */
  onStart?: (run: WorkflowRun) => void;
  /** Callback when workflow completes */
  onComplete?: (run: WorkflowRun) => void;
  /** Callback when workflow fails */
  onError?: (run: WorkflowRun, error: Error) => void;
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
  /** Wait for completion and get result */
  result(): Promise<TOutput>;
  /** Cancel the workflow */
  cancel(): Promise<void>;
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
  private activeRunControllers = new Map<string, AbortController>();
  private cancellationUpdates = new Map<string, Promise<void>>();

  /** Default lock duration: 30 seconds */
  private static readonly DEFAULT_LOCK_DURATION = 30_000;
  /** Heartbeat interval for long-running workflow liveness tracking */
  private static readonly HEARTBEAT_INTERVAL_MS = 10_000;

  constructor(config: WorkflowExecutorConfig) {
    this.config = {
      maxConcurrency: 10,
      debug: false,
      lockDuration: WorkflowExecutor.DEFAULT_LOCK_DURATION,
      ...config,
    };

    this.stepExecutor = new StepExecutor({
      cancellationGracePeriod: this.config.cancellationGracePeriod,
      ...this.config.stepExecutor,
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
      debug: this.config.debug,
      // waiting state is handled by executeAsync() after DAG execution returns with waiting: true
      onWaiting: () => {},
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
    this.workflows.set(workflow.id, workflow);
  }

  /**
   * Get a registered workflow
   */
  // deno-lint-ignore no-explicit-any -- type-erased registry lookup
  getWorkflow(id: string): WorkflowDefinition<any, any> | undefined {
    return this.workflows.get(id);
  }

  /**
   * Start a new workflow run
   */
  async start<TInput, TOutput>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): Promise<WorkflowHandle<TOutput>> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Workflow not found: ${workflowId}` });
    }

    workflow.inputSchema?.parse(input);

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

    const run: WorkflowRun<TInput, TOutput> = {
      id: options?.runId ?? generateId("run"),
      workflowId,
      version: workflow.version,
      status: "pending",
      input,
      nodeStates: {},
      currentNodes: [],
      context: {
        input,
        ...(injectedProjectEnv ? { env: injectedProjectEnv } : {}),
      },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      _tenant: tenant,
    };

    await this.config.backend.createRun(run);

    const settled = this.executeAsync(run.id).catch((error) => {
      logger.error("Workflow failed", { runId: run.id }, error);
    });

    return this.createHandle<TOutput>(run.id, settled);
  }

  /**
   * Resume a paused/waiting workflow
   */
  async resume(
    runId: string,
    fromCheckpoint?: string,
    expectedWorkerId?: string,
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

    await runWithWorkflowSourceIntegrationPolicy(
      run,
      () => this.resumeRun(run, fromCheckpoint),
    );
  }

  private async resumeRun(run: WorkflowRun, fromCheckpoint?: string): Promise<void> {
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

    const nodes = this.resolveNodes(workflow, run.context);
    const resumeInfo = await this.checkpointManager.prepareResume(runId, nodes, fromCheckpoint);

    if (fromCheckpoint && !resumeInfo) {
      throw RESOURCE_NOT_FOUND.create({
        detail: `Checkpoint "${fromCheckpoint}" not found for run "${runId}". ` +
          `Cannot resume from non-existent checkpoint.`,
      });
    }

    if (resumeInfo) {
      await this.config.backend.updateRun(runId, {
        status: "running",
        context: resumeInfo.context,
        nodeStates: resumeInfo.nodeStates,
      });
    }

    await this.executeAsync(runId, resumeInfo?.startFromNode);
  }

  /**
   * Execute a workflow run asynchronously
   *
   * Uses distributed locking (when backend supports it) to prevent
   * concurrent execution of the same workflow run.
   */
  async executeAsync(runId: string, startFromNode?: string): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

    await runWithWorkflowSourceIntegrationPolicy(
      run,
      () => this.executeRun(run, startFromNode),
    );
  }

  private async executeRun(run: WorkflowRun, startFromNode?: string): Promise<void> {
    const runId = run.id;

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Workflow not found: ${run.workflowId}` });
    }

    const useLocking = this.config.enableLocking !== false && hasLockSupport(this.config.backend);
    const lockDuration = this.config.lockDuration ?? WorkflowExecutor.DEFAULT_LOCK_DURATION;
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    let heartbeatPromise: Promise<void> | undefined;

    // If the heartbeat can no longer extend our lock, another worker may claim
    // this run as stalled and execute it concurrently. Abort the DAG as soon as
    // that happens, then wait for it to settle before releasing the lock. The
    // new owner remains responsible for the terminal status.
    let lockLostError: Error | undefined;

    // Acquire the lock before registering the per-run controller. A failed
    // acquisition must not replace or leak active execution state.
    let lockToken: string | null = null;
    if (useLocking) {
      lockToken = await this.config.backend.acquireLock!(runId, lockDuration);
      if (!lockToken) {
        throw ORCHESTRATION_ERROR.create({
          detail:
            `Cannot execute workflow run "${runId}": another worker is already executing it. ` +
            `This can happen when multiple workers try to execute the same run concurrently.`,
        });
      }
      logger.debug("Acquired lock for run", { runId });
    }

    const executionController = new AbortController();
    this.activeRunControllers.set(runId, executionController);

    try {
      const currentRun = await this.config.backend.getRun(runId);
      if (
        currentRun?.status === "cancelled" || executionController.signal.aborted ||
        !this.isCurrentExecution(runId, executionController)
      ) return;

      const now = new Date();
      await this.config.backend.updateRun(runId, {
        status: "running",
        startedAt: run.startedAt || now,
        heartbeatAt: now,
      });

      heartbeatInterval = setInterval(() => {
        if (heartbeatPromise) return;

        heartbeatPromise = (async () => {
          if (
            executionController.signal.aborted ||
            !this.isCurrentExecution(runId, executionController)
          ) return;

          if (useLocking && typeof this.config.backend.extendLock === "function") {
            let extended: boolean;
            try {
              extended = await this.config.backend.extendLock(runId, lockDuration);
            } catch (error) {
              if (!lockLostError) {
                lockLostError = ORCHESTRATION_ERROR.create({
                  detail: `Could not renew lock for run "${runId}"; aborting to avoid ` +
                    `concurrent execution by another worker.`,
                  cause: error instanceof Error ? error : undefined,
                });
                logger.error("Could not renew workflow lock; aborting run", { runId }, error);
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                executionController.abort(lockLostError);
              }
              return;
            }

            if (!extended && !lockLostError) {
              lockLostError = ORCHESTRATION_ERROR.create({
                detail: `Lost lock for run "${runId}" during heartbeat; aborting to avoid ` +
                  `concurrent execution by another worker.`,
              });
              logger.error("Lost workflow lock; aborting run", { runId });
              if (heartbeatInterval) clearInterval(heartbeatInterval);
              executionController.abort(lockLostError);
              return;
            }
          }

          if (
            executionController.signal.aborted ||
            !this.isCurrentExecution(runId, executionController)
          ) return;

          try {
            await this.config.backend.updateRun(runId, {
              heartbeatAt: new Date(),
            });
          } catch (error) {
            logger.warn("Heartbeat update failed", { runId }, error);
          } finally {
            heartbeatPromise = undefined;
          }
        })();
      }, WorkflowExecutor.HEARTBEAT_INTERVAL_MS);

      const updatedRun = await this.config.backend.getRun(runId);
      this.config.onStart?.(updatedRun!);

      const nodes = this.resolveNodes(workflow, run.context);

      const runWithTenantContext: WorkflowRun = run._tenant
        ? {
          ...run,
          context: { ...run.context, _tenant: run._tenant },
        }
        : run;

      const result = await runWithWorkflowTenant(run._tenant, () =>
        this.executeWithTimeout(
          () =>
            this.dagExecutor.execute(
              nodes,
              runWithTenantContext,
              startFromNode,
              executionController.signal,
            ),
          workflow.timeout,
          executionController,
        ));

      if (executionController.signal.aborted) {
        await this.waitForCancellationUpdate(runId);
        const latestRun = await this.config.backend.getRun(runId);
        if (latestRun?.status === "cancelled") return;
        executionController.signal.throwIfAborted();
      }

      if (result.completed) {
        const finalRun = await this.completeRun(
          runId,
          result.context,
          result.nodeStates,
          executionController,
        );
        if (!finalRun) return;
        if (finalRun.status === "cancelled") return;

        workflow.outputSchema?.parse(finalRun.output);

        await workflow.onComplete?.(finalRun.output, finalRun.context);
        this.config.onComplete?.(finalRun);
        return;
      }

      if (result.waiting) {
        const paused = await this.pauseRun(
          runId,
          result.waitingNode!,
          result.context,
          result.nodeStates,
          executionController,
        );
        if (!paused) return;

        const pausedRun = await this.config.backend.getRun(runId);
        this.config.onWaiting?.(pausedRun!, result.waitingNode!);
        return;
      }

      const error = ORCHESTRATION_ERROR.create({ detail: result.error || "Unknown error" });
      if (
        !(await this.failRun(
          runId,
          error,
          result.context,
          result.nodeStates,
          executionController,
        ))
      ) return;

      await workflow.onError?.(error, result.context);
      this.config.onError?.(run, error);
    } catch (error) {
      const normalizedError = ensureError(error);

      // Lock lost: we no longer own the run, so a new owner (via stalled-run
      // recovery) is responsible for it. Do NOT write a terminal status here or
      // we would overwrite that worker's progress. Just release and rethrow.
      if (lockLostError) {
        logger.warn("Aborted run after losing lock; leaving status for new owner", { runId });
        throw lockLostError;
      }

      await this.waitForCancellationUpdate(runId);
      const latestRun = await this.config.backend.getRun(runId);
      if (latestRun?.status === "cancelled") return;

      if (
        !(await this.failRun(
          runId,
          normalizedError,
          run.context,
          run.nodeStates,
          executionController,
        ))
      ) return;

      await workflow.onError?.(normalizedError, run.context);
      this.config.onError?.(run, normalizedError);

      throw normalizedError;
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (heartbeatPromise) {
        if (executionController.signal.aborted) {
          await this.waitForCancellationGrace(heartbeatPromise);
        } else {
          await heartbeatPromise;
        }
      }

      if (this.activeRunControllers.get(runId) === executionController) {
        this.activeRunControllers.delete(runId);
      }

      if (useLocking && !lockLostError && lockToken) {
        await this.config.backend.releaseLock!(runId, lockToken);
        logger.debug("Released lock for run", { runId });
      }
    }
  }

  /**
   * Resolve workflow nodes from definition
   */
  private resolveNodes(workflow: WorkflowDefinition, context: WorkflowContext): WorkflowNode[] {
    const nodes = Array.isArray(workflow.steps) ? workflow.steps : workflow.steps(
      {
        input: context.input,
        context,
        blobStorage: this.config.blobStorage,
        blob: this.blobResolver,
      } satisfies StepBuilderContext,
    );

    this.validateNodes(nodes, workflow.id);
    return nodes;
  }

  /**
   * Validate workflow nodes
   */
  private validateNodes(nodes: WorkflowNode[], workflowId: string): void {
    if (!Array.isArray(nodes)) {
      throw INVALID_ARGUMENT.create({
        detail: `Workflow "${workflowId}" steps must resolve to an array`,
      });
    }

    if (nodes.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: `Workflow "${workflowId}" must have at least one step`,
      });
    }

    const seenIds = new Set<string>();

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (!node) {
        throw INVALID_ARGUMENT.create({
          detail: `Workflow "${workflowId}" has undefined node at index ${i}`,
        });
      }

      if (!node.id || typeof node.id !== "string") {
        throw INVALID_ARGUMENT.create({
          detail: `Workflow "${workflowId}" node at index ${i} has invalid ID`,
        });
      }

      if (seenIds.has(node.id)) {
        throw INVALID_ARGUMENT.create({
          detail: `Workflow "${workflowId}" has duplicate node ID: "${node.id}"`,
        });
      }
      seenIds.add(node.id);

      if (!node.config || typeof node.config !== "object") {
        throw INVALID_ARGUMENT.create({
          detail: `Workflow "${workflowId}" node "${node.id}" has invalid config`,
        });
      }

      if (!node.config.type) {
        throw INVALID_ARGUMENT.create({
          detail: `Workflow "${workflowId}" node "${node.id}" config missing type`,
        });
      }
    }
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

    if (timeout) {
      const timeoutMs = parseDuration(timeout);
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
        await this.waitForCancellationGrace(fencedOperation);
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (rejectAbort) executionController.signal.removeEventListener("abort", rejectAbort);
    }
  }

  private async waitForCancellationGrace(operation: Promise<unknown>): Promise<void> {
    const gracePeriod = Math.max(
      0,
      this.config.cancellationGracePeriod ?? DEFAULT_CANCELLATION_GRACE_PERIOD_MS,
    );
    let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    const graceExpired = new Promise<void>((resolve) => {
      graceTimeoutId = setTimeout(resolve, gracePeriod);
    });

    try {
      await Promise.race([settled, graceExpired]);
    } finally {
      if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);
    }
  }

  private isCurrentExecution(runId: string, controller: AbortController): boolean {
    return this.activeRunControllers.get(runId) === controller;
  }

  /**
   * Mark run as completed
   */
  private async completeRun(
    runId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    executionController: AbortController,
  ): Promise<WorkflowRun | null> {
    await this.waitForCancellationUpdate(runId);
    const currentRun = await this.config.backend.getRun(runId);
    if (!currentRun) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    if (currentRun.status === "cancelled") return currentRun;
    if (
      executionController.signal.aborted ||
      !this.isCurrentExecution(runId, executionController)
    ) return null;

    const publicContext = this.toPublicContext(context);
    const output = this.determineOutput(publicContext);

    await this.config.backend.updateRun(runId, {
      status: "completed",
      output,
      context: publicContext,
      nodeStates,
      completedAt: new Date(),
    });

    return (await this.config.backend.getRun(runId))!;
  }

  /**
   * Mark run as failed
   */
  private async failRun(
    runId: string,
    error: Error,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    executionController: AbortController,
  ): Promise<boolean> {
    await this.waitForCancellationUpdate(runId);
    const currentRun = await this.config.backend.getRun(runId);
    if (currentRun?.status === "cancelled") return false;
    if (!this.isCurrentExecution(runId, executionController)) return false;

    const publicContext = this.toPublicContext(context);

    await this.config.backend.updateRun(runId, {
      status: "failed",
      context: publicContext,
      nodeStates,
      error: {
        message: error.message,
        stack: error.stack,
      },
      completedAt: new Date(),
    });
    return true;
  }

  /**
   * Mark run as waiting
   */
  private async pauseRun(
    runId: string,
    waitingNode: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    executionController: AbortController,
  ): Promise<boolean> {
    await this.waitForCancellationUpdate(runId);
    const currentRun = await this.config.backend.getRun(runId);
    if (currentRun?.status === "cancelled") return false;
    if (
      executionController.signal.aborted ||
      !this.isCurrentExecution(runId, executionController)
    ) return false;

    const publicContext = this.toPublicContext(context);

    await this.config.backend.updateRun(runId, {
      status: "waiting",
      currentNodes: [waitingNode],
      context: publicContext,
      nodeStates,
    });
    return true;
  }

  /**
   * Remove execution-only metadata before exposing or persisting workflow context.
   */
  private toPublicContext(context: WorkflowContext): WorkflowContext {
    const { _tenant: _tenant, ...publicContext } = context;
    return publicContext;
  }

  /**
   * Determine workflow output from context
   */
  private determineOutput(context: WorkflowContext): unknown {
    const { input: _input, _tenant: _tenant, ...rest } = context;
    return rest;
  }

  /**
   * Create a handle for a workflow run
   */
  private createHandle<TOutput>(runId: string, settled: Promise<void>): WorkflowHandle<TOutput> {
    return {
      runId,
      settled: () => settled,
      status: () => this.config.backend.getRun(runId) as Promise<WorkflowRun>,
      result: () => this.waitForResult<TOutput>(runId),
      cancel: () => this.cancel(runId),
    };
  }

  /**
   * Wait for workflow result
   */
  private async waitForResult<TOutput>(
    runId: string,
    pollInterval = DEFAULT_RESULT_POLL_INTERVAL_MS,
    timeoutMs = this.config.resultWaitTimeout ?? DEFAULT_RESULT_WAIT_TIMEOUT_MS,
  ): Promise<TOutput> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const run = await this.config.backend.getRun(runId);
      if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

      if (run.status === "completed") return run.output as TOutput;
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

      // no cleanup needed: one-shot
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, remaining)));
    }
  }

  /**
   * Cancel a workflow run
   */
  async cancel(runId: string): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

    if (run.status === "completed" || run.status === "failed") {
      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot cancel workflow run "${runId}": run has already ${run.status}. ` +
          `Only active runs (pending, running, waiting) can be cancelled.`,
      });
    }

    const cancellationUpdate = Promise.resolve().then(() =>
      this.config.backend.updateRun(runId, {
        status: "cancelled",
        completedAt: new Date(),
      })
    );
    this.cancellationUpdates.set(runId, cancellationUpdate);

    this.activeRunControllers.get(runId)?.abort(
      ORCHESTRATION_ERROR.create({ detail: `Workflow run "${runId}" was cancelled` }),
    );

    try {
      await cancellationUpdate;
    } finally {
      if (this.cancellationUpdates.get(runId) === cancellationUpdate) {
        this.cancellationUpdates.delete(runId);
      }
    }
  }

  private async waitForCancellationUpdate(runId: string): Promise<void> {
    await this.cancellationUpdates.get(runId);
  }

  /**
   * Get workflow run status
   */
  getStatus(runId: string): Promise<WorkflowRun | null> {
    return this.config.backend.getRun(runId);
  }

  /**
   * List workflow runs
   */
  listRuns(options?: {
    workflowId?: string;
    status?: WorkflowStatus | WorkflowStatus[];
    limit?: number;
  }): Promise<WorkflowRun[]> {
    return this.config.backend.listRuns({
      workflowId: options?.workflowId,
      status: options?.status,
      limit: options?.limit,
    });
  }
}
