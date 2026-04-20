/**
 * Contract interface for Node.js compatibility shims.
 *
 * Default implementation: `@veryfront/ext-node-compat`
 *
 * @module extensions/interfaces/node-compat
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
 * Mirrors `SqliteDatabase` in `src/platform/compat/kv/types.ts` — kept
 * separate here so extensions can import from the public
 * `veryfront/extensions/interfaces` entrypoint without taking a dependency
 * on internal platform paths.
 */
export interface NodeCompatSqliteDatabase {
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
  ): Promise<{ content: string }>;
}

/**
 * NodeCompat contract interface.
 *
 * Implementations provide access to Node.js-only packages
 * (`@kreuzberg/wasm`, `better-sqlite3`) in environments where those
 * packages are available (i.e. a full Node/Deno runtime, not a compiled
 * binary or edge runtime).
 *
 * Both methods are optional on the interface so that partial
 * implementations (e.g. SQLite-only or kreuzberg-only) are valid.
 */
export interface NodeCompat {
  /**
   * Initialise and return the kreuzberg document-extraction module.
   *
   * Callers should fall back to a "no extraction" path when this
   * method is absent or throws.
   */
  importKreuzberg?(): Promise<KreuzbergExtractor>;

  /**
   * Open (or create) a SQLite database at `path`.
   *
   * Returns a database compatible with `SqliteKv`.
   * When `path` is omitted an in-memory database is created.
   *
   * Callers should fall back to the in-memory KV when this method is
   * absent or throws.
   */
  openSqliteDatabase?(path?: string): Promise<NodeCompatSqliteDatabase>;
}
