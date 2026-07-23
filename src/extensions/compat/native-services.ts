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
  /** Return the first matching row. */
  get(...params: unknown[]): unknown;
  /** Execute a statement that does not return rows. */
  run(...params: unknown[]): void;
  /** Return all matching rows. */
  all(...params: unknown[]): unknown[];
}

/**
 * Minimal interface for a SQLite database connection, compatible with
 * `better-sqlite3`'s `Database` shape as consumed by `SqliteKv`.
 *
 * Structurally compatible with the database shape consumed by Veryfront's
 * portable key-value adapter. The public contract keeps extensions independent
 * from runtime implementation modules.
 */
export interface SqliteDatabase {
  /** Execute one or more SQL statements. */
  exec(sql: string): void;
  /** Prepare a reusable SQL statement. */
  prepare(sql: string): SqliteStatement;
  /** Close the database connection. */
  close(): void;
}

/**
 * Shape returned by the kreuzberg document-extraction module.
 *
 * Matches the subset used by the optional document extraction adapter.
 */
export interface KreuzbergExtractor {
  /** Extract text from document bytes. */
  extractBytes(
    data: Uint8Array,
    mimeType: string,
    config?: Record<string, unknown> | null,
  ): Promise<{ content: string }>;
}

/** Progress reported while a document is being extracted. */
export interface DocumentExtractionProgressEvent {
  /** Unit represented by the progress counters. */
  unit: "file" | "page" | "slide";
  /** Number of completed units. */
  current: number;
  /** Total units, when known. */
  total?: number;
  /** Number of characters extracted so far, when available. */
  characters?: number;
}

/** Callback invoked when document extraction progress changes. */
export type DocumentExtractionProgress = (
  event: DocumentExtractionProgressEvent,
) => void | Promise<void>;

/** Controls document extraction progress and timeout behavior. */
export interface DocumentExtractionOptions {
  /** Receive extraction progress updates. */
  onProgress?: DocumentExtractionProgress;
  /** Maximum time without progress before extraction stops. */
  idleTimeoutMs?: number;
  /** Maximum total extraction time. */
  hardTimeoutMs?: number;
}

/**
 * Document extraction contract.
 */
export interface DocumentExtractor {
  /**
   * Initialize and return the Kreuzberg document-extraction module.
   *
   * Absence or failure means document extraction is unavailable. Callers must
   * surface that failure instead of silently substituting document content.
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
   * Callers can select an in-memory store when this method is absent. A
   * provider failure must remain terminal so persistent data is not silently
   * replaced with process-local state.
   */
  openSqliteDatabase?(path?: string): Promise<SqliteDatabase>;
}
