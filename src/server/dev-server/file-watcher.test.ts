import { delay } from "#std/async.ts";
import { expect } from "#std/expect.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OptimizedFileWatcher } from "./file-watcher.ts";

function createDeferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("OptimizedFileWatcher", () => {
  it("batches and deduplicates change events", async () => {
    const processedBatches: string[][] = [];
    const completion = createDeferred<void>();

    const watcher = new OptimizedFileWatcher(5, (paths) => {
      processedBatches.push(paths);
      completion.resolve();
      return Promise.resolve();
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
    const watcher = new OptimizedFileWatcher(5, () => {
      processed = true;
      return Promise.resolve();
    });

    watcher.handleChange(["src/pages/hmr.tsx"]);
    watcher.cleanup();

    await delay(10);

    expect(processed).toBe(false);

    const metrics = watcher.getMetrics();
    expect(metrics.totalFileChangeEvents).toBe(1);
    expect(metrics.routeDiscoveryCalls).toBe(0);
    expect(metrics.averageBatchSize).toBe("0");
    expect(metrics.largestBatch).toBe(0);
    expect(metrics.fsOperationReduction).toBe("100.0%");
  });
});
