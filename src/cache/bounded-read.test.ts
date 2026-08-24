import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runInNewContext } from "node:vm";
import type { CacheBackend } from "./types.ts";
import {
  assertCacheValueWithinLimit,
  CacheValueTooLargeError,
  captureBoundedCacheRead,
  readCacheValueWithinLimit,
} from "./bounded-read.ts";

function backend(
  getWithinLimit?: CacheBackend["getWithinLimit"],
): CacheBackend {
  return {
    type: "memory",
    get: () => Promise.resolve(null),
    ...(getWithinLimit === undefined ? {} : { getWithinLimit }),
    set: () => Promise.resolve(),
    del: () => Promise.resolve(),
  };
}

describe("bounded cache reads", () => {
  it("accepts the exact UTF-8 boundary and throws a typed overflow", () => {
    assertEquals(assertCacheValueWithinLimit("é", 2), 2);
    let error: unknown;
    try {
      assertCacheValueWithinLimit("é", 1);
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof CacheValueTooLargeError, true);
    assertEquals((error as CacheValueTooLargeError).maximumBytes, 1);
  });

  it("captures an inherited data-property method exactly once", async () => {
    class Backend {
      readonly type = "memory" as const;
      get(): Promise<string | null> {
        return Promise.resolve(null);
      }
      getWithinLimit(key: string, maximumBytes: number): Promise<string | null> {
        return Promise.resolve(`${key}:${maximumBytes}`);
      }
      set(): Promise<void> {
        return Promise.resolve();
      }
      del(): Promise<void> {
        return Promise.resolve();
      }
    }
    const value = new Backend();
    const captured = captureBoundedCacheRead(value);
    assertEquals(await captured?.getWithinLimit("key", 16), "key:16");
  });

  it("captures proxied authority once and rejects accessors without invoking them", async () => {
    let proxyTraps = 0;
    const proxied = new Proxy(backend(async () => "value"), {
      getOwnPropertyDescriptor(target, property) {
        proxyTraps++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const captured = captureBoundedCacheRead(proxied);
    assertEquals(await captured?.getWithinLimit("key", 10), "value");
    const captureTrapCount = proxyTraps;
    assertEquals(captureTrapCount > 0, true);
    assertEquals(await captured?.getWithinLimit("key", 10), "value");
    assertEquals(proxyTraps, captureTrapCount);

    let accessorReads = 0;
    const accessorBackend = backend() as CacheBackend & Record<string, unknown>;
    Object.defineProperty(accessorBackend, "getWithinLimit", {
      get() {
        accessorReads++;
        return async () => "value";
      },
    });
    assertEquals(captureBoundedCacheRead(accessorBackend), null);
    assertEquals(accessorReads, 0);
  });

  it("does not let Object.prototype fabricate a bounded-read capability", () => {
    let forgedCalls = 0;
    Object.defineProperty(Object.prototype, "getWithinLimit", {
      configurable: true,
      value: () => {
        forgedCalls++;
        return Promise.resolve("forged");
      },
    });
    try {
      assertEquals(captureBoundedCacheRead(backend()), null);
      assertEquals(forgedCalls, 0);
    } finally {
      delete (Object.prototype as Record<string, unknown>).getWithinLimit;
    }
  });

  it("does not accept a bounded reader forged on a foreign Object.prototype", () => {
    const foreign = runInNewContext(`
      Object.prototype.getWithinLimit = () => Promise.resolve("forged");
      ({});
    `);
    assertEquals(captureBoundedCacheRead(foreign), null);
  });

  it("fails closed when the capability is missing", async () => {
    await assertRejects(
      () => readCacheValueWithinLimit(backend(), "key", 8),
      TypeError,
      "exact bounded-read capability",
    );
  });

  it("post-verifies a dishonest backend result", async () => {
    await assertRejects(
      () =>
        readCacheValueWithinLimit(
          backend(() => Promise.resolve("oversized")),
          "key",
          4,
        ),
      CacheValueTooLargeError,
    );
  });

  it("returns the value on a good read and null on a miss", async () => {
    assertEquals(
      await readCacheValueWithinLimit(backend(() => Promise.resolve("ok")), "key", 8),
      "ok",
      "a within-limit backend value must be returned unchanged",
    );
    assertEquals(
      await readCacheValueWithinLimit(backend(() => Promise.resolve(null)), "key", 8),
      null,
      "a backend miss must surface as null",
    );
  });
});
