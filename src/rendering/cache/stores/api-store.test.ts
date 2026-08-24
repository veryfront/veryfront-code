import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { withTimeoutThrow } from "../../utils/stream-utils.ts";
import { APICacheStore } from "./api-store.ts";
import type { CachePayload } from "../types.ts";

// IANA's documentation address is public, so the egress guard can validate it
// before the deterministic test transport handles the request.
const TEST_PUBLIC_API_ORIGIN = "https://93.184.216.34";

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

    it("should create with custom ttlSeconds", () => {
      const store = new APICacheStore({ ttlSeconds: 7200 });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with local cache disabled", () => {
      const store = new APICacheStore({ enableLocalCache: false });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should bound the local cache with custom localMaxEntries", async () => {
      const store = new APICacheStore({ enableLocalCache: true, localMaxEntries: 1 });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      } as any;

      try {
        await store.set("k1", payload);
        await store.set("k2", payload);

        assertEquals(await store.get("k1"), undefined, "localMaxEntries bounds the local LRU");
        assertEquals(
          (await store.get("k2"))?.result.html,
          "<p>x</p>",
          "the newest entry survives eviction",
        );
      } finally {
        await store.destroy();
      }
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

      const setStarted = Promise.withResolvers<void>();
      const releaseSet = Promise.withResolvers<void>();
      let setCompleted = false;
      let setPromise: Promise<void> | undefined;
      Deno.env.set("VERYFRONT_API_BASE_URL", TEST_PUBLIC_API_ORIGIN);
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
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            if (
              request.method !== "POST" ||
              url.origin !== TEST_PUBLIC_API_ORIGIN ||
              url.pathname !== "/projects/api-store-test-project/cache/set"
            ) {
              return Response.json({ error: "not found" }, { status: 404 });
            }

            setStarted.resolve();
            await releaseSet.promise;
            setCompleted = true;
            return Response.json({ success: true });
          },
          async () => {
            let setResolved = false;
            setPromise = store.set("distributed-key", payload).then(() => {
              setResolved = true;
            });

            await withTimeoutThrow(
              setStarted.promise,
              10_000,
              "distributed cache write to start",
            );
            assertEquals(setResolved, false);
            assertEquals(setCompleted, false);

            releaseSet.resolve();
            await setPromise;

            assertEquals(setCompleted, true);
            assertEquals(setResolved, true);
          },
        );
      } finally {
        releaseSet.resolve();
        try {
          await withTimeoutThrow(
            Promise.all([
              store.destroy(),
              setPromise ?? Promise.resolve(),
            ]),
            10_000,
            "distributed cache write test cleanup",
          );
        } finally {
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
      }
    });

    it("preserves Dates through an API transport round-trip", async () => {
      const previousApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const previousApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const globals = globalThis as Record<string, unknown>;
      const originalAdapter = globals.__vf_multi_project_adapter;
      const values = new Map<string, string>();
      Deno.env.set("VERYFRONT_API_BASE_URL", TEST_PUBLIC_API_ORIGIN);
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      globals.__vf_multi_project_adapter = {
        getCurrentRequestContext: () => ({
          token: "request-token",
          projectSlug: "api-store-date-project",
          productionMode: true,
        }),
      };
      const store = new APICacheStore({ enableLocalCache: false });
      const publishedAt = new Date("2026-07-24T08:30:00.000Z");
      const payload: CachePayload = {
        result: {
          html: "<p>dated</p>",
          frontmatter: { publishedAt } as unknown as CachePayload["result"]["frontmatter"],
          stream: null,
        },
        storedAt: Date.now(),
      };

      try {
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            if (
              request.method === "POST" &&
              url.origin === TEST_PUBLIC_API_ORIGIN &&
              url.pathname === "/projects/api-store-date-project/cache/set"
            ) {
              const body = await request.json() as { key: string; value: string };
              values.set(body.key, body.value);
              return Response.json({ success: true });
            }
            if (
              request.method === "GET" &&
              url.origin === TEST_PUBLIC_API_ORIGIN &&
              url.pathname === "/projects/api-store-date-project/cache/get"
            ) {
              return Response.json({
                value: values.get(url.searchParams.get("key") ?? "") ?? null,
              });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
          async () => {
            await store.set("dated-key", payload);
            const result = await store.get("dated-key");

            assertEquals(result?.result.frontmatter as unknown, { publishedAt });
          },
        );
      } finally {
        await store.destroy();
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

    it("namespaces distributed cache keys with the configured keyPrefix", async () => {
      const previousApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const previousApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const globals = globalThis as Record<string, unknown>;
      const originalAdapter = globals.__vf_multi_project_adapter;
      let receivedKey: string | undefined;
      Deno.env.set("VERYFRONT_API_BASE_URL", TEST_PUBLIC_API_ORIGIN);
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      globals.__vf_multi_project_adapter = {
        getCurrentRequestContext: () => ({
          token: "request-token",
          projectSlug: "api-store-prefix-project",
          productionMode: true,
        }),
      };
      const store = new APICacheStore({ enableLocalCache: false, keyPrefix: "custom" });
      const payload: CachePayload = {
        result: { html: "<p>prefixed</p>", frontmatter: {}, stream: null },
        storedAt: Date.now(),
      };

      try {
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            if (
              request.method === "POST" &&
              url.origin === TEST_PUBLIC_API_ORIGIN &&
              url.pathname === "/projects/api-store-prefix-project/cache/set"
            ) {
              const body = await request.json() as { key: string };
              receivedKey = body.key;
              return Response.json({ success: true });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
          async () => {
            await store.set("prefix-key", payload);

            assertEquals(
              receivedKey,
              "custom:prefix-key",
              "keyPrefix namespaces distributed cache keys",
            );
          },
        );
      } finally {
        await store.destroy();
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

    it("serves a distributed hit from the local cache on the next read", async () => {
      const previousApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const previousApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const globals = globalThis as Record<string, unknown>;
      const originalAdapter = globals.__vf_multi_project_adapter;
      const values = new Map<string, string>();
      let backendGets = 0;
      Deno.env.set("VERYFRONT_API_BASE_URL", TEST_PUBLIC_API_ORIGIN);
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      globals.__vf_multi_project_adapter = {
        getCurrentRequestContext: () => ({
          token: "request-token",
          projectSlug: "api-store-writethrough-project",
          productionMode: true,
        }),
      };
      // The seeding store keeps the distributed entry out of the reading
      // store's local cache, so the first read must come from the backend.
      const seeder = new APICacheStore({ enableLocalCache: false });
      const store = new APICacheStore({ enableLocalCache: true });
      const payload: CachePayload = {
        result: { html: "<p>write-through</p>", frontmatter: {}, stream: null },
        storedAt: Date.now(),
      };

      try {
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            if (
              request.method === "POST" &&
              url.origin === TEST_PUBLIC_API_ORIGIN &&
              url.pathname === "/projects/api-store-writethrough-project/cache/set"
            ) {
              const body = await request.json() as { key: string; value: string };
              values.set(body.key, body.value);
              return Response.json({ success: true });
            }
            if (
              request.method === "GET" &&
              url.origin === TEST_PUBLIC_API_ORIGIN &&
              url.pathname === "/projects/api-store-writethrough-project/cache/get"
            ) {
              backendGets += 1;
              return Response.json({
                value: values.get(url.searchParams.get("key") ?? "") ?? null,
              });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
          async () => {
            await seeder.set("write-through-key", payload);

            const first = await store.get("write-through-key");
            const second = await store.get("write-through-key");

            assertEquals(
              first?.result.html,
              "<p>write-through</p>",
              "the first read comes from the distributed cache",
            );
            assertEquals(
              second?.result.html,
              "<p>write-through</p>",
              "the second read returns the same entry",
            );
            assertEquals(
              backendGets,
              1,
              "a distributed hit must be written through to the local cache",
            );
          },
        );
      } finally {
        await seeder.destroy();
        await store.destroy();
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
      Deno.env.set("VERYFRONT_API_BASE_URL", TEST_PUBLIC_API_ORIGIN);
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
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            if (
              request.method !== "POST" ||
              url.origin !== TEST_PUBLIC_API_ORIGIN ||
              url.pathname !== "/projects/api-store-test-project/cache/set"
            ) {
              return Response.json({ error: "not found" }, { status: 404 });
            }

            const body = await request.json() as { ttl?: number; value?: string };
            receivedTtl = body.ttl;
            receivedValue = body.value ?? "";
            return Response.json({ success: true });
          },
          async () => {
            await store.set("distributed-stale-key", payload);

            // The stale window is 60s wide, so the backend ttl must be 60
            // (59 only if a full second of test time already elapsed).
            assertEquals(
              receivedTtl === 60 || receivedTtl === 59,
              true,
              `backend ttl must cover the full 60s stale window, not just ttlSeconds (got ${receivedTtl})`,
            );
            assertEquals(
              receivedValue.includes('"staleUntil"'),
              true,
              "the stale window is persisted with the distributed entry",
            );
          },
        );
      } finally {
        await store.destroy();
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
