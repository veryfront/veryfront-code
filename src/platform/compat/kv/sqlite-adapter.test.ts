import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { SqliteDatabase } from "./types.ts";

function createMockDb(): SqliteDatabase & {
  store: Map<string, { value: string; versionstamp?: string }>;
} {
  const store = new Map<string, { value: string; versionstamp?: string }>();

  return {
    store,
    exec(_sql: string) {
      // No-op for CREATE TABLE
    },
    prepare(sql: string) {
      return {
        get(...params: unknown[]): unknown {
          if (sql.includes("SELECT")) {
            const key = params[0] as string;
            const entry = store.get(key);
            if (!entry) return undefined;
            return { value: entry.value, versionstamp: entry.versionstamp };
          }
          return undefined;
        },
        run(...params: unknown[]): void {
          if (sql.includes("INSERT OR REPLACE")) {
            const [key, value, versionstamp] = params as [string, string, string];
            store.set(key, { value, versionstamp });
          } else if (sql.includes("DELETE")) {
            const key = params[0] as string;
            store.delete(key);
          }
        },
        all(...params: unknown[]): unknown[] {
          const results: unknown[] = [];
          for (const [key, entry] of store) {
            let match = true;
            // Simple prefix matching for LIKE queries
            if (sql.includes("LIKE")) {
              const pattern = (params[0] as string).replace(/%$/, "");
              if (!key.startsWith(pattern)) match = false;
            }
            if (match) {
              results.push({ key, value: entry.value, versionstamp: entry.versionstamp });
            }
          }
          return results;
        },
      };
    },
    close() {
      store.clear();
    },
  };
}

describe("platform/compat/kv/sqlite-adapter", () => {
  describe("SqliteKv", () => {
    it("should construct and initialize", () => {
      const db = createMockDb();
      const kv = new SqliteKv(db);
      assertEquals(typeof kv, "object");
    });

    describe("get", () => {
      it("should return undefined for missing key", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        const result = await kv.get(["missing"]);
        assertEquals(result.value, undefined);
      });

      it("should return stored value", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["key1"], { hello: "world" });
        const result = await kv.get<{ hello: string }>(["key1"]);
        assertEquals(result.value, { hello: "world" });
      });
    });

    describe("set", () => {
      it("should store a value", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["a"], "value-a");
        const result = await kv.get<string>(["a"]);
        assertEquals(result.value, "value-a");
      });

      it("should overwrite existing value", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["a"], "old");
        await kv.set(["a"], "new");
        const result = await kv.get<string>(["a"]);
        assertEquals(result.value, "new");
      });

      it("should store complex objects", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        const complex = { nested: { arr: [1, 2, 3] }, flag: true };
        await kv.set(["complex"], complex);
        const result = await kv.get<typeof complex>(["complex"]);
        assertEquals(result.value, complex);
      });
    });

    describe("delete", () => {
      it("should delete an existing key", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["del"], "value");
        await kv.delete(["del"]);
        const result = await kv.get(["del"]);
        assertEquals(result.value, undefined);
      });

      it("should be idempotent", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.delete(["nonexistent"]);
        // Should not throw
      });
    });

    describe("list", () => {
      it("should list all entries", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["a"], "1");
        await kv.set(["b"], "2");

        const entries = [];
        for await (const entry of kv.list()) {
          entries.push(entry);
        }
        assertEquals(entries.length, 2);
      });

      it("should list with prefix filter", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["users", "1"], "alice");
        await kv.set(["users", "2"], "bob");
        await kv.set(["posts", "1"], "post");

        const entries = [];
        for await (const entry of kv.list({ prefix: ["users"] })) {
          entries.push(entry);
        }
        assertEquals(entries.length, 2);
      });

      it("should return empty for no matches", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);

        const entries = [];
        for await (const entry of kv.list({ prefix: ["nonexistent"] })) {
          entries.push(entry);
        }
        assertEquals(entries.length, 0);
      });
    });

    describe("close", () => {
      it("should close the database", () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        kv.close();
        // Should not throw
      });
    });
  });
});
