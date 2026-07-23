import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
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

  await t.step("validates constructor paths, keys, values, and TTLs", async () => {
    assertThrows(() => new DiskCacheBackend("bad\0path"));

    const baseDir = Deno.makeTempDirSync();
    const backend = new DiskCacheBackend(baseDir, "../../outside");
    const internalDir = (backend as unknown as { dir: string }).dir;
    assertEquals(internalDir.startsWith(join(baseDir, "veryfront-files")), true);
    assertEquals(internalDir.includes(".."), false);

    await assertRejects(() => backend.set("key", "value", -1));
    await assertRejects(() => backend.set("bad\nkey", "value"));
  });

  await t.step("set and get round-trip", async () => {
    const backend = makeBackend();
    await backend.set("hello", "world");
    assertEquals(await backend.get("hello"), "world");
  });

  await t.step("set repairs an existing cache directory's permissions", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = Deno.makeTempDirSync();
    const cacheDir = join(baseDir, "veryfront-files");
    await Deno.mkdir(cacheDir, { recursive: true });
    await Deno.chmod(cacheDir, 0o777);

    const backend = new DiskCacheBackend(baseDir);
    await backend.set("permission-test", "value");

    const mode = (await Deno.stat(cacheDir)).mode;
    assertEquals(mode === null ? null : mode & 0o077, 0);
  });

  await t.step("refuses generated cache directories that are symbolic links", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = Deno.makeTempDirSync();
    const targetDir = Deno.makeTempDirSync();
    await Deno.symlink(targetDir, join(baseDir, "veryfront-files"));
    const backend = new DiskCacheBackend(baseDir);

    await assertRejects(() => backend.set("symlink-test", "value"));
    assertEquals(Array.from(Deno.readDirSync(targetDir)).length, 0);
  });

  await t.step("does not follow a cache-directory symlink during reads or deletes", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = Deno.makeTempDirSync();
    const backend = new DiskCacheBackend(baseDir);
    await backend.set("symlinked-entry", "value");
    const rootDir = join(baseDir, "veryfront-files");
    const relocatedDir = join(baseDir, "relocated-cache");
    await Deno.rename(rootDir, relocatedDir);
    await Deno.symlink(relocatedDir, rootDir);

    assertEquals(await backend.get("symlinked-entry"), null);
    await assertRejects(() => backend.del("symlinked-entry"));
    assertEquals(Array.from(Deno.readDirSync(relocatedDir)).length, 1);
  });

  await t.step("does not follow symbolic links for cache entry files", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = Deno.makeTempDirSync();
    const backend = new DiskCacheBackend(baseDir);
    const key = "symlinked-file";
    await backend.set(key, "original");
    const filePath = (backend as unknown as { filePath: (entryKey: string) => string }).filePath(
      key,
    );
    const externalFile = join(baseDir, "external.json");
    await Deno.writeTextFile(externalFile, JSON.stringify({ key, value: "poisoned" }));
    await Deno.remove(filePath);
    await Deno.symlink(externalFile, filePath);

    assertEquals(await backend.get(key), null);
  });

  await t.step("restricts both root and namespaced cache directories", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = Deno.makeTempDirSync();
    const backend = new DiskCacheBackend(baseDir, "private-namespace");
    await backend.set("permission-test", "value");

    const rootDir = join(baseDir, "veryfront-files");
    const rootMode = (await Deno.stat(rootDir)).mode;
    assertEquals(rootMode === null ? null : rootMode & 0o077, 0);
    for await (const entry of Deno.readDir(rootDir)) {
      if (!entry.isDirectory) continue;
      const namespaceMode = (await Deno.stat(join(rootDir, entry.name))).mode;
      assertEquals(namespaceMode === null ? null : namespaceMode & 0o077, 0);
    }
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
        undefined,
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
    const remaining = await backend.getRemainingTtlSeconds("ttl-long");
    assertEquals(typeof remaining, "number");
    assertEquals(remaining! > 0 && remaining! <= 3600, true);
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

  await t.step("keeps the compiled glob cache bounded after an empty pattern", async () => {
    const backend = makeBackend();
    await backend.delByPattern("");
    for (let index = 0; index < 150; index++) {
      await backend.delByPattern(`pattern-${index}`);
    }

    const globCache = (backend as unknown as { globCache: Map<string, unknown> }).globCache;
    assertEquals(globCache.size, 100);
  });

  await t.step("delete operations propagate non-missing filesystem failures", async () => {
    const baseFile = join(Deno.makeTempDirSync(), "not-a-directory");
    await Deno.writeTextFile(baseFile, "file");
    const backend = new DiskCacheBackend(baseFile);

    await assertRejects(() => backend.del("key"));
    await assertRejects(() => backend.delByPattern("*"));
  });

  await t.step("type property is 'disk'", () => {
    const backend = makeBackend();
    assertEquals(backend.type, "disk");
  });
});
