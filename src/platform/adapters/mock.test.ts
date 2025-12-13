import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertRejects } from "std/assert/mod.ts";
import { createMockAdapter } from "./mock.ts";

describe("platform/adapters/mock", () => {
  describe("createMockAdapter", () => {
    it("should create a mock adapter with correct id and platform", () => {
      const adapter = createMockAdapter();
      assertEquals(adapter.id, "memory");
      assertEquals(adapter.name, "mock");
      assertEquals(adapter.platform, "memory");
    });

    it("should have correct capabilities", () => {
      const adapter = createMockAdapter();

      assertEquals(adapter.capabilities.typescript, false);
      assertEquals(adapter.capabilities.jsx, false);
      assertEquals(adapter.capabilities.http2, false);
      assertEquals(adapter.capabilities.websocket, false);
      assertEquals(adapter.capabilities.workers, false);
      assertEquals(adapter.capabilities.fileWatching, false);
      assertEquals(adapter.capabilities.shell, false);
      assertEquals(adapter.capabilities.kvStore, false);
      assertEquals(adapter.capabilities.writableFs, true);
    });

    it("should have correct features", () => {
      const adapter = createMockAdapter();

      assertEquals(adapter.features.websocket, false);
      assertEquals(adapter.features.http2, false);
      assertEquals(adapter.features.workers, false);
      assertEquals(adapter.features.jsx, false);
      assertEquals(adapter.features.typescript, false);
    });

    describe("filesystem operations", () => {
      it("should write and read files", async () => {
        const adapter = createMockAdapter();

        await adapter.fs.writeFile("/test.txt", "Hello, World!");
        const content = await adapter.fs.readFile("/test.txt");

        assertEquals(content, "Hello, World!");
      });

      it("should read file as bytes", async () => {
        const adapter = createMockAdapter();

        await adapter.fs.writeFile("/test.txt", "Hello");
        const bytes = await adapter.fs.readFileBytes!("/test.txt");

        assertEquals(bytes, new TextEncoder().encode("Hello"));
      });

      it("should throw error for non-existent file", async () => {
        const adapter = createMockAdapter();

        await assertRejects(
          async () => await adapter.fs.readFile("/nonexistent.txt"),
          Error,
          "File not found",
        );
      });

      it("should check if file exists", async () => {
        const adapter = createMockAdapter();

        await adapter.fs.writeFile("/exists.txt", "content");

        const exists = await adapter.fs.exists("/exists.txt");
        const notExists = await adapter.fs.exists("/notexists.txt");

        assertEquals(exists, true);
        assertEquals(notExists, false);
      });

      it("should support stat operation", async () => {
        const adapter = createMockAdapter();

        await adapter.fs.writeFile("/test.txt", "Hello");
        const stat = await adapter.fs.stat("/test.txt");

        assertEquals(stat.isFile, true);
        assertEquals(stat.isDirectory, false);
        assertEquals(stat.isSymlink, false);
        assertEquals(stat.size, 5);
      });

      it("should support readDir operation", async () => {
        const adapter = createMockAdapter();

        await adapter.fs.writeFile("/dir/file1.txt", "content1");
        await adapter.fs.writeFile("/dir/file2.txt", "content2");
        await adapter.fs.writeFile("/dir/sub/file3.txt", "content3");

        const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
        for await (const entry of adapter.fs.readDir("/dir")) {
          entries.push(entry);
        }

        assert(entries.length > 0, "should have entries");
        assert(entries.some((e) => e.name === "file1.txt"), "should have file1.txt");
        assert(entries.some((e) => e.name === "file2.txt"), "should have file2.txt");
      });

      it("should support makeTempDir", async () => {
        const adapter = createMockAdapter();

        const tempDir = await adapter.fs.makeTempDir("test-");

        assert(tempDir.startsWith("/tmp/test-"), "temp dir should have correct prefix");
      });
    });

    describe("environment operations", () => {
      it("should get and set environment variables", () => {
        const adapter = createMockAdapter();

        adapter.env.set("TEST_VAR", "test_value");
        const value = adapter.env.get("TEST_VAR");

        assertEquals(value, "test_value");
      });

      it("should return undefined for non-existent env var", () => {
        const adapter = createMockAdapter();

        const value = adapter.env.get("NONEXISTENT");

        assertEquals(value, undefined);
      });

      it("should convert env to object", () => {
        const adapter = createMockAdapter();

        adapter.env.set("VAR1", "value1");
        adapter.env.set("VAR2", "value2");

        const envObj = adapter.env.toObject();

        assertEquals(envObj.VAR1, "value1");
        assertEquals(envObj.VAR2, "value2");
      });
    });

    describe("serve method", () => {
      it("should return a server instance", async () => {
        const adapter = createMockAdapter();
        const handler = () => new Response("OK");

        const server = await adapter.serve(handler, {});

        assert(server !== null);
        assert(typeof server.stop === "function");
        assertEquals(server.addr.hostname, "localhost");
        assertEquals(server.addr.port, 8000);
      });

      it("should resolve stop promise", async () => {
        const adapter = createMockAdapter();
        const handler = () => new Response("OK");

        const server = await adapter.serve(handler, {});
        await server.stop();
      });
    });
  });
});
