import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";

const DEFAULT_MEMO_CACHE_MAX_ENTRIES = 1_000;
const FNV1A_OFFSET_BASIS_64 = 14_695_981_039_346_656_037n;
const FNV1A_PRIME_64 = 1_099_511_628_211n;
const UINT64_MASK = (1n << 64n) - 1n;

/**
 * Bounded least-recently-used memo cache.
 *
 * Reads refresh recency. New entries evict the least recently used entry when
 * the configured bound is reached.
 */
export class MemoCache<V> {
  private cache = new Map<string, V>();

  constructor(
    private readonly maxEntries: number = DEFAULT_MEMO_CACHE_MAX_ENTRIES,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw INVALID_ARGUMENT.create({
        message: "Memo cache maxEntries must be a positive safe integer",
      });
    }
  }

  get(key: string): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

function memoizeWithCache<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  keyHasher: (...args: Args) => string,
): (...args: Args) => Result {
  const cache = new MemoCache<Result>();

  return (...args: Args): Result => {
    const key = keyHasher(...args);

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

/** Memoize asynchronous work and share one in-flight promise per cache key. */
export function memoizeAsync<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  keyHasher: (...args: Args) => string,
): (...args: Args) => Promise<Result> {
  const cache = new MemoCache<Result>();
  const inflight = new Map<string, Promise<Result>>();

  return (...args: Args): Promise<Result> => {
    const key = keyHasher(...args);
    if (cache.has(key)) return Promise.resolve(cache.get(key)!);

    const existing = inflight.get(key);
    if (existing) return existing;

    let resolvePromise!: (value: Result | PromiseLike<Result>) => void;
    let rejectPromise!: (reason?: unknown) => void;
    const promise = new Promise<Result>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    inflight.set(key, promise);

    let result: Promise<Result>;
    try {
      result = fn(...args);
    } catch (error) {
      inflight.delete(key);
      rejectPromise(error);
      return promise;
    }

    Promise.resolve(result).then(
      (resolved) => {
        if (inflight.get(key) === promise) {
          cache.set(key, resolved);
          inflight.delete(key);
        }
        resolvePromise(resolved);
      },
      (error) => {
        if (inflight.get(key) === promise) inflight.delete(key);
        rejectPromise(error);
      },
    );

    return promise;
  };
}

/** Memoize synchronous work by cache key. */
export function memoize<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  keyHasher: (...args: Args) => string,
): (...args: Args) => Result {
  return memoizeWithCache(fn, keyHasher);
}

function hashSegment(hash: bigint, segment: string): bigint {
  for (let index = 0; index < segment.length; index++) {
    hash ^= BigInt(segment.charCodeAt(index));
    hash = (hash * FNV1A_PRIME_64) & UINT64_MASK;
  }
  return (hash * FNV1A_PRIME_64) & UINT64_MASK;
}

/**
 * 64-bit FNV-1a hash for allocation-light cache key generation.
 * Type and length prefixes preserve primitive and argument boundaries.
 */
export function simpleHash(...values: unknown[]): string {
  let hash = FNV1A_OFFSET_BASIS_64;

  for (const value of values) {
    const type = value === null ? "null" : typeof value;
    const str = typeof value === "string" ? value : String(value);

    hash = hashSegment(hash, type);
    hash = hashSegment(hash, String(str.length));
    hash = hashSegment(hash, str);
  }

  return hash.toString(36);
}
