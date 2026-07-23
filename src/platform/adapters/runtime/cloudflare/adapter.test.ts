import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareAdapter, createCloudflareAdapter } from "./adapter.ts";
import type { KVNamespace } from "./types.ts";

interface WranglerStyleEnv {
  MODE: string;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const EMPTY_KV_NAMESPACE = {
  get: () => Promise.resolve(null),
  put: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve({ keys: [], list_complete: true as const }),
  getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
} satisfies KVNamespace;

describe("CloudflareAdapter", () => {
  it("should export CloudflareAdapter class", () => {
    assertExists(CloudflareAdapter);
    assertEquals(typeof CloudflareAdapter, "function");
  });

  describe("instance", () => {
    const mockEnv = {};

    it("should be instantiable with env", () => {
      assertExists(new CloudflareAdapter(mockEnv));
    });

    it("should be instantiable with env and kvNamespace", () => {
      assertExists(new CloudflareAdapter(mockEnv, EMPTY_KV_NAMESPACE));
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
      assertEquals("shell" in adapter, false);
    });

    it("should have capabilities", () => {
      const adapter = new CloudflareAdapter(mockEnv);
      const { capabilities } = adapter;

      assertExists(capabilities);
      assertEquals(capabilities.typescript, false);
      assertEquals(capabilities.jsx, false);
      assertEquals(capabilities.http2, false);
      assertEquals(capabilities.websocket, true);
      assertEquals(capabilities.workers, false);
      assertEquals(capabilities.fileWatching, false);
      assertEquals(capabilities.shell, false);
      assertEquals(capabilities.kvStore, false);
      assertEquals(capabilities.writableFs, false);
    });

    it("does not advertise complete writable filesystem semantics for KV storage", () => {
      const { capabilities, kv } = new CloudflareAdapter(mockEnv, EMPTY_KV_NAMESPACE);

      assertEquals(capabilities.kvStore, false);
      assertEquals(capabilities.writableFs, false);
      assertEquals(kv, undefined);
    });

    it("reports generic KV storage only when its separate namespace is configured", () => {
      const { capabilities, kv } = new CloudflareAdapter(
        mockEnv,
        undefined,
        EMPTY_KV_NAMESPACE,
      );

      assertEquals(capabilities.kvStore, true);
      assertEquals(capabilities.writableFs, false);
      assertExists(kv);
    });

    it("should have serve and shutdown methods", () => {
      const adapter = new CloudflareAdapter(mockEnv);

      assertExists(adapter.serve);
      assertEquals(typeof adapter.serve, "function");

      assertExists(adapter.shutdown);
      assertEquals(typeof adapter.shutdown, "function");
    });

    it("rejects serve because Workers receive requests through fetch handlers", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      let handlerCalls = 0;
      let listenCalls = 0;

      await assertRejects(
        () =>
          adapter.serve(
            () => {
              handlerCalls++;
              return new Response("test");
            },
            { onListen: () => listenCalls++ },
          ),
        Error,
        "createWorker",
      );
      assertEquals(handlerCalls, 0);
      assertEquals(listenCalls, 0);
    });

    it("shutdown should complete without error", async () => {
      const adapter = new CloudflareAdapter(mockEnv);
      await adapter.shutdown();
    });
  });

  it("creates an adapter through the public factory", () => {
    const adapter = createCloudflareAdapter({ MODE: "test" }, {
      fileSystemNamespace: EMPTY_KV_NAMESPACE,
      kvNamespace: EMPTY_KV_NAMESPACE,
    });

    assertEquals(adapter instanceof CloudflareAdapter, true);
    assertEquals(adapter.env.get("MODE"), "test");
    assertEquals(adapter.capabilities.writableFs, false);
    assertEquals(adapter.capabilities.kvStore, true);
  });

  it("accepts a named Wrangler-style environment without an index signature", () => {
    const env: WranglerStyleEnv = {
      MODE: "test",
      ASSETS: {
        fetch: () => Promise.resolve(new Response("asset")),
      },
    };

    const direct = new CloudflareAdapter(env);
    const factory = createCloudflareAdapter(env);

    assertEquals(direct.env.get("MODE"), "test");
    assertEquals(factory.env.get("MODE"), "test");
    assertEquals(factory.env.get("ASSETS"), undefined);
  });
});
