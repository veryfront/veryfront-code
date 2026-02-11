/**
 * In-Memory Token Storage Adapter
 *
 * Development-only adapter that stores tokens in memory.
 * Tokens are lost when the process restarts.
 */

import { logger } from "#veryfront/utils";
import type { TokenStorageAdapter } from "./types.ts";

const log = logger.component("memory-token-adapter");

const STORAGE_KEY = "__veryfront_token_storage__" as const;

interface GlobalWithTokenStorage {
  __veryfront_token_storage__?: Map<string, string>;
}

const globalStore = globalThis as GlobalWithTokenStorage;

export class MemoryTokenAdapter implements TokenStorageAdapter {
  private storage: Map<string, string>;

  constructor() {
    globalStore[STORAGE_KEY] ??= new Map<string, string>();
    this.storage = globalStore[STORAGE_KEY] ?? new Map<string, string>();

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
    log.debug("Disposed");
  }

  get size(): number {
    return this.storage.size;
  }

  clear(): void {
    this.storage.clear();
  }
}
