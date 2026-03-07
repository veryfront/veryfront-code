/**************************
 * Workflow Executor
 *
 * Main orchestrator for executing durable workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
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
import { DAGExecutor } from "./dag-executor.ts";
import { CheckpointManager } from "./checkpoint-manager.ts";
import { runWithWorkflowTenant, StepExecutor, type StepExecutorConfig } from "./step-executor.ts";
import type { BlobStorage } from "../blob/types.ts";

const logger = baseLogger.component("workflow-executor");

/** Default polling interval for waiting on workflow result */
const DEFAULT_RESULT_POLL_INTERVAL_MS = 1_000;

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
  /** Enable distributed locking (default: true if backend supports it) */
  enableLocking?: boolean;
  /** Callback when workflow starts */
  onStart?: (run: WorkflowRun) => void;
  /** Callback when workflow completes */
  onComplete?: (run: WorkflowRun) => void;
  /** Callback when workflow fails */
  onError?: (run: WorkflowRun, error: Error) => void;
  /** Callback when workflow is waiting */
  onWaiting?: (run: WorkflowRun, nodeId: string) => void;
}

/**
 * Handle for a running workflow
 */
export interface WorkflowHandle<TOutput = unknown> {
  /** Run ID */
  runId: string;
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
      const blob = ref as Record<string, unknown> | null | undefined;
      return blob?.__kind === "blob" && typeof blob.id === "string"
        ? fn(blob.id)
        : Promise.resolve(fallback);
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
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

    workflow.inputSchema?.parse(input);

    // Capture current tenant context for multi-tenant job execution.
    // When a workflow is started from an API route, the request context
    // carries the tenant info (slug, token, etc.). We persist it on the run
    // so that worker processes can restore the context when executing jobs.
    const requestCtx = getCurrentRequestContext();
    const tenant = requestCtx
      ? {
        projectSlug: requestCtx.projectSlug,
        token: requestCtx.token,
        projectId: requestCtx.projectId,
        productionMode: requestCtx.productionMode ?? false,
        releaseId: requestCtx.releaseId ?? null,
      }
      : undefined;

    const run: WorkflowRun<TInput, TOutput> = {
      id: options?.runId ?? generateId("run"),
      workflowId,
      version: workflow.version,
      status: "pending",
      input,
      nodeStates: {},
      currentNodes: [],
      context: { input },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      _tenant: tenant,
    };

    await this.config.backend.createRun(run);

    this.executeAsync(run.id).catch((error) => {
      logger.error("Workflow failed", { runId: run.id }, error);
    });

    return this.createHandle<TOutput>(run.id);
  }

  /**
   * Resume a paused/waiting workflow
   */
  async resume(runId: string, fromCheckpoint?: string): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    if (run.status !== "waiting" && run.status !== "pending") {
      throw new Error(
        `Cannot resume workflow run "${runId}": current status is "${run.status}". ` +
          `Only runs in "waiting" or "pending" status can be resumed.`,
      );
    }

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${run.workflowId}`);

    const nodes = this.resolveNodes(workflow, run.context);
    const resumeInfo = await this.checkpointManager.prepareResume(runId, nodes, fromCheckpoint);

    if (fromCheckpoint && !resumeInfo) {
      throw new Error(
        `Checkpoint "${fromCheckpoint}" not found for run "${runId}". ` +
          `Cannot resume from non-existent checkpoint.`,
      );
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
    if (!run) throw new Error(`Run not found: ${runId}`);

    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${run.workflowId}`);

    const useLocking = this.config.enableLocking !== false && hasLockSupport(this.config.backend);
    const lockDuration = this.config.lockDuration ?? WorkflowExecutor.DEFAULT_LOCK_DURATION;
    let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
    let heartbeatInFlight = false;

    if (useLocking) {
      const acquired = await this.config.backend.acquireLock!(runId, lockDuration);
      if (!acquired) {
        throw new Error(
          `Cannot execute workflow run "${runId}": another worker is already executing it. ` +
            `This can happen when multiple workers try to execute the same run concurrently.`,
        );
      }
      logger.debug("Acquired lock for run", { runId });
    }

    try {
      const now = new Date();
      await this.config.backend.updateRun(runId, {
        status: "running",
        startedAt: run.startedAt || now,
        heartbeatAt: now,
      });

      heartbeatInterval = setInterval(() => {
        if (heartbeatInFlight) return;
        heartbeatInFlight = true;

        void (async () => {
          try {
            await this.config.backend.updateRun(runId, {
              heartbeatAt: new Date(),
            });

            if (useLocking && typeof this.config.backend.extendLock === "function") {
              const extended = await this.config.backend.extendLock(runId, lockDuration);
              if (!extended) {
                logger.warn("Failed to extend lock during heartbeat", { runId });
              }
            }
          } catch (error) {
            logger.warn("Heartbeat update failed", { runId }, error);
          } finally {
            heartbeatInFlight = false;
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
          () => this.dagExecutor.execute(nodes, runWithTenantContext, startFromNode),
          workflow.timeout,
        ));

      if (result.completed) {
        const finalRun = await this.completeRun(runId, result.context, result.nodeStates);

        workflow.outputSchema?.parse(finalRun.output);

        await workflow.onComplete?.(finalRun.output, finalRun.context);
        this.config.onComplete?.(finalRun);
        return;
      }

      if (result.waiting) {
        await this.pauseRun(runId, result.waitingNode!, result.context, result.nodeStates);

        const pausedRun = await this.config.backend.getRun(runId);
        this.config.onWaiting?.(pausedRun!, result.waitingNode!);
        return;
      }

      const error = new Error(result.error || "Unknown error");
      await this.failRun(runId, error, result.context, result.nodeStates);

      await workflow.onError?.(error, result.context);
      this.config.onError?.(run, error);
    } catch (error) {
      const normalizedError = ensureError(error);
      await this.failRun(runId, normalizedError, run.context, run.nodeStates);

      await workflow.onError?.(normalizedError, run.context);
      this.config.onError?.(run, normalizedError);

      throw normalizedError;
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }

      if (useLocking) {
        await this.config.backend.releaseLock!(runId);
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
      throw new Error(`Workflow "${workflowId}" steps must resolve to an array`);
    }

    if (nodes.length === 0) {
      throw new Error(`Workflow "${workflowId}" must have at least one step`);
    }

    const seenIds = new Set<string>();

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (!node) {
        throw new Error(`Workflow "${workflowId}" has undefined node at index ${i}`);
      }

      if (!node.id || typeof node.id !== "string") {
        throw new Error(`Workflow "${workflowId}" node at index ${i} has invalid ID`);
      }

      if (seenIds.has(node.id)) {
        throw new Error(`Workflow "${workflowId}" has duplicate node ID: "${node.id}"`);
      }
      seenIds.add(node.id);

      if (!node.config || typeof node.config !== "object") {
        throw new Error(`Workflow "${workflowId}" node "${node.id}" has invalid config`);
      }

      if (!node.config.type) {
        throw new Error(`Workflow "${workflowId}" node "${node.id}" config missing type`);
      }
    }
  }

  /**
   * Execute with optional timeout
   *
   * Uses Promise.race() to properly handle timeout cleanup.
   * The timeout is always cleared in the finally block to prevent memory leaks.
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeout?: string | number): Promise<T> {
    if (!timeout) return fn();

    const timeoutMs = parseDuration(timeout);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Workflow timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  /**
   * Mark run as completed
   */
  private async completeRun(
    runId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<WorkflowRun> {
    const output = this.determineOutput(context);

    await this.config.backend.updateRun(runId, {
      status: "completed",
      output,
      context,
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
  ): Promise<void> {
    await this.config.backend.updateRun(runId, {
      status: "failed",
      context,
      nodeStates,
      error: {
        message: error.message,
        stack: error.stack,
      },
      completedAt: new Date(),
    });
  }

  /**
   * Mark run as waiting
   */
  private async pauseRun(
    runId: string,
    waitingNode: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<void> {
    await this.config.backend.updateRun(runId, {
      status: "waiting",
      currentNodes: [waitingNode],
      context,
      nodeStates,
    });
  }

  /**
   * Determine workflow output from context
   */
  private determineOutput(context: WorkflowContext): unknown {
    const { input: _input, ...rest } = context;
    return rest;
  }

  /**
   * Create a handle for a workflow run
   */
  private createHandle<TOutput>(runId: string): WorkflowHandle<TOutput> {
    return {
      runId,
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
  ): Promise<TOutput> {
    while (true) {
      const run = await this.config.backend.getRun(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);

      if (run.status === "completed") return run.output as TOutput;
      if (run.status === "failed") throw new Error(run.error?.message || "Workflow failed");
      if (run.status === "cancelled") throw new Error("Workflow was cancelled");

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Cancel a workflow run
   */
  async cancel(runId: string): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    if (run.status === "completed" || run.status === "failed") {
      throw new Error(
        `Cannot cancel workflow run "${runId}": run has already ${run.status}. ` +
          `Only active runs (pending, running, waiting) can be cancelled.`,
      );
    }

    await this.config.backend.updateRun(runId, {
      status: "cancelled",
      completedAt: new Date(),
    });
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
