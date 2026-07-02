/**
 * Contract interfaces for optional native runtime services.
 *
 * Default implementations:
 * - `@veryfront/ext-document-kreuzberg` for `DocumentExtractor`
 * - `@veryfront/ext-db-sqlite` for `SqliteStore`
 *
 * @module extensions/compat/native-services
 */

/**
 * Minimal interface for a prepared SQLite statement, compatible with
 * `better-sqlite3`'s `Statement` shape.
 */
export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): void;
  all(...params: unknown[]): unknown[];
}

/**
 * Minimal interface for a SQLite database connection, compatible with
 * `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`.
 *
 * Mirrors `SqliteDatabase` in `src/platform/compat/kv/types.ts`. Kept
 * separate here so extensions can import from the public
 * `veryfront/extensions/compat` entrypoint without taking a dependency
 * on internal platform paths.
 */
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

/**
 * Shape returned by the kreuzberg document-extraction module.
 *
 * Matches the subset used by `importKreuzberg()` in `opaque-deps.ts`.
 */
export interface KreuzbergExtractor {
  extractBytes(
    data: Uint8Array,
    mimeType: string,
    config?: Record<string, unknown> | null,
  ): Promise<{ content: string }>;
}

export interface DocumentExtractionProgressEvent {
  unit: "file" | "page" | "slide";
  current: number;
  total?: number;
  characters?: number;
}

export type DocumentExtractionProgress = (
  event: DocumentExtractionProgressEvent,
) => void | Promise<void>;

export interface DocumentExtractionOptions {
  onProgress?: DocumentExtractionProgress;
  idleTimeoutMs?: number;
  hardTimeoutMs?: number;
}

/**
 * Document extraction contract.
 */
export interface DocumentExtractor {
  /**
   * Initialise and return the kreuzberg document-extraction module.
   *
   * Callers should fall back to a "no extraction" path when this
   * method is absent or throws.
   */
  importKreuzberg?(): Promise<KreuzbergExtractor>;

  /**
   * Extract text from a document buffer.
   *
   * Implementations may run extraction inside an isolated worker or call a
   * native implementation directly.
   */
  extractInWorker?(
    buffer: ArrayBuffer,
    mimeType: string,
    options?: DocumentExtractionOptions,
  ): Promise<string>;
}

/**
 * SQLite-backed storage contract.
 */
export interface SqliteStore {
  /**
   * Open (or create) a SQLite database at `path`.
   *
   * Returns a database compatible with `SqliteKv`.
   * When `path` is omitted an in-memory database is created.
   *
   * Callers should fall back to the in-memory KV when this method is
   * absent or throws.
   */
  openSqliteDatabase?(path?: string): Promise<SqliteDatabase>;
}
