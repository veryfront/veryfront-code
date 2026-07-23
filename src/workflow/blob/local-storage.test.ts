import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";
import { readDir, readTextFile, remove, stat, writeTextFile } from "#veryfront/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { LocalBlobStorage } from "./local-storage.ts";

const COMMIT_NAME_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{32}$/;

async function encodedObjectDir(rootDir: string, id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  const key = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return join(rootDir, "v2", key.slice(0, 2), key.slice(2, 4), key);
}

async function latestCommitDir(rootDir: string, id: string): Promise<string> {
  const commitsDir = join(await encodedObjectDir(rootDir, id), "commits");
  const commits: string[] = [];
  for await (const entry of readDir(commitsDir)) {
    if (entry.isDirectory && !entry.isSymlink && COMMIT_NAME_PATTERN.test(entry.name)) {
      commits.push(entry.name);
    }
  }
  commits.sort();
  assertExists(commits.at(-1));
  return join(commitsDir, commits.at(-1)!);
}

async function assertStagingEmpty(rootDir: string, id: string): Promise<void> {
  const entries: string[] = [];
  for await (const entry of readDir(join(await encodedObjectDir(rootDir, id), "staging"))) {
    entries.push(entry.name);
  }
  assertEquals(entries, []);
}

function replaceFileSystem(
  storage: LocalBlobStorage,
  wrap: (fs: FileSystem) => FileSystem,
): () => void {
  const internals = storage as unknown as { fs: FileSystem };
  const original = internals.fs;
  internals.fs = wrap(original);
  return () => {
    internals.fs = original;
  };
}

function proxyFileSystem(
  fs: FileSystem,
  overrides: Partial<FileSystem>,
): FileSystem {
  return new Proxy(fs, {
    get(target, property) {
      const override = Reflect.get(overrides, property);
      if (override !== undefined) return override;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function failNextCommit(storage: LocalBlobStorage, message: string): () => void {
  let failed = false;
  return replaceFileSystem(
    storage,
    (fs) =>
      proxyFileSystem(fs, {
        rename: async (oldPath, newPath) => {
          if (!failed && newPath.split(/[\\/]/).includes("commits")) {
            failed = true;
            throw new Error(message);
          }
          if (!fs.rename) throw new Error("rename unavailable");
          await fs.rename(oldPath, newPath);
        },
      }),
  );
}

function setCommitId(storage: LocalBlobStorage, commitId: string): void {
  (storage as unknown as { createCommitId: () => string }).createCommitId = () => commitId;
}

async function withTempStorage(
  fn: (storage: LocalBlobStorage, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await makeTempDir({ prefix: "vf_blob_test_" });
  const storage = new LocalBlobStorage(dir);

  try {
    await fn(storage, dir);
  } finally {
    await remove(dir, { recursive: true });
  }
}

describe("LocalBlobStorage", () => {
  it("put and get text", async () => {
    await withTempStorage(async (storage) => {
      const data = "Hello, Blob!";
      const ref = await storage.put(data, { mimeType: "text/plain" });

      assertExists(ref.id);
      assertEquals(ref.size, new TextEncoder().encode(data).length);
      assertEquals(ref.mimeType, "text/plain");

      const retrieved = await storage.getText(ref.id);
      assertEquals(retrieved, data);
    });
  });

  it("put and get bytes", async () => {
    await withTempStorage(async (storage) => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const ref = await storage.put(data, {
        mimeType: "application/octet-stream",
      });

      assertExists(ref.id);
      assertEquals(ref.size, data.length);
      assertEquals(ref.mimeType, "application/octet-stream");

      const retrieved = await storage.getBytes(ref.id);
      assertExists(retrieved);
      // Compare as arrays to handle Buffer vs Uint8Array differences
      assertEquals([...retrieved], [...data]);
    });
  });

  it("keeps case-distinct IDs independent on case-insensitive filesystems", async () => {
    await withTempStorage(async (storage, dir) => {
      await storage.put("upper", { id: "A" });
      await storage.put("lower", { id: "a" });

      assertEquals(await storage.getText("A"), "upper");
      assertEquals(await storage.getText("a"), "lower");
      assertEquals((await storage.list()).map((ref) => ref.id).sort(), ["A", "a"]);
      assert((await encodedObjectDir(dir, "A")) !== (await encodedObjectDir(dir, "a")));
    });
  });

  it("stores a maximum-length public ID without using it as a path component", async () => {
    await withTempStorage(async (storage, dir) => {
      const id = "A".repeat(255);
      const ref = await storage.put("maximum", { id });

      assertEquals(await storage.getText(id), "maximum");
      assertEquals((await storage.stat(id))?.id, ref.id);

      const components = (await encodedObjectDir(dir, id)).split(/[\\/]/).slice(-3);
      assertEquals(components.map((component) => component.length), [2, 2, 64]);
    });
  });

  it("publishes later cross-instance writes when commit clocks collide or roll back", async () => {
    const dir = await makeTempDir({ prefix: "vf_blob_test_" });
    const first = new LocalBlobStorage(dir);
    const second = new LocalBlobStorage(dir);
    setCommitId(first, `ffffffffffff-ffffffff-${"f".repeat(32)}`);
    setCommitId(second, `000000000000-00000000-${"0".repeat(32)}`);

    try {
      await first.put("first", { id: "shared-clock" });
      await second.put("second", { id: "shared-clock" });

      assertEquals(await first.getText("shared-clock"), "second");
      assertEquals(await second.getText("shared-clock"), "second");
    } finally {
      await remove(dir, { recursive: true });
    }
  });

  it("validates and snapshots all caller-controlled metadata before staging", async () => {
    await withTempStorage(async (storage) => {
      const invalidOptions: unknown[] = [
        { id: "invalid-mime-empty", mimeType: "" },
        { id: "invalid-mime-space", mimeType: "   " },
        { id: "invalid-mime-long", mimeType: "x".repeat(257) },
        { id: "invalid-ttl-zero", ttl: 0 },
        { id: "invalid-ttl-negative", ttl: -1 },
        { id: "invalid-ttl-nan", ttl: Number.NaN },
        { id: "invalid-ttl-infinite", ttl: Number.POSITIVE_INFINITY },
        {
          id: "invalid-metadata-count",
          metadata: Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`key-${index}`, "value"]),
          ),
        },
        { id: "invalid-metadata-value", metadata: { key: 1 } },
        { id: "invalid-metadata-bytes", metadata: { key: "x".repeat(65_537) } },
      ];

      for (const options of invalidOptions) {
        const error = await assertRejects(
          () => storage.put("data", options as never),
          Error,
        );
        assertEquals((error as { slug?: unknown }).slug, "invalid-argument");
      }

      const metadata = { owner: "original" };
      const restore = replaceFileSystem(
        storage,
        (fs) =>
          proxyFileSystem(fs, {
            writeFile: async (path, data) => {
              metadata.owner = "mutated-during-write";
              await fs.writeFile(path, data);
            },
          }),
      );
      let ref;
      try {
        ref = await storage.put("snapshot", { id: "metadata-snapshot", metadata });
      } finally {
        restore();
      }
      metadata.owner = "mutated-after-write";

      assertEquals(ref.metadata, { owner: "original" });
      assertEquals((await storage.stat("metadata-snapshot"))?.metadata, { owner: "original" });
    });
  });

  it("rejects invalid clocks and base URLs before writing", async () => {
    await withTempStorage(async (_storage, dir) => {
      assertThrows(
        () => new LocalBlobStorage(dir, "not an absolute URL"),
        Error,
      );

      const invalidClock = new LocalBlobStorage(dir, undefined, {
        now: () => new Date(Number.NaN),
      });
      const error = await assertRejects(
        () => invalidClock.put("data", { id: "invalid-clock" }),
        Error,
      );
      assertEquals((error as { slug?: unknown }).slug, "invalid-argument");
    });
  });

  it("uses private permissions for storage directories and committed files", async () => {
    await withTempStorage(async (storage) => {
      const chmodCalls: Array<{ path: string; mode: number }> = [];
      const restore = replaceFileSystem(
        storage,
        (fs) =>
          proxyFileSystem(fs, {
            chmod: async (path, mode) => {
              chmodCalls.push({ path, mode });
              await fs.chmod(path, mode);
            },
          }),
      );
      try {
        await storage.put("private", { id: "private-storage" });
      } finally {
        restore();
      }

      assert(chmodCalls.some(({ mode }) => mode === 0o700));
      assert(chmodCalls.some(({ path, mode }) => path.endsWith("payload") && mode === 0o600));
      assert(chmodCalls.some(({ path, mode }) =>
        path.endsWith("metadata.json") && mode === 0o600
      ));
    });
  });

  it("sanitizes commit failures and preserves them when cleanup also fails", async () => {
    await withTempStorage(async (storage) => {
      class PrimaryCommitError extends Error {
        override name = "PrimaryCommitError";
      }
      class SecondaryCleanupError extends Error {
        override name = "SecondaryCleanupError";
      }

      const restore = replaceFileSystem(
        storage,
        (fs) =>
          proxyFileSystem(fs, {
            rename: async (oldPath, newPath) => {
              if (newPath.split(/[\\/]/).includes("commits")) {
                throw new PrimaryCommitError("primary exposed <TOKEN> at <LOCAL_PATH>");
              }
              if (!fs.rename) throw new Error("rename unavailable");
              await fs.rename(oldPath, newPath);
            },
            remove: (path, options) =>
              path.split(/[\\/]/).includes("staging")
                ? Promise.reject(
                  new SecondaryCleanupError("cleanup exposed <TOKEN> at <LOCAL_PATH>"),
                )
                : fs.remove(path, options),
          }),
      );
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));

      try {
        const error = await assertRejects(
          () => storage.put("private", { id: "contained-write-error" }),
          Error,
          "Failed to store blob in local storage",
        );
        assertEquals((error as { slug?: unknown }).slug, "unknown-error");
      } finally {
        restore();
        __resetLogRecordEmitterForTests();
      }

      const serialized = JSON.stringify(entries);
      assert(serialized.includes("PrimaryCommitError"));
      assert(serialized.includes("SecondaryCleanupError"));
      assertEquals(serialized.includes("<TOKEN>"), false);
      assertEquals(serialized.includes("<LOCAL_PATH>"), false);
    });
  });

  it("does not advertise a failed initial commit", async () => {
    await withTempStorage(async (storage, dir) => {
      const restore = failNextCommit(storage, "commit failed");
      try {
        await assertRejects(
          () => storage.put("uncommitted", { id: "failed-initial" }),
          Error,
          "commit failed",
        );
      } finally {
        restore();
      }

      assertEquals(await storage.stat("failed-initial"), null);
      assertEquals(await storage.getText("failed-initial"), null);
      assertEquals(await storage.list(), []);
      await assertStagingEmpty(dir, "failed-initial");
    });
  });

  it("preserves the committed value when a replacement commit fails", async () => {
    await withTempStorage(async (storage, dir) => {
      await storage.put("committed", { id: "replace-failure", mimeType: "text/old" });

      const restore = failNextCommit(storage, "replacement commit failed");
      try {
        await assertRejects(
          () =>
            storage.put("replacement", {
              id: "replace-failure",
              mimeType: "text/new",
            }),
          Error,
          "replacement commit failed",
        );
      } finally {
        restore();
      }

      assertEquals(await storage.getText("replace-failure"), "committed");
      assertEquals((await storage.stat("replace-failure"))?.mimeType, "text/old");
      await assertStagingEmpty(dir, "replace-failure");
    });
  });

  it("rejects blob IDs containing path traversal sequences", async () => {
    await withTempStorage(async (storage) => {
      await assertRejects(
        () => storage.put("hello", { id: "../../outside" }),
        Error,
        "Invalid blob id",
      );
      await assertRejects(
        () => storage.getText("../secret"),
        Error,
        "Invalid blob id",
      );
      await assertRejects(
        () => storage.stat("nested/blob"),
        Error,
        "Invalid blob id",
      );
      await assertRejects(
        () => storage.delete(".."),
        Error,
        "Invalid blob id",
      );
    });
  });

  it("sanitizes local read failures", async () => {
    await withTempStorage(async (storage) => {
      await storage.put("stored", { id: "blob-id" });
      const internals = storage as unknown as { fs: FileSystem };
      const original = internals.fs;
      const restore = replaceFileSystem(
        storage,
        (fs) =>
          proxyFileSystem(fs, {
            readTextFile: (path) =>
              path.endsWith("metadata.json")
                ? original.readTextFile(path)
                : Promise.reject(new Error("read exposed <TOKEN> at <LOCAL_PATH>")),
            readFile: () => Promise.reject(new Error("read exposed <TOKEN> at <LOCAL_PATH>")),
          }),
      );
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));

      try {
        const textError = await assertRejects(() => storage.getText("blob-id"));
        const bytesError = await assertRejects(() => storage.getBytes("blob-id"));
        assertInstanceOf(textError, Error);
        assertInstanceOf(bytesError, Error);
        assertEquals(textError.message, "Failed to read blob text from local storage");
        assertEquals(bytesError.message, "Failed to read blob bytes from local storage");
      } finally {
        restore();
        __resetLogRecordEmitterForTests();
      }

      assertEquals(entries.map((entry) => entry.context), [
        { errorName: "Error" },
        { errorName: "Error" },
      ]);
      assertEquals(JSON.stringify(entries).includes("<TOKEN>"), false);
      assertEquals(JSON.stringify(entries).includes("<LOCAL_PATH>"), false);
    });
  });

  it("put with TTL and cleanup", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    let now = Date.now();
    const storage = new LocalBlobStorage(testDir, undefined, {
      now: () => new Date(now),
    });

    try {
      const expiredData = "Expired content";
      const expiredRef = await storage.put(expiredData, { id: "zz-expired", ttl: 1 });
      assertExists(expiredRef.expiresAt);
      assert(expiredRef.expiresAt <= new Date(now + 2000));

      const validData = "Valid content";
      const validRef = await storage.put(validData, { id: "G_-valid", ttl: 3600 });
      assertExists(validRef.expiresAt);
      assert(validRef.expiresAt > new Date(now + 3000));

      now += 1500;

      assert(await storage.exists(expiredRef.id));
      assert(await storage.exists(validRef.id));

      await storage.cleanupExpiredBlobs();

      assert(!await storage.exists(expiredRef.id));
      assert(await storage.exists(validRef.id));

      const validStat = await storage.stat(validRef.id);
      assertExists(validStat);
      assertEquals(validStat.id, validRef.id);
      assertEquals(validStat.size, new TextEncoder().encode(validData).length);
      assertExists(validStat.expiresAt);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("lists blobs from every valid ID prefix", async () => {
    await withTempStorage(async (storage) => {
      for (const id of ["A", "Zz-listed", "_x-listed", "--listed", "9f-listed"]) {
        await storage.put(id, { id });
      }

      const ids = (await storage.list()).map((ref) => ref.id).sort();
      assertEquals(ids, ["--listed", "9f-listed", "A", "Zz-listed", "_x-listed"]);
    });
  });

  it("delete existing blob", async () => {
    await withTempStorage(async (storage) => {
      const data = "Data to delete";
      const ref = await storage.put(data);

      assert(await storage.exists(ref.id));
      assertExists(await storage.stat(ref.id));

      await storage.delete(ref.id);

      assert(!await storage.exists(ref.id));
      assertEquals(await storage.stat(ref.id), null);
    });
  });

  it("delete non-existent blob (no error)", async () => {
    await withTempStorage(async (storage) => {
      await storage.delete("non-existent-id");
      assert(true, "Delete did not throw for non-existent blob");
    });
  });

  it("does not return metadata whose committed payload is absent", async () => {
    await withTempStorage(async (storage, dir) => {
      const ref = await storage.put("metadata remains", { id: "metadata-only" });
      await remove(join(await latestCommitDir(dir, ref.id), "payload"));

      await assertRejects(
        () => storage.stat(ref.id),
        Error,
        "Failed to read blob metadata from local storage",
      );
      await assertRejects(
        () => storage.list(),
        Error,
        "Failed to read blob metadata from local storage",
      );

      await storage.delete(ref.id);

      assertEquals(await storage.stat(ref.id), null);
      assertEquals(await storage.list(), []);
    });
  });

  it("preserves a blob when its delete commit fails", async () => {
    await withTempStorage(async (storage, dir) => {
      await storage.put("keep", { id: "delete-failure" });
      const restore = failNextCommit(storage, "delete commit failed");
      try {
        await assertRejects(
          () => storage.delete("delete-failure"),
          Error,
          "delete commit failed",
        );
      } finally {
        restore();
      }

      assertEquals(await storage.getText("delete-failure"), "keep");
      await assertStagingEmpty(dir, "delete-failure");
    });
  });

  it("stat non-existent blob", async () => {
    await withTempStorage(async (storage) => {
      assertEquals(await storage.stat("non-existent-id"), null);
    });
  });

  it("throws a stable typed error for unreadable metadata", async () => {
    await withTempStorage(async (storage) => {
      await storage.put("stored", { id: "blob-id" });
      const restore = replaceFileSystem(
        storage,
        (fs) =>
          proxyFileSystem(fs, {
            readTextFile: () =>
              Promise.reject(new Error("metadata exposed <TOKEN> at <LOCAL_PATH>")),
          }),
      );
      try {
        const error = await assertRejects(
          () => storage.stat("blob-id"),
          Error,
          "Failed to read blob metadata from local storage",
        );
        assertEquals((error as { slug?: unknown }).slug, "unknown-error");
        assertEquals(error.message.includes("<TOKEN>"), false);
        assertEquals(error.message.includes("<LOCAL_PATH>"), false);
      } finally {
        restore();
      }
    });
  });

  it("rejects malformed or inconsistent metadata", async () => {
    await withTempStorage(async (storage, dir) => {
      const ref = await storage.put("metadata", { id: "validated-metadata" });
      const metadataPath = join(await latestCommitDir(dir, ref.id), "metadata.json");
      const storedCommit = JSON.parse(await readTextFile(metadataPath));
      const invalidMetadata: unknown[] = [
        "{<TOKEN>",
        { ...storedCommit, id: "different-id" },
        { ...storedCommit, ref: { ...storedCommit.ref, size: -1 } },
        { ...storedCommit, ref: { ...storedCommit.ref, createdAt: "not-a-date" } },
        { ...storedCommit, ref: { ...storedCommit.ref, expiresAt: "not-a-date" } },
      ];

      for (const value of invalidMetadata) {
        await writeTextFile(
          metadataPath,
          typeof value === "string" ? value : JSON.stringify(value),
        );
        const error = await assertRejects(
          () => storage.stat(ref.id),
          Error,
          "Failed to read blob metadata from local storage",
        );
        assertEquals((error as { slug?: unknown }).slug, "unknown-error");
        assertEquals(error.message.includes("<TOKEN>"), false);
      }
    });
  });

  it("exists non-existent blob", async () => {
    await withTempStorage(async (storage) => {
      assert(!await storage.exists("non-existent-id"));
    });
  });

  it("rootDir is created if not exists", async () => {
    const parentDir = await makeTempDir({ prefix: "vf_blob_test_root_" });
    const nonExistentDir = join(parentDir, "sub_dir");
    const storage = new LocalBlobStorage(nonExistentDir);

    try {
      const data = "Initial data";
      const ref = await storage.put(data);
      assert(await storage.exists(ref.id), "Blob should exist after put");

      const statResult = await stat(nonExistentDir);
      assert(statResult.isDirectory, "Root directory should be created");
    } finally {
      await remove(parentDir, { recursive: true });
    }
  });

  it("getStream", async () => {
    await withTempStorage(async (storage) => {
      const data = "Stream me this content.";
      const ref = await storage.put(data, { mimeType: "text/plain" });

      const stream = await storage.getStream(ref.id);
      assertExists(stream);

      const reader = stream.getReader();
      let receivedData = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedData += new TextDecoder().decode(value);
      }

      assertEquals(receivedData, data);
    });
  });

  it("put with ReadableStream", async () => {
    await withTempStorage(async (storage) => {
      const textEncoder = new TextEncoder();
      const chunks = ["hello", " ", "world"];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(textEncoder.encode(chunk));
          }
          controller.close();
        },
      });

      const ref = await storage.put(stream, { mimeType: "text/plain" });
      assertExists(ref.id);
      assertEquals(ref.size, textEncoder.encode(chunks.join("")).length);

      const retrieved = await storage.getText(ref.id);
      assertEquals(retrieved, chunks.join(""));
    });
  });
});
