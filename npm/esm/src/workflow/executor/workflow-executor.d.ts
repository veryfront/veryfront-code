import type { WorkflowDefinition, WorkflowRun, WorkflowStatus } from "../types.js";
import { type WorkflowBackend } from "../backends/types.js";
import { type StepExecutorConfig } from "./step-executor.js";
import type { BlobStorage } from "../blob/types.js";
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
export declare class WorkflowExecutor {
    private config;
    private stepExecutor;
    private checkpointManager;
    private dagExecutor;
    private workflows;
    private blobResolver?;
    /** Default lock duration: 30 seconds */
    private static readonly DEFAULT_LOCK_DURATION;
    constructor(config: WorkflowExecutorConfig);
    /**
     * Register a workflow definition
     */
    register<TInput, TOutput>(workflow: WorkflowDefinition<TInput, TOutput>): void;
    /**
     * Get a registered workflow
     */
    getWorkflow(id: string): WorkflowDefinition<any, any> | undefined;
    /**
     * Start a new workflow run
     */
    start<TInput, TOutput>(workflowId: string, input: TInput, options?: {
        runId?: string;
    }): Promise<WorkflowHandle<TOutput>>;
    /**
     * Resume a paused/waiting workflow
     */
    resume(runId: string, fromCheckpoint?: string): Promise<void>;
    /**
     * Execute a workflow run asynchronously
     *
     * Uses distributed locking (when backend supports it) to prevent
     * concurrent execution of the same workflow run.
     */
    executeAsync(runId: string, startFromNode?: string): Promise<void>;
    /**
     * Resolve workflow nodes from definition
     */
    private resolveNodes;
    /**
     * Validate workflow nodes
     */
    private validateNodes;
    /**
     * Execute with optional timeout
     *
     * Uses Promise.race() to properly handle timeout cleanup.
     * The timeout is always cleared in the finally block to prevent memory leaks.
     */
    private executeWithTimeout;
    /**
     * Mark run as completed
     */
    private completeRun;
    /**
     * Mark run as failed
     */
    private failRun;
    /**
     * Mark run as waiting
     */
    private pauseRun;
    /**
     * Determine workflow output from context
     */
    private determineOutput;
    /**
     * Create a handle for a workflow run
     */
    private createHandle;
    /**
     * Wait for workflow result
     */
    private waitForResult;
    /**
     * Cancel a workflow run
     */
    cancel(runId: string): Promise<void>;
    /**
     * Get workflow run status
     */
    getStatus(runId: string): Promise<WorkflowRun | null>;
    /**
     * List workflow runs
     */
    listRuns(options?: {
        workflowId?: string;
        status?: WorkflowStatus | WorkflowStatus[];
        limit?: number;
    }): Promise<WorkflowRun[]>;
}
//# sourceMappingURL=workflow-executor.d.ts.map