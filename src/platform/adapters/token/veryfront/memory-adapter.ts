/**
 * In-Memory Token Storage Adapter
 *
 * Development-only adapter that stores tokens in memory.
 * Tokens are lost when the process restarts.
 */

import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import type { TokenStorageAdapter } from "./types.ts";

const logger = baseLogger.component("memory-token-adapter");

let didWarnAboutMemoryStorage = false;

export class MemoryTokenAdapter implements TokenStorageAdapter {
  private readonly storage = new Map<string, string>();

  constructor() {
    if (!didWarnAboutMemoryStorage) {
      didWarnAboutMemoryStorage = true;
      logger.warn(
        "Using in-memory token storage. Tokens are isolated to this adapter and lost on restart. " +
          "Configure Veryfront Cloud for production.",
      );
    }
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.storage.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.storage.delete(key);
    return Promise.resolve();
  }

  list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.storage.keys());
    if (!prefix) return Promise.resolve(keys);
    return Promise.resolve(keys.filter((k) => k.startsWith(prefix)));
  }

  dispose(): void {
    this.storage.clear();
    logger.debug("Disposed");
  }

  get size(): number {
    return this.storage.size;
  }

  clear(): void {
    this.storage.clear();
  }
}
