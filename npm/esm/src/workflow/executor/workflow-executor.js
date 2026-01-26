/**************************
 * Workflow Executor
 *
 * Main orchestrator for executing durable workflows
 **************************/
import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
import { generateId, parseDuration } from "../types.js";
import { hasLockSupport } from "../backends/types.js";
import { DAGExecutor } from "./dag-executor.js";
import { CheckpointManager } from "./checkpoint-manager.js";
import { StepExecutor } from "./step-executor.js";
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
    config;
    stepExecutor;
    checkpointManager;
    dagExecutor;
    workflows = new Map();
    blobResolver;
    /** Default lock duration: 30 seconds */
    static DEFAULT_LOCK_DURATION = 30000;
    constructor(config) {
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
            onWaiting: () => { },
        });
        const bs = this.config.blobStorage;
        if (bs) {
            const resolveIfBlob = (ref, fn, fallback) => ref?.__kind === "blob" ? fn(ref.id) : Promise.resolve(fallback);
            this.blobResolver = {
                getText: (ref) => resolveIfBlob(ref, (id) => bs.getText(id), null),
                getBytes: (ref) => resolveIfBlob(ref, (id) => bs.getBytes(id), null),
                getStream: (ref) => resolveIfBlob(ref, (id) => bs.getStream(id), null),
                stat: (ref) => resolveIfBlob(ref, (id) => bs.stat(id), null),
                delete: (ref) => resolveIfBlob(ref, (id) => bs.delete(id), undefined),
            };
        }
    }
    /**
     * Register a workflow definition
     */
    register(workflow) {
        this.workflows.set(workflow.id, workflow);
    }
    /**
     * Get a registered workflow
     */
    getWorkflow(id) {
        return this.workflows.get(id);
    }
    /**
     * Start a new workflow run
     */
    async start(workflowId, input, options) {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }
        workflow.inputSchema?.parse(input);
        const run = {
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
        };
        await this.config.backend.createRun(run);
        this.executeAsync(run.id).catch((error) => {
            logger.error("[WorkflowExecutor] Workflow failed", { runId: run.id }, error);
        });
        return this.createHandle(run.id);
    }
    /**
     * Resume a paused/waiting workflow
     */
    async resume(runId, fromCheckpoint) {
        const run = await this.config.backend.getRun(runId);
        if (!run) {
            throw new Error(`Run not found: ${runId}`);
        }
        if (run.status !== "waiting" && run.status !== "pending") {
            throw new Error(`Cannot resume workflow run "${runId}": current status is "${run.status}". ` +
                `Only runs in "waiting" or "pending" status can be resumed.`);
        }
        const workflow = this.workflows.get(run.workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${run.workflowId}`);
        }
        const nodes = this.resolveNodes(workflow, run.context);
        const resumeInfo = await this.checkpointManager.prepareResume(runId, nodes, fromCheckpoint);
        if (fromCheckpoint && !resumeInfo) {
            throw new Error(`Checkpoint "${fromCheckpoint}" not found for run "${runId}". ` +
                `Cannot resume from non-existent checkpoint.`);
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
    async executeAsync(runId, startFromNode) {
        const run = await this.config.backend.getRun(runId);
        if (!run) {
            throw new Error(`Run not found: ${runId}`);
        }
        const workflow = this.workflows.get(run.workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${run.workflowId}`);
        }
        const useLocking = this.config.enableLocking !== false && hasLockSupport(this.config.backend);
        const lockDuration = this.config.lockDuration ?? WorkflowExecutor.DEFAULT_LOCK_DURATION;
        if (useLocking) {
            const acquired = await this.config.backend.acquireLock(runId, lockDuration);
            if (!acquired) {
                throw new Error(`Cannot execute workflow run "${runId}": another worker is already executing it. ` +
                    `This can happen when multiple workers try to execute the same run concurrently.`);
            }
            logger.debug("[WorkflowExecutor] Acquired lock for run", { runId });
        }
        try {
            await this.config.backend.updateRun(runId, {
                status: "running",
                startedAt: run.startedAt || new Date(),
            });
            const updatedRun = await this.config.backend.getRun(runId);
            this.config.onStart?.(updatedRun);
            const nodes = this.resolveNodes(workflow, run.context);
            const result = await this.executeWithTimeout(() => this.dagExecutor.execute(nodes, run, startFromNode), workflow.timeout);
            if (result.completed) {
                const finalRun = await this.completeRun(runId, result.context, result.nodeStates);
                workflow.outputSchema?.parse(finalRun.output);
                await workflow.onComplete?.(finalRun.output, finalRun.context);
                this.config.onComplete?.(finalRun);
                return;
            }
            if (result.waiting) {
                await this.pauseRun(runId, result.waitingNode, result.context, result.nodeStates);
                const pausedRun = await this.config.backend.getRun(runId);
                this.config.onWaiting?.(pausedRun, result.waitingNode);
                return;
            }
            const error = new Error(result.error || "Unknown error");
            await this.failRun(runId, error, result.context, result.nodeStates);
            await workflow.onError?.(error, result.context);
            this.config.onError?.(run, error);
        }
        catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            await this.failRun(runId, normalizedError, run.context, run.nodeStates);
            await workflow.onError?.(normalizedError, run.context);
            this.config.onError?.(run, normalizedError);
            throw normalizedError;
        }
        finally {
            if (useLocking) {
                await this.config.backend.releaseLock(runId);
                logger.debug("[WorkflowExecutor] Released lock for run", { runId });
            }
        }
    }
    /**
     * Resolve workflow nodes from definition
     */
    resolveNodes(workflow, context) {
        const nodes = Array.isArray(workflow.steps) ? workflow.steps : workflow.steps({
            input: context.input,
            context,
            blobStorage: this.config.blobStorage,
            blob: this.blobResolver,
        });
        this.validateNodes(nodes, workflow.id);
        return nodes;
    }
    /**
     * Validate workflow nodes
     */
    validateNodes(nodes, workflowId) {
        if (!Array.isArray(nodes)) {
            throw new Error(`Workflow "${workflowId}" steps must resolve to an array`);
        }
        if (nodes.length === 0) {
            throw new Error(`Workflow "${workflowId}" must have at least one step`);
        }
        const seenIds = new Set();
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
    async executeWithTimeout(fn, timeout) {
        if (!timeout) {
            return fn();
        }
        const timeoutMs = parseDuration(timeout);
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = dntShim.setTimeout(() => {
                reject(new Error(`Workflow timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
        try {
            return await Promise.race([fn(), timeoutPromise]);
        }
        finally {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        }
    }
    /**
     * Mark run as completed
     */
    async completeRun(runId, context, nodeStates) {
        const output = this.determineOutput(context);
        await this.config.backend.updateRun(runId, {
            status: "completed",
            output,
            context,
            nodeStates,
            completedAt: new Date(),
        });
        return (await this.config.backend.getRun(runId));
    }
    /**
     * Mark run as failed
     */
    async failRun(runId, error, context, nodeStates) {
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
    async pauseRun(runId, waitingNode, context, nodeStates) {
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
    determineOutput(context) {
        const { input: _input, ...rest } = context;
        return rest;
    }
    /**
     * Create a handle for a workflow run
     */
    createHandle(runId) {
        return {
            runId,
            status: () => this.config.backend.getRun(runId),
            result: () => this.waitForResult(runId),
            cancel: () => this.cancel(runId),
        };
    }
    /**
     * Wait for workflow result
     */
    async waitForResult(runId, pollInterval = 1000) {
        while (true) {
            const run = await this.config.backend.getRun(runId);
            if (!run) {
                throw new Error(`Run not found: ${runId}`);
            }
            if (run.status === "completed") {
                return run.output;
            }
            if (run.status === "failed") {
                throw new Error(run.error?.message || "Workflow failed");
            }
            if (run.status === "cancelled") {
                throw new Error("Workflow was cancelled");
            }
            await new Promise((resolve) => dntShim.setTimeout(resolve, pollInterval));
        }
    }
    /**
     * Cancel a workflow run
     */
    async cancel(runId) {
        const run = await this.config.backend.getRun(runId);
        if (!run) {
            throw new Error(`Run not found: ${runId}`);
        }
        if (run.status === "completed" || run.status === "failed") {
            throw new Error(`Cannot cancel workflow run "${runId}": run has already ${run.status}. ` +
                `Only active runs (pending, running, waiting) can be cancelled.`);
        }
        await this.config.backend.updateRun(runId, {
            status: "cancelled",
            completedAt: new Date(),
        });
    }
    /**
     * Get workflow run status
     */
    getStatus(runId) {
        return this.config.backend.getRun(runId);
    }
    /**
     * List workflow runs
     */
    listRuns(options) {
        return this.config.backend.listRuns({
            workflowId: options?.workflowId,
            status: options?.status,
            limit: options?.limit,
        });
    }
}
