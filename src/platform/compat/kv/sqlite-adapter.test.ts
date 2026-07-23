import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { SqliteDatabase } from "./types.ts";

function createMockDb(): SqliteDatabase & {
  store: Map<string, { value: string; versionstamp?: string }>;
  queries: string[];
} {
  const store = new Map<string, { value: string; versionstamp?: string }>();
  const queries: string[] = [];
  let metadataVersionstamp: string | undefined;

  return {
    store,
    queries,
    exec(_sql: string) {
      // No-op for CREATE TABLE
    },
    prepare(sql: string) {
      queries.push(sql);
      return {
        get(...params: unknown[]): unknown {
          if (sql.includes("veryfront_kv_metadata")) {
            const candidate = params[0] as string;
            metadataVersionstamp = metadataVersionstamp && metadataVersionstamp >= candidate
              ? (BigInt(metadataVersionstamp) + 1n).toString().padStart(20, "0")
              : candidate;
            return { value: metadataVersionstamp };
          }
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

      it("should read the existing JSON-encoded key layout", async () => {
        const db = createMockDb();
        db.store.set('["existing","key"]', {
          value: JSON.stringify({ compatible: true }),
          versionstamp: "existing-version",
        });
        const kv = new SqliteKv(db);

        const result = await kv.get<{ compatible: boolean }>(["existing", "key"]);

        assertEquals(result, {
          value: { compatible: true },
          versionstamp: "existing-version",
        });
      });

      it("should sanitize database provider failures", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        db.prepare = () => {
          throw new Error("Database provider failed: <REDACTED>");
        };

        let caught: unknown;
        try {
          await kv.get(["key"]);
        } catch (error) {
          caught = error;
        }

        if (!(caught instanceof VeryfrontError)) {
          throw new Error("Expected a typed Veryfront error");
        }
        assertEquals(caught.slug, "platform-error");
        assertEquals(caught.message, "KV database operation failed");
      });

      it("should sanitize hostile row accessors", async () => {
        const db = createMockDb();
        const originalPrepare = db.prepare.bind(db);
        const kv = new SqliteKv(db);
        db.prepare = (sql) => {
          const statement = originalPrepare(sql);
          if (!sql.startsWith("SELECT value")) return statement;
          statement.get = () =>
            Object.defineProperty({}, "value", {
              get() {
                throw new Error("PRIVATE_ROW_GETTER");
              },
            });
          return statement;
        };

        const error = await assertRejects(() => kv.get(["key"]), VeryfrontError);

        assertEquals(error.message, "KV database operation failed");
        assertEquals(error.message.includes("PRIVATE_ROW_GETTER"), false);
        assertEquals(error.cause, undefined);
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

      it("should preserve the JSON-encoded key storage layout", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);

        await kv.set(["stored", "key"], "value");

        assertEquals(db.store.has('["stored","key"]'), true);
      });

      it("advances lexically beyond legacy millisecond versionstamps", async () => {
        const db = createMockDb();
        const legacyVersionstamp = "1700000000000";
        db.store.set('["legacy"]', {
          value: JSON.stringify("old"),
          versionstamp: legacyVersionstamp,
        });
        const kv = new SqliteKv(db);

        await kv.set(["legacy"], "new");
        const updatedVersionstamp = (await kv.get(["legacy"])).versionstamp!;

        assertEquals(legacyVersionstamp < updatedVersionstamp, true);
        kv.close();
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

      it("should allocate unique versionstamps across adapters sharing a database", async () => {
        const db = createMockDb();
        const first = new SqliteKv(db);
        const second = new SqliteKv(db);
        const originalNow = Date.now;
        Date.now = () => 1_700_000_000_000;

        try {
          await first.set(["first"], 1);
          await second.set(["second"], 2);
          const firstVersion = (await first.get(["first"])).versionstamp!;
          const secondVersion = (await second.get(["second"])).versionstamp!;

          assertEquals(firstVersion < secondVersion, true);
        } finally {
          Date.now = originalNow;
          first.close();
        }
      });

      it("allocates the versionstamp and writes the value in one immediate transaction", async () => {
        const db = createMockDb();
        const events: string[] = [];
        const originalExec = db.exec.bind(db);
        const originalPrepare = db.prepare.bind(db);
        db.exec = (sql) => {
          const statement = sql.trim();
          if (["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"].includes(statement)) {
            events.push(statement);
          }
          originalExec(sql);
        };
        db.prepare = (sql) => {
          const statement = originalPrepare(sql);
          if (sql.includes("veryfront_kv_metadata")) {
            const originalGet = statement.get.bind(statement);
            statement.get = (...params) => {
              events.push("allocate");
              return originalGet(...params);
            };
          } else if (sql.includes("INSERT OR REPLACE")) {
            const originalRun = statement.run.bind(statement);
            statement.run = (...params) => {
              events.push("write");
              originalRun(...params);
            };
          }
          return statement;
        };
        const kv = new SqliteKv(db);
        events.length = 0;

        await kv.set(["same-key"], "value");

        assertEquals(events, ["BEGIN IMMEDIATE", "allocate", "write", "COMMIT"]);
        kv.close();
      });

      it("rolls back an allocated versionstamp when the value write fails", async () => {
        const db = createMockDb();
        const events: string[] = [];
        const originalExec = db.exec.bind(db);
        const originalPrepare = db.prepare.bind(db);
        db.exec = (sql) => {
          const statement = sql.trim();
          if (["BEGIN IMMEDIATE", "COMMIT", "ROLLBACK"].includes(statement)) {
            events.push(statement);
          }
          originalExec(sql);
        };
        db.prepare = (sql) => {
          const statement = originalPrepare(sql);
          if (sql.includes("INSERT OR REPLACE")) {
            statement.run = () => {
              throw new Error("PRIVATE_WRITE_FAILURE");
            };
          }
          return statement;
        };
        const kv = new SqliteKv(db);
        events.length = 0;

        const error = await assertRejects(
          () => kv.set(["same-key"], "value"),
          VeryfrontError,
        );

        assertEquals(events, ["BEGIN IMMEDIATE", "ROLLBACK"]);
        assertEquals(error.message, "KV database operation failed");
        assertEquals(error.message.includes("PRIVATE_WRITE_FAILURE"), false);
        kv.close();
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

      it("plans prefix selection as an indexed key range", async () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);

        for await (const _entry of kv.list({ prefix: ["users"] })) {
          // Iteration prepares the query.
        }

        const query = db.queries.find((candidate) => candidate.startsWith("SELECT key"))!;
        assertEquals(query.includes("substr("), false);
        assertEquals(query.match(/key >= \?/g)?.length, 1);
        assertEquals(query.match(/key < \?/g)?.length, 1);
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

      it("should sanitize hostile list row accessors", async () => {
        const db = createMockDb();
        const originalPrepare = db.prepare.bind(db);
        const kv = new SqliteKv(db);
        db.prepare = (sql) => {
          const statement = originalPrepare(sql);
          if (!sql.startsWith("SELECT key")) return statement;
          statement.all = () => [
            Object.defineProperty({}, "key", {
              get() {
                throw new Error("PRIVATE_LIST_ROW_GETTER");
              },
            }),
          ];
          return statement;
        };

        const error = await assertRejects(
          async () => {
            for await (const _entry of kv.list()) {
              // Iteration triggers the provider boundary.
            }
          },
          VeryfrontError,
        );

        assertEquals(error.message, "KV database operation failed");
        assertEquals(error.message.includes("PRIVATE_LIST_ROW_GETTER"), false);
        assertEquals(error.cause, undefined);
      });
    });

    describe("close", () => {
      it("should close the database", () => {
        const db = createMockDb();
        const kv = new SqliteKv(db);
        kv.close();
        // Should not throw
      });

      it("remains closed when the database close operation fails", async () => {
        const db = createMockDb();
        let closeCalls = 0;
        db.close = () => {
          closeCalls++;
          throw new Error("PRIVATE_CLOSE_FAILURE");
        };
        const kv = new SqliteKv(db);

        assertThrows(() => kv.close(), VeryfrontError, "KV database operation failed");
        const readError = await assertRejects(() => kv.get(["requested"]), VeryfrontError);
        kv.close();

        assertEquals(readError.message, "KV store is closed");
        assertEquals(closeCalls, 1);
      });
    });
  });
});
