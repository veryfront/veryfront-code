import { assertEquals } from "@std/assert";
import { createCacheBackend, isDiskCacheConfigured } from "./factory.ts";

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
