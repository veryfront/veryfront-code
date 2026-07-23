import { serverLogger } from "#veryfront/utils";
import type { FileWatcherMetrics } from "./types.ts";
import { getSafeErrorName } from "../utils/error-name.ts";
import { getErrorCollector } from "#veryfront/observability";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = serverLogger.component("hmr");
const MAX_DEBOUNCE_MS = 60_000;
const MAX_PENDING_PATHS = 4_096;
const MAX_PATH_LENGTH = 4_096;

/** Metadata for one bounded file-change batch. */
export interface FileChangeBatchMetadata {
  /** True when individual paths were collapsed and every relevant cache must be invalidated. */
  fullInvalidation: boolean;
}

function saturatingAdd(value: number, increment: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + increment);
}

export class OptimizedFileWatcher {
  private readonly changeQueue = new Set<string>();
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private processing = false;
  private closed = false;
  private changeRevision = 0;
  private fullInvalidation = false;
  private readonly inFlight = new Set<Promise<void>>();
  private cleanupPromise?: Promise<void>;
  private readonly metrics = {
    totalEvents: 0,
    batchedOperations: 0,
    totalBatchSize: 0,
    largestBatch: 0,
  };

  constructor(
    private readonly debounceMs: number,
    private readonly processCallback: (
      changes: string[],
      metadata: FileChangeBatchMetadata,
    ) => Promise<void>,
  ) {
    if (
      !Number.isSafeInteger(debounceMs) || debounceMs < 0 || debounceMs > MAX_DEBOUNCE_MS
    ) {
      throw new TypeError(`debounceMs must be a safe integer from 0 to ${MAX_DEBOUNCE_MS}`);
    }
  }

  handleChange(paths: string[]): void {
    if (this.closed) return;
    this.metrics.totalEvents = saturatingAdd(this.metrics.totalEvents, paths.length);
    this.changeRevision++;

    for (const path of paths) {
      if (
        typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH ||
        hasUnsafeControlCharacters(path)
      ) {
        this.fullInvalidation = true;
        continue;
      }
      if (!this.changeQueue.has(path) && this.changeQueue.size >= MAX_PENDING_PATHS) {
        this.fullInvalidation = true;
        continue;
      }
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
      const work = this.processChanges();
      this.inFlight.add(work);
      void work.then(
        () => this.inFlight.delete(work),
        () => this.inFlight.delete(work),
      );
    }, this.debounceMs);
  }

  private async processChanges(): Promise<void> {
    if (
      this.closed || this.processing ||
      (this.changeQueue.size === 0 && !this.fullInvalidation)
    ) return;

    this.processing = true;
    const changes = Array.from(this.changeQueue);
    const fullInvalidation = this.fullInvalidation;
    this.fullInvalidation = false;
    const revisionAtStart = this.changeRevision;
    const batchSize = changes.length;

    this.metrics.batchedOperations = saturatingAdd(this.metrics.batchedOperations, 1);
    this.metrics.totalBatchSize = saturatingAdd(this.metrics.totalBatchSize, batchSize);
    this.metrics.largestBatch = Math.max(this.metrics.largestBatch, batchSize);

    this.changeQueue.clear();

    const reductionPercent = (
      (1 - this.metrics.batchedOperations / this.metrics.totalEvents) *
      100
    ).toFixed(1);

    logger.debug(
      `[HMR] Processing batch of ${batchSize} file changes (${reductionPercent}% reduction in FS operations)`,
    );

    let failed = false;
    try {
      await this.processCallback(changes, { fullInvalidation });
    } catch (error) {
      failed = true;
      if (!this.closed) {
        const queuedAfterFailure = Array.from(this.changeQueue);
        this.changeQueue.clear();
        const restore = [...changes, ...queuedAfterFailure];
        for (const path of restore) {
          if (!this.changeQueue.has(path) && this.changeQueue.size >= MAX_PENDING_PATHS) {
            this.fullInvalidation = true;
            continue;
          }
          this.changeQueue.add(path);
        }
        this.fullInvalidation ||= fullInvalidation;
      }
      const errorName = getSafeErrorName(error);
      logger.error("Failed to process file changes", { errorName });
      getErrorCollector().addHMRError("Failed to process file changes", undefined, {
        errorName,
      });
    } finally {
      this.processing = false;
      const receivedChangesWhileProcessing = this.changeRevision !== revisionAtStart;
      if (
        !this.closed && (this.changeQueue.size > 0 || this.fullInvalidation) &&
        (!failed || receivedChangesWhileProcessing)
      ) {
        this.debounceChanges();
      }
    }
  }

  cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.closed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    this.changeQueue.clear();
    this.fullInvalidation = false;
    this.cleanupPromise = Promise.all([...this.inFlight]).then(() => undefined);
    return this.cleanupPromise;
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
