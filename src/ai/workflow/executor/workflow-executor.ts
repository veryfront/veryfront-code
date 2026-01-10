/**
 * Workflow Executor
 *
 * Main orchestrator for executing durable workflows
 */

import type {
  BlobResolver,
  CapturedTenantContext,
  NodeState,
  StepBuilderContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { generateId, parseDuration } from "../types.ts";
import { getCurrentRequestContext } from "../../../platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { hasLockSupport, type WorkflowBackend } from "../backends/types.ts";
import { DAGExecutor } from "./dag-executor.ts";
import { CheckpointManager } from "./checkpoint-manager.ts";
import { StepExecutor, type StepExecutorConfig } from "./step-executor.ts";
import type { BlobStorage } from "../blob/types.ts";

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
  private workflows = new Map<string, WorkflowDefinition<any, any>>();
  private blobResolver?: BlobResolver;

  /** Default lock duration: 30 seconds */
  private static readonly DEFAULT_LOCK_DURATION = 30000;

  constructor(config: WorkflowExecutorConfig) {
    this.config = {
      maxConcurrency: 10,
      debug: false,
      lockDuration: WorkflowExecutor.DEFAULT_LOCK_DURATION,
      ...config,
    };

    // Initialize components
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
      // onWaiting is intentionally a no-op here - waiting state is handled
      // by executeAsync() after DAG execution returns with waiting: true
      onWaiting: () => {},
    });

    if (this.config.blobStorage) {
      const bs = this.config.blobStorage;
      this.blobResolver = {
        getText: (ref) => ref.__kind === "blob" ? bs.getText(ref.id) : Promise.resolve(null),
        getBytes: (ref) => ref.__kind === "blob" ? bs.getBytes(ref.id) : Promise.resolve(null),
        getStream: (ref) => ref.__kind === "blob" ? bs.getStream(ref.id) : Promise.resolve(null),
        stat: (ref) => ref.__kind === "blob" ? bs.stat(ref.id) : Promise.resolve(null),
        delete: (ref) => ref.__kind === "blob" ? bs.delete(ref.id) : Promise.resolve(undefined),
      };
    }
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
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Validate input if schema provided
    if (workflow.inputSchema) {
      workflow.inputSchema.parse(input);
    }

    // Auto-capture tenant context from current request (if running within a request)
    const requestContext = getCurrentRequestContext();
    const capturedTenant: CapturedTenantContext | undefined = requestContext
      ? {
        projectSlug: requestContext.projectSlug,
        token: requestContext.token,
        projectId: requestContext.projectId,
        productionMode: requestContext.productionMode,
        releaseId: requestContext.releaseId,
      }
      : undefined;

    // Create run
    const run: WorkflowRun<TInput, TOutput> = {
      id: options?.runId || generateId("run"),
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
      _tenant: capturedTenant,
    };

    // Persist run
    await this.config.backend.createRun(run);

    // Start execution asynchronously
    this.executeAsync(run.id).catch((error) => {
      console.error(`Workflow ${run.id} failed:`, error);
    });

    return this.createHandle<TOutput>(run.id);
  }

  /**
   * Resume a paused/waiting workflow
   */
  async resume(runId: string, fromCheckpoint?: string): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status !== "waiting" && run.status !== "pending") {
      throw new Error(
        `Cannot resume workflow run "${runId}": current status is "${run.status}". ` +
          `Only runs in "waiting" or "pending" status can be resumed.`,
      );
    }

    // Get workflow definition
    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${run.workflowId}`);
    }

    // Get nodes
    const nodes = this.resolveNodes(workflow, run.context);

    // Get resume point
    const resumeInfo = await this.checkpointManager.prepareResume(
      runId,
      nodes,
      fromCheckpoint,
    );

    // If an explicit checkpoint was requested but not found, throw error
    if (fromCheckpoint && !resumeInfo) {
      throw new Error(
        `Checkpoint "${fromCheckpoint}" not found for run "${runId}". ` +
          `Cannot resume from non-existent checkpoint.`,
      );
    }

    if (resumeInfo) {
      // Update run state from checkpoint
      await this.config.backend.updateRun(runId, {
        status: "running",
        context: resumeInfo.context,
        nodeStates: resumeInfo.nodeStates,
      });
    }

    // Resume execution
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
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Get workflow definition
    const workflow = this.workflows.get(run.workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${run.workflowId}`);
    }

    // Try to acquire lock if backend supports it and locking is enabled
    const useLocking = this.config.enableLocking !== false &&
      hasLockSupport(this.config.backend);
    const lockDuration = this.config.lockDuration!;

    if (useLocking) {
      const acquired = await this.config.backend.acquireLock!(runId, lockDuration);
      if (!acquired) {
        throw new Error(
          `Cannot execute workflow run "${runId}": another worker is already executing it. ` +
            `This can happen when multiple workers try to execute the same run concurrently.`,
        );
      }

      if (this.config.debug) {
        console.log(`[WorkflowExecutor] Acquired lock for run: ${runId}`);
      }
    }

    try {
      // Update status to running
      await this.config.backend.updateRun(runId, {
        status: "running",
        startedAt: run.startedAt || new Date(),
      });

      // Notify start
      const updatedRun = await this.config.backend.getRun(runId);
      this.config.onStart?.(updatedRun!);

      // Resolve workflow nodes
      const nodes = this.resolveNodes(workflow, run.context);

      // Execute with timeout if configured
      const result = await this.executeWithTimeout(
        () => this.dagExecutor.execute(nodes, run as WorkflowRun, startFromNode),
        workflow.timeout,
      );

      // Update run based on result
      if (result.completed) {
        // Workflow completed successfully
        const finalRun = await this.completeRun(
          runId,
          result.context,
          result.nodeStates,
        );

        // Validate output if schema provided
        if (workflow.outputSchema) {
          workflow.outputSchema.parse(finalRun.output);
        }

        // Call completion handler
        await workflow.onComplete?.(finalRun.output, finalRun.context);
        this.config.onComplete?.(finalRun);
      } else if (result.waiting) {
        // Workflow is waiting for approval/event
        await this.pauseRun(
          runId,
          result.waitingNode!,
          result.context,
          result.nodeStates,
        );

        const pausedRun = await this.config.backend.getRun(runId);
        this.config.onWaiting?.(pausedRun!, result.waitingNode!);
      } else {
        // Workflow failed
        const error = new Error(result.error || "Unknown error");
        await this.failRun(runId, error, result.context, result.nodeStates);

        await workflow.onError?.(error, result.context);
        this.config.onError?.(run, error);
      }
    } catch (error) {
      // Unexpected error during execution
      const err = error instanceof Error ? error : new Error(String(error));
      await this.failRun(runId, err, run.context, run.nodeStates);

      await workflow.onError?.(err, run.context);
      this.config.onError?.(run, err);

      throw error;
    } finally {
      // Always release lock when done
      if (useLocking) {
        await this.config.backend.releaseLock!(runId);

        if (this.config.debug) {
          console.log(`[WorkflowExecutor] Released lock for run: ${runId}`);
        }
      }
    }
  }

  /**
   * Resolve workflow nodes from definition
   */
  private resolveNodes(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
  ): WorkflowNode[] {
    let nodes: WorkflowNode[];

    if (Array.isArray(workflow.steps)) {
      nodes = workflow.steps;
    } else {
      // Dynamic steps - call the function
      if (!this.config.blobStorage) {
        // Warn if blobStorage is missing but dynamic steps might need it?
        // For now, we allow it to be undefined if user doesn't use it.
      }

      const builderContext: StepBuilderContext = {
        input: context.input,
        context,
        blobStorage: this.config.blobStorage,
        blob: this.blobResolver,
      };
      nodes = workflow.steps(builderContext);
    }

    // Validate resolved nodes
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
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout?: string | number,
  ): Promise<T> {
    if (!timeout) {
      return fn();
    }

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
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
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
    // Determine output (last node's output or accumulated context)
    const output = this.determineOutput(context);

    await this.config.backend.updateRun(runId, {
      status: "completed" as WorkflowStatus,
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
      status: "failed" as WorkflowStatus,
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
      status: "waiting" as WorkflowStatus,
      currentNodes: [waitingNode],
      context,
      nodeStates,
    });
  }

  /**
   * Determine workflow output from context
   */
  private determineOutput(context: WorkflowContext): unknown {
    // Remove 'input' and return the rest as output
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
    pollInterval: number = 1000,
  ): Promise<TOutput> {
    while (true) {
      const run = await this.config.backend.getRun(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      if (run.status === "completed") {
        return run.output as TOutput;
      }

      if (run.status === "failed") {
        throw new Error(run.error?.message || "Workflow failed");
      }

      if (run.status === "cancelled") {
        throw new Error("Workflow was cancelled");
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Cancel a workflow run
   */
  async cancel(runId: string): Promise<void> {
    const run = await this.config.backend.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status === "completed" || run.status === "failed") {
      throw new Error(
        `Cannot cancel workflow run "${runId}": run has already ${run.status}. ` +
          `Only active runs (pending, running, waiting) can be cancelled.`,
      );
    }

    await this.config.backend.updateRun(runId, {
      status: "cancelled" as WorkflowStatus,
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
