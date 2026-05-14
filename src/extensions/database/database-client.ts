/**
 * Contract interface for database clients.
 *
 * No default first-party implementation is currently shipped.
 *
 * @module extensions/database/database-client
 */

/** Result returned from {@link DatabaseClient.query}. */
export interface QueryResult<T = Record<string, unknown>> {
  /** Array of rows returned by the query. */
  rows: T[];
  /** Number of rows affected by the statement. */
  rowCount: number;
}

/**
 * DatabaseClient contract interface.
 *
 * Implementations provide parameterized query execution against a
 * relational or document database.
 */
export interface DatabaseClient {
  /** Run a read query and return the matching rows. */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  /** Execute a write statement and return the affected row count. */
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  /** Open or initialize the database connection. */
  connect(): Promise<void>;
  /** Close the database connection and release resources. */
  disconnect(): Promise<void>;
}
