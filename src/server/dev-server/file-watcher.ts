import { serverLogger } from "#veryfront/utils";
import type { FileWatcherMetrics } from "./types.ts";

const logger = serverLogger.component("hmr");

export class OptimizedFileWatcher {
  private readonly changeQueue = new Set<string>();
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private processingTail: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly metrics = {
    totalEvents: 0,
    batchedOperations: 0,
    totalBatchSize: 0,
    largestBatch: 0,
  };

  constructor(
    private readonly debounceMs: number,
    private readonly processCallback: (changes: string[]) => Promise<void>,
  ) {}

  handleChange(paths: string[]): void {
    if (this.closed) return;

    this.metrics.totalEvents += paths.length;

    for (const path of paths) {
      this.changeQueue.add(path);
    }

    this.debounceChanges();
  }

  private debounceChanges(): void {
    if (this.closed) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.closed) return;

      this.processingTail = this.processingTail.then(() => this.processChanges());
    }, this.debounceMs);
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
      logger.error("Failed to process file changes", error);
    }
  }

  async cleanup(): Promise<void> {
    this.closed = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    this.changeQueue.clear();
    await this.processingTail;
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
