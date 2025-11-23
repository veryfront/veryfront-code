import type { Kv, KvEntry, KvListOptions, SqliteDatabase } from "./types.ts";

export class SqliteKv implements Kv {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY,
        value TEXT,
        versionstamp TEXT,
        created_at INTEGER,
        updated_at INTEGER)
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
      .get(keyStr);

    if (!row) {
      return Promise.resolve({ value: undefined as T | undefined });
    }

    return Promise.resolve({
      value: JSON.parse((row as { value: string; versionstamp?: string }).value) as T,
      versionstamp: (row as { value: string; versionstamp?: string }).versionstamp,
    });
  }

  set<T = unknown>(key: string[], value: T): Promise<void> {
    const keyStr = this.keyToString(key);
    const valueStr = JSON.stringify(value);
    const versionstamp = Date.now().toString();
    const now = Date.now();

    this.db
      .prepare(`
      INSERT OR REPLACE INTO kv_store (key, value, versionstamp, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run(keyStr, valueStr, versionstamp, now, now);

    return Promise.resolve();
  }

  delete(key: string[]): Promise<void> {
    const keyStr = this.keyToString(key);
    this.db.prepare("DELETE FROM kv_store WHERE key = ?").run(keyStr);
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
      const startStr = this.keyToString(options.start);
      conditions.push("key >= ?");
      params.push(startStr);
    }

    if (options?.end) {
      const endStr = this.keyToString(options.end);
      conditions.push("key < ?");
      params.push(endStr);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += " ORDER BY key";
    if (options?.reverse) {
      query += " DESC";
    }

    if (options?.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);

    for (const row of rows as Array<{ key: string; value: string; versionstamp?: string }>) {
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
