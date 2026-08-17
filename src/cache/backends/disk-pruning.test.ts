import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readDir, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { DiskCacheBackend } from "./disk.ts";

interface CacheEnvelope {
  key: string;
  expiresAt?: number;
}

type ReadFramedFile = (
  filePath: string,
  expectedKey: string | undefined,
  maximumValueBytes: number | undefined,
  includeValue: boolean,
) => Promise<CacheEnvelope>;

async function cacheFileNames(cacheDir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of readDir(cacheDir)) {
    if (entry.isFile && entry.name.endsWith(".vfcache")) names.push(entry.name);
  }
  return names;
}

describe("DiskCacheBackend expiry pruning", () => {
  it("removes expired entries that are never read again", async () => {
    await withTempDir(async (isolatedDir) => {
      const backend = new DiskCacheBackend(isolatedDir);
      const cacheDir = join(isolatedDir, "veryfront-files");

      await backend.set("expired-content-hash", "old", 0);
      await new Promise((resolve) => setTimeout(resolve, 2));
      assertEquals((await cacheFileNames(cacheDir)).length, 1);

      await backend.set("fresh-content-hash", "new", 60);

      assertEquals(await backend.get("fresh-content-hash"), "new");
      assertEquals((await cacheFileNames(cacheDir)).length, 1);
    }, { prefix: "expired-entry-prune-test-" });
  });

  it("does not delete a fresh cross-process replacement", async () => {
    await withTempDir(async (isolatedDir) => {
      const key = "prune-write-race";
      const pruner = new DiskCacheBackend(isolatedDir);
      const writer = new DiskCacheBackend(isolatedDir);
      await pruner.set(key, "expired", 0);
      await new Promise((resolve) => setTimeout(resolve, 2));

      const internals = pruner as unknown as { readFramedFile: ReadFramedFile };
      const originalRead = internals.readFramedFile.bind(pruner);
      let resumePrune!: () => void;
      let reportInspection!: () => void;
      const resume = new Promise<void>((resolve) => {
        resumePrune = resolve;
      });
      const inspected = new Promise<void>((resolve) => {
        reportInspection = resolve;
      });
      let paused = false;
      internals.readFramedFile = async (...args) => {
        const envelope = await originalRead(...args);
        if (!paused && envelope.key === key) {
          paused = true;
          reportInspection();
          await resume;
        }
        return envelope;
      };

      const pruningWrite = pruner.set("prune-trigger", "trigger", 60);
      await inspected;
      await writer.set(key, "fresh", 60);
      resumePrune();
      await pruningWrite;

      assertEquals(await writer.get(key), "fresh");
    }, { prefix: "expired-entry-race-test-" });
  });
});
