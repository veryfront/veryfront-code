/*******************************
 * Parallel Execution Utilities
 *
 * Provides utilities for parallel execution with concurrency control.
 * Uses a semaphore to limit the number of concurrent operations.
 *
 * @module core/utils/parallel
 *******************************/
import { Semaphore } from "../modules/react-loader/ssr-module-loader/concurrency/semaphore.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
const DEFAULT_CONCURRENCY = 20;
const ACQUIRE_TIMEOUT_MS = 30_000;
const apiSemaphore = new Semaphore(DEFAULT_CONCURRENCY);
async function acquireOrThrow(semaphore, timeoutMs, label) {
    const acquired = await semaphore.tryAcquire(timeoutMs);
    if (acquired)
        return;
    throw new Error(`${label}: timed out waiting for semaphore after ${timeoutMs}ms (available: ${semaphore.available}, waiting: ${semaphore.waiting})`);
}
export function parallelMap(items, fn, options = {}) {
    return withSpan("utils.parallelMap", async () => {
        if (items.length === 0)
            return [];
        const semaphore = options.semaphore ?? apiSemaphore;
        const timeoutMs = options.timeoutMs ?? ACQUIRE_TIMEOUT_MS;
        const results = new Array(items.length);
        await Promise.all(items.map(async (item, index) => {
            await acquireOrThrow(semaphore, timeoutMs, "parallelMap");
            try {
                results[index] = await fn(item, index);
            }
            finally {
                semaphore.release();
            }
        }));
        return results;
    }, {
        "parallel.itemCount": items.length,
        "parallel.timeoutMs": options.timeoutMs ?? ACQUIRE_TIMEOUT_MS,
    });
}
export function parallelAll(fns, options = {}) {
    return parallelMap([...fns], (fn) => fn(), options);
}
export function parallelFind(items, predicate, options = {}) {
    return withSpan("utils.parallelFind", async () => {
        if (items.length === 0)
            return undefined;
        const semaphore = options.semaphore ?? apiSemaphore;
        const timeoutMs = options.timeoutMs ?? ACQUIRE_TIMEOUT_MS;
        let found;
        let foundIndex = Infinity;
        await Promise.all(items.map(async (item, index) => {
            if (index >= foundIndex)
                return;
            await acquireOrThrow(semaphore, timeoutMs, "parallelFind");
            try {
                if (index >= foundIndex)
                    return;
                const matches = await predicate(item, index);
                if (!matches || index >= foundIndex)
                    return;
                found = item;
                foundIndex = index;
            }
            finally {
                semaphore.release();
            }
        }));
        return found;
    }, { "parallel.itemCount": items.length });
}
export function parallelFilter(items, predicate, options = {}) {
    return withSpan("utils.parallelFilter", async () => {
        const results = await parallelMap(items, async (item, index) => ({ item, keep: await predicate(item, index) }), options);
        return results.filter((r) => r.keep).map((r) => r.item);
    }, { "parallel.itemCount": items.length });
}
export function createSemaphore(permits) {
    return new Semaphore(permits);
}
export function getApiSemaphore() {
    return apiSemaphore;
}
