import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import {
  createCacheBackend,
  createDistributedCacheAccessor,
  isDiskCacheConfigured,
  isDistributedBackend,
} from "./factory.ts";
import { DiskCacheBackend } from "./disk.ts";
import { MemoryCacheBackend } from "./memory.ts";

describe("cache backend factory", () => {
  it("reports whether disk caching is configured", () => {
    // Default state: no VF_CACHE_BACKEND or VF_DISK_CACHE_DIR
    const result = isDiskCacheConfigured();
    assertEquals(typeof result, "boolean");
  });

  it("creates an explicitly preferred disk backend", async () => {
    const backend = await createCacheBackend({ preferredBackend: "disk" });
    assertEquals(backend.type, "disk");
  });

  it("creates an explicitly preferred memory backend", async () => {
    const backend = await createCacheBackend({ preferredBackend: "memory" });
    assertEquals(backend.type, "memory");
  });

  it("classifies disk as distributed", () => {
    assertEquals(isDistributedBackend(new DiskCacheBackend()), true);
  });

  it("classifies memory as local", () => {
    assertEquals(isDistributedBackend(new MemoryCacheBackend()), false);
  });

  it("recognizes VF_CACHE_BACKEND=disk", () => {
    setEnv("VF_CACHE_BACKEND", "disk");
    try {
      assertEquals(isDiskCacheConfigured(), true);
    } finally {
      deleteEnv("VF_CACHE_BACKEND");
    }
  });

  it("recognizes VF_DISK_CACHE_DIR", () => {
    setEnv("VF_DISK_CACHE_DIR", "test-cache-dir");
    try {
      assertEquals(isDiskCacheConfigured(), true);
    } finally {
      deleteEnv("VF_DISK_CACHE_DIR");
    }
  });

  it("isolates memoized distributed backends by scope", async () => {
    const first = new DiskCacheBackend();
    const second = new DiskCacheBackend();
    let scope = "first";
    let callCount = 0;
    const accessor = createDistributedCacheAccessor(
      () => Promise.resolve(callCount++ === 0 ? first : second),
      "test-scoped",
      () => scope,
    );

    assertEquals(await accessor(), first);
    scope = "second";
    assertEquals(await accessor(), second);
    scope = "first";
    assertEquals(await accessor(), first);
    assertEquals(callCount, 2);
  });

  it("bounds scoped state while every factory is pending", async () => {
    const backend = new DiskCacheBackend();
    const resolveFactories: Array<() => void> = [];
    let scope = "";
    let callCount = 0;
    const accessor = createDistributedCacheAccessor(
      () => {
        callCount++;
        return new Promise((resolve) => {
          resolveFactories.push(() => resolve(backend));
        });
      },
      "test-scoped-capacity",
      () => scope,
    );

    const initial = Array.from({ length: 129 }, (_, index) => {
      scope = `scope-${index}`;
      return accessor();
    });
    assertEquals(callCount, 129);

    for (const resolve of resolveFactories.splice(0)) resolve();
    await Promise.all(initial);

    scope = "scope-0";
    const revisited = accessor();
    assertEquals(callCount, 130);
    resolveFactories.shift()?.();
    await revisited;
  });
});
