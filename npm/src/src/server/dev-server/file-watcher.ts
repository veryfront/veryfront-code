import * as dntShim from "../../../_dnt.shims.js";
import { serverLogger as logger } from "../../utils/index.js";
import type { FileWatcherMetrics } from "./types.js";

export class OptimizedFileWatcher {
  private readonly changeQueue = new Set<string>();
  private debounceTimer?: number;
  private readonly debounceMs: number;
  private readonly processCallback: (changes: string[]) => Promise<void>;
  private readonly metrics = {
    totalEvents: 0,
    batchedOperations: 0,
    totalBatchSize: 0,
    largestBatch: 0,
  };

  constructor(
    debounceMs: number,
    processCallback: (changes: string[]) => Promise<void>,
  ) {
    this.debounceMs = debounceMs;
    this.processCallback = processCallback;
  }

  handleChange(paths: string[]): void {
    this.metrics.totalEvents += paths.length;

    for (const path of paths) {
      this.changeQueue.add(path);
    }

    this.debounceChanges();
  }

  private debounceChanges(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = dntShim.setTimeout(() => {
      void this.processChanges();
    }, this.debounceMs) as unknown as number;
  }

  private async processChanges(): Promise<void> {
    if (this.changeQueue.size === 0) {
      return;
    }

    const changes = Array.from(this.changeQueue);
    const batchSize = changes.length;

    this.metrics.batchedOperations++;
    this.metrics.totalBatchSize += batchSize;
    this.metrics.largestBatch = Math.max(this.metrics.largestBatch, batchSize);

    this.changeQueue.clear();

    const reductionPercent = (
      (1 - this.metrics.batchedOperations / this.metrics.totalEvents) *
      100
    ).toFixed(1);

    logger.debug(
      `[HMR] Processing batch of ${batchSize} file changes (${reductionPercent}% reduction in FS operations)`,
    );

    try {
      await this.processCallback(changes);
    } catch (error) {
      logger.error("[HMR] Failed to process file changes", error);
    }
  }

  cleanup(): void {
    if (this.debounceTimer === undefined) {
      this.changeQueue.clear();
      return;
    }

    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.changeQueue.clear();
  }

  getMetrics(): FileWatcherMetrics {
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
