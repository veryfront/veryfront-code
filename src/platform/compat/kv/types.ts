/** Limits shared by every Veryfront KV adapter. */
export const KV_PORTABLE_LIMITS = Object.freeze({
  maxKeyBytes: 2_048,
  maxKeyParts: 1_024,
  maxValueBytes: 60 * 1_024,
  maxValueDepth: 100,
  maxValueNodes: 65_536,
  defaultListScanEntries: 1_000,
  maxListScanEntries: 10_000,
});

/**
 * A value that every Veryfront KV adapter stores without type or value loss.
 *
 * TypeScript cannot distinguish finite numbers from `NaN`, infinities, or
 * negative zero. Runtime validation remains authoritative for numbers and the
 * other portable limits.
 */
export type KvJsonValue =
  | null
  | boolean
  | number
  | string
  | KvJsonValue[]
  | { [key: string]: KvJsonValue };

/** A versioned entry returned by a Veryfront KV list operation. */
export interface KvEntry<T = unknown> {
  key: string[];
  value: T;
  versionstamp?: string;
}

/** Selection and work limits for a bounded Veryfront KV list operation. */
export interface KvListOptions {
  /** Match strict descendants of these key parts. An empty prefix matches every stored key. */
  prefix?: string[];
  /** Inclusive encoded-key lower bound. */
  start?: string[];
  /** Exclusive encoded-key upper bound. */
  end?: string[];
  /** Maximum number of entries to return. Use 0 for an empty result. */
  limit?: number;
  /**
   * Maximum backend entries an adapter may inspect or buffer for this list.
   * Defaults to 1,000 and cannot exceed 10,000. Exceeding the bound throws
   * instead of returning a silently truncated result.
   */
  maxScanEntries?: number;
  reverse?: boolean;
}

/** Portable key-value operations shared by every Veryfront KV adapter. */
export interface Kv {
  /**
   * Read a value after runtime contract validation.
   *
   * The type parameter describes the caller's expected shape. It does not
   * validate application-specific fields. Validate untrusted data with an
   * application schema before using it.
   */
  get<T = unknown>(key: string[]): Promise<{ value: T | undefined; versionstamp?: string }>;
  /**
   * Store a value after validating its key and portable JSON representation.
   *
   * The generic input remains for API compatibility. Runtime validation
   * rejects values outside `KvJsonValue` or `KV_PORTABLE_LIMITS`.
   */
  set<T = unknown>(key: string[], value: T): Promise<void>;
  delete(key: string[]): Promise<void>;
  /**
   * List values after runtime contract validation.
   *
   * The type parameter describes the caller's expected shape. It does not
   * validate application-specific fields.
   */
  list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>>;
  /** Close the store. Later operations fail, and repeated close calls are safe. */
  close(): void;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): void;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}
