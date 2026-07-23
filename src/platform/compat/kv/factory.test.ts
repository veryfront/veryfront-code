import "#veryfront/schemas/_test-setup.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { SqliteStore } from "#veryfront/extensions/compat/native-services.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createKVStore, openKv, openKvWithBackends, polyfillDenoKv } from "./factory.ts";
import { MemoryKv } from "./memory-adapter.ts";
import type { NativeKvBackend } from "./native-adapter.ts";
import type { SqliteDatabase } from "./types.ts";

function createDatabase(): SqliteDatabase {
  return {
    exec() {},
    prepare() {
      return {
        get: () => undefined,
        run() {},
        all: () => [],
      };
    },
    close() {},
  };
}

function createNativeBackend(): NativeKvBackend {
  return {
    get: (key) => Promise.resolve({ key, value: null, versionstamp: null }),
    set: () => Promise.resolve({ ok: true, versionstamp: "1" }),
    delete: () => Promise.resolve(),
    async *list() {
      // Empty test backend.
    },
    close() {},
  };
}

describe("kv/factory", () => {
  describe("openKv", () => {
    it("should export openKv function", () => {
      assertExists(openKv);
      assertEquals(typeof openKv, "function");
    });

    it("should return a KV store", async () => {
      const kv = await openKv(":memory:");
      assertExists(kv);
      assertExists(kv.get);
      assertExists(kv.set);
      assertExists(kv.delete);
      assertExists(kv.list);
      assertExists(kv.close);
      kv.close();
    });
  });

  describe("createKVStore", () => {
    it("should export createKVStore function", () => {
      assertExists(createKVStore);
      assertEquals(typeof createKVStore, "function");
    });

    it("should create a KV store", async () => {
      const kv = await createKVStore({ path: ":memory:" });
      assertExists(kv);
      assertExists(kv.get);
      assertExists(kv.set);
      kv.close();
    });

    it("forwards a pinned backend through the public factory", async () => {
      const deno = Reflect.get(globalThis, "Deno") as Record<PropertyKey, unknown>;
      const openKvDescriptor = Object.getOwnPropertyDescriptor(deno, "openKv");
      const existingSqliteStore = tryResolve<SqliteStore>("SqliteStore");
      let nativeCalls = 0;
      let sqliteCalls = 0;
      Reflect.set(deno, "openKv", () => {
        nativeCalls++;
        return Promise.resolve(createNativeBackend());
      });
      register<SqliteStore>("SqliteStore", {
        openSqliteDatabase: () => {
          sqliteCalls++;
          return Promise.resolve(createDatabase());
        },
      });

      try {
        const sqlite = await createKVStore({ path: "data.db", backend: "sqlite" });
        sqlite.close();
        assertEquals(nativeCalls, 0);
        assertEquals(sqliteCalls, 1);

        const native = await createKVStore({ path: "data.db", backend: "native" });
        native.close();
        assertEquals(nativeCalls, 1);
        assertEquals(sqliteCalls, 1);
      } finally {
        if (openKvDescriptor) Object.defineProperty(deno, "openKv", openKvDescriptor);
        else Reflect.deleteProperty(deno, "openKv");
        if (existingSqliteStore) register("SqliteStore", existingSqliteStore);
        else unregister("SqliteStore");
      }
    });
  });

  describe("polyfillDenoKv", () => {
    it("should export polyfillDenoKv function", () => {
      assertExists(polyfillDenoKv);
      assertEquals(typeof polyfillDenoKv, "function");
    });

    it("installs the portable subset when native Deno KV is unavailable", async () => {
      const runtime = Reflect.get(globalThis, "Deno") as Record<PropertyKey, unknown> | undefined;
      const existingDescriptor = runtime && Object.getOwnPropertyDescriptor(runtime, "openKv");

      try {
        polyfillDenoKv();
        const deno = Reflect.get(globalThis, "Deno") as Record<PropertyKey, unknown>;
        const installed = Reflect.get(deno, "openKv") as
          | ((path?: string) => Promise<{ close(): void }>)
          | undefined;

        assertEquals(typeof installed, "function");
        if (!existingDescriptor) {
          const kv = await installed!(":memory:");
          kv.close();
        }
      } finally {
        const deno = Reflect.get(globalThis, "Deno") as Record<PropertyKey, unknown> | undefined;
        if (deno && existingDescriptor) {
          Object.defineProperty(deno, "openKv", existingDescriptor);
        } else if (deno) {
          Reflect.deleteProperty(deno, "openKv");
        }
      }
    });
  });

  describe("KV store operations", () => {
    it("should support get/set/delete operations", async () => {
      const kv = await openKv(":memory:");
      await kv.set(["test", "kvfactory"], "value123");
      const result = await kv.get(["test", "kvfactory"]);
      assertExists(result);
      assertEquals(result.value, "value123");
      await kv.delete(["test", "kvfactory"]);
      const deleted = await kv.get(["test", "kvfactory"]);
      assertEquals(deleted.value, undefined);
      await kv.close();
    });

    it("should support list operation", async () => {
      const kv = await openKv(":memory:");
      await kv.set(["list", "a"], "1");
      await kv.set(["list", "b"], "2");
      const entries: unknown[] = [];
      for await (const entry of kv.list({ prefix: ["list"] })) {
        entries.push(entry);
      }
      assertEquals(entries.length >= 2, true);
      await kv.delete(["list", "a"]);
      await kv.delete(["list", "b"]);
      kv.close();
    });

    it("should create store with createKVStore", async () => {
      const kv = await createKVStore({ path: ":memory:" });
      assertExists(kv.get);
      assertExists(kv.set);
      kv.close();
    });
  });

  describe("backend selection", () => {
    it("pins SQLite when both durable backends are available", async () => {
      let nativeCalls = 0;
      let sqliteCalls = 0;
      const kv = await openKvWithBackends("data.db", { backend: "sqlite" } as never, {
        nativeOpenKv: () => {
          nativeCalls++;
          return Promise.reject(new Error("Native backend must not be opened"));
        },
        sqliteStore: {
          openSqliteDatabase: () => {
            sqliteCalls++;
            return Promise.resolve(createDatabase());
          },
        },
      });

      assertEquals(nativeCalls, 0);
      assertEquals(sqliteCalls, 1);
      kv.close();
    });

    it("does not fall back when a pinned backend is unavailable", async () => {
      const error = await assertRejects(() =>
        openKvWithBackends(
          "data.db",
          { backend: "native", fallback: "memory" } as never,
          {},
        )
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "invalid-argument");
    });

    it("uses memory only when requested or when preserving the pathless API", async () => {
      const explicit = await openKvWithBackends(":memory:", undefined, {});
      const compatible = await openKvWithBackends(undefined, undefined, {});

      assertInstanceOf(explicit, MemoryKv);
      assertInstanceOf(compatible, MemoryKv);
      explicit.close();
      compatible.close();
    });

    it("rejects a persistent path when no durable backend is available", async () => {
      const error = await assertRejects(() => openKvWithBackends("data.db", undefined, {}));

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "initialization-error");
      assertEquals(error.message.includes("data.db"), false);
    });

    it("allows an explicit memory policy only when no backend is available", async () => {
      const kv = await openKvWithBackends("data.db", { fallback: "memory" }, {});

      assertInstanceOf(kv, MemoryKv);
      kv.close();
    });

    it("does not reinterpret a native backend failure through SQLite or memory", async () => {
      let sqliteCalls = 0;
      const secret = "PRIVATE_NATIVE_FAILURE";
      const error = await assertRejects(() =>
        openKvWithBackends("data.db", { fallback: "memory" }, {
          nativeOpenKv: () => Promise.reject(new Error(secret)),
          sqliteStore: {
            openSqliteDatabase: () => {
              sqliteCalls++;
              return Promise.resolve(createDatabase());
            },
          },
        })
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "initialization-error");
      assertEquals(error.message.includes(secret), false);
      assertEquals((error as VeryfrontError).cause, undefined);
      assertEquals(sqliteCalls, 0);
    });

    it("does not hide a configured SQLite backend failure with memory", async () => {
      const secret = "PRIVATE_SQLITE_FAILURE";
      const error = await assertRejects(() =>
        openKvWithBackends(undefined, { fallback: "memory" }, {
          sqliteStore: {
            openSqliteDatabase: () => Promise.reject(new Error(secret)),
          },
        })
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "initialization-error");
      assertEquals(error.message.includes(secret), false);
      assertEquals((error as VeryfrontError).cause, undefined);
    });

    it("closes a native store that fails adapter validation", async () => {
      let closeCalls = 0;
      const invalidStore = {
        close() {
          closeCalls++;
        },
      } as never;

      await assertRejects(() =>
        openKvWithBackends(undefined, undefined, {
          nativeOpenKv: () => Promise.resolve(invalidStore),
        })
      );

      assertEquals(closeCalls, 1);
    });

    it("awaits and sanitizes asynchronous cleanup of a rejected native store", async () => {
      let thenCalls = 0;
      const invalidStore = {
        close() {
          return {
            then(_resolve: () => void, reject: (error: Error) => void) {
              thenCalls++;
              reject(new Error("PRIVATE_ASYNC_CLOSE"));
            },
          };
        },
      } as never;

      const error = await assertRejects(() =>
        openKvWithBackends(undefined, undefined, {
          nativeOpenKv: () => Promise.resolve(invalidStore),
        })
      );

      assertEquals(thenCalls, 1);
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.message.includes("PRIVATE_ASYNC_CLOSE"), false);
    });

    it("closes a SQLite database when adapter initialization fails", async () => {
      let closeCalls = 0;
      const database = createDatabase();
      database.exec = () => {
        throw new Error("PRIVATE_INITIALIZATION_FAILURE");
      };
      database.close = () => {
        closeCalls++;
      };

      await assertRejects(() =>
        openKvWithBackends(undefined, undefined, {
          sqliteStore: {
            openSqliteDatabase: () => Promise.resolve(database),
          },
        })
      );

      assertEquals(closeCalls, 1);
    });

    it("wraps an available SQLite backend without changing its path", async () => {
      let receivedPath: string | undefined;
      const database = createDatabase();
      const kv = await openKvWithBackends("data.db", undefined, {
        sqliteStore: {
          openSqliteDatabase: (path) => {
            receivedPath = path;
            return Promise.resolve(database);
          },
        },
      });

      assertEquals(receivedPath, "data.db");
      kv.close();
    });

    it("rejects invalid fallback policies before selecting a backend", async () => {
      const error = await assertRejects(() =>
        openKvWithBackends(undefined, { fallback: "PRIVATE_POLICY" } as never, {})
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "invalid-argument");
      assertEquals(error.message.includes("PRIVATE_POLICY"), false);
    });

    it("sanitizes unreadable option containers at both public factory boundaries", async () => {
      const createOptions = Proxy.revocable({}, {});
      createOptions.revoke();
      const openOptions = Proxy.revocable({}, {});
      openOptions.revoke();

      const createError = await assertRejects(async () => {
        await createKVStore(createOptions.proxy);
      });
      const openError = await assertRejects(() =>
        openKvWithBackends(undefined, openOptions.proxy, {})
      );

      for (const error of [createError, openError]) {
        assertInstanceOf(error, VeryfrontError);
        assertEquals((error as VeryfrontError).slug, "invalid-argument");
        assertEquals(error.message.includes("Proxy"), false);
      }
    });

    it("sanitizes an unreadable backend selector", async () => {
      const options = Object.defineProperty({}, "backend", {
        get() {
          throw new Error("PRIVATE_BACKEND_GETTER");
        },
      });

      const error = await assertRejects(() => createKVStore(options));

      assertInstanceOf(error, VeryfrontError);
      assertEquals((error as VeryfrontError).slug, "invalid-argument");
      assertEquals(error.message.includes("PRIVATE_BACKEND_GETTER"), false);
    });
  });
});
