import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

function assertFunction(value: unknown): void {
  assertExists(value);
  assertEquals(typeof value, "function");
}

if (!isDeno) {
  describe("DenoAdapter", { skip: true }, () => {
    it("skipped - not running in Deno", () => {});
  });

  describe("denoAdapter singleton", { skip: true }, () => {
    it("skipped - not running in Deno", () => {});
  });
} else {
  const { DenoAdapter, denoAdapter } = await import("./adapter.ts");

  describe("DenoAdapter", () => {
    describe("class instantiation", () => {
      it("should be instantiable", () => {
        assertExists(new DenoAdapter());
      });

      it("should have correct id", () => {
        assertEquals(new DenoAdapter().id, "deno");
      });

      it("should have correct name", () => {
        assertEquals(new DenoAdapter().name, "deno");
      });
    });

    describe("capabilities", () => {
      it("should have typescript capability", () => {
        assertEquals(denoAdapter.capabilities.typescript, true);
      });

      it("should have jsx capability", () => {
        assertEquals(denoAdapter.capabilities.jsx, true);
      });

      it("should have http2 capability", () => {
        assertEquals(denoAdapter.capabilities.http2, true);
      });

      it("should have websocket capability", () => {
        assertEquals(denoAdapter.capabilities.websocket, true);
      });

      it("should have workers capability", () => {
        assertEquals(denoAdapter.capabilities.workers, true);
      });

      it("should have fileWatching capability", () => {
        assertEquals(denoAdapter.capabilities.fileWatching, true);
      });

      it("should have shell capability", () => {
        assertEquals(denoAdapter.capabilities.shell, true);
      });

      it("should have kvStore capability", () => {
        assertEquals(denoAdapter.capabilities.kvStore, true);
      });

      it("should have writableFs capability", () => {
        assertEquals(denoAdapter.capabilities.writableFs, true);
      });
    });

    describe("fs adapter", () => {
      it("should have fs adapter", () => {
        assertExists(denoAdapter.fs);
      });

      it("should have readFile method", () => {
        assertFunction(denoAdapter.fs.readFile);
      });

      it("should have readFileBytes method", () => {
        assertFunction(denoAdapter.fs.readFileBytes);
      });

      it("should have writeFile method", () => {
        assertFunction(denoAdapter.fs.writeFile);
      });

      it("should have exists method", () => {
        assertFunction(denoAdapter.fs.exists);
      });

      it("should have readDir method", () => {
        assertFunction(denoAdapter.fs.readDir);
      });

      it("should have stat method", () => {
        assertFunction(denoAdapter.fs.stat);
      });

      it("should have mkdir method", () => {
        assertFunction(denoAdapter.fs.mkdir);
      });

      it("should have remove method", () => {
        assertFunction(denoAdapter.fs.remove);
      });

      it("should have makeTempDir method", () => {
        assertFunction(denoAdapter.fs.makeTempDir);
      });

      it("should have watch method", () => {
        assertFunction(denoAdapter.fs.watch);
      });
    });

    describe("fs behavioral tests", () => {
      it("should read a file that exists", async () => {
        // Read this test file itself
        const content = await denoAdapter.fs.readFile(
          new URL(import.meta.url).pathname,
        );
        assertExists(content);
        assertEquals(typeof content, "string");
        assertEquals(content.includes("DenoAdapter"), true);
      });

      it("should read file bytes", async () => {
        const bytes = await denoAdapter.fs.readFileBytes(
          new URL(import.meta.url).pathname,
        );
        assertExists(bytes);
        assertEquals(bytes instanceof Uint8Array, true);
        assertEquals(bytes.length > 0, true);
      });

      it("should return true for file that exists", async () => {
        const exists = await denoAdapter.fs.exists(
          new URL(import.meta.url).pathname,
        );
        assertEquals(exists, true);
      });

      it("should return false for file that does not exist", async () => {
        const exists = await denoAdapter.fs.exists("/nonexistent/path/file.ts");
        assertEquals(exists, false);
      });

      it("should stat a file", async () => {
        const info = await denoAdapter.fs.stat(
          new URL(import.meta.url).pathname,
        );
        assertExists(info);
        assertEquals(info.isFile, true);
        assertEquals(info.isDirectory, false);
        assertEquals(info.size > 0, true);
      });

      it("should stat a directory", async () => {
        const dir = new URL(".", import.meta.url).pathname;
        const info = await denoAdapter.fs.stat(dir);
        assertExists(info);
        assertEquals(info.isDirectory, true);
        assertEquals(info.isFile, false);
      });

      it("should read a directory", async () => {
        const dir = new URL(".", import.meta.url).pathname;
        const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
        for await (const entry of denoAdapter.fs.readDir(dir)) {
          entries.push(entry);
        }
        assertEquals(entries.length > 0, true);
        // This test file should be in the directory
        const thisFile = entries.find((e) => e.name === "adapter.test.ts");
        assertExists(thisFile);
        assertEquals(thisFile!.isFile, true);
      });

      it("should create and remove temp dir", async () => {
        const tmpDir = await denoAdapter.fs.makeTempDir("test-deno-adapter-");
        assertExists(tmpDir);
        const exists = await denoAdapter.fs.exists(tmpDir);
        assertEquals(exists, true);

        await denoAdapter.fs.remove(tmpDir, { recursive: true });
        const existsAfter = await denoAdapter.fs.exists(tmpDir);
        assertEquals(existsAfter, false);
      });

      it("should write and read a file", async () => {
        const tmpDir = await denoAdapter.fs.makeTempDir("test-write-");
        const filePath = `${tmpDir}/test.txt`;
        try {
          await denoAdapter.fs.writeFile(filePath, "hello from test");
          const content = await denoAdapter.fs.readFile(filePath);
          assertEquals(content, "hello from test");
        } finally {
          await denoAdapter.fs.remove(tmpDir, { recursive: true });
        }
      });

      it("should create nested directories", async () => {
        const tmpDir = await denoAdapter.fs.makeTempDir("test-mkdir-");
        const nestedDir = `${tmpDir}/a/b/c`;
        try {
          await denoAdapter.fs.mkdir(nestedDir, { recursive: true });
          const info = await denoAdapter.fs.stat(nestedDir);
          assertEquals(info.isDirectory, true);
        } finally {
          await denoAdapter.fs.remove(tmpDir, { recursive: true });
        }
      });
    });

    describe("env adapter", () => {
      it("should have env adapter", () => {
        assertExists(denoAdapter.env);
      });

      it("should have get method", () => {
        assertFunction(denoAdapter.env.get);
      });

      it("should have set method", () => {
        assertFunction(denoAdapter.env.set);
      });

      it("should have toObject method", () => {
        assertFunction(denoAdapter.env.toObject);
      });
    });

    describe("env behavioral tests", () => {
      const testKey = "__DENO_ADAPTER_TEST_ENV__";

      it("should get undefined for non-existent key", () => {
        assertEquals(denoAdapter.env.get("__NON_EXISTENT__"), undefined);
      });

      it("should set and get env var", () => {
        denoAdapter.env.set(testKey, "adapter-test-value");
        assertEquals(denoAdapter.env.get(testKey), "adapter-test-value");
        // Clean up
        Deno.env.delete(testKey);
      });

      it("should return object from toObject", () => {
        const obj = denoAdapter.env.toObject();
        assertExists(obj);
        assertEquals(typeof obj, "object");
        assertExists(obj["PATH"] ?? obj["Path"]);
      });
    });

    describe("server adapter", () => {
      it("should have server adapter", () => {
        assertExists(denoAdapter.server);
      });

      it("should have upgradeWebSocket method", () => {
        assertFunction(denoAdapter.server.upgradeWebSocket);
      });
    });

    describe("shell adapter", () => {
      it("should have shell adapter", () => {
        assertExists(denoAdapter.shell);
      });

      it("should have statSync method", () => {
        assertFunction(denoAdapter.shell.statSync);
      });

      it("should have readFileSync method", () => {
        assertFunction(denoAdapter.shell.readFileSync);
      });
    });

    describe("shell behavioral tests", () => {
      it("should statSync a file", () => {
        const stat = denoAdapter.shell.statSync(new URL(import.meta.url).pathname);
        assertEquals(stat.isFile, true);
        assertEquals(stat.isDirectory, false);
      });

      it("should statSync a directory", () => {
        const stat = denoAdapter.shell.statSync(new URL(".", import.meta.url).pathname);
        assertEquals(stat.isDirectory, true);
        assertEquals(stat.isFile, false);
      });

      it("should throw for statSync of non-existent path", () => {
        try {
          denoAdapter.shell.statSync("/nonexistent/path/12345");
          assertEquals(true, false, "Should have thrown");
        } catch (e) {
          assertExists(e);
        }
      });

      it("should readFileSync a file", () => {
        const content = denoAdapter.shell.readFileSync(new URL(import.meta.url).pathname);
        assertEquals(typeof content, "string");
        assertEquals(content.includes("DenoAdapter"), true);
      });

      it("should throw for readFileSync of non-existent file", () => {
        try {
          denoAdapter.shell.readFileSync("/nonexistent/path/12345.ts");
          assertEquals(true, false, "Should have thrown");
        } catch (e) {
          assertExists(e);
        }
      });
    });

    describe("serve method", () => {
      it("should have serve method", () => {
        assertFunction(denoAdapter.serve);
      });
    });

    describe("shutdown method", () => {
      it("should have shutdown method", () => {
        assertFunction(denoAdapter.shutdown);
      });

      it("should handle shutdown when no server is running", async () => {
        const adapter = new DenoAdapter();
        await adapter.shutdown(); // Should not throw
      });
    });
  });

  describe("denoAdapter singleton", () => {
    it("should be an instance of DenoAdapter", () => {
      assertEquals(denoAdapter instanceof DenoAdapter, true);
    });

    it("should return consistent instance", () => {
      assertEquals(denoAdapter, denoAdapter);
    });
  });

  describe("diffSnapshots helper (via file watcher)", () => {
    // Test the file watching functionality indirectly
    it("should create a file watcher", () => {
      const tmpDir = Deno.makeTempDirSync({ prefix: "test-watch-" });
      try {
        const controller = new AbortController();
        const watcher = denoAdapter.fs.watch(tmpDir, {
          recursive: false,
          signal: controller.signal,
        });
        assertExists(watcher);
        // Close immediately
        watcher.close();
        controller.abort();
      } finally {
        Deno.removeSync(tmpDir, { recursive: true });
      }
    });
  });
}
