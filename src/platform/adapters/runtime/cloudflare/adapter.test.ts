import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareAdapter } from "./adapter.ts";

describe("CloudflareAdapter", () => {
  it("should export CloudflareAdapter class", () => {
    assertExists(CloudflareAdapter);
    assertEquals(typeof CloudflareAdapter, "function");
  });

  describe("instance", () => {
    const mockEnv: any = {};

    it("should be instantiable with env", () => {
      assertExists(new CloudflareAdapter(mockEnv));
    });

    it("should be instantiable with env and kvNamespace", () => {
      const mockKv: any = {};
      assertExists(new CloudflareAdapter(mockEnv, mockKv));
    });

    it("should have id and name properties", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertEquals(adapter.id, "cloudflare");
      assertEquals(adapter.name, "cloudflare");
    });

    it("should have adapters", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.fs);
      assertExists(adapter.env);
      assertExists(adapter.server);
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

    it("should have serve and shutdown methods", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      assertExists(adapter.serve);
      assertEquals(typeof adapter.serve, "function");
      assertExists(adapter.shutdown);
      assertEquals(typeof adapter.shutdown, "function");
    });

    it("serve should return a server", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      const server = await adapter.serve(() => new Response("test"));
      assertExists(server);
    });

    it("shutdown should complete without error", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      await adapter.shutdown();
    });
  });
});
