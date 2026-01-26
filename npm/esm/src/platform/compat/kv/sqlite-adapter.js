export class SqliteKv {
    db;
    constructor(db) {
        this.db = db;
        this.initialize();
    }
    initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY,
        value TEXT,
        versionstamp TEXT,
        created_at INTEGER,
        updated_at INTEGER)
    `);
    }
    keyToString(key) {
        return JSON.stringify(key);
    }
    stringToKey(keyStr) {
        return JSON.parse(keyStr);
    }
    get(key) {
        const keyStr = this.keyToString(key);
        const row = this.db
            .prepare("SELECT value, versionstamp FROM kv_store WHERE key = ?")
            .get(keyStr);
        if (!row)
            return Promise.resolve({ value: undefined });
        return Promise.resolve({
            value: JSON.parse(row.value),
            versionstamp: row.versionstamp,
        });
    }
    set(key, value) {
        const keyStr = this.keyToString(key);
        const valueStr = JSON.stringify(value);
        const now = Date.now();
        const versionstamp = now.toString();
        this.db
            .prepare(`
      INSERT OR REPLACE INTO kv_store (key, value, versionstamp, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
            .run(keyStr, valueStr, versionstamp, now, now);
        return Promise.resolve();
    }
    delete(key) {
        const keyStr = this.keyToString(key);
        this.db.prepare("DELETE FROM kv_store WHERE key = ?").run(keyStr);
        return Promise.resolve();
    }
    async *list(options) {
        let query = "SELECT key, value, versionstamp FROM kv_store";
        const params = [];
        const conditions = [];
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
        if (conditions.length)
            query += ` WHERE ${conditions.join(" AND ")}`;
        query += " ORDER BY key";
        if (options?.reverse)
            query += " DESC";
        if (options?.limit) {
            query += " LIMIT ?";
            params.push(options.limit);
        }
        const rows = this.db.prepare(query).all(...params);
        for (const row of rows) {
            yield {
                key: this.stringToKey(row.key),
                value: JSON.parse(row.value),
                versionstamp: row.versionstamp,
            };
        }
    }
    close() {
        this.db.close();
    }
}
