import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { DiskCacheBackend } from "./disk.ts";
import { join } from "node:path";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

let testDir: string;
let cache: DiskCacheBackend;

describe("DiskCacheBackend", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "disk-cache-test-"));
    cache = new DiskCacheBackend(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("get/set", () => {
    it("returns null for missing key", async () => {
      assertEquals(await cache.get("missing"), null);
    });

    it("stores and retrieves a value", async () => {
      await cache.set("key1", "value1");
      assertEquals(await cache.get("key1"), "value1");
    });

    it("overwrites existing value", async () => {
      await cache.set("key1", "value1");
      await cache.set("key1", "value2");
      assertEquals(await cache.get("key1"), "value2");
    });

    it("stores value without TTL (no expiry)", async () => {
      await cache.set("persistent", "data");
      assertEquals(await cache.get("persistent"), "data");
    });

    it("handles keys with path separators", async () => {
      await cache.set("user/../../etc/passwd", "safe");
      assertEquals(await cache.get("user/../../etc/passwd"), "safe");
    });

    it("handles keys with special characters", async () => {
      await cache.set("key:with:colons:and spaces!", "value");
      assertEquals(await cache.get("key:with:colons:and spaces!"), "value");
    });
  });

  describe("TTL expiry", () => {
    it("returns null for TTL=0 (immediately expired)", async () => {
      await cache.set("expiring", "data", 0);
      // TTL=0 means expiresAt = Date.now(), so next read should expire
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(await cache.get("expiring"), null);
    });

    it("returns value for non-expired entry", async () => {
      await cache.set("fresh", "data", 60);
      assertEquals(await cache.get("fresh"), "data");
    });

    it("returns null after TTL expires", async () => {
      // Use a very short TTL — 0.05 seconds
      await cache.set("short-lived", "data", 0.05);
      assertEquals(await cache.get("short-lived"), "data");
      await new Promise((r) => setTimeout(r, 100));
      assertEquals(await cache.get("short-lived"), null);
    });

    it("entry with no TTL never expires", async () => {
      await cache.set("forever", "data");
      // Verify expiresAt is absent in envelope
      const files = await readdir(join(testDir, "veryfront-files"));
      const jsonFile = files.find((f) => f.endsWith(".json"));
      const content = JSON.parse(
        await readFile(join(testDir, "veryfront-files", jsonFile!), "utf-8"),
      );
      assertEquals(content.expiresAt, undefined);
      assertEquals(await cache.get("forever"), "data");
    });
  });

  describe("del", () => {
    it("deletes an existing key", async () => {
      await cache.set("key1", "value1");
      await cache.del("key1");
      assertEquals(await cache.get("key1"), null);
    });

    it("does not throw for non-existent key", async () => {
      await cache.del("nonexistent");
    });
  });

  describe("delByPattern", () => {
    it("deletes keys matching glob pattern", async () => {
      await cache.set("user:1:name", "Alice");
      await cache.set("user:2:name", "Bob");
      await cache.set("post:1:title", "Hello");

      const deleted = await cache.delByPattern("user:*");
      assertEquals(deleted, 2);
      assertEquals(await cache.get("user:1:name"), null);
      assertEquals(await cache.get("user:2:name"), null);
      assertEquals(await cache.get("post:1:title"), "Hello");
    });

    it("returns 0 when no keys match", async () => {
      await cache.set("key1", "value1");
      assertEquals(await cache.delByPattern("nomatch:*"), 0);
    });

    it("returns 0 when directory does not exist", async () => {
      const emptyCache = new DiskCacheBackend(join(testDir, "nonexistent"));
      assertEquals(await emptyCache.delByPattern("*"), 0);
    });
  });

  describe("atomic writes", () => {
    it("writes files with .json extension", async () => {
      await cache.set("test-key", "test-value");
      const files = await readdir(join(testDir, "veryfront-files"));
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      assertEquals(jsonFiles.length, 1);
    });

    it("stores key in envelope for delByPattern", async () => {
      await cache.set("my-key", "my-value");
      const files = await readdir(join(testDir, "veryfront-files"));
      const jsonFile = files.find((f) => f.endsWith(".json"));
      const content = JSON.parse(
        await readFile(join(testDir, "veryfront-files", jsonFile!), "utf-8"),
      );
      assertEquals(content.key, "my-key");
      assertEquals(content.value, "my-value");
    });

    it("no temp files remain after successful write", async () => {
      await cache.set("key1", "value1");
      const files = await readdir(join(testDir, "veryfront-files"));
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      assertEquals(tmpFiles.length, 0);
    });

    it("concurrent writes to different keys succeed", async () => {
      await Promise.all([
        cache.set("race-key-a", "value-a"),
        cache.set("race-key-b", "value-b"),
      ]);
      assertEquals(await cache.get("race-key-a"), "value-a");
      assertEquals(await cache.get("race-key-b"), "value-b");
    });
  });

  describe("type", () => {
    it("returns 'disk'", () => {
      assertEquals(cache.type, "disk");
    });
  });
});
