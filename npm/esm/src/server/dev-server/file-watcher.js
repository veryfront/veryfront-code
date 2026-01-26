import * as dntShim from "../../../_dnt.shims.js";
import { serverLogger as logger } from "../../utils/index.js";
export class OptimizedFileWatcher {
    changeQueue = new Set();
    debounceTimer;
    debounceMs;
    processCallback;
    metrics = {
        totalEvents: 0,
        batchedOperations: 0,
        totalBatchSize: 0,
        largestBatch: 0,
    };
    constructor(debounceMs, processCallback) {
        this.debounceMs = debounceMs;
        this.processCallback = processCallback;
    }
    handleChange(paths) {
        this.metrics.totalEvents += paths.length;
        for (const path of paths) {
            this.changeQueue.add(path);
        }
        this.debounceChanges();
    }
    debounceChanges() {
        if (this.debounceTimer !== undefined) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = dntShim.setTimeout(() => {
            void this.processChanges();
        }, this.debounceMs);
    }
    async processChanges() {
        if (this.changeQueue.size === 0) {
            return;
        }
        const changes = Array.from(this.changeQueue);
        const batchSize = changes.length;
        this.metrics.batchedOperations++;
        this.metrics.totalBatchSize += batchSize;
        this.metrics.largestBatch = Math.max(this.metrics.largestBatch, batchSize);
        this.changeQueue.clear();
        const reductionPercent = ((1 - this.metrics.batchedOperations / this.metrics.totalEvents) *
            100).toFixed(1);
        logger.debug(`[HMR] Processing batch of ${batchSize} file changes (${reductionPercent}% reduction in FS operations)`);
        try {
            await this.processCallback(changes);
        }
        catch (error) {
            logger.error("[HMR] Failed to process file changes", error);
        }
    }
    cleanup() {
        if (this.debounceTimer === undefined) {
            this.changeQueue.clear();
            return;
        }
        clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        this.changeQueue.clear();
    }
    getMetrics() {
        const { totalEvents, batchedOperations, totalBatchSize, largestBatch } = this.metrics;
        const averageBatchSize = batchedOperations > 0
            ? (totalBatchSize / batchedOperations).toFixed(2)
            : "0";
        const reductionPercent = totalEvents > 0
            ? ((1 - batchedOperations / totalEvents) * 100).toFixed(1)
            : "0";
        return {
            totalFileChangeEvents: totalEvents,
            routeDiscoveryCalls: batchedOperations,
            averageBatchSize,
            largestBatch,
            fsOperationReduction: `${reductionPercent}%`,
        };
    }
}
