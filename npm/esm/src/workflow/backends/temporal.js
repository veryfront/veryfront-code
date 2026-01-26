/**
 * Temporal Adapter - workflow execution backend for enterprise-grade, long-running workflows.
 * @see https://docs.temporal.io/
 */
import { logger } from "../../utils/index.js";
/**
 * Stub implementation - requires Temporal SDK and worker setup.
 */
export class TemporalAdapter {
    config;
    constructor(config = {}) {
        this.config = {
            address: "localhost:7233",
            namespace: "default",
            taskQueue: "veryfront-workflows",
            debug: false,
            ...config,
        };
        logger.warn("[TemporalAdapter] Stub implementation - requires Temporal SDK and worker setup");
    }
    // Run Management
    createRun(_run) {
        throw new Error("TemporalAdapter.createRun not implemented");
    }
    getRun(_runId) {
        throw new Error("TemporalAdapter.getRun not implemented");
    }
    updateRun(_runId, _patch) {
        throw new Error("TemporalAdapter.updateRun not implemented");
    }
    listRuns(_filter) {
        throw new Error("TemporalAdapter.listRuns not implemented");
    }
    // Checkpointing (Temporal handles this internally via event sourcing)
    saveCheckpoint(_runId, _checkpoint) {
        return Promise.resolve();
    }
    getLatestCheckpoint(_runId) {
        throw new Error("TemporalAdapter.getLatestCheckpoint not implemented");
    }
    // Approvals
    savePendingApproval(_runId, _approval) {
        throw new Error("TemporalAdapter.savePendingApproval not implemented");
    }
    getPendingApprovals(_runId) {
        throw new Error("TemporalAdapter.getPendingApprovals not implemented");
    }
    updateApproval(_runId, _approvalId, _decision) {
        throw new Error("TemporalAdapter.updateApproval not implemented");
    }
    // Queue (Temporal handles this internally)
    enqueue(_job) {
        throw new Error("TemporalAdapter.enqueue not implemented");
    }
    dequeue() {
        throw new Error("TemporalAdapter.dequeue not implemented");
    }
    acknowledge(_runId) {
        return Promise.resolve();
    }
    // Lifecycle
    destroy() {
        return Promise.resolve();
    }
}
