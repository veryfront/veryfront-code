/**
 * In-Memory Token Storage Adapter
 *
 * Development-only adapter that stores tokens in memory.
 * Tokens are lost when the process restarts.
 */

import { logger as baseLogger } from "#veryfront/utils";
import {
  assertTokenStorageKey,
  assertTokenStoragePrefix,
  assertTokenStorageValue,
  type TokenStorageAdapter,
} from "./types.ts";

const logger = baseLogger.component("memory-token-adapter");

export class MemoryTokenAdapter implements TokenStorageAdapter {
  private readonly storage = new Map<string, string>();

  constructor() {
    logger.warn(
      "[MemoryTokenAdapter] Using in-memory storage. " +
        "Tokens will be lost on restart. " +
        "Configure Veryfront Cloud for production.",
    );
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    assertTokenStorageKey(key);
    return Promise.resolve(this.storage.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    assertTokenStorageKey(key);
    assertTokenStorageValue(value);
    this.storage.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    assertTokenStorageKey(key);
    this.storage.delete(key);
    return Promise.resolve();
  }

  list(prefix?: string): Promise<string[]> {
    assertTokenStoragePrefix(prefix);
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
