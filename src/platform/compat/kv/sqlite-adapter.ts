import { PLATFORM_ERROR } from "#veryfront/errors/error-registry/deploy.ts";
import type { Kv, KvEntry, KvListOptions, SqliteDatabase } from "./types.ts";
import {
  assertKvListScanWithinLimit,
  assertKvOpen,
  compareEncodedKvKeys,
  decodeStoredKvKey,
  decodeStoredKvValue,
  encodeKvKey,
  encodeKvValue,
  formatKvVersionstamp,
  normalizeKvListOptions,
  selectKvEntries,
  VersionstampGenerator,
} from "./contract.ts";

export class SqliteKv implements Kv {
  private readonly db: SqliteDatabase;
  private readonly versionstamps = new VersionstampGenerator();
  private closed = false;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.initialize();
  }

  private databaseOperation<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      throw PLATFORM_ERROR.create({ message: "KV database operation failed" });
    }
  }

  private initialize(): void {
    this.databaseOperation(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT,
          versionstamp TEXT,
          created_at INTEGER,
          updated_at INTEGER
        )
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS veryfront_kv_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    });
  }

  private writeTransaction<T>(operation: () => T): T {
    return this.databaseOperation(() => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = operation();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // The primary database failure remains authoritative and sanitized.
        }
        throw error;
      }
    });
  }

  private allocateVersionstamp(): string {
    const candidate = this.versionstamps.nextSequence();
    const row = this.db.prepare(`
        INSERT INTO veryfront_kv_metadata (key, value)
        VALUES ('versionstamp', ?)
        ON CONFLICT(key) DO UPDATE SET value =
          CASE
            WHEN CAST(value AS INTEGER) >= CAST(excluded.value AS INTEGER)
              THEN printf('%020d', CAST(value AS INTEGER) + 1)
            ELSE excluded.value
          END
        RETURNING value
      `).get(candidate);
    if ((typeof row !== "object" && typeof row !== "function") || row === null) {
      throw new TypeError("Invalid KV metadata row");
    }
    const versionstamp = Reflect.get(row, "value");
    if (typeof versionstamp !== "string" || !/^\d{20}$/.test(versionstamp)) {
      throw new TypeError("Invalid KV metadata row");
    }
    return formatKvVersionstamp(versionstamp);
  }

  private snapshotValueRow(
    row: unknown,
  ): { value: string; versionstamp?: string } | undefined {
    if (row === undefined) return undefined;
    if ((typeof row !== "object" && typeof row !== "function") || row === null) {
      throw new TypeError("Invalid KV database row");
    }

    const value = Reflect.get(row, "value");
    const versionstamp = Reflect.get(row, "versionstamp");
    if (
      typeof value !== "string" ||
      (versionstamp !== undefined && typeof versionstamp !== "string")
    ) {
      throw new TypeError("Invalid KV database row");
    }
    return { value, versionstamp };
  }

  private snapshotListRows(rows: unknown): Array<{
    key: string;
    value: string;
    versionstamp?: string;
  }> {
    if (!Array.isArray(rows)) throw new TypeError("Invalid KV database rows");
    return rows.map((row) => {
      if ((typeof row !== "object" && typeof row !== "function") || row === null) {
        throw new TypeError("Invalid KV database row");
      }
      const key = Reflect.get(row, "key");
      const value = Reflect.get(row, "value");
      const versionstamp = Reflect.get(row, "versionstamp");
      if (
        typeof key !== "string" ||
        typeof value !== "string" ||
        (versionstamp !== undefined && typeof versionstamp !== "string")
      ) {
        throw new TypeError("Invalid KV database row");
      }
      return { key, value, versionstamp };
    });
  }

  async get<T = unknown>(
    key: string[],
  ): Promise<{ value: T | undefined; versionstamp?: string }> {
    assertKvOpen(this.closed);
    const keyStr = encodeKvKey(key);
    const row = this.databaseOperation(() => {
      const rawRow = this.db
        .prepare("SELECT value, versionstamp FROM kv_store WHERE key = ?")
        .get(keyStr);
      return this.snapshotValueRow(rawRow);
    });

    if (!row) return { value: undefined };

    return {
      value: decodeStoredKvValue<T>(row.value),
      versionstamp: row.versionstamp,
    };
  }

  async set<T = unknown>(key: string[], value: T): Promise<void> {
    assertKvOpen(this.closed);
    const keyStr = encodeKvKey(key);
    const encodedValue = encodeKvValue(value);
    const now = Date.now();
    this.writeTransaction(() => {
      const versionstamp = this.allocateVersionstamp();
      this.db
        .prepare(`
          INSERT OR REPLACE INTO kv_store (key, value, versionstamp, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(keyStr, encodedValue, versionstamp, now, now);
    });
  }

  async delete(key: string[]): Promise<void> {
    assertKvOpen(this.closed);
    const keyStr = encodeKvKey(key);
    this.databaseOperation(() => this.db.prepare("DELETE FROM kv_store WHERE key = ?").run(keyStr));
  }

  async *list<T = unknown>(options?: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    assertKvOpen(this.closed);
    const normalizedOptions = normalizeKvListOptions(options);
    let query = "SELECT key, value, versionstamp FROM kv_store";
    const params: unknown[] = [];
    const conditions: string[] = [];
    let lowerBound = normalizedOptions.start && JSON.stringify(normalizedOptions.start);
    let upperBound = normalizedOptions.end && JSON.stringify(normalizedOptions.end);

    if (normalizedOptions.prefix && normalizedOptions.prefix.length > 0) {
      const prefixStr = JSON.stringify(normalizedOptions.prefix);
      const descendantPrefix = `${prefixStr.slice(0, -1)},`;
      if (!lowerBound || compareEncodedKvKeys(descendantPrefix, lowerBound) > 0) {
        lowerBound = descendantPrefix;
      }
      if (!upperBound || compareEncodedKvKeys(prefixStr, upperBound) < 0) {
        upperBound = prefixStr;
      }
    }

    if (lowerBound && upperBound && compareEncodedKvKeys(lowerBound, upperBound) >= 0) return;

    if (lowerBound) {
      conditions.push("key >= ?");
      params.push(lowerBound);
    }

    if (upperBound) {
      conditions.push("key < ?");
      params.push(upperBound);
    }

    if (conditions.length) query += ` WHERE ${conditions.join(" AND ")}`;

    query += " ORDER BY key";
    if (normalizedOptions.reverse) query += " DESC";
    query += " LIMIT ?";
    params.push(normalizedOptions.limit ?? normalizedOptions.maxScanEntries + 1);

    const rows = this.databaseOperation(() =>
      this.snapshotListRows(this.db.prepare(query).all(...params))
    );
    if (normalizedOptions.limit === undefined) {
      assertKvListScanWithinLimit(rows.length, normalizedOptions.maxScanEntries);
    }

    const entries = selectKvEntries(
      rows.map((row) => ({
        encodedKey: row.key,
        key: decodeStoredKvKey(row.key),
        value: row.value,
        versionstamp: row.versionstamp,
      })),
      normalizedOptions,
    );

    for (const entry of entries) {
      assertKvOpen(this.closed);
      yield {
        key: [...entry.key],
        value: decodeStoredKvValue<T>(entry.value),
        versionstamp: entry.versionstamp,
      };
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.databaseOperation(() => this.db.close());
  }
}
