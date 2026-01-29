import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "./mock.ts";

function collectDirEntries(
  iter: AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>,
): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
  const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
  return (async () => {
    for await (const entry of iter) {
      entries.push({ name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory });
    }
    return entries;
  })();
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

      const bytes = await adapter.fs.readFileBytes("/test.txt");
      assertEquals(new TextDecoder().decode(bytes), "hello");
    });

    it("should throw for non-existent file", async () => {
      const adapter = createMockAdapter();

      await assertRejects(
        () => adapter.fs.readFileBytes("/missing.txt"),
        Error,
        "File not found: /missing.txt",
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
