import type { Kv, KvEntry, KvListOptions, SqliteDatabase } from "./types.ts";

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

  private keyToString(key: string[]): string {
    return JSON.stringify(key);
  }

  private stringToKey(keyStr: string): string[] {
    return JSON.parse(keyStr);
  }

  get<T = unknown>(key: string[]): Promise<{ value: T | undefined; versionstamp?: string }> {
    const keyStr = this.keyToString(key);
    const row = this.db
      .prepare("SELECT value, versionstamp FROM kv_store WHERE key = ?")
      .get(keyStr) as { value: string; versionstamp?: string } | undefined;

    if (!row) return Promise.resolve({ value: undefined });

    return Promise.resolve({
      value: JSON.parse(row.value) as T,
      versionstamp: row.versionstamp,
    });
  }

  set<T = unknown>(key: string[], value: T): Promise<void> {
    const keyStr = this.keyToString(key);
    const now = Date.now();

    this.db
      .prepare(`
        INSERT OR REPLACE INTO kv_store (key, value, versionstamp, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(keyStr, JSON.stringify(value), now.toString(), now, now);

    return Promise.resolve();
  }

  delete(key: string[]): Promise<void> {
    this.db.prepare("DELETE FROM kv_store WHERE key = ?").run(this.keyToString(key));
    return Promise.resolve();
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    let query = "SELECT key, value, versionstamp FROM kv_store";
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options?.prefix) {
      const prefixStr = this.keyToString(options.prefix);
      conditions.push("key LIKE ?");
      params.push(`${prefixStr.slice(0, -1)}%`);
    }

    if (options?.start) {
      conditions.push("key >= ?");
      params.push(this.keyToString(options.start));
    }

    if (options?.end) {
      conditions.push("key < ?");
      params.push(this.keyToString(options.end));
    }

    if (conditions.length) query += ` WHERE ${conditions.join(" AND ")}`;

    query += " ORDER BY key";
    if (options?.reverse) query += " DESC";

    if (options?.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      key: string;
      value: string;
      versionstamp?: string;
    }>;

    for (const row of rows) {
      yield {
        key: this.stringToKey(row.key),
        value: JSON.parse(row.value) as T,
        versionstamp: row.versionstamp,
      };
    }
  }

  close(): void {
    this.db.close();
  }
}
