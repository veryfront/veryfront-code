import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { FilesystemCacheStore } from "./filesystem-store.ts";
import type { CachePayload } from "../types.ts";

// Helper to create a valid cache payload
function createPayload(html: string): CachePayload {
  return {
    result: {
      html,
      frontmatter: {},
    },
    storedAt: Date.now(),
  };
}

describe("FilesystemCacheStore", () => {
  let store: FilesystemCacheStore;
  let mockAdapter: any;
  let files: Map<string, string>;

  beforeEach(() => {
    files = new Map();
    mockAdapter = {
      fs: {
        readFile: async (path: string) => {
          const content = files.get(path);
          if (!content) throw new Error("File not found");
          return content;
        },
        writeFile: async (path: string, content: string) => {
          files.set(path, content);
        },
        remove: async (path: string) => {
          files.delete(path);
        },
        mkdir: async () => {
          // Mock directory creation
        },
      },
    };

    store = new FilesystemCacheStore({
      baseDir: "/cache",
      adapter: mockAdapter,
    });
  });

  describe("constructor", () => {
    it("should create instance with options", () => {
      assertExists(store);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent key", async () => {
      const result = await store.get("nonexistent");
      assertEquals(result, undefined);
    });

    it("should retrieve cached value", async () => {
      const payload = createPayload("<h1>Test</h1>");
      const key = "test-key";
      const encodedKey = encodeURIComponent(key);
      files.set(`/cache/${encodedKey}.json`, JSON.stringify(payload));

      const result = await store.get(key);
      assertExists(result);
      assertEquals(result.result.html, "<h1>Test</h1>");
    });

    it("should return undefined for invalid JSON", async () => {
      const key = "invalid";
      const encodedKey = encodeURIComponent(key);
      files.set(`/cache/${encodedKey}.json`, "invalid json {");

      const result = await store.get(key);
      assertEquals(result, undefined);
    });

    it("should encode special characters in key", async () => {
      const payload = createPayload("<p>Data</p>");
      const key = "key/with/slashes";
      const encodedKey = encodeURIComponent(key);
      files.set(`/cache/${encodedKey}.json`, JSON.stringify(payload));

      const result = await store.get(key);
      assertExists(result);
      assertEquals(result.result.html, "<p>Data</p>");
    });
  });

  describe("set", () => {
    it("should store value with key", async () => {
      const payload = createPayload("<div>New</div>");
      await store.set("my-key", payload);

      const encodedKey = encodeURIComponent("my-key");
      const stored = files.get(`/cache/${encodedKey}.json`);
      assertExists(stored);
      const parsed = JSON.parse(stored);
      assertEquals(parsed.result.html, "<div>New</div>");
    });

    it("should overwrite existing value", async () => {
      const key = "overwrite";
      const first = createPayload("<p>First</p>");
      const second = createPayload("<p>Second</p>");

      await store.set(key, first);
      await store.set(key, second);

      const result = await store.get(key);
      assertExists(result);
      assertEquals(result.result.html, "<p>Second</p>");
    });

    it("should handle complex result objects", async () => {
      const payload: CachePayload = {
        result: {
          html: "<div>Complex</div>",
          frontmatter: {
            title: "Test",
            tags: ["test", "demo"],
          },
          css: "body { color: red; }",
          headings: [{ id: "h1", text: "Heading", level: 1 }],
        },
        storedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      await store.set("complex", payload);
      const result = await store.get("complex");

      assertExists(result);
      assertEquals(result.result.css, "body { color: red; }");
      assertEquals(result.result.headings?.length, 1);
      assertEquals(result.result.frontmatter.title, "Test");
    });
  });

  describe("delete", () => {
    it("should delete existing key", async () => {
      const payload = createPayload("<p>Delete me</p>");
      await store.set("delete-me", payload);

      await store.delete("delete-me");
      const result = await store.get("delete-me");

      assertEquals(result, undefined);
    });

    it("should not throw when deleting non-existent key", async () => {
      await store.delete("does-not-exist");
      // Should not throw
    });
  });

  describe("clear", () => {
    it("should remove all cache files", async () => {
      let removedPath: string | null = null;
      mockAdapter.fs.remove = async (path: string) => {
        removedPath = path;
        files.clear();
      };

      await store.set("key1", createPayload("<p>Val1</p>"));
      await store.set("key2", createPayload("<p>Val2</p>"));

      await store.clear();

      assertEquals(removedPath, "/cache");
      assertEquals(files.size, 0);
    });

    it("should not throw if base directory does not exist", async () => {
      mockAdapter.fs.remove = async () => {
        throw new Error("Directory not found");
      };

      await store.clear();
      // Should not throw
    });
  });

  describe("destroy", () => {
    it("should call clear", async () => {
      let clearCalled = false;
      mockAdapter.fs.remove = async () => {
        clearCalled = true;
      };

      await store.destroy();
      assertEquals(clearCalled, true);
    });
  });

  describe("filePathForKey", () => {
    it("should encode URI components in key", async () => {
      const payload = createPayload("<p>Test</p>");
      const key = "http://example.com/path?query=value";

      await store.set(key, payload);
      const result = await store.get(key);

      assertExists(result);
      assertEquals(result.result.html, "<p>Test</p>");
    });

    it("should append .json extension", async () => {
      const payload = createPayload("<p>Data</p>");
      await store.set("simple", payload);

      const encodedKey = encodeURIComponent("simple");
      assertExists(files.get(`/cache/${encodedKey}.json`));
    });
  });

  describe("ensureDir", () => {
    it("should create directory recursively", async () => {
      let mkdirCalled = false;
      let recursiveOption = false;

      mockAdapter.fs.mkdir = async (_path: string, options?: any) => {
        mkdirCalled = true;
        recursiveOption = options?.recursive || false;
      };

      await store.set("test", createPayload("<p>Data</p>"));

      assertEquals(mkdirCalled, true);
      assertEquals(recursiveOption, true);
    });

    it("should ignore existing directory errors", async () => {
      mockAdapter.fs.mkdir = async () => {
        const error = new Error("Directory already exists");
        throw error;
      };

      // Should not throw
      await store.set("test", createPayload("<p>Data</p>"));
    });
  });
});
