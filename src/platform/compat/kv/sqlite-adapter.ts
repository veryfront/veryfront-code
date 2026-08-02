import type { Kv, KvEntry, KvListOptions, SqliteDatabase } from "./types.ts";
import {
  createKvVersionstamp,
  deserializeKvKey,
  deserializeKvValue,
  serializeKvKey,
  serializeKvValue,
  validateKvListLimit,
} from "./internal.ts";

export class SqliteKv implements Kv {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT,
        versionstamp TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);
  }

  async get<T = unknown>(
    key: string[],
  ): Promise<{ value: T | undefined; versionstamp?: string }> {
    const keyStr = serializeKvKey(key);
    const row = this.db
      .prepare("SELECT value, versionstamp FROM kv_store WHERE key = ?")
      .get(keyStr) as { value: string; versionstamp?: string } | undefined;

    if (!row) return { value: undefined };

    return {
      value: deserializeKvValue<T>(row.value),
      versionstamp: row.versionstamp,
    };
  }

  async set<T = unknown>(key: string[], value: T): Promise<void> {
    const keyStr = serializeKvKey(key);
    const serializedValue = serializeKvValue(value);
    const now = Date.now();

    this.db
      .prepare(`
        INSERT OR REPLACE INTO kv_store (key, value, versionstamp, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(keyStr, serializedValue, createKvVersionstamp(), now, now);
  }

  async delete(key: string[]): Promise<void> {
    this.db.prepare("DELETE FROM kv_store WHERE key = ?").run(serializeKvKey(key));
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const limit = validateKvListLimit(options);
    let query = "SELECT key, value, versionstamp FROM kv_store";
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options?.prefix?.length) {
      const prefixStr = serializeKvKey(options.prefix);
      const descendantPrefix = `${prefixStr.slice(0, -1)},`;
      conditions.push("(key = ? OR substr(key, 1, length(?)) = ?)");
      params.push(prefixStr, descendantPrefix, descendantPrefix);
    }

    if (options?.start) {
      conditions.push("key >= ?");
      params.push(serializeKvKey(options.start));
    }

    if (options?.end) {
      conditions.push("key < ?");
      params.push(serializeKvKey(options.end));
    }

    if (conditions.length) query += ` WHERE ${conditions.join(" AND ")}`;

    query += " ORDER BY key";
    if (options?.reverse) query += " DESC";

    if (limit !== undefined) {
      query += " LIMIT ?";
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      key: string;
      value: string;
      versionstamp?: string;
    }>;

    for (const row of rows) {
      yield {
        key: deserializeKvKey(row.key),
        value: deserializeKvValue<T>(row.value),
        versionstamp: row.versionstamp,
      };
    }
  }

  close(): void {
    this.db.close();
  }
}
