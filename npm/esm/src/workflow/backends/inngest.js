import { agentLogger as logger } from "../../utils/index.js";
export class InngestAdapter {
    config;
    constructor(config = {}) {
        this.config = { debug: false, ...config };
        logger.warn("[InngestAdapter] This is a stub implementation. Full Inngest integration requires additional setup. See: https://www.inngest.com/docs");
    }
    createRun(_run) {
        throw new Error("InngestAdapter.createRun not implemented");
    }
    getRun(_runId) {
        throw new Error("InngestAdapter.getRun not implemented");
    }
    updateRun(_runId, _patch) {
        throw new Error("InngestAdapter.updateRun not implemented");
    }
    listRuns(_filter) {
        throw new Error("InngestAdapter.listRuns not implemented");
    }
    saveCheckpoint(_runId, _checkpoint) {
        throw new Error("InngestAdapter.saveCheckpoint not implemented");
    }
    getLatestCheckpoint(_runId) {
        throw new Error("InngestAdapter.getLatestCheckpoint not implemented");
    }
    savePendingApproval(_runId, _approval) {
        throw new Error("InngestAdapter.savePendingApproval not implemented");
    }
    getPendingApprovals(_runId) {
        throw new Error("InngestAdapter.getPendingApprovals not implemented");
    }
    updateApproval(_runId, _approvalId, _decision) {
        throw new Error("InngestAdapter.updateApproval not implemented");
    }
    enqueue(_job) {
        throw new Error("InngestAdapter.enqueue not implemented");
    }
    dequeue() {
        throw new Error("InngestAdapter.dequeue not implemented");
    }
    acknowledge(_runId) {
        return Promise.resolve();
    }
    destroy() {
        return Promise.resolve();
    }
}
