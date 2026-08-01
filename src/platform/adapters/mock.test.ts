import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "./mock.ts";
import { FileSnapshotChangedError } from "./file-snapshot-error.ts";

type DirEntry = { name: string; isFile: boolean; isDirectory: boolean };

async function collectDirEntries(iter: AsyncIterable<DirEntry>): Promise<DirEntry[]> {
  const entries: DirEntry[] = [];
  for await (const entry of iter) {
    entries.push(entry);
  }
  return entries;
}

describe("MockAdapter", () => {
  describe("creation", () => {
    it("should create a mock adapter with correct properties", () => {
      const adapter = createMockAdapter();

      assertEquals(adapter.id, "memory");
      assertEquals(adapter.name, "mock");
      assertEquals(adapter.capabilities.writableFs, true);
      assertEquals(adapter.capabilities.websocket, false);
    });
  });

  describe("fs.readFile", () => {
    it("should read file that exists", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test.txt", "hello world");

      const content = await adapter.fs.readFile("/test.txt");
      assertEquals(content, "hello world");
    });

    it("should throw for non-existent file", async () => {
      const adapter = createMockAdapter();

      await assertRejects(
        () => adapter.fs.readFile("/missing.txt"),
        Error,
        "File not found: /missing.txt",
      );
    });
  });

  describe("fs.readFileBytes", () => {
    it("should read file as bytes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test.txt", "hello");

      const readFileBytes = adapter.fs.readFileBytes;
      assertExists(readFileBytes);
      const bytes = await readFileBytes("/test.txt");
      assertEquals(new TextDecoder().decode(bytes), "hello");
    });

    it("preserves binary files exactly", async () => {
      const adapter = createMockAdapter();
      const writeFileBytes = adapter.fs.writeFileBytes;
      const readFileBytes = adapter.fs.readFileBytes;
      assertExists(writeFileBytes);
      assertExists(readFileBytes);
      const bytes = new Uint8Array([0, 255, 1, 128]);

      await writeFileBytes("/test.bin", bytes);

      assertEquals([...await readFileBytes("/test.bin")], [...bytes]);
      assertEquals(adapter.fs.byteFiles.get("/test.bin") === bytes, false);
    });

    it("should throw for non-existent file", async () => {
      const adapter = createMockAdapter();

      const readFileBytes = adapter.fs.readFileBytes;
      assertExists(readFileBytes);
      await assertRejects(
        () => readFileBytes("/missing.txt"),
        Error,
        "File not found: /missing.txt",
      );
    });
  });

  describe("fs.readFileSnapshotWithinLimit", () => {
    it("reads a complete contained snapshot within the exact limit", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/asset.bin", new Uint8Array([1, 2, 3]));
      const readSnapshot = adapter.fs.readFileSnapshotWithinLimit;
      assertExists(readSnapshot);

      assertEquals([...await readSnapshot("/project/asset.bin", "/project", 3)], [1, 2, 3]);
      await assertRejects(
        () => readSnapshot("/outside.bin", "/project", 3),
        TypeError,
        "contained",
      );
      await assertRejects(
        () => readSnapshot("/project/asset.bin", "/project", 2),
        RangeError,
        "exceeds",
      );
    });

    it("rejects replacement during a snapshot read", async () => {
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set("/project/asset.bin", new Uint8Array([1, 2, 3]));
      const readSnapshot = adapter.fs.readFileSnapshotWithinLimit;
      assertExists(readSnapshot);

      const read = readSnapshot("/project/asset.bin", "/project", 3);
      adapter.fs.byteFiles.set("/project/asset.bin", new Uint8Array([4, 5, 6]));

      await assertRejects(() => read, FileSnapshotChangedError, "changed");
    });
  });

  describe("fs.readFileBytesBounded", () => {
    it("reads only the requested UTF-8 byte prefix", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test.txt", "A€B");
      const readFileBytesBounded = adapter.fs.readFileBytesBounded;
      assertExists(readFileBytesBounded);

      assertEquals(
        [...await readFileBytesBounded("/test.txt", 3)],
        [65, 226, 130],
      );
    });

    it("reads bounded binary prefixes without exposing stored bytes", async () => {
      const adapter = createMockAdapter();
      const stored = new Uint8Array([0, 255, 1, 128]);
      adapter.fs.byteFiles.set("/test.bin", stored);
      const readFileBytesBounded = adapter.fs.readFileBytesBounded;
      assertExists(readFileBytesBounded);

      const prefix = await readFileBytesBounded("/test.bin", 2);
      assertEquals([...prefix], [0, 255]);
      prefix[0] = 99;
      assertEquals([...stored], [0, 255, 1, 128]);
    });

    it("does not inspect text beyond the requested byte prefix", async () => {
      const adapter = createMockAdapter();
      const source = "a".repeat(1_000_000);
      let codePointReads = 0;
      const observedSource = new Proxy(new String(source), {
        get(target, key) {
          if (key === "length") return source.length;
          if (key === "codePointAt") {
            return (index: number) => {
              codePointReads += 1;
              return source.codePointAt(index);
            };
          }
          return Reflect.get(target, key, target);
        },
      }) as unknown as string;
      adapter.fs.files.set("/large.txt", observedSource);
      const readFileBytesBounded = adapter.fs.readFileBytesBounded;
      assertExists(readFileBytesBounded);

      assertEquals([...await readFileBytesBounded("/large.txt", 1)], [97]);
      assertEquals(codePointReads, 1);
    });

    it("preserves missing-file and invalid-limit failures", async () => {
      const adapter = createMockAdapter();
      const readFileBytesBounded = adapter.fs.readFileBytesBounded;
      assertExists(readFileBytesBounded);

      await assertRejects(
        () => readFileBytesBounded("/missing.txt", 4),
        Error,
        "File not found: /missing.txt",
      );
      await assertRejects(
        () => readFileBytesBounded("/missing.txt", 0),
        RangeError,
        "positive safe integer",
      );
    });
  });

  describe("fs.readFileBytesWithinLimit", () => {
    it("returns complete text and binary files only when they fit", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/text.txt", "A€B");
      adapter.fs.byteFiles.set("/bytes.bin", new Uint8Array([0, 255, 1]));
      const readFileBytesWithinLimit = adapter.fs.readFileBytesWithinLimit;
      assertExists(readFileBytesWithinLimit);

      assertEquals(
        [...await readFileBytesWithinLimit("/text.txt", 5)],
        [65, 226, 130, 172, 66],
      );
      assertEquals(
        [...await readFileBytesWithinLimit("/bytes.bin", 3)],
        [0, 255, 1],
      );
      await assertRejects(
        () => readFileBytesWithinLimit("/text.txt", 4),
        RangeError,
        "exceeds byte limit of 4 bytes",
      );
      await assertRejects(
        () => readFileBytesWithinLimit("/bytes.bin", 2),
        RangeError,
        "exceeds byte limit of 2 bytes",
      );
    });

    it("preserves missing-file and invalid-limit failures", async () => {
      const readFileBytesWithinLimit = createMockAdapter().fs.readFileBytesWithinLimit;
      assertExists(readFileBytesWithinLimit);

      await assertRejects(
        () => readFileBytesWithinLimit("/missing.txt", 4),
        Error,
        "File not found: /missing.txt",
      );
      await assertRejects(
        () => readFileBytesWithinLimit("/missing.txt", 0),
        RangeError,
        "positive safe integer",
      );
    });
  });

  describe("fs.writeFile", () => {
    it("should write file", async () => {
      const adapter = createMockAdapter();

      await adapter.fs.writeFile("/new.txt", "content");
      assertEquals(adapter.fs.files.get("/new.txt"), "content");
    });

    it("should overwrite existing file", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test.txt", "old");

      await adapter.fs.writeFile("/test.txt", "new");
      assertEquals(adapter.fs.files.get("/test.txt"), "new");
    });
  });

  describe("fs.exists", () => {
    it("should return true for existing file", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test.txt", "content");

      assertEquals(await adapter.fs.exists("/test.txt"), true);
    });

    it("should return true for existing directory", async () => {
      const adapter = createMockAdapter();
      adapter.fs.directories.add("/mydir");

      assertEquals(await adapter.fs.exists("/mydir"), true);
    });

    it("should return true for implicit directory", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/dir/file.txt", "content");

      assertEquals(await adapter.fs.exists("/dir"), true);
    });

    it("should return false for non-existent path", async () => {
      const adapter = createMockAdapter();

      assertEquals(await adapter.fs.exists("/missing"), false);
    });
  });

  describe("fs.readDir", () => {
    it("should list directory contents", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/dir/file1.txt", "a");
      adapter.fs.files.set("/dir/file2.txt", "b");
      adapter.fs.files.set("/dir/subdir/file3.txt", "c");

      const entries = await collectDirEntries(adapter.fs.readDir("/dir"));

      assertEquals(entries.length, 3);
      assertEquals(entries.some((e) => e.name === "file1.txt" && e.isFile), true);
      assertEquals(entries.some((e) => e.name === "file2.txt" && e.isFile), true);
      assertEquals(entries.some((e) => e.name === "subdir" && e.isDirectory), true);
    });

    it("should return empty for empty directory", async () => {
      const adapter = createMockAdapter();
      adapter.fs.directories.add("/empty");

      const entries = await collectDirEntries(adapter.fs.readDir("/empty"));
      assertEquals(entries.length, 0);
    });

    it("lists root files and explicit empty directories", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/root.txt", "root");
      adapter.fs.directories.add("/empty");

      const entries = await collectDirEntries(adapter.fs.readDir("///"));
      assertEquals(
        entries.some((entry) => entry.name === "root.txt" && entry.isFile),
        true,
      );
      assertEquals(
        entries.some((entry) => entry.name === "empty" && entry.isDirectory),
        true,
      );
    });

    it("rejects missing paths and file paths", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/file.txt", "content");

      await assertRejects(
        () => collectDirEntries(adapter.fs.readDir("/missing")),
        Error,
        "Path not found",
      );
      await assertRejects(
        () => collectDirEntries(adapter.fs.readDir("/file.txt")),
        TypeError,
        "not a directory",
      );
    });
  });

  describe("fs.stat", () => {
    it("should stat a file", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test.txt", "hello");

      const stat = await adapter.fs.stat("/test.txt");
      assertEquals(stat.isFile, true);
      assertEquals(stat.isDirectory, false);
      assertEquals(stat.size, 5);
    });

    it("reports UTF-8 byte size rather than UTF-16 code units", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/unicode.txt", "€");

      assertEquals((await adapter.fs.stat("/unicode.txt")).size, 3);
    });

    it("should stat a directory", async () => {
      const adapter = createMockAdapter();
      adapter.fs.directories.add("/mydir");

      const stat = await adapter.fs.stat("/mydir");
      assertEquals(stat.isFile, false);
      assertEquals(stat.isDirectory, true);
    });

    it("should stat implicit directory", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/dir/file.txt", "content");

      const stat = await adapter.fs.stat("/dir");
      assertEquals(stat.isFile, false);
      assertEquals(stat.isDirectory, true);
    });

    it("should throw for non-existent path", async () => {
      const adapter = createMockAdapter();

      await assertRejects(
        () => adapter.fs.stat("/missing"),
        Error,
        "Path not found: /missing",
      );
    });
  });

  describe("fs.mkdir", () => {
    it("should add directory to directories set", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/newdir");

      assertEquals(adapter.fs.directories.has("/newdir"), true);
      assertEquals(await adapter.fs.exists("/newdir"), true);
    });

    it("should add parent directories when recursive", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/a/b/c", { recursive: true });

      assertEquals(adapter.fs.directories.has("/a"), true);
      assertEquals(adapter.fs.directories.has("/a/b"), true);
      assertEquals(adapter.fs.directories.has("/a/b/c"), true);
    });

    it("preserves relative paths when creating parents recursively", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("a/b", { recursive: true });

      assertEquals(adapter.fs.directories.has("a"), true);
      assertEquals(adapter.fs.directories.has("a/b"), true);
      assertEquals(adapter.fs.directories.has("/a"), false);
    });
  });

  describe("fs.remove", () => {
    it("should remove file from files map", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test.txt", "content");

      await adapter.fs.remove("/test.txt");

      assertEquals(adapter.fs.files.has("/test.txt"), false);
    });

    it("should remove directory from directories set", async () => {
      const adapter = createMockAdapter();
      adapter.fs.directories.add("/mydir");

      await adapter.fs.remove("/mydir");

      assertEquals(adapter.fs.directories.has("/mydir"), false);
    });

    it("should remove children when recursive", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/dir/file1.txt", "a");
      adapter.fs.files.set("/dir/file2.txt", "b");
      adapter.fs.files.set("/dir/sub/file3.txt", "c");
      adapter.fs.directories.add("/dir/sub");

      await adapter.fs.remove("/dir", { recursive: true });

      assertEquals(adapter.fs.files.has("/dir/file1.txt"), false);
      assertEquals(adapter.fs.files.has("/dir/file2.txt"), false);
      assertEquals(adapter.fs.files.has("/dir/sub/file3.txt"), false);
      assertEquals(adapter.fs.directories.has("/dir/sub"), false);
    });
  });

  describe("fs.makeTempDir", () => {
    it("should return temp directory path with prefix", async () => {
      const adapter = createMockAdapter();
      const tempDir = await adapter.fs.makeTempDir("test");

      assertEquals(tempDir.startsWith("/tmp/test"), true);
      assertEquals(await adapter.fs.exists(tempDir), true);
    });

    it("rejects path-bearing prefixes", async () => {
      const adapter = createMockAdapter();
      await assertRejects(
        () => adapter.fs.makeTempDir("../escape-"),
        TypeError,
        "must not contain",
      );
    });
  });

  describe("env", () => {
    it("should get and set environment variables", () => {
      const adapter = createMockAdapter();

      assertEquals(adapter.env.get("FOO"), undefined);
      adapter.env.set("FOO", "bar");
      assertEquals(adapter.env.get("FOO"), "bar");
    });

    it("should convert to object", () => {
      const adapter = createMockAdapter();
      adapter.env.set("A", "1");
      adapter.env.set("B", "2");

      const obj = adapter.env.toObject();
      assertEquals(obj, { A: "1", B: "2" });
    });
  });

  describe("server.upgradeWebSocket", () => {
    it("should throw not supported error", () => {
      const adapter = createMockAdapter();

      assertThrows(
        () => adapter.server.upgradeWebSocket(new Request("http://test")),
        Error,
        "WebSocket upgrade not available in mock adapter",
      );
    });
  });

  describe("serve", () => {
    it("should return a mock server", async () => {
      const adapter = createMockAdapter();

      const server = await adapter.serve(() => new Response("ok"), {});
      assertEquals(server.addr.hostname, "localhost");
      assertEquals(server.addr.port, 8000);

      await server.stop();
    });
  });

  describe("shutdown", () => {
    it("should resolve without error", async () => {
      const adapter = createMockAdapter();
      await adapter.shutdown?.();
    });
  });
});
