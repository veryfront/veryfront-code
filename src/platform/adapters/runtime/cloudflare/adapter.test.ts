import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareAdapter } from "./adapter.ts";

describe("CloudflareAdapter", () => {
  describe("class", () => {
    it("should export CloudflareAdapter class", () => {
      assertExists(CloudflareAdapter);
      assertEquals(typeof CloudflareAdapter, "function");
    });
  });

  describe("instance", () => {
    const mockEnv = {} as any;

    it("should be instantiable with env", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter);
    });

    it("should be instantiable with env and kvNamespace", () => {
      const mockKv = {} as any;
      const adapter = new CloudflareAdapter(mockEnv, mockKv);
      assertExists(adapter);
    });

    it("should have id property", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertEquals(adapter.id, "cloudflare");
    });

    it("should have name property", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertEquals(adapter.name, "cloudflare");
    });

    it("should have fs adapter", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.fs);
    });

    it("should have env adapter", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.env);
    });

    it("should have server adapter", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.server);
    });

    it("should have shell adapter", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.shell);
    });

    it("should have capabilities", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.capabilities);
      assertEquals(adapter.capabilities.typescript, false);
      assertEquals(adapter.capabilities.jsx, false);
      assertEquals(adapter.capabilities.http2, true);
      assertEquals(adapter.capabilities.websocket, true);
      assertEquals(adapter.capabilities.workers, false);
      assertEquals(adapter.capabilities.fileWatching, false);
      assertEquals(adapter.capabilities.shell, false);
      assertEquals(adapter.capabilities.kvStore, true);
      assertEquals(adapter.capabilities.writableFs, false);
    });

    it("should have serve method", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.serve);
      assertEquals(typeof adapter.serve, "function");
    });

    it("should have shutdown method", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.shutdown);
      assertEquals(typeof adapter.shutdown, "function");
    });

    it("serve should return a server", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      const handler = () => new Response("test");
      const server = await adapter.serve(handler);
      assertExists(server);
    });

    it("shutdown should complete without error", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      await adapter.shutdown();
    });
  });
});
