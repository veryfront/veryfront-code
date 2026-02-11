import { assertEquals } from "@std/assert";
import { join } from "#veryfront/compat/path/index.ts";
import { DiskCacheBackend } from "./disk.ts";

const TEST_DIR = join(Deno.makeTempDirSync(), "disk-cache-test");

function makeBackend(): DiskCacheBackend {
  return new DiskCacheBackend(TEST_DIR);
}

Deno.test("DiskCacheBackend", async (t) => {
  await t.step("get returns null for missing key", async () => {
    const backend = makeBackend();
    assertEquals(await backend.get("nonexistent"), null);
  });

  await t.step("set and get round-trip", async () => {
    const backend = makeBackend();
    await backend.set("hello", "world");
    assertEquals(await backend.get("hello"), "world");
  });

  await t.step("del removes a key", async () => {
    const backend = makeBackend();
    await backend.set("to-delete", "value");
    assertEquals(await backend.get("to-delete"), "value");
    await backend.del("to-delete");
    assertEquals(await backend.get("to-delete"), null);
  });

  await t.step("del on nonexistent key does not throw", async () => {
    const backend = makeBackend();
    await backend.del("never-existed");
  });

  await t.step("TTL=0 expires very quickly", async () => {
    const backend = makeBackend();
    await backend.set("ttl-zero", "val", 0);
    // TTL=0 means expiresAt = Date.now() + 0; wait 1ms to ensure it's expired
    await new Promise((r) => setTimeout(r, 5));
    assertEquals(await backend.get("ttl-zero"), null);
  });

  await t.step("TTL non-expired returns value", async () => {
    const backend = makeBackend();
    await backend.set("ttl-long", "val", 3600);
    assertEquals(await backend.get("ttl-long"), "val");
  });

  await t.step("short TTL expires after delay", async () => {
    const backend = makeBackend();
    await backend.set("ttl-short", "val", 1);
    assertEquals(await backend.get("ttl-short"), "val");
    await new Promise((r) => setTimeout(r, 1100));
    assertEquals(await backend.get("ttl-short"), null);
  });

  await t.step("no TTL means never expire", async () => {
    const backend = makeBackend();
    await backend.set("no-ttl", "forever");
    assertEquals(await backend.get("no-ttl"), "forever");
  });

  await t.step("keys with path separators", async () => {
    const backend = makeBackend();
    await backend.set("a/b/c", "nested");
    assertEquals(await backend.get("a/b/c"), "nested");
  });

  await t.step("keys with special characters", async () => {
    const backend = makeBackend();
    const key = "special:chars!@#$%^&*()=+[]{}|;',.<>?";
    await backend.set(key, "special-value");
    assertEquals(await backend.get(key), "special-value");
  });

  await t.step("delByPattern removes matching keys", async () => {
    const backend = makeBackend();
    await backend.set("user:1:name", "alice");
    await backend.set("user:2:name", "bob");
    await backend.set("other:key", "value");
    const deleted = await backend.delByPattern("user:*");
    assertEquals(deleted, 2);
    assertEquals(await backend.get("user:1:name"), null);
    assertEquals(await backend.get("user:2:name"), null);
    assertEquals(await backend.get("other:key"), "value");
  });

  await t.step("overwrite existing key", async () => {
    const backend = makeBackend();
    await backend.set("overwrite", "v1");
    assertEquals(await backend.get("overwrite"), "v1");
    await backend.set("overwrite", "v2");
    assertEquals(await backend.get("overwrite"), "v2");
  });

  await t.step("concurrent writes to different keys", async () => {
    const backend = makeBackend();
    const writes = Array.from(
      { length: 10 },
      (_, i) => backend.set(`concurrent-${i}`, `value-${i}`),
    );
    await Promise.all(writes);
    for (let i = 0; i < 10; i++) {
      assertEquals(await backend.get(`concurrent-${i}`), `value-${i}`);
    }
  });

  await t.step("large value", async () => {
    const backend = makeBackend();
    const largeValue = "x".repeat(100_000);
    await backend.set("large", largeValue);
    assertEquals(await backend.get("large"), largeValue);
  });

  await t.step("type property is 'disk'", () => {
    const backend = makeBackend();
    assertEquals(backend.type, "disk");
  });
});
