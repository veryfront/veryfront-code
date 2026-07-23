/**
 * Browser polyfill for node:async_hooks.
 *
 * Provides the callback-running subset used by browser-served framework modules.
 * Browser execution does not retain request-local state, so getStore always returns
 * undefined and enterWith and disable are no-ops. Consumers must already treat a
 * missing store as the browser-safe state.
 */

export class AsyncLocalStorage<T = unknown> {
  run<R, Args extends unknown[]>(
    _store: T,
    callback: (...args: Args) => R,
    ...args: Args
  ): R {
    return callback(...args);
  }

  getStore(): T | undefined {
    return undefined;
  }

  disable(): void {}

  enterWith(_store: T): void {}
}
