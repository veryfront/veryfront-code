import { logger } from "../../utils/index.js";
/**
 * Stub implementation - requires Cloudflare Workers environment bindings.
 */
export class CloudflareAdapter {
    config;
    constructor(config = {}) {
        this.config = {
            durableObjectBinding: "WORKFLOW_DO",
            kvBinding: "WORKFLOW_KV",
            queueBinding: "WORKFLOW_QUEUE",
            debug: false,
            ...config,
        };
        logger.warn("[CloudflareAdapter] Stub implementation - requires Workers environment bindings");
    }
    // Run Management
    createRun(_run) {
        throw new Error("CloudflareAdapter.createRun not implemented");
    }
    getRun(_runId) {
        throw new Error("CloudflareAdapter.getRun not implemented");
    }
    updateRun(_runId, _patch) {
        throw new Error("CloudflareAdapter.updateRun not implemented");
    }
    listRuns(_filter) {
        throw new Error("CloudflareAdapter.listRuns not implemented");
    }
    // Checkpointing
    saveCheckpoint(_runId, _checkpoint) {
        throw new Error("CloudflareAdapter.saveCheckpoint not implemented");
    }
    getLatestCheckpoint(_runId) {
        throw new Error("CloudflareAdapter.getLatestCheckpoint not implemented");
    }
    // Approvals
    savePendingApproval(_runId, _approval) {
        throw new Error("CloudflareAdapter.savePendingApproval not implemented");
    }
    getPendingApprovals(_runId) {
        throw new Error("CloudflareAdapter.getPendingApprovals not implemented");
    }
    updateApproval(_runId, _approvalId, _decision) {
        throw new Error("CloudflareAdapter.updateApproval not implemented");
    }
    // Queue (using Cloudflare Queues)
    enqueue(_job) {
        throw new Error("CloudflareAdapter.enqueue not implemented");
    }
    dequeue() {
        throw new Error("CloudflareAdapter.dequeue not implemented");
    }
    acknowledge(_runId) {
        return Promise.resolve();
    }
    // Lifecycle
    destroy() {
        return Promise.resolve();
    }
}
