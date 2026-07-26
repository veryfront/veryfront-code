/**
 * Concurrency primitives for lazy code-block dependencies.
 *
 * Kept separate from the React component so loader retry and Mermaid
 * serialization semantics can be verified without a browser.
 *
 * @module react/components/ui/code-block-runtime
 */

export interface RetryableModuleLoader<T> {
  /**
   * Load the module once, coalescing concurrent callers. A rejected import is
   * not cached, so a later call can recover from a transient failure.
   */
  load(): Promise<T>;
}

export function createRetryableModuleLoader<T>(
  importModule: () => Promise<T>,
): RetryableModuleLoader<T> {
  let loaded: { value: T } | undefined;
  let pending: Promise<T> | undefined;

  return {
    async load(): Promise<T> {
      if (loaded) return loaded.value;
      if (pending) return await pending;

      const current = importModule().then((module) => {
        loaded = { value: module };
        return module;
      });
      pending = current;

      try {
        return await current;
      } catch (error) {
        if (pending === current) pending = undefined;
        throw error;
      }
    },
  };
}

export type SerialAsyncExecutor = <T>(
  operation: () => Promise<T>,
) => Promise<T>;

/**
 * Create a FIFO async executor that remains usable after an operation fails.
 */
export function createSerialAsyncExecutor(): SerialAsyncExecutor {
  let tail: Promise<void> = Promise.resolve();

  return function execute<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
