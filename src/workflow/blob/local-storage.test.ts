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
import { remove, stat, writeTextFile } from "#veryfront/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { LocalBlobStorage } from "./local-storage.ts";

function getStorageFileSystem(storage: LocalBlobStorage): FileSystem {
  return (storage as unknown as { fs: FileSystem }).fs;
}

function setStorageFileSystem(storage: LocalBlobStorage, fs: FileSystem): void {
  (storage as unknown as { fs: FileSystem }).fs = fs;
}

function delegateFileSystem(
  base: FileSystem,
  overrides: Partial<FileSystem>,
): FileSystem {
  const delegated: FileSystem = {
    readTextFile: (path) => base.readTextFile(path),
    readFile: (path) => base.readFile(path),
    writeTextFile: (path, data) => base.writeTextFile(path, data),
    writeFile: (path, data) => base.writeFile(path, data),
    rename: base.rename ? (from, to) => base.rename!(from, to) : undefined,
    exists: (path) => base.exists(path),
    stat: (path) => base.stat(path),
    lstat: base.lstat ? (path) => base.lstat!(path) : undefined,
    mkdir: (path, options) => base.mkdir(path, options),
    readDir: (path) => base.readDir(path),
    remove: (path, options) => base.remove(path, options),
    makeTempDir: (options) => base.makeTempDir(options),
    chmod: (path, mode) => base.chmod(path, mode),
  };
  return Object.assign(delegated, overrides);
}

async function directoryEntryNames(fs: FileSystem, path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of fs.readDir(path)) names.push(entry.name);
  return names.sort();
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

  it("atomically replaces a blob and removes the superseded payload", async () => {
    await withTempStorage(async (storage, dir) => {
      await storage.put("old", { id: "stable-id", mimeType: "text/plain" });
      await storage.put("new", { id: "stable-id", mimeType: "text/plain" });

      assertEquals(await storage.getText("stable-id"), "new");
      const names = await directoryEntryNames(getStorageFileSystem(storage), join(dir, "st"));
      assertEquals(names.filter((name) => name.endsWith(".data")).length, 1);
      assertEquals(names.filter((name) => name.endsWith(".meta.json")), [
        "stable-id.meta.json",
      ]);
      assertEquals(names.some((name) => name.endsWith(".tmp")), false);
    });
  });

  it("rolls back a failed metadata commit without disturbing an existing blob", async () => {
    await withTempStorage(async (storage, dir) => {
      await storage.put("old", { id: "stable-id", mimeType: "text/plain" });
      const base = getStorageFileSystem(storage);
      setStorageFileSystem(
        storage,
        delegateFileSystem(base, {
          rename: async (from, to) => {
            if (to.endsWith("stable-id.meta.json")) {
              throw new Error(`metadata rename failed: ${to}`);
            }
            await base.rename!(from, to);
          },
        }),
      );

      const error = await assertRejects(
        () => storage.put("new", { id: "stable-id", mimeType: "text/plain" }),
        Error,
        "Failed to commit blob to local storage",
      );
      assertInstanceOf(error, Error);
      assertEquals(error.message.includes(dir), false);

      setStorageFileSystem(storage, base);
      assertEquals(await storage.getText("stable-id"), "old");
      const names = await directoryEntryNames(base, join(dir, "st"));
      assertEquals(names.filter((name) => name.endsWith(".data")).length, 1);
      assertEquals(names.some((name) => name.endsWith(".tmp")), false);
    });
  });

  it("cleans up payload staging when writing the metadata sidecar fails", async () => {
    await withTempStorage(async (storage, dir) => {
      const base = getStorageFileSystem(storage);
      let payloadWrites = 0;
      setStorageFileSystem(
        storage,
        delegateFileSystem(base, {
          writeFile: async (path, data) => {
            payloadWrites++;
            await base.writeFile(path, data);
          },
          writeTextFile: (path, data) => {
            if (path.endsWith(".meta.tmp")) {
              return Promise.reject(new Error(`sidecar write failed: ${path}`));
            }
            return base.writeTextFile(path, data);
          },
        }),
      );

      const error = await assertRejects(
        () => storage.put("new", { id: "failed-id" }),
        Error,
        "Failed to commit blob to local storage",
      );
      assertInstanceOf(error, Error);
      assertEquals(error.message.includes(dir), false);
      assertEquals(payloadWrites, 1);
      assertEquals(
        await directoryEntryNames(base, join(dir, "fa")),
        [],
      );
    });
  });

  it("requires atomic rename before making filesystem writes", async () => {
    await withTempStorage(async (storage) => {
      const base = getStorageFileSystem(storage);
      let writes = 0;
      setStorageFileSystem(
        storage,
        delegateFileSystem(base, {
          rename: undefined,
          writeFile: async (path, data) => {
            writes++;
            await base.writeFile(path, data);
          },
          writeTextFile: async (path, data) => {
            writes++;
            await base.writeTextFile(path, data);
          },
        }),
      );
      await assertRejects(
        () => storage.put("payload", { id: "no-rename" }),
        Error,
        "requires atomic filesystem rename support",
      );
      assertEquals(writes, 0);
    });
  });

  it("rejects blob IDs containing path traversal sequences", async () => {
    await withTempStorage(async (storage) => {
      await assertRejects(
        () => storage.put("hello", { id: "../../outside" }),
        Error,
        "Blob IDs must contain only",
      );
      await assertRejects(
        () => storage.getText("../secret"),
        Error,
        "Blob IDs must contain only",
      );
      await assertRejects(
        () => storage.stat("nested/blob"),
        Error,
        "Blob IDs must contain only",
      );
      await assertRejects(
        () => storage.delete(".."),
        Error,
        "Blob IDs must contain only",
      );
    });
  });

  it("sanitizes local read failures", async () => {
    const storage = new LocalBlobStorage(".");
    (storage as unknown as { fs: FileSystem }).fs = {
      readTextFile: (path: string) =>
        path.endsWith(".meta.json")
          ? Promise.reject(new Deno.errors.NotFound("metadata absent"))
          : Promise.reject(new Error("read exposed <TOKEN> at <LOCAL_PATH>")),
      readFile: () => Promise.reject(new Error("read exposed <TOKEN> at <LOCAL_PATH>")),
    } as unknown as FileSystem;
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
      __resetLogRecordEmitterForTests();
    }

    assertEquals(entries.map((entry) => entry.context), [
      { committed: false, errorName: "Error" },
      { committed: false, errorName: "Error" },
    ]);
    assertEquals(JSON.stringify(entries).includes("<TOKEN>"), false);
    assertEquals(JSON.stringify(entries).includes("<LOCAL_PATH>"), false);
  });

  it("put with TTL and cleanup", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    let now = Date.now();
    const storage = new LocalBlobStorage(testDir, undefined, {
      now: () => new Date(now),
    });

    try {
      const expiredData = "Expired content";
      const expiredRef = await storage.put(expiredData, { ttl: 1 });
      assertExists(expiredRef.expiresAt);
      assert(expiredRef.expiresAt <= new Date(now + 2000));

      const validData = "Valid content";
      const validRef = await storage.put(validData, { ttl: 3600 });
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

  it("lists and expires portable non-hex blob IDs", async () => {
    const testDir = await makeTempDir({ prefix: "vf_blob_test_" });
    let now = 1_800_000_000_000;
    const storage = new LocalBlobStorage(testDir, undefined, {
      now: () => new Date(now),
    });

    try {
      const ref = await storage.put("custom", { id: "zz-custom", ttl: 1 });
      assertEquals((await storage.list()).map(({ id }) => id), [ref.id]);

      now += 1_000;
      assertEquals(await storage.list(), []);
      await storage.cleanupExpiredBlobs();
      assertEquals(await storage.exists(ref.id), false);
      assertEquals(await storage.stat(ref.id), null);
    } finally {
      await remove(testDir, { recursive: true });
    }
  });

  it("fails closed on corrupt or mismatched metadata sidecars", async () => {
    await withTempStorage(async (storage, dir) => {
      const ref = await storage.put("payload", { id: "valid-id" });
      const metadataPath = join(dir, "va", `${ref.id}.meta.json`);

      await writeTextFile(metadataPath, "{not-json");
      await assertRejects(
        () => storage.stat(ref.id),
        Error,
        "Invalid blob metadata in local storage",
      );

      await writeTextFile(metadataPath, JSON.stringify({ ...ref, id: "different-id" }));
      await assertRejects(
        () => storage.stat(ref.id),
        Error,
        "Invalid blob metadata in local storage",
      );
    });
  });

  it("attempts both deletes and sanitizes operational failures", async () => {
    const storage = new LocalBlobStorage("/explicit/blob/root");
    const removed: string[] = [];
    (storage as unknown as { fs: FileSystem }).fs = {
      readTextFile: () => Promise.reject(new Deno.errors.NotFound("metadata absent")),
      remove: (path: string) => {
        removed.push(path);
        return Promise.reject(new Error(`permission denied: ${path}`));
      },
    } as unknown as FileSystem;

    const error = await assertRejects(
      () => storage.delete("blob-id"),
      Error,
      "Failed to delete blob from local storage",
    );
    assertInstanceOf(error, Error);
    assertEquals(error.message.includes("/explicit/blob/root"), false);
    assertEquals(removed.sort(), [
      "/explicit/blob/root/bl/blob-id",
      "/explicit/blob/root/bl/blob-id.meta.json",
    ]);
  });

  it("rejects invalid construction and storage metadata before filesystem writes", async () => {
    assertThrows(
      () => new LocalBlobStorage(""),
      Error,
      "Local blob rootDir must not be empty",
    );

    await withTempStorage(async (storage) => {
      for (const ttl of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assertRejects(
          () => storage.put("payload", { ttl }),
          Error,
          "Blob TTL must be a non-negative safe integer",
        );
      }
      await assertRejects(
        () =>
          storage.put("payload", {
            metadata: { unsafe: 7 } as unknown as Record<string, string>,
          }),
        Error,
        "Blob metadata values must be strings",
      );
      await assertRejects(
        () => storage.put("payload", { mimeType: "" }),
        Error,
        "Blob mimeType must be a non-empty string",
      );
    });
  });

  it("rejects hostile constructor and put records without invoking hooks", async () => {
    let hooks = 0;
    const constructorOptions = new Proxy({}, {
      get() {
        hooks++;
        throw new Error("must not run");
      },
      ownKeys() {
        hooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () =>
        new LocalBlobStorage(
          ".",
          undefined,
          constructorOptions as { now?: () => Date },
        ),
      Error,
      "non-Proxy plain record",
    );
    assertEquals(hooks, 0);

    const nowProxy = new Proxy(() => new Date(), {
      apply() {
        hooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () => new LocalBlobStorage(".", undefined, { now: nowProxy }),
      Error,
      "non-Proxy function",
    );
    assertEquals(hooks, 0);

    await withTempStorage(async (storage) => {
      const options = Object.create(null);
      Object.defineProperty(options, "metadata", {
        enumerable: true,
        get() {
          hooks++;
          return { secret: "unsafe" };
        },
      });
      await assertRejects(
        () => storage.put("payload", options),
        Error,
        "enumerable own data property",
      );
      assertEquals(hooks, 0);
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

  it("stat non-existent blob", async () => {
    await withTempStorage(async (storage) => {
      assertEquals(await storage.stat("non-existent-id"), null);
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
