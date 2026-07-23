import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { APICacheStore } from "./api-store.ts";
import type { CacheBackend } from "#veryfront/cache/backend.ts";

function createMemoryBackend(): CacheBackend & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    type: "memory",
    values,
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    delByPattern: (pattern) => {
      const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
      let deleted = 0;
      for (const key of [...values.keys()]) {
        if (!key.startsWith(prefix)) continue;
        values.delete(key);
        deleted++;
      }
      return Promise.resolve(deleted);
    },
  } as CacheBackend & { values: Map<string, string> };
}

async function withStoreTtlEnabled(fn: () => Promise<void>): Promise<void> {
  const previousGlobal = (globalThis as Record<string, unknown>).__vfDisableLruInterval;
  const previousEnv = Deno.env.get("VF_DISABLE_LRU_INTERVAL");

  (globalThis as Record<string, unknown>).__vfDisableLruInterval = false;
  Deno.env.delete("VF_DISABLE_LRU_INTERVAL");

  try {
    await fn();
  } finally {
    if (previousGlobal === undefined) {
      delete (globalThis as Record<string, unknown>).__vfDisableLruInterval;
    } else {
      (globalThis as Record<string, unknown>).__vfDisableLruInterval = previousGlobal;
    }

    if (previousEnv === undefined) {
      Deno.env.delete("VF_DISABLE_LRU_INTERVAL");
    } else {
      Deno.env.set("VF_DISABLE_LRU_INTERVAL", previousEnv);
    }
  }
}

describe("rendering/cache/stores/api-store", () => {
  describe("APICacheStore constructor", () => {
    it("should create with default options", () => {
      const store = new APICacheStore();
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom keyPrefix", () => {
      const store = new APICacheStore({ keyPrefix: "custom" });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom ttlSeconds", () => {
      const store = new APICacheStore({ ttlSeconds: 7200 });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with local cache disabled", () => {
      const store = new APICacheStore({ enableLocalCache: false });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom localMaxEntries", () => {
      const store = new APICacheStore({ localMaxEntries: 50 });
      assertEquals(store instanceof APICacheStore, true);
    });
  });

  describe("operations (without distributed backend)", () => {
    it("should return undefined for missing key", async () => {
      const store = new APICacheStore();
      const result = await store.get("missing-key");
      assertEquals(result, undefined);
    });

    it("should clear without error", async () => {
      const store = new APICacheStore();
      await store.clear();
    });

    it("should destroy without error", async () => {
      const store = new APICacheStore();
      await store.destroy();
    });

    it("should delete without error", async () => {
      const store = new APICacheStore();
      await store.delete("some-key");
    });
  });

  describe("distributed lifecycle", () => {
    it("clears both local and distributed entries", async () => {
      const backend = createMemoryBackend();
      const store = new APICacheStore({
        enableLocalCache: false,
        backendFactory: () => Promise.resolve(backend),
      });
      const payload = {
        result: { html: "<p>distributed</p>", frontmatter: {}, stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("entry", payload);
      assertEquals(backend.values.size, 1);
      await store.clear();
      assertEquals(backend.values.size, 0);
    });

    it("retries backend initialization after a transient failure", async () => {
      const backend = createMemoryBackend();
      let attempts = 0;
      const store = new APICacheStore({
        enableLocalCache: false,
        backendFactory: () => {
          attempts++;
          return attempts === 1
            ? Promise.reject(new Error("temporary initialization failure"))
            : Promise.resolve(backend);
        },
      });
      const payload = {
        result: { html: "<p>retry</p>", frontmatter: {}, stream: null },
        storedAt: Date.now(),
      } as any;

      assertEquals(await store.get("missing"), undefined);
      await store.set("entry", payload);
      assertEquals(attempts, 2);
      assertEquals(backend.values.size, 1);
    });
  });

  describe("serialize/deserialize round-trip", () => {
    interface TestPayload {
      result: {
        html: string;
        css?: string;
        frontmatter: Record<string, unknown>;
        headings?: Array<{ id: string; text: string; level: number }>;
        nodeMap?: Map<number, unknown>;
        stream: null;
        pageModule?: { slug: string; code: string; type: "mdx" | "component" };
        ssrHash?: string;
      };
      storedAt: number;
      expiresAt?: number;
      staleUntil?: number;
    }

    function makePayload(overrides: Record<string, unknown> = {}): TestPayload {
      return {
        result: {
          html: "<h1>Test</h1>",
          frontmatter: { title: "Test" },
          headings: [],
          stream: null,
          ...overrides,
        },
        storedAt: Date.now(),
      };
    }

    it("round-trips basic HTML payload", () => {
      const store = new APICacheStore();
      const payload = makePayload();
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.html, "<h1>Test</h1>");
      assertEquals(deserialized.result.frontmatter.title, "Test");
      assertEquals(deserialized.storedAt, payload.storedAt);
    });

    it("round-trips payload with nodeMap", () => {
      const store = new APICacheStore();
      const nodeMap = new Map<number, unknown>([
        [1, { type: "div" }],
        [2, { type: "span" }],
      ]);
      const payload = makePayload({ nodeMap });
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.nodeMap instanceof Map, true);
      assertEquals(deserialized.result.nodeMap.size, 2);
      assertEquals(
        (deserialized.result.nodeMap.get(1) as Record<string, string>).type,
        "div",
      );
    });

    it("round-trips payload with ssrHash and css", () => {
      const store = new APICacheStore();
      const payload = makePayload({ ssrHash: "hash123", css: "body{}" });
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.ssrHash, "hash123");
      assertEquals(deserialized.result.css, "body{}");
    });

    it("round-trips payload with pageModule", () => {
      const store = new APICacheStore();
      const payload = makePayload({
        pageModule: { slug: "index", code: "export default {}", type: "mdx" as const },
      });
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.pageModule.slug, "index");
      assertEquals(deserialized.result.pageModule.type, "mdx");
    });

    it("deserializes stream as null (streams are not cacheable)", () => {
      const store = new APICacheStore();
      const payload = makePayload();
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.result.stream, null);
    });

    it("preserves expiresAt field", () => {
      const store = new APICacheStore();
      const payload = { ...makePayload(), expiresAt: Date.now() + 60000 };
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.expiresAt, payload.expiresAt);
    });

    it("preserves staleUntil field for stale-while-refresh cache entries", () => {
      const store = new APICacheStore();
      const payload = {
        ...makePayload(),
        expiresAt: Date.now() - 1,
        staleUntil: Date.now() + 60_000,
      };
      const serialized = (store as any).serialize(payload);
      const deserialized = (store as any).deserialize(serialized);
      assertEquals(deserialized.expiresAt, payload.expiresAt);
      assertEquals(deserialized.staleUntil, payload.staleUntil);
    });
  });

  describe("local cache operations", () => {
    it("set then get returns value from local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: {
          html: "<p>cached</p>",
          frontmatter: {},
          headings: [],
          stream: null,
        },
        storedAt: Date.now(),
      } as any;

      await store.set("local-key", payload);
      const result = await store.get("local-key");
      assertEquals(result?.result.html, "<p>cached</p>");
    });

    it("skips caching when result has a stream", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: {
          html: "<p>stream</p>",
          frontmatter: {},
          headings: [],
          stream: {} as ReadableStream,
        },
        storedAt: Date.now(),
      } as any;

      await store.set("stream-key", payload);
      const result = await store.get("stream-key");
      assertEquals(result, undefined);
    });

    it("delete removes from local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("del-key", payload);
      await store.delete("del-key");
      const result = await store.get("del-key");
      assertEquals(result, undefined);
    });

    it("deleteByPrefix removes matching keys from local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("proj:page:a", payload);
      await store.set("proj:page:b", payload);
      await store.set("other:page:c", payload);

      const deleted = await store.deleteByPrefix("proj:");
      assertEquals(deleted >= 2, true);

      const a = await store.get("proj:page:a");
      assertEquals(a, undefined);
      const c = await store.get("other:page:c");
      assertEquals(c?.result.html, "<p>x</p>");
    });

    it("clear empties local cache", async () => {
      const store = new APICacheStore({ enableLocalCache: true });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("clear-key", payload);
      await store.clear();
      const result = await store.get("clear-key");
      assertEquals(result, undefined);
    });

    it("returns undefined when local cache is disabled", async () => {
      const store = new APICacheStore({ enableLocalCache: false });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      await store.set("no-local", payload);
      const result = await store.get("no-local");
      assertEquals(result, undefined);
    });

    it("waits for distributed writes when local cache is disabled", async () => {
      const previousApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const previousApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const globals = globalThis as Record<string, unknown>;
      const originalAdapter = globals.__vf_multi_project_adapter;

      let releaseSet: () => void = () => {};
      let setStarted = false;
      let setCompleted = false;
      const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen: () => {} },
        async (request) => {
          const url = new URL(request.url);
          if (
            request.method !== "POST" ||
            url.pathname !== "/projects/api-store-test-project/cache/set"
          ) {
            return Response.json({ error: "not found" }, { status: 404 });
          }

          setStarted = true;
          await new Promise<void>((resolve) => {
            releaseSet = resolve;
          });
          setCompleted = true;
          return Response.json({ success: true });
        },
      );
      const addr = server.addr as Deno.NetAddr;
      Deno.env.set("VERYFRONT_API_BASE_URL", `http://${addr.hostname}:${addr.port}`);
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      globals.__vf_multi_project_adapter = {
        getCurrentRequestContext: () => ({
          token: "request-token",
          projectSlug: "api-store-test-project",
          productionMode: true,
        }),
      };
      const store = new APICacheStore({ enableLocalCache: false });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      try {
        let setResolved = false;
        const setPromise = store.set("distributed-key", payload).then(() => {
          setResolved = true;
        });

        for (let attempts = 0; attempts < 50 && !setStarted; attempts++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        assertEquals(setStarted, true);
        assertEquals(setResolved, false);
        assertEquals(setCompleted, false);

        releaseSet();
        await setPromise;

        assertEquals(setCompleted, true);
        assertEquals(setResolved, true);
      } finally {
        releaseSet();
        await store.destroy();
        await server.shutdown();
        if (previousApiBaseUrl === undefined) {
          Deno.env.delete("VERYFRONT_API_BASE_URL");
        } else {
          Deno.env.set("VERYFRONT_API_BASE_URL", previousApiBaseUrl);
        }
        if (previousApiToken === undefined) {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        } else {
          Deno.env.set("VERYFRONT_API_TOKEN", previousApiToken);
        }
        if (originalAdapter === undefined) {
          delete globals.__vf_multi_project_adapter;
        } else {
          globals.__vf_multi_project_adapter = originalAdapter;
        }
      }
    });

    it("retains distributed entries through staleUntil instead of only the fresh TTL", async () => {
      const previousApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const previousApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const globals = globalThis as Record<string, unknown>;
      const originalAdapter = globals.__vf_multi_project_adapter;

      let receivedTtl: number | undefined;
      let receivedValue = "";
      const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen: () => {} },
        async (request) => {
          const url = new URL(request.url);
          if (
            request.method !== "POST" ||
            url.pathname !== "/projects/api-store-test-project/cache/set"
          ) {
            return Response.json({ error: "not found" }, { status: 404 });
          }

          const body = await request.json() as { ttl?: number; value?: string };
          receivedTtl = body.ttl;
          receivedValue = body.value ?? "";
          return Response.json({ success: true });
        },
      );
      const addr = server.addr as Deno.NetAddr;
      Deno.env.set("VERYFRONT_API_BASE_URL", `http://${addr.hostname}:${addr.port}`);
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      globals.__vf_multi_project_adapter = {
        getCurrentRequestContext: () => ({
          token: "request-token",
          projectSlug: "api-store-test-project",
          productionMode: true,
        }),
      };

      const store = new APICacheStore({ enableLocalCache: false, ttlSeconds: 5 });
      const staleUntil = Date.now() + 60_000;
      const payload = {
        result: { html: "<p>stale</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1,
        staleUntil,
      } as any;

      try {
        await store.set("distributed-stale-key", payload);

        assertEquals(receivedTtl !== undefined && receivedTtl > 5, true);
        assertEquals(receivedValue.includes('"staleUntil"'), true);
      } finally {
        await store.destroy();
        await server.shutdown();
        if (previousApiBaseUrl === undefined) {
          Deno.env.delete("VERYFRONT_API_BASE_URL");
        } else {
          Deno.env.set("VERYFRONT_API_BASE_URL", previousApiBaseUrl);
        }
        if (previousApiToken === undefined) {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        } else {
          Deno.env.set("VERYFRONT_API_TOKEN", previousApiToken);
        }
        if (originalAdapter === undefined) {
          delete globals.__vf_multi_project_adapter;
        } else {
          globals.__vf_multi_project_adapter = originalAdapter;
        }
      }
    });

    it("expires local entries without payload expiresAt using store TTL", async () => {
      await withStoreTtlEnabled(async () => {
        const store = new APICacheStore({ enableLocalCache: true, ttlSeconds: 1 });
        try {
          const payload = {
            result: {
              html: "<p>ttl</p>",
              frontmatter: {},
              headings: [],
              stream: null,
            },
            storedAt: Date.now(),
          } as any;

          await store.set("ttl-key", payload);
          await new Promise((resolve) => setTimeout(resolve, 1_100));

          const result = await store.get("ttl-key");
          assertEquals(result, undefined);
        } finally {
          await store.destroy();
        }
      });
    });
  });
});
