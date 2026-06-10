import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "@std/assert";
import { join } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { DiskCacheBackend } from "./disk.ts";
import {
  runCacheInvariantTests,
  testConcurrentAccess,
  testKeyCollisionResistance,
} from "../testing/invariants.ts";

const TEST_DIR = join(Deno.makeTempDirSync(), "disk-cache-test");

function makeBackend(): DiskCacheBackend {
  return new DiskCacheBackend(TEST_DIR);
}

function captureDebugLogs(): {
  entries: Array<{ message: string; args: unknown[] }>;
  restore: () => void;
} {
  const entries: Array<{ message: string; args: unknown[] }> = [];
  const target = logger as unknown as {
    debug: (message: string, ...args: unknown[]) => void;
  };
  const original = target.debug;
  target.debug = (message: string, ...args: unknown[]) => {
    entries.push({ message, args });
  };
  return {
    entries,
    restore: () => {
      target.debug = original;
    },
  };
}

/** Adapter: wraps DiskCacheBackend for the MinimalCache invariant test interface */
function makeMinimalCache() {
  const backend = makeBackend();
  return {
    get: (key: string) => backend.get(key),
    set: (key: string, value: string, ttl?: number) => backend.set(key, value, ttl),
    delete: (key: string) => backend.del(key),
  };
}

Deno.test("DiskCacheBackend invariants", async (t) => {
  const opts = {
    createCache: makeMinimalCache,
    createValue: () => `value-${Date.now()}-${Math.random()}`,
    name: "disk",
  };
  await runCacheInvariantTests(t, opts);
  await testKeyCollisionResistance(t, opts);
  await testConcurrentAccess(t, opts);
});

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

  await t.step("get returns null for invalid cache envelope fields", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "invalid-envelope-get");
    const backend = new DiskCacheBackend(isolatedDir);
    const key = "invalid-envelope";
    await backend.set(key, "value");

    const cacheDir = join(isolatedDir, "veryfront-files");
    let wroteInvalidEnvelope = false;
    for await (const file of Deno.readDir(cacheDir)) {
      if (file.isFile && file.name.endsWith(".json")) {
        await Deno.writeTextFile(
          join(cacheDir, file.name),
          JSON.stringify({ key, value: { nested: true } }),
        );
        wroteInvalidEnvelope = true;
        break;
      }
    }

    assertEquals(wroteInvalidEnvelope, true);
    assertEquals(await backend.get(key), null);
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

  await t.step("logs expired-entry cleanup failures", async () => {
    const backend = makeBackend();
    const key = "expired-cleanup-fails";
    await backend.set(key, "val", 0);
    await new Promise((r) => setTimeout(r, 5));

    const originalDel = backend.del.bind(backend);
    (backend as unknown as { del: (entryKey: string) => Promise<void> }).del = (entryKey: string) =>
      entryKey === key ? Promise.reject(new Error("delete rejected")) : originalDel(entryKey);

    const debugCapture = captureDebugLogs();
    try {
      assertEquals(await backend.get(key), null);
      await Promise.resolve();

      assertEquals(debugCapture.entries.length, 1);
      assertEquals(debugCapture.entries[0]?.message, "[DiskCache] Expired entry cleanup failed");
      assertEquals(
        (debugCapture.entries[0]?.args[0] as Record<string, unknown> | undefined)?.key,
        key,
      );
    } finally {
      debugCapture.restore();
      (backend as unknown as { del: (entryKey: string) => Promise<void> }).del = originalDel;
    }
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
    const isolatedDir = join(Deno.makeTempDirSync(), "delbypattern-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("user:1:name", "alice");
    await backend.set("user:2:name", "bob");
    await backend.set("other:key", "value");
    const deleted = await backend.delByPattern("user:*");
    assertEquals(deleted, 2);
    assertEquals(await backend.get("user:1:name"), null);
    assertEquals(await backend.get("user:2:name"), null);
    assertEquals(await backend.get("other:key"), "value");
  });

  await t.step("delByPattern skips invalid cache envelope fields", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "invalid-envelope-delbypattern");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("user:valid", "value");
    await backend.set("user:invalid", "value");

    const cacheDir = join(isolatedDir, "veryfront-files");
    for await (const file of Deno.readDir(cacheDir)) {
      if (!file.isFile || !file.name.endsWith(".json")) continue;
      const filePath = join(cacheDir, file.name);
      const raw = await Deno.readTextFile(filePath);
      const parsed = JSON.parse(raw) as { key?: string };
      if (parsed.key === "user:invalid") {
        await Deno.writeTextFile(
          filePath,
          JSON.stringify({ key: "user:invalid", value: { nested: true } }),
        );
        break;
      }
    }

    const deleted = await backend.delByPattern("user:*");
    assertEquals(deleted, 1);
    assertEquals(await backend.get("user:valid"), null);
    assertEquals(await backend.get("user:invalid"), null);
  });

  await t.step("overwrite existing key", async () => {
    const backend = makeBackend();
    await backend.set("overwrite", "v1");
    assertEquals(await backend.get("overwrite"), "v1");
    await backend.set("overwrite", "v2");
    assertEquals(await backend.get("overwrite"), "v2");
  });

  await t.step("concurrent writes to same key are safe", async () => {
    const backend = makeBackend();
    await Promise.all([
      backend.set("race", "value-a"),
      backend.set("race", "value-b"),
    ]);
    const result = await backend.get("race");
    assertEquals(result === "value-a" || result === "value-b", true);
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

  await t.step("delByPattern with no matching keys returns 0", async () => {
    const backend = makeBackend();
    await backend.set("keep:this", "value");
    const deleted = await backend.delByPattern("nomatch:*");
    assertEquals(deleted, 0);
    assertEquals(await backend.get("keep:this"), "value");
  });

  await t.step("delByPattern rejects excessive wildcards", async () => {
    const backend = makeBackend();
    await backend.set("keep:a", "1");
    await backend.set("keep:b", "2");
    const deleted = await backend.delByPattern("*".repeat(65));
    assertEquals(deleted, 0);
    assertEquals(await backend.get("keep:a"), "1");
    assertEquals(await backend.get("keep:b"), "2");
  });

  await t.step("delByPattern rejects backtracking-shaped glob misses", async () => {
    const backend = makeBackend();
    const longKey = "a".repeat(1000);
    await backend.set(longKey, "1");
    const deleted = await backend.delByPattern(`${"a*".repeat(20)}b`);
    assertEquals(deleted, 0);
    assertEquals(await backend.get(longKey), "1");
  });

  await t.step("delByPattern on empty directory returns 0", async () => {
    const emptyDir = join(Deno.makeTempDirSync(), "empty-cache");
    const backend = new DiskCacheBackend(emptyDir);
    const deleted = await backend.delByPattern("*");
    assertEquals(deleted, 0);
  });

  await t.step("type property is 'disk'", () => {
    const backend = makeBackend();
    assertEquals(backend.type, "disk");
  });
});
