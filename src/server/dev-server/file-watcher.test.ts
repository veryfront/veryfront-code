import "#veryfront/schemas/_test-setup.ts";
import { delay } from "#std/async.ts";
import { expect } from "#std/expect.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OptimizedFileWatcher } from "./file-watcher.ts";

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("OptimizedFileWatcher", () => {
  it("rejects invalid debounce intervals", () => {
    for (const debounceMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, 60_001]) {
      expect(() => new OptimizedFileWatcher(debounceMs, () => Promise.resolve())).toThrow(
        TypeError,
      );
    }
  });

  it("collapses an oversized pending path set into a bounded full invalidation", async () => {
    const completion = createDeferred<void>();
    let receivedPaths: string[] = [];
    let fullInvalidation = false;
    const watcher = new OptimizedFileWatcher(
      1,
      (paths, metadata?: { fullInvalidation: boolean }) => {
        receivedPaths = paths;
        fullInvalidation = metadata?.fullInvalidation === true;
        completion.resolve();
        return Promise.resolve();
      },
    );
    const paths = Array.from(
      { length: 4_097 },
      (_, index) => `src/pages/generated-${index}.tsx`,
    );

    watcher.handleChange(paths);
    await completion.promise;

    expect(receivedPaths.length).toBeLessThanOrEqual(4_096);
    expect(fullInvalidation).toBe(true);
    watcher.cleanup();
  });

  it("batches and deduplicates change events", async () => {
    const processedBatches: string[][] = [];
    const completion = createDeferred<void>();

    const watcher = new OptimizedFileWatcher(5, async (paths) => {
      processedBatches.push(paths);
      completion.resolve();
    });

    watcher.handleChange(["src/pages/index.tsx"]);
    watcher.handleChange(["src/pages/about.tsx", "src/pages/index.tsx"]);

    await delay(10);
    await completion.promise;

    expect(processedBatches).toHaveLength(1);
    expect(processedBatches[0]?.sort()).toEqual([
      "src/pages/about.tsx",
      "src/pages/index.tsx",
    ]);

    const metrics = watcher.getMetrics();
    expect(metrics.totalFileChangeEvents).toBe(3);
    expect(metrics.routeDiscoveryCalls).toBe(1);
    expect(metrics.averageBatchSize).toBe("2.00");
    expect(metrics.largestBatch).toBe(2);
    expect(metrics.fsOperationReduction).toBe("66.7%");
  });

  it("cleanup cancels pending batches", async () => {
    let processed = false;

    const watcher = new OptimizedFileWatcher(5, async () => {
      processed = true;
    });

    watcher.handleChange(["src/pages/hmr.tsx"]);
    watcher.cleanup();
    watcher.handleChange(["src/pages/after-cleanup.tsx"]);

    await delay(10);

    expect(processed).toBe(false);

    const metrics = watcher.getMetrics();
    expect(metrics.totalFileChangeEvents).toBe(1);
    expect(metrics.routeDiscoveryCalls).toBe(0);
    expect(metrics.averageBatchSize).toBe("0");
    expect(metrics.largestBatch).toBe(0);
    expect(metrics.fsOperationReduction).toBe("100.0%");
  });

  it("serializes batches that arrive while a callback is still running", async () => {
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    const secondCompleted = createDeferred<void>();
    const batches: string[][] = [];
    let activeCallbacks = 0;
    let maximumActiveCallbacks = 0;

    const watcher = new OptimizedFileWatcher(5, async (paths) => {
      batches.push(paths);
      activeCallbacks++;
      maximumActiveCallbacks = Math.max(maximumActiveCallbacks, activeCallbacks);
      try {
        if (batches.length === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        } else {
          secondCompleted.resolve();
        }
      } finally {
        activeCallbacks--;
      }
    });

    watcher.handleChange(["src/pages/first.tsx"]);
    await firstStarted.promise;
    watcher.handleChange(["src/pages/second.tsx"]);
    await delay(10);
    const overlapObserved = maximumActiveCallbacks;
    releaseFirst.resolve();
    await secondCompleted.promise;

    expect(overlapObserved).toBe(1);
    expect(maximumActiveCallbacks).toBe(1);
    expect(batches).toEqual([
      ["src/pages/first.tsx"],
      ["src/pages/second.tsx"],
    ]);
    await watcher.cleanup();
  });

  it("waits for an active callback during cleanup", async () => {
    const callbackStarted = createDeferred<void>();
    const releaseCallback = createDeferred<void>();
    const watcher = new OptimizedFileWatcher(1, async () => {
      callbackStarted.resolve();
      await releaseCallback.promise;
    });

    watcher.handleChange(["src/pages/index.tsx"]);
    await callbackStarted.promise;
    const cleanup = watcher.cleanup();
    let cleanupSettled = false;
    Promise.resolve(cleanup).then(() => {
      cleanupSettled = true;
    });
    await Promise.resolve();
    const settledBeforeCallback = cleanupSettled;
    releaseCallback.resolve();
    await Promise.resolve(cleanup);

    expect(settledBeforeCallback).toBe(false);
    expect(cleanupSettled).toBe(true);
  });

  it("retries a failed batch together with the next change", async () => {
    const firstAttempted = createDeferred<void>();
    const retryCompleted = createDeferred<void>();
    const batches: string[][] = [];

    const watcher = new OptimizedFileWatcher(5, (paths) => {
      batches.push(paths);
      if (batches.length === 1) {
        firstAttempted.resolve();
        return Promise.reject(new Error("transient watcher failure"));
      }
      retryCompleted.resolve();
      return Promise.resolve();
    });

    watcher.handleChange(["src/pages/first.tsx"]);
    await firstAttempted.promise;
    await delay(1);
    watcher.handleChange(["src/pages/second.tsx"]);
    await retryCompleted.promise;

    expect(batches).toEqual([
      ["src/pages/first.tsx"],
      ["src/pages/first.tsx", "src/pages/second.tsx"],
    ]);
    watcher.cleanup();
  });
});
