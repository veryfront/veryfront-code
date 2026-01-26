/**************************
 * Workflow Client
 *
 * High-level API for interacting with workflows
 **************************/
import { logger } from "../../utils/index.js";
import { MemoryBackend } from "../backends/memory.js";
import { WorkflowExecutor, } from "../executor/workflow-executor.js";
import { ApprovalManager } from "../runtime/approval-manager.js";
export class WorkflowClient {
    backend;
    executor;
    approvalManager;
    debug;
    constructor(config = {}) {
        this.debug = config.debug ?? false;
        this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });
        const userOnWaiting = config.executor?.onWaiting;
        this.executor = new WorkflowExecutor({
            backend: this.backend,
            debug: this.debug,
            ...config.executor,
            onWaiting: async (run, nodeId) => {
                const nodeState = run.nodeStates[nodeId];
                const input = nodeState?.input;
                if (!input) {
                    logger.debug("[WorkflowClient] No wait config found for node", { nodeId });
                    userOnWaiting?.(run, nodeId);
                    return;
                }
                if (input.type !== "approval") {
                    userOnWaiting?.(run, nodeId);
                    return;
                }
                const waitConfig = {
                    type: "wait",
                    waitType: "approval",
                    message: input.message,
                    payload: input.payload,
                };
                try {
                    await this.approvalManager.createApproval(run, nodeId, waitConfig, run.context);
                    logger.debug("[WorkflowClient] Created approval for node", { nodeId });
                }
                catch (error) {
                    logger.error("[WorkflowClient] Failed to create approval", error);
                }
                userOnWaiting?.(run, nodeId);
            },
        });
        this.approvalManager = new ApprovalManager({
            backend: this.backend,
            executor: this.executor,
            debug: this.debug,
            ...config.approval,
        });
    }
    register(workflow) {
        const definition = "definition" in workflow ? workflow.definition : workflow;
        this.executor.register(definition);
        logger.debug("[WorkflowClient] Registered workflow", { workflowId: definition.id });
    }
    registerAll(workflows) {
        for (const workflow of workflows) {
            this.register(workflow);
        }
    }
    start(workflowId, input, options) {
        return this.executor.start(workflowId, input, options);
    }
    resume(runId) {
        return this.executor.resume(runId);
    }
    cancel(runId) {
        return this.executor.cancel(runId);
    }
    getRun(runId) {
        return this.backend.getRun(runId);
    }
    listRuns(filter) {
        return this.backend.listRuns(filter ?? {});
    }
    getRunsByStatus(status, limit) {
        return this.backend.listRuns({ status, limit });
    }
    getRunsForWorkflow(workflowId, limit) {
        return this.backend.listRuns({ workflowId, limit });
    }
    getPendingApprovals(runId) {
        return this.approvalManager.getPendingApprovals(runId);
    }
    approve(runId, approvalId, approver, comment) {
        return this.approvalManager.approve(runId, approvalId, approver, comment);
    }
    reject(runId, approvalId, approver, comment) {
        return this.approvalManager.reject(runId, approvalId, approver, comment);
    }
    listAllPendingApprovals(filter) {
        return this.approvalManager.listAllPending(filter);
    }
    getBackend() {
        return this.backend;
    }
    getExecutor() {
        return this.executor;
    }
    getApprovalManager() {
        return this.approvalManager;
    }
    async destroy() {
        this.approvalManager.stop();
        await this.backend.destroy();
        logger.debug("[WorkflowClient] Destroyed");
    }
}
export function createWorkflowClient(config) {
    return new WorkflowClient(config);
}
