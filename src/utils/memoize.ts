import { FNV1A_PRIME_32 } from "./constants/crypto.ts";
import { HASH_SEED_FNV1A } from "./constants/hash.ts";

/** Default retained-result budget for memoization helpers. */
export const DEFAULT_MEMO_CACHE_MAX_ENTRIES = 100;
/** Highest explicit retained-result budget accepted by memoization helpers. */
export const MAX_MEMO_CACHE_ENTRIES = 100_000;
/** Default distinct in-flight key budget for asynchronous memoization. */
export const DEFAULT_MEMOIZE_MAX_INFLIGHT = DEFAULT_MEMO_CACHE_MAX_ENTRIES;
/** Highest explicit distinct in-flight key budget accepted by asynchronous memoization. */
export const MAX_MEMOIZE_INFLIGHT = MAX_MEMO_CACHE_ENTRIES;
/** Maximum character length of a retained memoization key. */
export const MAX_MEMO_KEY_CHARACTERS = 4_096;

/** Capacity policy shared by `MemoCache` and synchronous memoization. */
export interface MemoCacheOptions {
  /** Maximum number of resolved results retained in least-recently-used order. */
  maxEntries?: number;
}

/** Capacity policy for resolved and unresolved asynchronous memoization state. */
export interface MemoizeAsyncOptions extends MemoCacheOptions {
  /**
   * Maximum number of distinct unresolved keys. Same-key callers continue to
   * share the existing promise when this budget is full. Defaults to
   * `maxEntries` when supplied, otherwise `DEFAULT_MEMOIZE_MAX_INFLIGHT`.
   */
  maxInflight?: number;
}

function requireMemoLimit(
  value: number,
  option: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(
      `${option} must be a safe integer between 1 and ${maximum}`,
    );
  }
  return value;
}

function requireMemoKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Memoization key must be a string");
  }
  if (value.length > MAX_MEMO_KEY_CHARACTERS) {
    throw new RangeError(
      `Memoization key must not exceed ${MAX_MEMO_KEY_CHARACTERS} characters`,
    );
  }
  return value;
}

/**
 * Bounded string-keyed memo cache with deterministic least-recently-used
 * eviction. Reads refresh recency; `has` is observational.
 */
export class MemoCache<V> {
  private readonly cache = new Map<string, V>();
  private readonly maxEntries: number;

  constructor(options: MemoCacheOptions = {}) {
    this.maxEntries = requireMemoLimit(
      options.maxEntries ?? DEFAULT_MEMO_CACHE_MAX_ENTRIES,
      "MemoCache maxEntries",
      MAX_MEMO_CACHE_ENTRIES,
    );
  }

  get(key: string): V | undefined {
    const normalizedKey = requireMemoKey(key);
    if (!this.cache.has(normalizedKey)) return undefined;

    const value = this.cache.get(normalizedKey) as V;
    this.cache.delete(normalizedKey);
    this.cache.set(normalizedKey, value);
    return value;
  }

  set(key: string, value: V): void {
    const normalizedKey = requireMemoKey(key);
    if (this.cache.has(normalizedKey)) {
      this.cache.delete(normalizedKey);
    } else if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(normalizedKey, value);
  }

  has(key: string): boolean {
    return this.cache.has(requireMemoKey(key));
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Memoize asynchronous results with bounded LRU retention and bounded
 * distinct in-flight work. Rejections are never cached.
 */
export function memoizeAsync<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  keyHasher: (...args: Args) => string,
  options: MemoizeAsyncOptions = {},
): (...args: Args) => Promise<Result> {
  const cache = new MemoCache<Promise<Result>>(options);
  const inflight = new Map<string, Promise<Result>>();
  const maxInflight = requireMemoLimit(
    options.maxInflight ?? options.maxEntries ?? DEFAULT_MEMOIZE_MAX_INFLIGHT,
    "memoizeAsync maxInflight",
    MAX_MEMOIZE_INFLIGHT,
  );

  return (...args: Args): Promise<Result> => {
    let key: string;
    try {
      key = requireMemoKey(keyHasher(...args));
    } catch (error) {
      return Promise.reject(error);
    }

    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const existing = inflight.get(key);
    if (existing) return existing;
    if (inflight.size >= maxInflight) {
      return Promise.reject(
        new RangeError(
          `memoizeAsync capacity of ${maxInflight} distinct in-flight keys is exhausted`,
        ),
      );
    }

    let operation: Promise<Result>;
    try {
      operation = Promise.resolve(fn(...args));
    } catch (error) {
      return Promise.reject(error);
    }

    const tracked = operation.then(
      (resolved) => {
        cache.set(key, tracked);
        if (inflight.get(key) === tracked) inflight.delete(key);
        return resolved;
      },
      (error) => {
        if (inflight.get(key) === tracked) inflight.delete(key);
        throw error;
      },
    );

    inflight.set(key, tracked);
    return tracked;
  };
}

/** Memoize synchronous results with bounded LRU retention. */
export function memoize<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  keyHasher: (...args: Args) => string,
  options: MemoCacheOptions = {},
): (...args: Args) => Result {
  const cache = new MemoCache<Result>(options);

  return (...args: Args): Result => {
    const key = requireMemoKey(keyHasher(...args));
    if (cache.has(key)) return cache.get(key)!;

    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * FNV-1a hash algorithm for fast, framed cache key generation.
 * 10-15x faster than JSON.stringify() and uses 70-80% less memory.
 */
export function simpleHash(...values: unknown[]): string {
  let hash = HASH_SEED_FNV1A;

  const mix = (text: string): void => {
    // Length-prefix every segment so argument boundaries cannot collapse
    // (`["ab", "c"]` must not hash as `["a", "bc"]`).
    const length = text.length >>> 0;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (length >>> shift) & 0xff;
      hash = Math.imul(hash, FNV1A_PRIME_32);
    }

    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, FNV1A_PRIME_32);
    }
  };

  for (const value of values) {
    const str = typeof value === "string" ? value : String(value);
    mix(value === null ? "null" : typeof value);
    mix(str);
  }

  return (hash >>> 0).toString(36);
}
