/**
 * Mock Cache Backend for Testing
 *
 * Provides a predictable, inspectable cache backend for unit tests.
 * Supports recording operations, simulating failures, and validating behavior.
 *
 * @module cache/testing/mock-backend
 */

import type { CacheBackend } from "../backend.ts";

/**
 * Recorded cache operation for inspection.
 */
export interface RecordedOperation {
  type: "get" | "set" | "del" | "delByPattern" | "getBatch" | "setBatch";
  key?: string;
  keys?: string[];
  value?: string;
  ttl?: number;
  pattern?: string;
  timestamp: number;
  result?: unknown;
  error?: Error;
}

/**
 * Options for configuring mock behavior.
 */
export interface MockCacheBackendOptions {
  /** Simulate network latency (ms) */
  latencyMs?: number;
  /** Keys that should fail on get */
  failOnGet?: Set<string>;
  /** Keys that should fail on set */
  failOnSet?: Set<string>;
  /** Simulate all operations failing */
  failAll?: boolean;
  /** Error message to use for failures */
  errorMessage?: string;
  /** Initial data to populate the cache */
  initialData?: Map<string, { value: string; expiresAt: number }>;
}

/**
 * Mock cache backend for testing.
 *
 * @example
 * ```typescript
 * const mock = new MockCacheBackend();
 * await mock.set("key", "value");
 *
 * // Inspect operations
 * console.log(mock.operations);
 *
 * // Verify specific calls
 * assertEquals(mock.getCallCount("set"), 1);
 * ```
 */
export class MockCacheBackend implements CacheBackend {
  readonly type = "memory" as const;

  private store = new Map<string, { value: string; expiresAt: number }>();
  private _operations: RecordedOperation[] = [];
  private options: MockCacheBackendOptions;

  constructor(options: MockCacheBackendOptions = {}) {
    this.options = options;
    if (options.initialData) {
      this.store = new Map(options.initialData);
    }
  }

  /**
   * Get all recorded operations.
   */
  get operations(): readonly RecordedOperation[] {
    return this._operations;
  }

  /**
   * Get the number of times a specific operation type was called.
   */
  getCallCount(type: RecordedOperation["type"]): number {
    return this._operations.filter((op) => op.type === type).length;
  }

  /**
   * Get operations for a specific key.
   */
  getOperationsForKey(key: string): RecordedOperation[] {
    return this._operations.filter((op) => op.key === key || op.keys?.includes(key));
  }

  /**
   * Check if a specific key was ever accessed.
   */
  wasKeyAccessed(key: string): boolean {
    return this._operations.some((op) => op.key === key || op.keys?.includes(key));
  }

  /**
   * Get the current store contents (for inspection).
   */
  getStoreSnapshot(): Map<string, string> {
    const snapshot = new Map<string, string>();
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt > now) {
        snapshot.set(key, entry.value);
      }
    }
    return snapshot;
  }

  /**
   * Clear all recorded operations.
   */
  clearOperations(): void {
    this._operations = [];
  }

  /**
   * Clear the store and operations.
   */
  reset(): void {
    this.store.clear();
    this._operations = [];
  }

  /**
   * Get the current size of the cache.
   */
  get size(): number {
    return this.store.size;
  }

  private async maybeDelay(): Promise<void> {
    if (this.options.latencyMs && this.options.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.options.latencyMs));
    }
  }

  private shouldFail(key: string, operation: "get" | "set"): boolean {
    if (this.options.failAll) return true;
    if (operation === "get" && this.options.failOnGet?.has(key)) return true;
    if (operation === "set" && this.options.failOnSet?.has(key)) return true;
    return false;
  }

  private createError(): Error {
    return new Error(this.options.errorMessage ?? "Mock cache error");
  }

  async get(key: string): Promise<string | null> {
    await this.maybeDelay();

    const operation: RecordedOperation = {
      type: "get",
      key,
      timestamp: Date.now(),
    };

    if (this.shouldFail(key, "get")) {
      const error = this.createError();
      operation.error = error;
      this._operations.push(operation);
      throw error;
    }

    const entry = this.store.get(key);
    if (!entry) {
      operation.result = null;
      this._operations.push(operation);
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      operation.result = null;
      this._operations.push(operation);
      return null;
    }

    operation.result = entry.value;
    this._operations.push(operation);
    return entry.value;
  }

  async getBatch(keys: string[]): Promise<Map<string, string | null>> {
    await this.maybeDelay();

    const operation: RecordedOperation = {
      type: "getBatch",
      keys: [...keys],
      timestamp: Date.now(),
    };

    const results = new Map<string, string | null>();
    const now = Date.now();

    for (const key of keys) {
      if (this.shouldFail(key, "get")) {
        results.set(key, null);
        continue;
      }

      const entry = this.store.get(key);
      if (!entry || now > entry.expiresAt) {
        if (entry) this.store.delete(key);
        results.set(key, null);
      } else {
        results.set(key, entry.value);
      }
    }

    operation.result = results;
    this._operations.push(operation);
    return results;
  }

  async set(key: string, value: string, ttlSeconds: number = 300): Promise<void> {
    await this.maybeDelay();

    const operation: RecordedOperation = {
      type: "set",
      key,
      value,
      ttl: ttlSeconds,
      timestamp: Date.now(),
    };

    if (this.shouldFail(key, "set")) {
      const error = this.createError();
      operation.error = error;
      this._operations.push(operation);
      throw error;
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    this._operations.push(operation);
  }

  async setBatch(entries: Array<{ key: string; value: string; ttl?: number }>): Promise<void> {
    await this.maybeDelay();

    const operation: RecordedOperation = {
      type: "setBatch",
      keys: entries.map((e) => e.key),
      timestamp: Date.now(),
    };

    const now = Date.now();
    for (const { key, value, ttl } of entries) {
      if (!this.shouldFail(key, "set")) {
        this.store.set(key, {
          value,
          expiresAt: now + (ttl ?? 300) * 1000,
        });
      }
    }

    this._operations.push(operation);
  }

  async del(key: string): Promise<void> {
    await this.maybeDelay();

    const operation: RecordedOperation = {
      type: "del",
      key,
      timestamp: Date.now(),
    };

    this.store.delete(key);
    this._operations.push(operation);
  }

  async delByPattern(pattern: string): Promise<number> {
    await this.maybeDelay();

    const operation: RecordedOperation = {
      type: "delByPattern",
      pattern,
      timestamp: Date.now(),
    };

    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
    let deleted = 0;

    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        deleted++;
      }
    }

    operation.result = deleted;
    this._operations.push(operation);
    return deleted;
  }
}

/**
 * Create a mock backend with pre-populated data.
 */
export function createPopulatedMock(
  data: Record<string, string>,
  ttlSeconds: number = 3600,
): MockCacheBackend {
  const initialData = new Map<string, { value: string; expiresAt: number }>();
  const expiresAt = Date.now() + ttlSeconds * 1000;

  for (const [key, value] of Object.entries(data)) {
    initialData.set(key, { value, expiresAt });
  }

  return new MockCacheBackend({ initialData });
}

/**
 * Create a mock backend that simulates failures.
 */
export function createFailingMock(options: {
  failAll?: boolean;
  failOnGet?: string[];
  failOnSet?: string[];
  errorMessage?: string;
}): MockCacheBackend {
  return new MockCacheBackend({
    failAll: options.failAll,
    failOnGet: options.failOnGet ? new Set(options.failOnGet) : undefined,
    failOnSet: options.failOnSet ? new Set(options.failOnSet) : undefined,
    errorMessage: options.errorMessage,
  });
}

/**
 * Create a mock backend with simulated latency.
 */
export function createSlowMock(latencyMs: number): MockCacheBackend {
  return new MockCacheBackend({ latencyMs });
}
