import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareAdapter, createCloudflareAdapter } from "./adapter.ts";
import type { KVNamespace } from "./types.ts";

const mockKv = {
  delete: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  getWithMetadata: () => Promise.resolve({ metadata: null, value: null }),
  list: () => Promise.resolve({ keys: [], list_complete: true, cursor: "" }),
  put: () => Promise.resolve(),
} satisfies KVNamespace;

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
      assertExists(new CloudflareAdapter(mockEnv, mockKv));
    });

    it("provides the factory named by runtime detection guidance", () => {
      const adapter = createCloudflareAdapter(mockEnv, mockKv);

      assertEquals(adapter instanceof CloudflareAdapter, true);
      assertEquals(adapter.capabilities.kvStore, true);
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

    it("derives storage capabilities from the supplied bindings", () => {
      const withoutKv = new CloudflareAdapter(mockEnv).capabilities;
      const withKv = new CloudflareAdapter(mockEnv, mockKv).capabilities;

      assertEquals(withoutKv.kvStore, false);
      assertEquals(withoutKv.writableFs, false);
      assertEquals(withKv.kvStore, true);
      assertEquals(withKv.writableFs, true);
    });

    it("should have serve and shutdown methods", () => {
      const adapter = new CloudflareAdapter(mockEnv);

      assertExists(adapter.serve);
      assertEquals(typeof adapter.serve, "function");

      assertExists(adapter.shutdown);
      assertEquals(typeof adapter.shutdown, "function");
    });

    it("fails closed instead of pretending to open a listener", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      await assertRejects(
        () => adapter.serve(() => new Response("test")),
        Error,
        "fetch handler",
      );
    });

    it("shutdown should complete without error", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      await adapter.shutdown();
    });
  });
});
