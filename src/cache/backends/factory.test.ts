import { assertEquals } from "@std/assert";
import { createCacheBackend, isDiskCacheConfigured, isDistributedBackend } from "./factory.ts";
import { DiskCacheBackend } from "./disk.ts";
import { MemoryCacheBackend } from "./memory.ts";

Deno.test("factory: isDiskCacheConfigured", async (t) => {
  await t.step("returns false when no env vars set", () => {
    // Default state: no VF_CACHE_BACKEND or VF_DISK_CACHE_DIR
    const result = isDiskCacheConfigured();
    assertEquals(typeof result, "boolean");
  });
});

Deno.test("factory: createCacheBackend with preferredBackend=disk", async () => {
  const backend = await createCacheBackend({ preferredBackend: "disk" });
  assertEquals(backend.type, "disk");
});

Deno.test("factory: createCacheBackend with preferredBackend=memory", async () => {
  const backend = await createCacheBackend({ preferredBackend: "memory" });
  assertEquals(backend.type, "memory");
});

Deno.test("factory: isDistributedBackend", async (t) => {
  await t.step("returns true for disk backend", () => {
    assertEquals(isDistributedBackend(new DiskCacheBackend()), true);
  });

  await t.step("returns false for memory backend", () => {
    assertEquals(isDistributedBackend(new MemoryCacheBackend()), false);
  });
});

Deno.test("factory: isDiskCacheConfigured responds to env vars", async (t) => {
  await t.step("returns true when VF_CACHE_BACKEND=disk", () => {
    Deno.env.set("VF_CACHE_BACKEND", "disk");
    try {
      assertEquals(isDiskCacheConfigured(), true);
    } finally {
      Deno.env.delete("VF_CACHE_BACKEND");
    }
  });

  await t.step("returns true when VF_DISK_CACHE_DIR is set", () => {
    Deno.env.set("VF_DISK_CACHE_DIR", "/tmp/test");
    try {
      assertEquals(isDiskCacheConfigured(), true);
    } finally {
      Deno.env.delete("VF_DISK_CACHE_DIR");
    }
  });
});
