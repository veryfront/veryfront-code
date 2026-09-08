import type { DependencySnapshotStore } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { captureDependencySnapshotStore } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { DEPENDENCY_SNAPSHOT_STORE_UNAVAILABLE } from "#veryfront/errors/error-registry/server.ts";
import {
  decodeDependencySnapshot,
  DEPENDENCY_SNAPSHOT_DEFAULT_RETENTION_MS,
  DEPENDENCY_SNAPSHOT_RETENTION_MS,
  type DependencyPinningSnapshot,
  encodeDependencySnapshot,
} from "./dependency-snapshot.ts";

interface Entry {
  snapshot: DependencyPinningSnapshot;
  value: string;
  expiresAt: number;
  bytes: number;
}

interface PendingOperation {
  value?: string;
  promise: Promise<unknown>;
}

interface RegistryOptions {
  store?: DependencySnapshotStore;
  now?: () => number;
  retentionMs?: number;
  maxEntries?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

const nativeNow = Date.now;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const isSafeInteger = Number.isSafeInteger;
const NativeMap = Map;
const mapGet = NativeMap.prototype.get;
const mapSet = NativeMap.prototype.set;
const mapDelete = NativeMap.prototype.delete;
const mapClear = NativeMap.prototype.clear;
const mapKeys = NativeMap.prototype.keys;
const mapSize = getOwnPropertyDescriptor(NativeMap.prototype, "size")!.get!;
const mapIteratorNext = Object.getPrototypeOf(new NativeMap<string, unknown>().keys())
  .next as () => IteratorResult<string>;
const NativeAbortController = AbortController;
const NativePromise = Promise;
const promiseThen = Promise.prototype.then;
const ready = new NativePromise<void>((resolve) => resolve());
const scheduleTimeout = globalThis.setTimeout;
const cancelTimeout = globalThis.clearTimeout;
const abortController = NativeAbortController.prototype.abort;
const controllerSignal = getOwnPropertyDescriptor(NativeAbortController.prototype, "signal")!.get!;
const apply = Reflect.apply;
function option<K extends keyof RegistryOptions>(
  options: RegistryOptions,
  key: K,
): RegistryOptions[K] {
  const descriptor = getOwnPropertyDescriptor(options, key);
  if (descriptor && !hasOwn(descriptor, "value")) {
    throw new TypeError("Snapshot registry options must be own data properties");
  }
  return descriptor?.value as RegistryOptions[K];
}

/** Immutable history with acknowledged publication and a bounded local fast path. */
export class DependencySnapshotRegistry {
  private readonly entries = new NativeMap<string, Entry>();
  private readonly pending = new NativeMap<string, PendingOperation>();
  private bytes = 0;
  private generation = 0;
  readonly #store?: DependencySnapshotStore;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: RegistryOptions = {}) {
    const store = option(options, "store");
    this.#store = store && captureDependencySnapshotStore(store);
    const clock = option(options, "now") ?? nativeNow;
    this.now = () => clock();
    this.retentionMs = option(options, "retentionMs") ?? DEPENDENCY_SNAPSHOT_DEFAULT_RETENTION_MS;
    this.maxEntries = option(options, "maxEntries") ?? 4096;
    this.maxBytes = option(options, "maxBytes") ?? 32 * 1024 * 1024;
    this.timeoutMs = option(options, "timeoutMs") ?? 5000;
    const limits = [this.retentionMs, this.maxEntries, this.maxBytes, this.timeoutMs];
    for (let index = 0; index < limits.length; index++) {
      const value = limits[index]!;
      if (!isSafeInteger(value) || value <= 0) {
        throw new RangeError("Invalid snapshot registry limit");
      }
    }
    if (this.retentionMs > DEPENDENCY_SNAPSHOT_RETENTION_MS) {
      throw new RangeError("Dependency snapshot retention cannot exceed 24 hours");
    }
  }

  peek(identity: string, key: string): DependencyPinningSnapshot | undefined {
    return this.entry(`${identity}\0${key}`)?.snapshot;
  }

  async remember(identity: string, snapshot: DependencyPinningSnapshot): Promise<void> {
    const localKey = `${identity}\0${snapshot.cacheKey}`;
    const namespace = await computeHash(identity);
    const value = encodeDependencySnapshot(namespace, snapshot);
    const existing = this.entry(localKey);
    if (existing && existing.value !== value) throw this.unavailable();
    // Renew well before expiry so every newly emitted document has time to hydrate.
    if (existing && existing.expiresAt >= this.now() + this.retentionMs / 2) return;
    let expiresAt = this.now() + this.retentionMs;
    const generation = this.generation;
    if (this.#store) {
      expiresAt = await this.operation(
        `publish:${localKey}`,
        value,
        async (signal) => {
          const publishedUntil = expiresAt;
          await this.#store!.publish(namespace, snapshot.cacheKey, value, publishedUntil, signal);
          return publishedUntil;
        },
      );
    }
    if (generation !== this.generation) return;
    this.insert(localKey, { snapshot, value, expiresAt, bytes: utf8ByteLength(value) });
  }

  async find(identity: string, key: string): Promise<DependencyPinningSnapshot | undefined> {
    const existing = this.peek(identity, key);
    if (existing || !this.#store) return existing;
    const generation = this.generation;
    const namespace = await computeHash(identity);
    const record = await this.operation(
      `read:${identity}\0${key}`,
      undefined,
      (signal) => this.#store!.read(namespace, key, signal),
    );
    if (record === null) return undefined;
    if (
      !record || typeof record.value !== "string" || !isSafeInteger(record.expiresAt) ||
      record.expiresAt > this.now() + DEPENDENCY_SNAPSHOT_RETENTION_MS
    ) throw this.unavailable();
    if (record.expiresAt <= this.now()) return undefined;
    let snapshot: DependencyPinningSnapshot;
    try {
      snapshot = decodeDependencySnapshot(record.value, namespace, key);
    } catch {
      throw this.unavailable();
    }
    if (generation === this.generation) {
      this.insert(`${identity}\0${key}`, {
        snapshot,
        value: record.value,
        expiresAt: record.expiresAt,
        bytes: utf8ByteLength(record.value),
      });
    }
    return snapshot;
  }

  /**
   * Retain an exact match reconstructed from API-owned prior metadata, using
   * its acknowledged expiry. This read-only path never substitutes for an
   * explicitly configured shared store and never publishes renderer state.
   */
  async recoverHistorical(
    identity: string,
    key: string,
    load: (
      signal: AbortSignal,
    ) => Promise<{ snapshot: DependencyPinningSnapshot; expiresAt: number } | undefined>,
  ): Promise<DependencyPinningSnapshot | undefined> {
    if (this.#store) return undefined;
    const generation = this.generation;
    const record = await this.operation(`metadata:${identity}\0${key}`, undefined, load);
    if (!record || record.expiresAt <= this.now()) return undefined;
    if (
      record.snapshot.cacheKey !== key || !isSafeInteger(record.expiresAt) ||
      record.expiresAt > this.now() + DEPENDENCY_SNAPSHOT_RETENTION_MS
    ) throw this.unavailable();
    const namespace = await computeHash(identity);
    let value: string;
    try {
      value = encodeDependencySnapshot(namespace, record.snapshot);
    } catch {
      throw this.unavailable();
    }
    const existing = this.entry(`${identity}\0${key}`);
    if (existing && existing.value !== value) throw this.unavailable();
    if (generation === this.generation) {
      this.insert(`${identity}\0${key}`, {
        snapshot: record.snapshot,
        value,
        expiresAt: record.expiresAt,
        bytes: utf8ByteLength(value),
      });
    }
    return record.snapshot;
  }

  clear(): void {
    this.generation++;
    apply(mapClear, this.entries, []);
    this.bytes = 0;
  }

  private entry(key: string): Entry | undefined {
    const entry = apply(mapGet, this.entries, [key]) as Entry | undefined;
    if (!entry) return undefined;
    apply(mapDelete, this.entries, [key]);
    if (entry.expiresAt <= this.now()) {
      this.bytes -= entry.bytes;
      return undefined;
    }
    apply(mapSet, this.entries, [key, entry]);
    return entry;
  }

  private insert(key: string, entry: Entry): void {
    const prior = apply(mapGet, this.entries, [key]) as Entry | undefined;
    if (prior) this.bytes -= prior.bytes;
    apply(mapDelete, this.entries, [key]);
    apply(mapSet, this.entries, [key, entry]);
    this.bytes += entry.bytes;
    while (apply(mapSize, this.entries, []) > this.maxEntries || this.bytes > this.maxBytes) {
      const iterator = apply(mapKeys, this.entries, []);
      const oldest = apply(mapIteratorNext, iterator, []).value as string;
      this.bytes -= (apply(mapGet, this.entries, [oldest]) as Entry).bytes;
      apply(mapDelete, this.entries, [oldest]);
    }
  }

  private async operation<T>(
    key: string,
    value: string | undefined,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let pending = apply(mapGet, this.pending, [key]) as PendingOperation | undefined;
    if (pending && pending.value !== value) throw this.unavailable();
    try {
      if (!pending) {
        if (apply(mapSize, this.pending, []) >= 64) throw this.unavailable();
        const controller = new NativeAbortController();
        const signal = apply(controllerSignal, controller, []) as AbortSignal;
        const producer = apply(promiseThen, ready, [() => run(signal)]) as Promise<T>;
        const promise = new NativePromise<T>((resolve, reject) => {
          const timer = scheduleTimeout(() => {
            const error = this.unavailable();
            reject(error);
            try {
              apply(abortController, controller, [error]);
            } catch { /* Caller rejection does not depend on cooperative cancellation. */ }
          }, this.timeoutMs);
          const release = () => {
            cancelTimeout(timer);
            const current = apply(mapGet, this.pending, [key]) as PendingOperation | undefined;
            if (current?.promise === promise) apply(mapDelete, this.pending, [key]);
          };
          void apply(promiseThen, producer, [
            (result: T) => {
              release();
              resolve(result);
            },
            (error: unknown) => {
              release();
              reject(error);
            },
          ]);
        });
        // Coalesced callers share the deadline, including its settled rejection.
        // Non-cooperative producers remain admitted until they actually settle.
        pending = { value, promise };
        apply(mapSet, this.pending, [key, pending]);
      }
      return await pending.promise as T;
    } catch {
      throw this.unavailable();
    }
  }

  private unavailable(): Error {
    return DEPENDENCY_SNAPSHOT_STORE_UNAVAILABLE.create();
  }
}
