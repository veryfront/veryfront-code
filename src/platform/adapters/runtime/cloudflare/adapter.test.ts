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
      const { capabilities } = adapter;

      assertExists(capabilities);
      assertEquals(capabilities.typescript, false);
      assertEquals(capabilities.jsx, false);
      assertEquals(capabilities.http2, true);
      assertEquals(capabilities.websocket, true);
      assertEquals(capabilities.workers, false);
      assertEquals(capabilities.fileWatching, false);
      assertEquals(capabilities.shell, false);
      assertEquals(capabilities.kvStore, true);
      assertEquals(capabilities.writableFs, false);
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
