import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { DiskCacheBackend, type DiskCacheOptions } from "./disk.ts";
import {
  runCacheInvariantTests,
  testConcurrentAccess,
  testKeyCollisionResistance,
} from "../testing/invariants.ts";
import { DEFAULT_CACHE_TTL_SECONDS, MAX_CACHE_TTL_SECONDS } from "./ttl.ts";
import { CacheValueTooLargeError } from "../bounded-read.ts";

const TEST_DIR = join(Deno.makeTempDirSync(), "disk-cache-test");

function makeBackend(): DiskCacheBackend {
  return new DiskCacheBackend(TEST_DIR);
}

async function listCacheFiles(baseDir: string): Promise<string[]> {
  const cacheDir = join(baseDir, "veryfront-files");
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(cacheDir)) {
      if (entry.isFile && entry.name.endsWith(".vfcache")) files.push(entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return files.sort();
}

async function cacheFileNameForKey(key: string): Promise<string> {
  const bytes = new Uint8Array(key.length * 2);
  for (let index = 0; index < key.length; index++) {
    const codeUnit = key.charCodeAt(index);
    bytes[index * 2] = codeUnit >>> 8;
    bytes[index * 2 + 1] = codeUnit & 0xff;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}.vfcache`;
}

async function replaceFramedCacheKey(filePath: string, replacement: string): Promise<void> {
  const content = await Deno.readFile(filePath);
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const keyCodeUnits = Number(view.getBigUint64(8));
  assertEquals(replacement.length, keyCodeUnits);
  let offset = 40;
  for (let index = 0; index < replacement.length; index++) {
    const codeUnit = replacement.charCodeAt(index);
    content[offset++] = codeUnit >>> 8;
    content[offset++] = codeUnit & 0xff;
  }
  const integrityOffset = content.byteLength - 32;
  const integrity = new Uint8Array(
    await crypto.subtle.digest("SHA-256", content.subarray(0, integrityOffset)),
  );
  content.set(integrity, integrityOffset);
  await Deno.writeFile(filePath, content);
}

async function forgeOversizedFramedLengths(
  filePath: string,
  storedBytes: number,
): Promise<void> {
  const content = await Deno.readFile(filePath);
  const originalView = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const keyCodeUnits = Number(originalView.getBigUint64(8));
  const forged = new Uint8Array(40 + keyCodeUnits * 2 + storedBytes + 32);
  forged.set(content.subarray(0, Math.min(content.byteLength, forged.byteLength)));
  const forgedView = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
  forgedView.setBigUint64(16, BigInt(storedBytes));
  forgedView.setBigUint64(24, BigInt(storedBytes));
  await Deno.writeFile(filePath, forged);
}

async function replaceFramedCacheValueBytes(
  filePath: string,
  replacement: Uint8Array,
): Promise<void> {
  const content = await Deno.readFile(filePath);
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const keyCodeUnits = Number(view.getBigUint64(8));
  const valueStoredBytes = Number(view.getBigUint64(16));
  assertEquals(replacement.byteLength, valueStoredBytes);
  const valueOffset = 40 + keyCodeUnits * 2;
  content.set(replacement, valueOffset);
  const integrityOffset = content.byteLength - 32;
  const integrity = new Uint8Array(
    await crypto.subtle.digest("SHA-256", content.subarray(0, integrityOffset)),
  );
  content.set(integrity, integrityOffset);
  await Deno.writeFile(filePath, content);
}

async function replaceFramedCacheExpiry(filePath: string, expiresAt: number): Promise<void> {
  const content = await Deno.readFile(filePath);
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  view.setFloat64(32, expiresAt);
  const integrityOffset = content.byteLength - 32;
  const integrity = new Uint8Array(
    await crypto.subtle.digest("SHA-256", content.subarray(0, integrityOffset)),
  );
  content.set(integrity, integrityOffset);
  await Deno.writeFile(filePath, content);
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

function captureErrorLogs(): {
  entries: Array<{ message: string; args: unknown[] }>;
  restore: () => void;
} {
  const entries: Array<{ message: string; args: unknown[] }> = [];
  const target = logger as unknown as {
    error: (message: string, ...args: unknown[]) => void;
  };
  const original = target.error;
  target.error = (message: string, ...args: unknown[]) => {
    entries.push({ message, args });
  };
  return {
    entries,
    restore: () => {
      target.error = original;
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

  await t.step("read failure logs do not expose filesystem paths", async () => {
    const blockingPath = join(Deno.makeTempDirSync(), "not-a-directory");
    await Deno.writeTextFile(blockingPath, "file");
    const backend = new DiskCacheBackend(blockingPath);
    const errorCapture = captureErrorLogs();

    try {
      assertEquals(await backend.get("key"), null);
      assertEquals(errorCapture.entries.length, 1);
      assertEquals(JSON.stringify(errorCapture.entries).includes(blockingPath), false);
    } finally {
      errorCapture.restore();
    }
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

  await t.step("stale invalid-entry cleanup preserves concurrent replacements", async (t) => {
    const readers: Array<{
      name: string;
      read: (backend: DiskCacheBackend, key: string) => Promise<unknown>;
    }> = [
      { name: "get", read: (backend, key) => backend.get(key) },
      {
        name: "getWithinLimit",
        read: (backend, key) => backend.getWithinLimit(key, 1),
      },
      {
        name: "getRemainingTtlSeconds",
        read: (backend, key) => backend.getRemainingTtlSeconds(key),
      },
    ];

    for (const { name, read } of readers) {
      await t.step(name, async () => {
        const isolatedDir = join(Deno.makeTempDirSync(), `stale-${name}-cleanup-test`);
        const backend = new DiskCacheBackend(isolatedDir);
        const key = `stale-${name}`;
        await backend.set(key, "old");
        const [fileName] = await listCacheFiles(isolatedDir);
        await Deno.writeFile(
          join(isolatedDir, "veryfront-files", fileName!),
          new Uint8Array([0xff]),
        );

        const internals = backend as unknown as {
          removeKnownFile(fileName: string): Promise<void>;
        };
        const removeKnownFile = internals.removeKnownFile.bind(backend);
        let signalCleanupStarted = () => {};
        const cleanupStarted = new Promise<void>((resolve) => {
          signalCleanupStarted = resolve;
        });
        let resumeCleanup = () => {};
        const cleanupResumed = new Promise<void>((resolve) => {
          resumeCleanup = resolve;
        });
        internals.removeKnownFile = async (staleFileName) => {
          signalCleanupStarted();
          await cleanupResumed;
          await removeKnownFile(staleFileName);
        };

        const staleRead = read(backend, key);
        await cleanupStarted;
        try {
          await backend.set(key, "fresh");
        } finally {
          resumeCleanup();
        }
        await staleRead;

        assertEquals(await backend.get(key), "fresh");
      });
    }
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

  await t.step("del propagates filesystem failures", async () => {
    const blockingPath = join(Deno.makeTempDirSync(), "not-a-directory");
    await Deno.writeTextFile(blockingPath, "file");
    const backend = new DiskCacheBackend(blockingPath);

    await assertRejects(() => backend.del("key"));
  });

  await t.step(
    "non-positive TTL removes an existing entry without storing a replacement",
    async () => {
      const isolatedDir = join(Deno.makeTempDirSync(), "non-positive-ttl-test");
      const backend = new DiskCacheBackend(isolatedDir);
      await backend.set("ttl-zero", "old", 60);
      await backend.set("ttl-zero", "replacement", 0);
      await backend.set("ttl-negative", "value", -1);

      const dir = (backend as unknown as { dir: string }).dir;
      const files: string[] = [];
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".vfcache")) files.push(entry.name);
      }
      assertEquals(files, []);
      assertEquals(await backend.get("ttl-zero"), null);
      assertEquals(await backend.get("ttl-negative"), null);
    },
  );

  await t.step("rejects TTLs that cannot produce a safe expiry timestamp", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "unsafe-ttl-test");
    const backend = new DiskCacheBackend(isolatedDir);

    await assertRejects(
      () => backend.set("oversized", "value", MAX_CACHE_TTL_SECONDS + 1),
      RangeError,
      "finite number of seconds at most",
    );
    await assertRejects(
      () => backend.set("max-number", "value", Number.MAX_VALUE),
      RangeError,
      "finite number of seconds at most",
    );
    assertEquals(await backend.get("oversized"), null);
    assertEquals(await backend.get("max-number"), null);
  });

  await t.step("logs expired-entry cleanup failures", async () => {
    const backend = makeBackend();
    const key = "expired-cleanup-fails";
    const originalDateNow = Date.now;
    let now = originalDateNow();
    Date.now = () => now;
    const debugCapture = captureDebugLogs();
    const cleanupTarget = backend as unknown as {
      removeObservedFile: (...args: unknown[]) => Promise<void>;
    };
    const originalCleanup = cleanupTarget.removeObservedFile.bind(backend);
    try {
      await backend.set(key, "val", 1);
      now += 2_000;
      cleanupTarget.removeObservedFile = () => Promise.reject(new Error("delete rejected"));

      assertEquals(await backend.get(key), null);
      await Promise.resolve();

      assertEquals(debugCapture.entries.length, 1);
      assertEquals(debugCapture.entries[0]?.message, "[DiskCache] Expired entry cleanup failed");
      const metadata = debugCapture.entries[0]?.args[0] as Record<string, unknown> | undefined;
      assertEquals(typeof metadata?.keyHash, "string");
      assertEquals(JSON.stringify(metadata).includes(key), false);
    } finally {
      debugCapture.restore();
      cleanupTarget.removeObservedFile = originalCleanup;
      Date.now = originalDateNow;
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
    const originalDateNow = Date.now;
    let now = originalDateNow();
    Date.now = () => now;
    try {
      await backend.set("ttl-short", "val", 1);
      assertEquals(await backend.get("ttl-short"), "val");
      now += 1_000;
      assertEquals(await backend.get("ttl-short"), null);
    } finally {
      Date.now = originalDateNow;
    }
  });

  await t.step("omitted TTL uses the shared backend default", async () => {
    const backend = makeBackend();
    const originalDateNow = Date.now;
    let now = originalDateNow();
    Date.now = () => now;
    try {
      await backend.set("default-ttl", "bounded");
      assertEquals(
        await backend.getRemainingTtlSeconds("default-ttl"),
        DEFAULT_CACHE_TTL_SECONDS,
      );
      now += DEFAULT_CACHE_TTL_SECONDS * 1_000;
      assertEquals(await backend.get("default-ttl"), null);
    } finally {
      Date.now = originalDateNow;
    }
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

  await t.step("uses cryptographic identities without collapsing lone surrogates", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "cryptographic-identity-test");
    const backend = new DiskCacheBackend(isolatedDir);
    const firstKey = "lone-surrogate-\ud800";
    const secondKey = "lone-surrogate-\ud801";

    await backend.set(firstKey, "first");
    await backend.set(secondKey, "second");

    const files = await listCacheFiles(isolatedDir);
    assertEquals(files.length, 2);
    assertEquals(files.every((file) => /^[0-9a-f]{64}\.vfcache$/.test(file)), true);
    assertEquals(await backend.get(firstKey), "first");
    assertEquals(await backend.get(secondKey), "second");
  });

  await t.step("round-trips lone surrogates and counts their logical UTF-8 bytes", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "surrogate-value-test");
    const backend = new DiskCacheBackend(isolatedDir);
    const value = "\ud800x\udc00y\ud83d\ude00";

    await backend.set("surrogate-value", value);

    assertEquals(await backend.get("surrogate-value"), value);
    assertEquals(await backend.getWithinLimit("surrogate-value", 12), value);
    await assertRejects(
      () => backend.getWithinLimit("surrogate-value", 11),
      CacheValueTooLargeError,
      "11 UTF-8 bytes",
    );
    assertEquals(await backend.get("surrogate-value"), value);
  });

  await t.step("cleans checksum-verified noncanonical WTF-8 surrogate pairs", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "noncanonical-wtf8-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("noncanonical", "abcdef");
    const [fileName] = await listCacheFiles(isolatedDir);
    const filePath = join(isolatedDir, "veryfront-files", fileName!);

    await replaceFramedCacheValueBytes(
      filePath,
      new Uint8Array([0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80]),
    );

    assertEquals(await backend.get("noncanonical"), null);
    assertEquals(await listCacheFiles(isolatedDir), []);
  });

  await t.step("cleans a checksum-verified writer-impossible zero expiry", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "noncanonical-expiry-zero-test");
    const backend = new DiskCacheBackend(isolatedDir);
    const key = "noncanonical-expiry-zero";
    await backend.set(key, "value");
    const [fileName] = await listCacheFiles(isolatedDir);
    const filePath = join(isolatedDir, "veryfront-files", fileName!);

    await replaceFramedCacheExpiry(filePath, 0);

    assertEquals(await backend.get(key), null);
    assertEquals(await listCacheFiles(isolatedDir), []);
  });

  await t.step("key prefixes cannot escape the disk cache namespace", async () => {
    const root = Deno.makeTempDirSync();
    const cacheRoot = join(root, "cache-root");
    const escapedDir = join(root, "escaped");
    const backend = new DiskCacheBackend(cacheRoot, "../../escaped");

    await backend.set("key", "value");

    assertEquals(await backend.get("key"), "value");
    await assertRejects(() => Deno.stat(escapedDir), Deno.errors.NotFound);
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
    await Deno.writeTextFile(
      join(cacheDir, await cacheFileNameForKey("user:invalid")),
      JSON.stringify({ key: "user:invalid", value: { nested: true } }),
    );

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

  await t.step("bounded reads preserve valid oversized entries", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "bounded-value-read-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("unicode", "é");

    assertEquals(await backend.getWithinLimit("unicode", 2), "é");
    await assertRejects(
      () => backend.getWithinLimit("unicode", 1),
      CacheValueTooLargeError,
      "1 UTF-8 bytes",
    );
    assertEquals(await backend.get("unicode"), "é");
    assertEquals((await listCacheFiles(isolatedDir)).length, 1);
  });

  await t.step(
    "bounded reads classify a checksum-verified stored-key mismatch before overflow",
    async () => {
      const isolatedDir = join(Deno.makeTempDirSync(), "bounded-collision-read-test");
      const cacheDir = join(isolatedDir, "veryfront-files");
      const backend = new DiskCacheBackend(isolatedDir);
      const requestedKey = "bounded-key-a";
      const storedKey = "bounded-key-b";
      const requestedFileName = await cacheFileNameForKey(requestedKey);
      const storedFileName = await cacheFileNameForKey(storedKey);
      await backend.set(storedKey, "oversized");
      await Deno.rename(
        join(cacheDir, storedFileName),
        join(cacheDir, requestedFileName),
      );

      assertEquals(await backend.getWithinLimit(requestedKey, 1), null);
      assertEquals(await listCacheFiles(isolatedDir), [requestedFileName]);
    },
  );

  await t.step("bounded reads reject oversized ASCII before invoking JSON.parse", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "bounded-ascii-parser-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("ascii", "x".repeat(32));
    const originalJsonParse = JSON.parse;
    let parseCalls = 0;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      parseCalls++;
      return Reflect.apply(originalJsonParse, JSON, args);
    }) as typeof JSON.parse;

    try {
      await assertRejects(
        () => backend.getWithinLimit("ascii", 8),
        CacheValueTooLargeError,
        "8 UTF-8 bytes",
      );
      assertEquals(parseCalls, 0);
    } finally {
      JSON.parse = originalJsonParse;
    }

    assertEquals(await backend.get("ascii"), "x".repeat(32));
    assertEquals((await listCacheFiles(isolatedDir)).length, 1);
  });

  await t.step("bounded reads count multibyte UTF-8 before constructing the value", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "bounded-unicode-before-string-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("unicode", "é".repeat(8));
    const originalFromCharCode = String.fromCharCode;
    const constructedChunkSizes: number[] = [];
    String.fromCharCode = ((...codeUnits: number[]) => {
      constructedChunkSizes.push(codeUnits.length);
      return Reflect.apply(originalFromCharCode, String, codeUnits);
    }) as typeof String.fromCharCode;

    try {
      await assertRejects(
        () => backend.getWithinLimit("unicode", 8),
        CacheValueTooLargeError,
        "8 UTF-8 bytes",
      );
      assertEquals(constructedChunkSizes, ["unicode".length]);
    } finally {
      String.fromCharCode = originalFromCharCode;
    }

    assertEquals(await backend.get("unicode"), "é".repeat(8));
  });

  await t.step("cleans checksum-invalid entries that forge oversized framed lengths", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "forged-bounded-length-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("forged", "value");
    const [fileName] = await listCacheFiles(isolatedDir);
    await forgeOversizedFramedLengths(
      join(isolatedDir, "veryfront-files", fileName!),
      128,
    );

    assertEquals(await backend.getWithinLimit("forged", 8), null);
    assertEquals(await listCacheFiles(isolatedDir), []);
  });

  await t.step("treats expired oversized bounded values as cache misses", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "expired-bounded-value-test");
    const originalDateNow = Date.now;
    let now = originalDateNow();
    Date.now = () => now;
    try {
      const backend = new DiskCacheBackend(isolatedDir);
      await backend.set("expired-large", "xx", 1);
      now += 2_000;

      assertEquals(await backend.getWithinLimit("expired-large", 1), null);
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await listCacheFiles(isolatedDir)).length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      assertEquals(await listCacheFiles(isolatedDir), []);
    } finally {
      Date.now = originalDateNow;
    }
  });

  await t.step("maxEntryBytes accounts for physical UTF-8-like value storage", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "physical-entry-size-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, {
      maxEntries: 10,
      maxBytes: 512,
      maxEntryBytes: 256,
    });
    const ascii = "x".repeat(128);

    await backend.set("ascii", ascii);

    assertEquals(await backend.get("ascii"), ascii);
    const [fileName] = await listCacheFiles(isolatedDir);
    const stat = await Deno.stat(join(isolatedDir, "veryfront-files", fileName!));
    assertEquals(stat.size <= 256, true);
  });

  await t.step("validates deterministic capacity options", () => {
    const baseDir = Deno.makeTempDirSync();
    assertThrows(
      () => new DiskCacheBackend(baseDir, undefined, { maxEntries: 0 }),
      RangeError,
      "positive safe integer",
    );
    assertThrows(
      () =>
        new DiskCacheBackend(baseDir, undefined, {
          maxBytes: 100,
          maxEntryBytes: 101,
        }),
      RangeError,
      "cannot exceed",
    );
    assertThrows(
      () => new DiskCacheBackend(baseDir, undefined, { sweepIntervalMs: -1 }),
      RangeError,
      "non-negative safe integer",
    );
  });

  await t.step("rejects oversized writes without replacing a valid entry", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "oversized-write-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, {
      maxEntries: 10,
      maxBytes: 512,
      maxEntryBytes: 256,
    });
    await backend.set("bounded", "old-value");

    await assertRejects(
      () => backend.set("bounded", "x".repeat(300)),
      RangeError,
      "maxEntryBytes",
    );

    assertEquals(await backend.get("bounded"), "old-value");
    assertEquals((await listCacheFiles(isolatedDir)).length, 1);
    const allNames: string[] = [];
    for await (const entry of Deno.readDir(join(isolatedDir, "veryfront-files"))) {
      allNames.push(entry.name);
    }
    assertEquals(allNames.some((name) => name.includes(".tmp.")), false);
  });

  await t.step("rejects and removes an oversized file before parsing it", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "oversized-read-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, {
      maxEntries: 10,
      maxBytes: 512,
      maxEntryBytes: 256,
    });
    await backend.set("oversized-on-disk", "valid");
    const [fileName] = await listCacheFiles(isolatedDir);
    await Deno.writeTextFile(
      join(isolatedDir, "veryfront-files", fileName!),
      "x".repeat(4_096),
    );

    assertEquals(await backend.get("oversized-on-disk"), null);
    assertEquals(await listCacheFiles(isolatedDir), []);
  });

  await t.step("rejects parseable cache data whose value was modified on disk", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "integrity-test");
    const backend = new DiskCacheBackend(isolatedDir);
    const key = "integrity-protected";
    await backend.set(key, "original");

    const [fileName] = await listCacheFiles(isolatedDir);
    const filePath = join(isolatedDir, "veryfront-files", fileName!);
    const content = await Deno.readFile(filePath);
    const valueByteIndex = content.byteLength - 33;
    content[valueByteIndex] = content[valueByteIndex]! ^ 1;
    await Deno.writeFile(filePath, content);

    assertEquals(await backend.get(key), null);
    assertEquals(await listCacheFiles(isolatedDir), []);
  });

  await t.step("bounds directory traversal even when unrelated files accumulate", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "bounded-scan-test");
    const cacheDir = join(isolatedDir, "veryfront-files");
    await Deno.mkdir(cacheDir, { recursive: true });
    await Deno.writeTextFile(join(cacheDir, "unrelated-a"), "a");
    await Deno.writeTextFile(join(cacheDir, "unrelated-b"), "b");
    await Deno.writeTextFile(join(cacheDir, "unrelated-c"), "c");

    const backend = new DiskCacheBackend(
      isolatedDir,
      undefined,
      { maxEntries: 2, maxScanEntries: 2 } as DiskCacheOptions,
    );
    await assertRejects(
      () => backend.delByPattern("*"),
      RangeError,
      "directory scan exceeded",
    );
  });

  await t.step("evicts the oldest entry when the entry limit is reached", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "entry-limit-test");
    const options = {
      maxEntries: 2,
      maxBytes: 4_096,
      maxEntryBytes: 1_024,
    };
    const writer = new DiskCacheBackend(isolatedDir, undefined, options);
    await writer.set("oldest", "one");
    await writer.set("newer", "two");

    const cacheDir = join(isolatedDir, "veryfront-files");
    await Deno.utime(
      join(cacheDir, await cacheFileNameForKey("oldest")),
      new Date(1_000),
      new Date(1_000),
    );
    await Deno.utime(
      join(cacheDir, await cacheFileNameForKey("newer")),
      new Date(2_000),
      new Date(2_000),
    );

    const reloaded = new DiskCacheBackend(isolatedDir, undefined, options);
    await reloaded.set("newest", "three");

    assertEquals(await reloaded.get("oldest"), null);
    assertEquals(await reloaded.get("newer"), "two");
    assertEquals(await reloaded.get("newest"), "three");
    assertEquals((await listCacheFiles(isolatedDir)).length, 2);
  });

  await t.step("enforces the aggregate byte limit on disk", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "byte-limit-test");
    const backend = new DiskCacheBackend(isolatedDir, undefined, {
      maxEntries: 10,
      maxBytes: 300,
      maxEntryBytes: 300,
    });
    await backend.set("byte-first", "a".repeat(100));
    await backend.set("byte-second", "b".repeat(100));

    assertEquals(await backend.get("byte-first"), null);
    assertEquals(await backend.get("byte-second"), "b".repeat(100));
    const files = await listCacheFiles(isolatedDir);
    assertEquals(files.length, 1);
    const stat = await Deno.stat(join(isolatedDir, "veryfront-files", files[0]!));
    assertEquals(stat.size <= 300, true);
  });

  await t.step("sweeps expired entries after a backend restart", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "restart-expiry-sweep-test");
    const originalDateNow = Date.now;
    let now = originalDateNow();
    Date.now = () => now;
    try {
      const writer = new DiskCacheBackend(isolatedDir);
      await writer.set("expired-without-read", "stale", 1);
      now += 2_000;

      const reloaded = new DiskCacheBackend(isolatedDir, undefined, { sweepIntervalMs: 0 });
      assertEquals(await reloaded.get("missing-sweep-trigger"), null);
      assertEquals(await listCacheFiles(isolatedDir), []);
    } finally {
      Date.now = originalDateNow;
    }
  });

  await t.step("removes legacy entries and stale temporary files during a sweep", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "stale-temp-sweep-test");
    const writer = new DiskCacheBackend(isolatedDir);
    await writer.set("live", "value");
    const [cacheFileName] = await listCacheFiles(isolatedDir);
    const tempFileName = `${cacheFileName}.tmp.1.00000000-0000-4000-8000-000000000000`;
    const tempFilePath = join(isolatedDir, "veryfront-files", tempFileName);
    await Deno.writeTextFile(tempFilePath, "orphaned");
    const legacyFilePath = join(isolatedDir, "veryfront-files", `${"0".repeat(32)}.json`);
    const legacyTempPath = `${legacyFilePath}.tmp.1.00000000`;
    await Deno.writeTextFile(legacyFilePath, "legacy-cache-entry");
    await Deno.writeTextFile(legacyTempPath, "legacy-orphan");
    const staleAt = new Date(Date.now() - 11 * 60 * 1_000);
    await Deno.utime(tempFilePath, staleAt, staleAt);
    await Deno.utime(legacyTempPath, staleAt, staleAt);

    const reloaded = new DiskCacheBackend(isolatedDir, undefined, { sweepIntervalMs: 0 });
    assertEquals(await reloaded.get("missing-sweep-trigger"), null);
    await assertRejects(() => Deno.stat(tempFilePath), Deno.errors.NotFound);
    await assertRejects(() => Deno.stat(legacyFilePath), Deno.errors.NotFound);
    await assertRejects(() => Deno.stat(legacyTempPath), Deno.errors.NotFound);
    assertEquals(await reloaded.get("live"), "value");
  });

  await t.step("ignores cache-shaped directories during maintenance", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "cache-shaped-directories-test");
    const cacheDir = join(isolatedDir, "veryfront-files");
    await Deno.mkdir(cacheDir, { recursive: true });
    const directoryNames = [
      `${"a".repeat(64)}.vfcache`,
      `${"b".repeat(64)}.json`,
      `${"c".repeat(64)}.vfcache.tmp.1.00000000-0000-0000-0000-000000000000`,
    ];
    for (const name of directoryNames) await Deno.mkdir(join(cacheDir, name));

    const backend = new DiskCacheBackend(isolatedDir, undefined, { sweepIntervalMs: 0 });
    await backend.set("live", "value");

    assertEquals(await backend.get("live"), "value");
    for (const name of directoryNames) {
      assertEquals((await Deno.lstat(join(cacheDir, name))).isDirectory, true);
    }
  });

  await t.step("does not follow a cache entry symlink outside its namespace", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "entry-symlink-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("symlinked", "cached");
    const [fileName] = await listCacheFiles(isolatedDir);
    const cacheFilePath = join(isolatedDir, "veryfront-files", fileName!);
    const externalPath = join(Deno.makeTempDirSync(), "external.json");
    await Deno.writeTextFile(externalPath, "external-content");
    await Deno.remove(cacheFilePath);
    await Deno.symlink(externalPath, cacheFilePath);

    assertEquals(await backend.get("symlinked"), null);
    assertEquals(await Deno.readTextFile(externalPath), "external-content");
    await assertRejects(() => Deno.lstat(cacheFilePath), Deno.errors.NotFound);
  });

  await t.step("rejects a cache-root symlink instead of writing through it", async () => {
    const root = Deno.makeTempDirSync();
    const baseDir = join(root, "base");
    const externalDir = join(root, "external");
    await Deno.mkdir(baseDir);
    await Deno.mkdir(externalDir);
    await Deno.symlink(externalDir, join(baseDir, "veryfront-files"));
    const backend = new DiskCacheBackend(baseDir);

    await assertRejects(() => backend.set("key", "value"));
    const externalEntries: string[] = [];
    for await (const entry of Deno.readDir(externalDir)) externalEntries.push(entry.name);
    assertEquals(externalEntries, []);
  });

  await t.step("never overwrites an entry whose stored key does not match", async () => {
    const isolatedDir = join(Deno.makeTempDirSync(), "collision-guard-test");
    const backend = new DiskCacheBackend(isolatedDir);
    await backend.set("collision-guard", "original");
    const [fileName] = await listCacheFiles(isolatedDir);
    const filePath = join(isolatedDir, "veryfront-files", fileName!);
    await replaceFramedCacheKey(filePath, "collision-other");
    const tamperedContent = await Deno.readFile(filePath);

    await backend.del("collision-guard");
    assertEquals((await Deno.stat(filePath)).isFile, true);
    await assertRejects(
      () => backend.set("collision-guard", "replacement"),
      Error,
      "digest collision",
    );
    assertEquals(await Deno.readFile(filePath), tamperedContent);
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

  await t.step("delByPattern propagates filesystem failures", async () => {
    const blockingPath = join(Deno.makeTempDirSync(), "not-a-directory");
    await Deno.writeTextFile(blockingPath, "file");
    const backend = new DiskCacheBackend(blockingPath);

    await assertRejects(() => backend.delByPattern("*"));
  });

  await t.step("type property is 'disk'", () => {
    const backend = makeBackend();
    assertEquals(backend.type, "disk");
  });
});
