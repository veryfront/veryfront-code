/*******************************
 * Parallel Execution Utilities
 *
 * Provides utilities for parallel execution with concurrency control.
 * Uses a semaphore to limit the number of concurrent operations.
 *
 * @module core/utils/parallel
 *******************************/
import { Semaphore } from "../modules/react-loader/ssr-module-loader/concurrency/semaphore.js";
type ParallelOptions = {
    concurrency?: number;
    semaphore?: Semaphore;
    timeoutMs?: number;
};
export declare function parallelMap<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>, options?: ParallelOptions): Promise<R[]>;
export declare function parallelAll<T extends readonly (() => Promise<unknown>)[]>(fns: T, options?: ParallelOptions): Promise<{
    [K in keyof T]: Awaited<ReturnType<T[K]>>;
}>;
export declare function parallelFind<T>(items: T[], predicate: (item: T, index: number) => Promise<boolean>, options?: ParallelOptions): Promise<T | undefined>;
export declare function parallelFilter<T>(items: T[], predicate: (item: T, index: number) => Promise<boolean>, options?: ParallelOptions): Promise<T[]>;
export declare function createSemaphore(permits: number): Semaphore;
export declare function getApiSemaphore(): Semaphore;
export {};
//# sourceMappingURL=parallel.d.ts.map