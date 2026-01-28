/**
 * Browser polyfill for node:async_hooks.
 *
 * Provides a no-op AsyncLocalStorage that safely does nothing in the browser.
 * Server-only modules like head-collector.ts import AsyncLocalStorage at the top level,
 * but their functions already guard against missing stores (returning early in browser).
 * This polyfill prevents the import from crashing without changing module behavior.
 */

export class AsyncLocalStorage<T = unknown> {
  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
    return callback(...args);
  }

  getStore(): T | undefined {
    return undefined;
  }

  disable(): void {}

  enterWith(_store: T): void {}
}
