/**************************
 * Workflow Executor
 *
 * Main orchestrator for executing durable workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR, RESOURCE_NOT_FOUND, TIMEOUT_ERROR, ensureError } from "#veryfront/errors";
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

const logger = baseLogger.component("workflow-executor");

/** Default polling interval for waiting on workflow result */
const DEFAULT_RESULT_POLL_INTERVAL_MS = 1_000;

/** Default max time waitForResult() polls before giving up (5 minutes) */
const DEFAULT_RESULT_WAIT_TIMEOUT_MS = 5 * 60 * 1_000;

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
  /** Runs cancelled in-process; guards terminal writes from clobbering "cancelled". */
  private cancelledRuns = new Set<string>();
  /** Per-run aborters that stop in-flight execution when cancel() is called. */
  private cancelSignals = new Map<string, () => void>();

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

    if (expectedWorkerId !== undefined && run.workerId !== expectedWorkerId) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Cannot resume workflow run because execution ownership has changed",
      });
    }

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
      const resumed = await this.updateRunIfStatus(
        runId,
        [run.status],
        {
          status: "running",
          context: resumeInfo.context,
          nodeStates: resumeInfo.nodeStates,
        },
        expectedWorkerId,
      );
      if (!resumed) {
        const current = await this.config.backend.getRun(runId);
        if (current?.status === "cancelled") return;
        throw ORCHESTRATION_ERROR.create({
          detail: `Cannot resume workflow run "${runId}": current status is "${current?.status}"`,
        });
      }
    }

    await this.executeAsync(runId, resumeInfo?.startFromNode, expectedWorkerId);
  }

  /**
   * Execute a workflow run asynchronously
   *
   * Uses distributed locking (when backend supports it) to prevent
   * concurrent execution of the same workflow run.
   */
  async executeAsync(
    runId: string,
    startFromNode?: string,
    expectedWorkerId?: string,
  ): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Workflow not found: ${run.workflowId}` });
    }

    const useLocking = this.config.enableLocking !== false && hasLockSupport(this.config.backend);
    const lockDuration = this.config.lockDuration ?? WorkflowExecutor.DEFAULT_LOCK_DURATION;
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    let heartbeatTask: Promise<void> | undefined;

    // If the heartbeat can no longer extend our lock, another worker may claim
    // this run as stalled and execute it concurrently. The execution controller
    // stops cooperative work while keeping cleanup inside this method's finally.
    let lockLostError: Error | undefined;
    let ownershipLostError: Error | undefined;

    // Acquire the lock BEFORE registering any per-run state (cancelSignals). If
    // acquisition fails we throw here, and registering the cancel signal earlier
    // would leak it (and later poison cancelledRuns) on every lost lock race.
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
    const releaseExecutionLock = async (): Promise<void> => {
      if (!useLocking || !lockToken) return;
      const token = lockToken;
      await this.config.backend.releaseLock!(runId, token);
      lockToken = null;
      logger.debug("Released lock for run", { runId });
    };

    const executionAbortController = new AbortController();
    const abortForOwnershipLoss = (): Error => {
      if (!ownershipLostError) {
        ownershipLostError = ORCHESTRATION_ERROR.create({
          detail: "Workflow execution ownership changed",
        });
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (!executionAbortController.signal.aborted) {
          executionAbortController.abort(ownershipLostError);
        }
      }
      return ownershipLostError;
    };
    this.cancelSignals.set(runId, () => {
      if (!executionAbortController.signal.aborted) {
        executionAbortController.abort(
          ORCHESTRATION_ERROR.create({ detail: "Workflow run was cancelled" }),
        );
      }
    });

    try {
      const now = new Date();
      const started = await this.updateRunIfStatus(
        runId,
        ["pending", "waiting", "running"],
        {
          status: "running",
          startedAt: run.startedAt || now,
          heartbeatAt: now,
        },
        expectedWorkerId,
      );
      if (!started) {
        const current = await this.config.backend.getRun(runId);
        if (current?.status === "cancelled") return;
        if (expectedWorkerId !== undefined) throw abortForOwnershipLoss();
        throw ORCHESTRATION_ERROR.create({
          detail: `Cannot execute workflow run "${runId}": current status is "${current?.status}"`,
        });
      }

      heartbeatInterval = setInterval(() => {
        if (heartbeatTask) return;

        heartbeatTask = (async () => {
          try {
            const persistedRun = await this.config.backend.getRun(runId);
            if (persistedRun?.status === "cancelled") {
              this.cancelledRuns.add(runId);
              if (heartbeatInterval) clearInterval(heartbeatInterval);
              if (!executionAbortController.signal.aborted) {
                executionAbortController.abort(
                  ORCHESTRATION_ERROR.create({
                    detail: "Workflow run was cancelled",
                  }),
                );
              }
              return;
            }

            const heartbeatUpdated = await this.updateRunIfStatus(
              runId,
              ["running"],
              { heartbeatAt: new Date() },
              expectedWorkerId,
            );
            if (!heartbeatUpdated) {
              const current = await this.config.backend.getRun(runId);
              if (current?.status === "cancelled") {
                this.cancelledRuns.add(runId);
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                if (!executionAbortController.signal.aborted) {
                  executionAbortController.abort(
                    ORCHESTRATION_ERROR.create({ detail: "Workflow run was cancelled" }),
                  );
                }
              } else if (expectedWorkerId !== undefined) {
                abortForOwnershipLoss();
              }
              return;
            }

            if (useLocking && typeof this.config.backend.extendLock === "function") {
              const extended = await this.config.backend.extendLock(
                runId,
                lockDuration,
                lockToken ?? undefined,
              );
              if (!extended && !lockLostError) {
                lockLostError = ORCHESTRATION_ERROR.create({
                  detail: `Lost lock for run "${runId}" during heartbeat; aborting to avoid ` +
                    `concurrent execution by another worker.`,
                });
                logger.error("Lost workflow lock; aborting run", { runId });
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                executionAbortController.abort(lockLostError);
              }
            }
          } catch (error) {
            logger.warn("Heartbeat update failed", { runId }, error);
          } finally {
            heartbeatTask = undefined;
          }
        })();
      }, this.config.heartbeatInterval ?? WorkflowExecutor.HEARTBEAT_INTERVAL_MS);

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
          (executionSignal) =>
            this.dagExecutor.execute(
              nodes,
              runWithTenantContext,
              startFromNode,
              executionSignal,
              expectedWorkerId ? { runId, workerId: expectedWorkerId } : undefined,
            ),
          workflow.timeout,
          executionAbortController.signal,
        ));

      if (result.completed) {
        const output = this.determineOutput(this.toPublicContext(result.context));
        workflow.outputSchema?.parse(output);
        const finalRun = await this.completeRun(
          runId,
          result.context,
          result.nodeStates,
          output,
          expectedWorkerId,
        );

        // A concurrent cancel() may have won: completeRun leaves the "cancelled"
        // status intact, so don't run completion side-effects in that case.
        if (!finalRun || this.cancelledRuns.has(runId) || finalRun.status !== "completed") return;

        await workflow.onComplete?.(finalRun.output, finalRun.context);
        this.config.onComplete?.(finalRun);
        return;
      }

      if (result.waiting) {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = undefined;
        }
        const activeHeartbeat = heartbeatTask;
        if (activeHeartbeat) await activeHeartbeat;

        const paused = await this.pauseRun(
          runId,
          result.waitingNode!,
          result.context,
          result.nodeStates,
          expectedWorkerId,
        );
        if (!paused) return;

        const pausedRun = await this.config.backend.getRun(runId);
        // Waiting is durable now, so release execution ownership before callbacks
        // persist or notify an approval that may immediately resume this run.
        await releaseExecutionLock();
        await this.config.onWaiting?.(pausedRun!, result.waitingNode!);
        return;
      }

      // A concurrent cancel() takes precedence over a failure result.
      if (this.cancelledRuns.has(runId)) return;

      const error = ORCHESTRATION_ERROR.create({ detail: result.error || "Unknown error" });
      const failed = await this.failRun(
        runId,
        error,
        result.context,
        result.nodeStates,
        expectedWorkerId,
      );
      if (!failed) return;

      await workflow.onError?.(error, result.context);
      this.config.onError?.(run, error);
    } catch (error) {
      const normalizedError = ensureError(error);

      // Cancelled in-process: cancel() already persisted the "cancelled" status
      // (and likely triggered this abort). Do not write a terminal status or fire
      // error callbacks — that would clobber the cancellation.
      if (this.cancelledRuns.has(runId)) {
        logger.warn("Run cancelled; leaving cancelled status unchanged");
        return;
      }

      // Lock lost: we no longer own the run, so a new owner (via stalled-run
      // recovery) is responsible for it. Do NOT write a terminal status here or
      // we would overwrite that worker's progress. Just release and rethrow.
      if (lockLostError) {
        logger.warn("Aborted run after losing lock; leaving status for new owner", { runId });
        throw lockLostError;
      }

      if (ownershipLostError) {
        logger.warn("Aborted run after execution ownership changed");
        throw ownershipLostError;
      }

      const failed = await this.failRun(
        runId,
        normalizedError,
        run.context,
        run.nodeStates,
        expectedWorkerId,
      );
      if (!failed) return;

      await workflow.onError?.(normalizedError, run.context);
      this.config.onError?.(run, normalizedError);

      throw normalizedError;
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      const activeHeartbeat = heartbeatTask;
      if (activeHeartbeat) await activeHeartbeat;

      this.cancelSignals.delete(runId);
      this.cancelledRuns.delete(runId);

      await releaseExecutionLock();
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
    fn: (abortSignal: AbortSignal) => Promise<T>,
    timeout?: string | number,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    if (!timeout) {
      const executionSignal = parentSignal ?? new AbortController().signal;
      executionSignal.throwIfAborted();
      return fn(executionSignal);
    }

    const timeoutMs = parseDuration(timeout);
    const controller = new AbortController();
    const forwardParentAbort = () => {
      if (!controller.signal.aborted) controller.abort(parentSignal?.reason);
    };

    if (parentSignal) {
      parentSignal.addEventListener("abort", forwardParentAbort, { once: true });
      if (parentSignal.aborted) forwardParentAbort();
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let execution: Promise<T> | undefined;

    try {
      controller.signal.throwIfAborted();
      execution = fn(controller.signal);

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = TIMEOUT_ERROR.create({
            detail: `Workflow timed out after ${timeoutMs}ms`,
          });
          if (!controller.signal.aborted) controller.abort(error);
          reject(error);
        }, timeoutMs);
      });

      try {
        const result = await Promise.race([execution, timeoutPromise]);
        controller.signal.throwIfAborted();
        return result;
      } catch (error) {
        if (controller.signal.aborted) {
          await execution.catch(() => {});
          controller.signal.throwIfAborted();
        }
        throw error;
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", forwardParentAbort);
    }
  }

  /**
   * Mark run as completed
   */
  private async completeRun(
    runId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    output: unknown,
    expectedWorkerId?: string,
  ): Promise<WorkflowRun | null> {
    const publicContext = this.toPublicContext(context);

    const completed = await this.updateRunIfStatus(
      runId,
      ["running"],
      {
        status: "completed",
        output,
        context: publicContext,
        nodeStates,
        completedAt: new Date(),
      },
      expectedWorkerId,
    );
    if (!completed) return null;

    const current = await this.config.backend.getRun(runId);
    if (!current) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    return current;
  }

  /**
   * Mark run as failed
   */
  private async failRun(
    runId: string,
    error: Error,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    const publicContext = this.toPublicContext(context);

    return await this.updateRunIfStatus(
      runId,
      ["running"],
      {
        status: "failed",
        context: publicContext,
        nodeStates,
        error: {
          message: error.message,
          stack: error.stack,
        },
        completedAt: new Date(),
      },
      expectedWorkerId,
    );
  }

  /**
   * Mark run as waiting
   */
  private async pauseRun(
    runId: string,
    waitingNode: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    const publicContext = this.toPublicContext(context);

    return await this.updateRunIfStatus(
      runId,
      ["running"],
      {
        status: "waiting",
        currentNodes: [waitingNode],
        context: publicContext,
        nodeStates,
      },
      expectedWorkerId,
    );
  }

  private async updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    patch: Partial<WorkflowRun>,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    if (expectedWorkerId !== undefined) {
      if (!this.config.backend.updateRunIfStatusAndWorker) return false;
      return await this.config.backend.updateRunIfStatusAndWorker(
        runId,
        expectedStatuses,
        expectedWorkerId,
        patch,
      );
    }

    if (this.config.backend.updateRunIfStatus) {
      return await this.config.backend.updateRunIfStatus(runId, expectedStatuses, patch);
    }

    // Compatibility fallback for third-party backends that predate conditional
    // updates. Built-in backends implement the atomic method above.
    const current = await this.config.backend.getRun(runId);
    if (!current || !expectedStatuses.includes(current.status)) return false;
    await this.config.backend.updateRun(runId, patch);
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

    const activeAbort = this.cancelSignals.get(runId);

    try {
      const cancelled = await this.updateRunIfStatus(runId, ["pending", "running", "waiting"], {
        status: "cancelled",
        completedAt: new Date(),
      });
      if (!cancelled) {
        const current = await this.config.backend.getRun(runId);
        if (current?.status !== "cancelled") {
          if (activeAbort) this.cancelledRuns.delete(runId);
          throw ORCHESTRATION_ERROR.create({
            detail: `Cannot cancel workflow run "${runId}": run has already ${current?.status}. ` +
              `Only active runs (pending, running, waiting) can be cancelled.`,
          });
        }
      }

      // Only publish the in-process cancellation flag after the persisted
      // status transition wins. A speculative flag can suppress completion
      // callbacks when a concurrent completion commits first.
      if (activeAbort) this.cancelledRuns.add(runId);
      activeAbort?.();
    } catch (error) {
      if (activeAbort) this.cancelledRuns.delete(runId);
      throw error;
    }
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
