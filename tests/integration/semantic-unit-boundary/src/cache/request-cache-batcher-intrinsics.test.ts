import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { CacheBackend } from "#veryfront/cache/backend.ts";
import {
  getCachedWithBatching,
  getRequestCacheContext,
  runWithCacheBatching,
} from "#veryfront/cache/request-cache-batcher.ts";

it("does not settle cache reads through a project-mutated promise prototype", async () => {
  const backend: CacheBackend = {
    type: "memory",
    get(key: string) {
      assertEquals(key, "key");
      return Promise.resolve("backend");
    },
    set() {
      return Promise.resolve();
    },
    del() {
      return Promise.resolve();
    },
  };
  const originalThen = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
  let poisonedCalls = 0;

  await runWithCacheBatching(async () => {
    const ctx = getRequestCacheContext();
    assertExists(ctx);
    let read: Promise<string | null> | undefined;
    Object.defineProperty(Promise.prototype, "then", {
      configurable: true,
      value() {
        poisonedCalls += 1;
        return Promise.resolve("injected");
      },
    });
    try {
      read = getCachedWithBatching(backend, "key");
    } finally {
      Object.defineProperty(Promise.prototype, "then", originalThen);
    }

    assertEquals(await read, "backend");
    assertEquals(ctx.pending.size, 0);
  });
  assertEquals(poisonedCalls, 0);
});

for (const phase of ["constructor", "species"] as const) {
  it(`settles owned cache reads without live promise ${phase} hooks`, async () => {
    const backend: CacheBackend = {
      type: "memory",
      get() {
        return Promise.resolve("backend");
      },
      set() {
        return Promise.resolve();
      },
      del() {
        return Promise.resolve();
      },
    };
    const target = phase === "constructor" ? Promise.prototype : Promise;
    const key = phase === "constructor" ? "constructor" : Symbol.species;
    const original = Object.getOwnPropertyDescriptor(target, key)!;
    let poisonedCalls = 0;
    await runWithCacheBatching(async () => {
      const ctx = getRequestCacheContext();
      assertExists(ctx);
      let read: Promise<string | null> | undefined;
      Object.defineProperty(target, key, {
        configurable: true,
        get() {
          poisonedCalls += 1;
          throw new Error("project-controlled promise continuation");
        },
      });
      try {
        read = getCachedWithBatching(backend, "key");
      } finally {
        Object.defineProperty(target, key, original);
      }
      assertEquals(await read, "backend");
      assertEquals(ctx.pending.size, 0);
    });
    assertEquals(poisonedCalls, 0);
  });
}
