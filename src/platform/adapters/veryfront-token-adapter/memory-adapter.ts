
import { logger } from "@veryfront/utils";
import type { TokenStorageAdapter } from "./types.ts";

const STORAGE_KEY = "__veryfront_token_storage__";
// deno-lint-ignore no-explicit-any
const globalStore = globalThis as any;

export class MemoryTokenAdapter implements TokenStorageAdapter {
  private storage: Map<string, string>;

  constructor() {
    this.storage = globalStore[STORAGE_KEY] ||= new Map<string, string>();

    logger.warn(
      "[MemoryTokenAdapter] Using in-memory storage. " +
        "Tokens will be lost on restart. " +
        "Configure Veryfront Cloud for production.",
    );
  }

  async initialize(): Promise<void> {
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
    if (prefix) {
      return Promise.resolve(keys.filter((k) => k.startsWith(prefix)));
    }
    return Promise.resolve(keys);
  }

  dispose(): void {
    logger.debug("[MemoryTokenAdapter] Disposed");
  }

  get size(): number {
    return this.storage.size;
  }

  clear(): void {
    this.storage.clear();
  }
}
