import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertMatch, assertRejects, assertThrows } from "@std/assert";
import { join } from "#veryfront/compat/path/index.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { logger } from "#veryfront/utils";
import { DiskCacheBackend } from "./disk.ts";
import { CacheValueTooLargeError } from "../bounded-read.ts";
import {
  runCacheInvariantTests,
  testConcurrentAccess,
  testKeyCollisionResistance,
} from "../testing/invariants.ts";

const TEST_DIR = join(Deno.makeTempDirSync(), "disk-cache-test");

function makeBackend(): DiskCacheBackend {
  return new DiskCacheBackend(TEST_DIR);
}

function captureLogs(level: "debug" | "warn"): {
  entries: Array<{ message: string; args: unknown[] }>;
  restore: () => void;
} {
  const entries: Array<{ message: string; args: unknown[] }> = [];
  const target = logger as unknown as {
    [key in "debug" | "warn"]: (message: string, ...args: unknown[]) => void;
  };
  const original = target[level];
  target[level] = (message: string, ...args: unknown[]) => {
    entries.push({ message, args });
  };
  return {
    entries,
    restore: () => {
      target[level] = original;
    },
  };
}

function captureDebugLogs() {
  return captureLogs("debug");
}

async function cacheFileNames(cacheDir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(cacheDir)) {
    if (entry.isFile && entry.name.endsWith(".vfcache")) names.push(entry.name);
  }
  return names;
}

async function onlyCacheFileName(cacheDir: string): Promise<string> {
  const names = await cacheFileNames(cacheDir);
  assertEquals(names.length, 1);
  return names[0]!;
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
      if (file.isFile && file.name.endsWith(".vfcache")) {
        await Deno.writeFile(join(cacheDir, file.name), new Uint8Array([1, 2, 3]));
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

  await t.step("a later write prunes expired entries that are never read again", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "expired-entry-prune-test");
    const backend = new DiskCacheBackend(isolatedDir);
    const cacheDir = join(isolatedDir, "veryfront-files");

    await backend.set("expired-content-hash", "old", 0);
    await new Promise((resolve) => setTimeout(resolve, 2));
    assertEquals((await cacheFileNames(cacheDir)).length, 1);

    await backend.set("fresh-content-hash", "new", 60);

    assertEquals(await backend.get("fresh-content-hash"), "new");
    assertEquals((await cacheFileNames(cacheDir)).length, 1);
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
      await new Promise((r) => setTimeout(r, 5));

      assertEquals(debugCapture.entries.length, 1);
      assertEquals(debugCapture.entries[0]?.message, "[DiskCache] Expired entry cleanup failed");
      // Without something identifying the entry the log says only that some
      // cleanup failed, which is not diagnosable against a cache holding
      // thousands of entries. The digest identifies it without reproducing the
      // key, which for a user KV entry can embed a token.
      const context = debugCapture.entries[0]?.args[0] as Record<string, unknown> | undefined;
      assertMatch(String(context?.keyDigest), /^[0-9a-f]{12}$/);
      assertEquals(JSON.stringify(context).includes(key), false);
    } finally {
      debugCapture.restore();
      (backend as unknown as { del: (entryKey: string) => Promise<void> }).del = originalDel;
    }
  });

  await t.step("logs both keys when a filename digest collides", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "digest-collision");
    const backend = new DiskCacheBackend(isolatedDir);
    const cacheDir = join(isolatedDir, "veryfront-files");
    const storedKey = "collision-stored-key";
    const requestedKey = "collision-requested-key";

    await backend.set(storedKey, "stored-value");
    const storedFile = await onlyCacheFileName(cacheDir);
    const storedBytes = await Deno.readFile(join(cacheDir, storedFile));

    // Force the collision the digest makes astronomically unlikely: park the
    // envelope written for one key under the other key's filename.
    await backend.set(requestedKey, "requested-value");
    const requestedFile = (await cacheFileNames(cacheDir)).find((name) => name !== storedFile);
    assertEquals(typeof requestedFile, "string");
    await Deno.writeFile(join(cacheDir, requestedFile!), storedBytes);

    const warnCapture = captureLogs("warn");
    try {
      assertEquals(await backend.get(requestedKey), null);

      assertEquals(warnCapture.entries.length, 1);
      assertEquals(
        warnCapture.entries[0]?.message,
        "[DiskCache] Filename digest collision; stored key does not match",
      );
      const context = warnCapture.entries[0]?.args[0] as Record<string, unknown> | undefined;
      // Digests keep the two entries distinguishable — and equal digests would
      // mean a genuine SHA-256 collision rather than an overwritten file —
      // without reproducing key text that can embed a token.
      assertMatch(String(context?.requestedKeyDigest), /^[0-9a-f]{12}$/);
      assertMatch(String(context?.storedKeyDigest), /^[0-9a-f]{12}$/);
      assertEquals(context?.requestedKeyDigest === context?.storedKeyDigest, false);
      const payload = JSON.stringify(context);
      assertEquals(payload.includes(requestedKey), false);
      assertEquals(payload.includes(storedKey), false);
    } finally {
      warnCapture.restore();
    }
  });

  await t.step("derives the logged key digest from the entry's own filename", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "digest-correlation");
    const backend = new DiskCacheBackend(isolatedDir);
    const cacheDir = join(isolatedDir, "veryfront-files");
    const key = "digest-correlation-key";

    await backend.set(key, "value", 0);
    const fileName = await onlyCacheFileName(cacheDir);
    await new Promise((r) => setTimeout(r, 5));

    const originalDel = backend.del.bind(backend);
    (backend as unknown as { del: (entryKey: string) => Promise<void> }).del = () =>
      Promise.reject(new Error("delete rejected"));

    const debugCapture = captureDebugLogs();
    try {
      assertEquals(await backend.get(key), null);
      await waitFor(
        () =>
          debugCapture.entries.some((entry) =>
            entry.message === "[DiskCache] Expired entry cleanup failed"
          ),
        {
          interval: 1,
          timeout: 1_000,
          message: "expired-entry cleanup diagnostic was not emitted",
        },
      );

      // The digest is the prefix of the SHA-256 that names the file, so an
      // operator can still walk from a log line to the entry on disk.
      const diagnostic = debugCapture.entries.find((entry) =>
        entry.message === "[DiskCache] Expired entry cleanup failed"
      );
      const context = diagnostic?.args[0] as Record<string, unknown> | undefined;
      assertEquals(fileName.startsWith(String(context?.keyDigest)), true);
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

  await t.step("encodes cache namespaces instead of treating them as paths", async () => {
    const isolatedDir = Deno.makeTempDirSync();
    const backend = new DiskCacheBackend(isolatedDir, "../escape");
    await backend.set("key", "value");

    assertEquals(await backend.get("key"), "value");
    const namespaces = [...Deno.readDirSync(join(isolatedDir, "veryfront-files"))];
    assertEquals(namespaces.length, 1);
    assertEquals(namespaces[0]?.isDirectory, true);
    assertEquals(namespaces[0]?.name.includes("/"), false);
    assertEquals(await Deno.stat(join(isolatedDir, "veryfront-files")).then(() => true), true);
    await assertRejects(
      () => Deno.stat(join(isolatedDir, "escape")),
      Deno.errors.NotFound,
    );
  });

  await t.step("rejects unsupported constructor limits and namespace lengths", () => {
    assertThrows(
      () => new DiskCacheBackend(TEST_DIR, undefined, 0),
      RangeError,
    );
    assertThrows(
      () => new DiskCacheBackend(TEST_DIR, "/".repeat(100)),
      TypeError,
    );
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
    await backend.set("user:invalid", "value");

    const cacheDir = join(isolatedDir, "veryfront-files");
    for await (const file of Deno.readDir(cacheDir)) {
      if (!file.isFile || !file.name.endsWith(".vfcache")) continue;
      await Deno.writeFile(join(cacheDir, file.name), new Uint8Array([1, 2, 3]));
      break;
    }
    await backend.set("user:valid", "value");

    const deleted = await backend.delByPattern("user:*");
    assertEquals(deleted, 1);
    assertEquals(await backend.get("user:valid"), null);
    assertEquals(await backend.get("user:invalid"), null);
  });

  await t.step("does not follow cache-entry symlinks", async () => {
    const isolatedDir = await Deno.makeTempDir({ prefix: "disk-cache-symlink-" });
    const outsidePath = join(isolatedDir, "outside.txt");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("linked", "safe-value");
    await Deno.writeTextFile(outsidePath, "outside-value");

    const cacheDir = join(isolatedDir, "veryfront-files");
    for await (const file of Deno.readDir(cacheDir)) {
      if (!file.isFile || !file.name.endsWith(".vfcache")) continue;
      const cachePath = join(cacheDir, file.name);
      await Deno.remove(cachePath);
      await Deno.symlink(outsidePath, cachePath);
      break;
    }

    assertEquals(await backend.get("linked"), null);
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

  await t.step("bounded reads preserve valid oversized entries", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "bounded-value-read-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, 16);
    await backend.set("unicode", "é");

    assertEquals(await backend.getWithinLimit("unicode", 2), "é");
    await assertRejects(
      () => backend.getWithinLimit("unicode", 1),
      CacheValueTooLargeError,
    );
    assertEquals(await backend.get("unicode"), "é");
  });

  await t.step("bounded reads keep cache infrastructure failures fail-soft", async () => {
    const backend = makeBackend();
    (backend as unknown as { mutationTail: Promise<void> }).mutationTail = Promise.reject(
      new Error("simulated cache queue failure"),
    );
    assertEquals(await backend.getWithinLimit("key", 1), null);
  });

  await t.step("framed values round-trip control characters and lone surrogates", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "framed-string-roundtrip-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, 32);
    const controlValue = "\0".repeat(8);
    const surrogateValue = "\ud800x\udc00y😀";

    await backend.set("control", controlValue);
    await backend.set("surrogate", surrogateValue);
    assertEquals(await backend.get("control"), controlValue);
    assertEquals(await backend.getWithinLimit("surrogate", 12), surrogateValue);
    await assertRejects(
      () => backend.getWithinLimit("surrogate", 11),
      CacheValueTooLargeError,
    );
  });

  await t.step("bounded reads classify a stored-key mismatch before value overflow", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "bounded-collision-read-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, 32);
    const cacheDir = join(isolatedDir, "veryfront-files");
    await backend.set("requested-key", "a");
    const requestedFile = [...Deno.readDirSync(cacheDir)]
      .find((entry) => entry.name.endsWith(".vfcache"))?.name;
    assertEquals(typeof requestedFile, "string");
    await backend.del("requested-key");

    await backend.set("stored-key", "oversized");
    const storedFile = [...Deno.readDirSync(cacheDir)]
      .find((entry) => entry.name.endsWith(".vfcache"))?.name;
    assertEquals(typeof storedFile, "string");
    await Deno.rename(
      join(cacheDir, storedFile as string),
      join(cacheDir, requestedFile as string),
    );

    assertEquals(await backend.getWithinLimit("requested-key", 1), null);
  });

  await t.step("expired values are misses before bounded overflow", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "expired-bounded-read-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, 32);
    await backend.set("expired", "oversized", 0);
    await new Promise((resolve) => setTimeout(resolve, 2));

    assertEquals(await backend.getWithinLimit("expired", 1), null);
  });

  await t.step("oversized writes do not replace a valid entry", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "oversized-write-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, 8);
    await backend.set("bounded", "old");

    await assertRejects(
      () => backend.set("bounded", "x".repeat(9)),
      CacheValueTooLargeError,
    );
    assertEquals(await backend.get("bounded"), "old");
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
