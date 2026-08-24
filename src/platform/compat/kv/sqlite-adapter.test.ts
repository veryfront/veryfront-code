import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { SqliteDatabase } from "./types.ts";

function createMockDb(): SqliteDatabase & {
  store: Map<string, { value: string; versionstamp?: string }>;
  execCalls: string[];
} {
  const store = new Map<string, { value: string; versionstamp?: string }>();
  const execCalls: string[] = [];

  return {
    store,
    execCalls,
    exec(sql: string) {
      execCalls.push(sql);
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
          let parameterIndex = 0;
          let exactPrefix: string | undefined;
          let descendantPrefix: string | undefined;
          if (sql.includes("substr(key")) {
            exactPrefix = params[parameterIndex++] as string;
            descendantPrefix = params[parameterIndex++] as string;
            parameterIndex++; // The second descendant-prefix parameter is identical.
          }
          const start = sql.includes("key >= ?") ? params[parameterIndex++] as string : undefined;
          const end = sql.includes("key < ?") ? params[parameterIndex++] as string : undefined;
          const limit = sql.includes("LIMIT ?") ? params[parameterIndex] as number : undefined;

          const results: Array<{ key: string; value: string; versionstamp?: string }> = [];
          for (const [key, entry] of store) {
            if (
              exactPrefix !== undefined &&
              key !== exactPrefix &&
              !key.startsWith(descendantPrefix!)
            ) continue;
            if (start !== undefined && key < start) continue;
            if (end !== undefined && key >= end) continue;
            results.push({ key, value: entry.value, versionstamp: entry.versionstamp });
          }
          results.sort((a, b) => a.key.localeCompare(b.key));
          if (sql.includes("ORDER BY key DESC")) results.reverse();
          return limit === undefined ? results : results.slice(0, limit);
        },
      };
    },
    close() {
      store.clear();
    },
  };
}

async function collectEntries<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const entries: T[] = [];
  for await (const entry of iterable) entries.push(entry);
  return entries;
}

describe("platform/compat/kv/sqlite-adapter", () => {
  describe("SqliteKv", () => {
    it("creates the kv_store table on construction", () => {
      const db = createMockDb();
      new SqliteKv(db);
      assertEquals(
        db.execCalls.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS kv_store")),
        true,
        "the SqliteKv constructor must create the kv_store table",
      );
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
        assertEquals(
          entries.map((entry) => [entry.key.join("/"), entry.value]),
          [["a", "1"], ["b", "2"]],
          "list must deserialize stored values, not yield raw JSON",
        );
      });

      it("deserializes object values when listing", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["obj"], { nested: { n: 1 } });

        const entries = await collectEntries(kv.list());
        assertEquals(entries.length, 1, "one entry was stored");
        assertEquals(
          entries[0]?.value,
          { nested: { n: 1 } },
          "list must yield the stored object rather than its JSON string",
        );
      });

      it("honours start, end and reverse options", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["a"], 1);
        await kv.set(["b"], 2);
        await kv.set(["c"], 3);

        assertEquals(
          (await collectEntries(kv.list({ start: ["b"] }))).map((e) => e.key[0]),
          ["b", "c"],
          "start is an inclusive lower bound",
        );
        assertEquals(
          (await collectEntries(kv.list({ end: ["b"] }))).map((e) => e.key[0]),
          ["a"],
          "end is an exclusive upper bound",
        );
        assertEquals(
          (await collectEntries(kv.list({ reverse: true }))).map((e) => e.key[0]),
          ["c", "b", "a"],
          "reverse yields descending key order",
        );
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

      it("matches prefixes by complete key parts", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["a"], "exact");
        await kv.set(["a", "child"], "child");
        await kv.set(["ab"], "collision");

        const entries = await collectEntries(kv.list({ prefix: ["a"] }));
        assertEquals(entries.map((entry) => entry.key.join("/")).sort(), ["a", "a/child"]);
      });

      it("treats a zero limit as an empty result", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await kv.set(["a"], 1);

        assertEquals(await collectEntries(kv.list({ limit: 0 })), []);
      });

      it("rejects invalid limits", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);

        for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
          await assertRejects(
            () => collectEntries(kv.list({ limit })),
            RangeError,
            "non-negative safe integer",
          );
        }
      });
    });

    describe("versionstamps", () => {
      it("generates a distinct versionstamp for every write", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        const originalNow = Date.now;
        Date.now = () => 123;
        try {
          await kv.set(["key"], "first");
          const first = (await kv.get(["key"])).versionstamp;
          await kv.set(["key"], "second");
          const second = (await kv.get(["key"])).versionstamp;

          assertExists(first);
          assertExists(second);
          assertEquals(first === second, false);
        } finally {
          Date.now = originalNow;
        }
      });
    });

    describe("contract validation", () => {
      it("rejects values without a JSON representation", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await assertRejects(
          () => kv.set(["undefined"], undefined),
          TypeError,
          "JSON-serializable",
        );
      });

      it("rejects sparse keys instead of storing unreadable entries", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        await assertRejects(
          () => kv.set(new Array<string>(1), "value"),
          TypeError,
          "arrays of strings",
        );
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
