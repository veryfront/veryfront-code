import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { FSAdapterWrapper, NotSupportedError, wrapFSAdapter } from "./wrapper.ts";
import type { ContextualFSAdapter, FSAdapter } from "./veryfront/types.ts";

/**
 * Create a minimal mock FSAdapter for testing
 */
function createMockFSAdapter(overrides: Partial<FSAdapter> = {}): FSAdapter {
  return {
    readFile: async (path: string) => {
      if (path === "/exists.txt") return "content";
      throw new Error(`File not found: ${path}`);
    },
    exists: async (path: string) => path === "/exists.txt" || path === "/dir",
    stat: async (path: string) => {
      if (path === "/exists.txt") {
        return { size: 7, isFile: true, isDirectory: false, isSymlink: false, mtime: new Date() };
      }
      if (path === "/dir") {
        return { size: 0, isFile: false, isDirectory: true, isSymlink: false, mtime: new Date() };
      }
      throw new Error(`Path not found: ${path}`);
    },
    ...overrides,
  };
}

/**
 * Create a mock ContextualFSAdapter for testing contextual operations
 */
function createMockContextualAdapter(
  overrides: Partial<ContextualFSAdapter> = {},
): ContextualFSAdapter {
  return {
    ...createMockFSAdapter(),
    ...overrides,
  };
}

describe("NotSupportedError", () => {
  it("should create error with operation name", () => {
    const error = new NotSupportedError("writeFile");
    assertEquals(error.name, "NotSupportedError");
    assertEquals(error.message, "Operation 'writeFile' is not supported by this FSAdapter");
  });

  it("should create error with operation and adapter type", () => {
    const error = new NotSupportedError("writeFile", "MockAdapter");
    assertEquals(error.message, "Operation 'writeFile' is not supported by MockAdapter");
  });
});

describe("wrapFSAdapter", () => {
  it("should create FSAdapterWrapper instance", () => {
    const fsAdapter = createMockFSAdapter();
    const wrapper = wrapFSAdapter(fsAdapter);

    assertEquals(wrapper instanceof FSAdapterWrapper, true);
  });
});

describe("FSAdapterWrapper", () => {
  describe("readFile", () => {
    it("should read file using readTextFile if available", async () => {
      const fsAdapter = createMockFSAdapter({
        readTextFile: async () => "text content",
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const content = await wrapper.readFile("/any.txt");
      assertEquals(content, "text content");
    });

    it("should read file using readFile and decode if readTextFile not available", async () => {
      const fsAdapter = createMockFSAdapter({
        readFile: async () => new TextEncoder().encode("binary content"),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const content = await wrapper.readFile("/any.txt");
      assertEquals(content, "binary content");
    });

    it("should return string directly if readFile returns string", async () => {
      const fsAdapter = createMockFSAdapter({
        readFile: async () => "string content",
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const content = await wrapper.readFile("/any.txt");
      assertEquals(content, "string content");
    });
  });

  describe("readFileBytes", () => {
    it("should return Uint8Array directly if readFile returns bytes", async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const fsAdapter = createMockFSAdapter({
        readFile: async () => bytes,
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const result = await wrapper.readFileBytes("/any.txt");
      assertEquals(result, bytes);
    });

    it("should encode string to Uint8Array if readFile returns string", async () => {
      const fsAdapter = createMockFSAdapter({
        readFile: async () => "hello",
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const result = await wrapper.readFileBytes("/any.txt");
      assertEquals(new TextDecoder().decode(result), "hello");
    });
  });

  describe("writeFile", () => {
    it("should write file when writeFile is supported", async () => {
      let written: { path: string; content: string } | null = null;
      const fsAdapter = createMockFSAdapter({
        writeFile: async (path: string, content: string) => {
          written = { path, content };
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.writeFile("/new.txt", "new content");
      assertEquals(written, { path: "/new.txt", content: "new content" });
    });

    it("should throw NotSupportedError when writeFile not available", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await assertRejects(
        () => wrapper.writeFile("/new.txt", "content"),
        NotSupportedError,
      );
    });
  });

  describe("exists", () => {
    it("should delegate to fsAdapter.exists", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(await wrapper.exists("/exists.txt"), true);
      assertEquals(await wrapper.exists("/missing.txt"), false);
    });
  });

  describe("stat", () => {
    it("should return FileInfo for file", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const stat = await wrapper.stat("/exists.txt");
      assertEquals(stat.isFile, true);
      assertEquals(stat.isDirectory, false);
      assertEquals(stat.size, 7);
    });

    it("should return FileInfo for directory", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const stat = await wrapper.stat("/dir");
      assertEquals(stat.isFile, false);
      assertEquals(stat.isDirectory, true);
    });
  });

  describe("readDir", () => {
    it("should yield directory entries using readdir", async () => {
      const fsAdapter = createMockFSAdapter({
        readdir: async () => [
          { name: "file1.txt", path: "/dir/file1.txt", isFile: true, isDirectory: false, isSymlink: false },
          { name: "subdir", path: "/dir/subdir", isFile: false, isDirectory: true, isSymlink: false },
        ],
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
      for await (const entry of wrapper.readDir("/dir")) {
        entries.push({ name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory });
      }

      assertEquals(entries.length, 2);
      assertEquals(entries[0]?.name, "file1.txt");
      assertEquals(entries[1]?.name, "subdir");
    });

    it("should yield directory entries using readDir if readdir not available", async () => {
      const fsAdapter = createMockFSAdapter({
        readDir: async function* () {
          yield { name: "a.txt", path: "/dir/a.txt", isFile: true, isDirectory: false, isSymlink: false };
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const entries = [];
      for await (const entry of wrapper.readDir("/dir")) {
        entries.push(entry);
      }

      assertEquals(entries.length, 1);
      assertEquals(entries[0]?.name, "a.txt");
    });

    it("should throw NotSupportedError when neither readdir nor readDir available", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await assertRejects(
        async () => {
          const entries = [];
          for await (const entry of wrapper.readDir("/dir")) {
            entries.push(entry);
          }
        },
        NotSupportedError,
      );
    });
  });

  describe("readdir", () => {
    it("should return array of directory entries", async () => {
      const fsAdapter = createMockFSAdapter({
        readdir: async () => [
          { name: "file.txt", path: "/dir/file.txt", isFile: true, isDirectory: false, isSymlink: false },
        ],
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const entries = await wrapper.readdir("/dir");
      assertEquals(entries.length, 1);
      assertEquals(entries[0]?.name, "file.txt");
    });
  });

  describe("mkdir", () => {
    it("should create directory when supported", async () => {
      let created: { path: string; options?: { recursive?: boolean } } | null = null;
      const fsAdapter = createMockFSAdapter({
        mkdir: async (path: string, options?: { recursive?: boolean }) => {
          created = { path, options };
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.mkdir("/newdir", { recursive: true });
      assertEquals(created, { path: "/newdir", options: { recursive: true } });
    });

    it("should throw NotSupportedError when mkdir not available", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await assertRejects(
        () => wrapper.mkdir("/newdir"),
        NotSupportedError,
      );
    });
  });

  describe("remove", () => {
    it("should remove when supported", async () => {
      let removed: string | null = null;
      const fsAdapter = createMockFSAdapter({
        remove: async (path: string) => {
          removed = path;
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.remove("/file.txt");
      assertEquals(removed, "/file.txt");
    });

    it("should throw NotSupportedError when remove not available", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await assertRejects(
        () => wrapper.remove("/file.txt"),
        NotSupportedError,
      );
    });
  });

  describe("resolveFile", () => {
    it("should delegate to fsAdapter.resolveFile when available", async () => {
      const fsAdapter = createMockFSAdapter({
        resolveFile: async (basePath: string) => `${basePath}.tsx`,
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const resolved = await wrapper.resolveFile("/pages/index");
      assertEquals(resolved, "/pages/index.tsx");
    });

    it("should throw NotSupportedError when resolveFile not available", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.resolveFile("/pages/index"),
        NotSupportedError,
      );
    });
  });

  describe("makeTempDir", () => {
    it("should throw NotSupportedError (not supported by FSAdapter)", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.makeTempDir("test"),
        NotSupportedError,
      );
    });
  });

  describe("watch", () => {
    it("should throw NotSupportedError (not supported by FSAdapter)", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.watch("/dir"),
        NotSupportedError,
      );
    });
  });

  describe("shutdown", () => {
    it("should call fsAdapter.shutdown when available", async () => {
      let shutdownCalled = false;
      const fsAdapter = createMockFSAdapter({
        shutdown: async () => {
          shutdownCalled = true;
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.shutdown();
      assertEquals(shutdownCalled, true);
    });

    it("should do nothing when fsAdapter.shutdown not available", async () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      await wrapper.shutdown();
      // No error thrown
    });
  });

  describe("contextual operations", () => {
    it("isMultiProjectMode should return true when runWithContext available", () => {
      const fsAdapter = createMockContextualAdapter({
        runWithContext: async <T>(_slug: string, _token: string, fn: () => Promise<T>) => fn(),
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(wrapper.isMultiProjectMode(), true);
    });

    it("isMultiProjectMode should return false when runWithContext not available", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(wrapper.isMultiProjectMode(), false);
    });

    it("isContextualMode should return true when setRequestToken available", () => {
      const fsAdapter = createMockContextualAdapter({
        setRequestToken: () => {},
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertEquals(wrapper.isContextualMode(), true);
    });

    it("setRequestToken should throw when not supported", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.setRequestToken("token"),
        NotSupportedError,
      );
    });

    it("clearRequestToken should throw when not supported", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.clearRequestToken(),
        NotSupportedError,
      );
    });

    it("setRequestBranch should throw when not supported", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.setRequestBranch("main"),
        NotSupportedError,
      );
    });

    it("getRequestBranch should throw when not supported", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.getRequestBranch(),
        NotSupportedError,
      );
    });

    it("clearRequestBranch should throw when not supported", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.clearRequestBranch(),
        NotSupportedError,
      );
    });

    it("setProductionMode should throw when not supported", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.setProductionMode(true),
        NotSupportedError,
      );
    });

    it("runWithContext should throw when not supported", () => {
      const fsAdapter = createMockFSAdapter();
      const wrapper = new FSAdapterWrapper(fsAdapter);

      assertThrows(
        () => wrapper.runWithContext("slug", "token", async () => "result"),
        NotSupportedError,
      );
    });

    it("setRequestToken should delegate when supported", () => {
      let tokenSet: string | null = null;
      const fsAdapter = createMockContextualAdapter({
        setRequestToken: (token: string) => {
          tokenSet = token;
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      wrapper.setRequestToken("my-token");
      assertEquals(tokenSet, "my-token");
    });

    it("runWithContext should delegate when supported", async () => {
      let captured: { slug: string; token: string } | null = null;
      const fsAdapter = createMockContextualAdapter({
        runWithContext: async <T>(slug: string, token: string, fn: () => Promise<T>) => {
          captured = { slug, token };
          return fn();
        },
      });
      const wrapper = new FSAdapterWrapper(fsAdapter);

      const result = await wrapper.runWithContext("my-slug", "my-token", async () => "result");
      assertEquals(captured, { slug: "my-slug", token: "my-token" });
      assertEquals(result, "result");
    });
  });
});
