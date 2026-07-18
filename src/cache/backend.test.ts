import "#veryfront/schemas/_test-setup.ts";
/**
 * Cache Backend Tests
 *
 * Tests MemoryCacheBackend, ApiCacheBackend, RedisCacheBackend,
 * isDistributedBackend, createDistributedCacheAccessor, and
 * CacheBackends factory functions.
 *
 * @module cache/backend.test
 */

import { assertEquals, assertExists } from "#std/assert";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import type { RedisClient } from "#veryfront/utils/redis-client.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { runWithVerifiedCacheApiCredential } from "./verified-api-credential-context.ts";

type RecordedSpan = {
  name: string;
  attributes: Record<string, AttributeValue>;
};

async function importBackend(): Promise<typeof import("./backend.ts")> {
  return await import("./backend.ts");
}

async function createVerifiedCacheClaims(options: {
  token: string;
  projectId: string;
  projectSlug: string;
}) {
  const rawBody = JSON.stringify({
    credentials: { authToken: options.token },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody, {
    audience: options.projectSlug,
    projectId: options.projectId,
  });
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = options.projectId;
  ctx.projectSlug = options.projectSlug;
  const signingKeyEnv = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
  const originalSigningKey = Deno.env.get(signingKeyEnv);
  Deno.env.set(signingKeyEnv, publicKeyPem);

  try {
    return await verifyControlPlaneRequest(
      new Request("https://example.test/api/control-plane/runs/run-1/stream", {
        headers: { "x-veryfront-control-plane-jws": jws },
      }),
      ctx,
      rawBody,
    );
  } finally {
    if (originalSigningKey === undefined) Deno.env.delete(signingKeyEnv);
    else Deno.env.set(signingKeyEnv, originalSigningKey);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRecordingSpan(record: RecordedSpan): Span {
  return {
    setAttribute(key, value) {
      record.attributes[key] = value;
      return this;
    },
    setAttributes(attrs) {
      Object.assign(record.attributes, attrs);
      return this;
    },
    setStatus() {
      return this;
    },
    recordException() {},
    addEvent() {
      return this;
    },
    end() {},
    spanContext() {
      return {
        traceId: "0".repeat(32),
        spanId: "0".repeat(16),
        traceFlags: 0,
      };
    },
    updateName() {},
  };
}

function installRecordingTracer(records: RecordedSpan[]): void {
  const tracer = {
    startSpan(name: string, options?: { attributes?: Record<string, AttributeValue> }) {
      const record = { name, attributes: { ...(options?.attributes ?? {}) } };
      records.push(record);
      return createRecordingSpan(record);
    },
  } as unknown as Tracer;

  setGlobalTracerProvider({ getTracer: () => tracer });
}

Deno.test({
  name: "backend.ts imports without circular dependency",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const mod = await importBackend();

    assertExists(mod.MemoryCacheBackend);
    assertExists(mod.RedisCacheBackend);
    assertExists(mod.ApiCacheBackend);
    assertExists(mod.createCacheBackend);
    assertExists(mod.CacheBackends);
    assertExists(mod.isApiCacheAvailable);
  },
});

Deno.test("MemoryCacheBackend basic operations", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  assertEquals(cache.type, "memory");

  await cache.set("key1", "value1", 60);
  assertEquals(await cache.get("key1"), "value1");

  await cache.del("key1");
  assertEquals(await cache.get("key1"), null);

  await cache.set("a", "1");
  await cache.set("b", "2");
  assertEquals(cache.size, 2);

  cache.clear();
  assertEquals(cache.size, 0);
});

Deno.test("MemoryCacheBackend TTL expiration", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);

  await cache.set("expires", "soon", 1);
  assertEquals(await cache.get("expires"), "soon");

  await sleep(1100);

  assertEquals(await cache.get("expires"), null);
});

Deno.test("MemoryCacheBackend reports remaining TTL without extending it", async () => {
  const { MemoryCacheBackend } = await importBackend();
  const cache = new MemoryCacheBackend(10);

  await cache.set("ttl", "value", 0.1);
  const remaining = await cache.getRemainingTtlSeconds("ttl");

  assertEquals(typeof remaining, "number");
  assertEquals(remaining! > 0 && remaining! <= 0.1, true);
});

Deno.test("MemoryCacheBackend evicts oldest on capacity", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(3);

  await cache.set("a", "1");
  await cache.set("b", "2");
  await cache.set("c", "3");
  assertEquals(cache.size, 3);

  await cache.set("d", "4");
  assertEquals(cache.size, 3);
  assertEquals(await cache.get("a"), null);
  assertEquals(await cache.get("d"), "4");
});

Deno.test("MemoryCacheBackend delByPattern", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);

  await cache.set("http:mod1", "v1");
  await cache.set("http:mod2", "v2");
  await cache.set("other:key", "v3");

  assertEquals(await cache.delByPattern("http:*"), 2);
  assertEquals(await cache.get("http:mod1"), null);
  assertEquals(await cache.get("http:mod2"), null);
  assertEquals(await cache.get("other:key"), "v3");
});

Deno.test("MemoryCacheBackend getBatch returns all requested keys", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("k1", "v1");
  await cache.set("k2", "v2");

  const results = await cache.getBatch(["k1", "k2", "missing"]);
  assertEquals(results.get("k1"), "v1");
  assertEquals(results.get("k2"), "v2");
  assertEquals(results.get("missing"), null);
});

Deno.test("MemoryCacheBackend getBatch handles expired entries", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("exp", "val", 0); // TTL of 0 means expires immediately

  // Slight delay to ensure expiration
  await sleep(10);

  const results = await cache.getBatch(["exp"]);
  assertEquals(results.get("exp"), null);
});

Deno.test("MemoryCacheBackend setBatch sets multiple entries", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.setBatch([
    { key: "a", value: "1" },
    { key: "b", value: "2", ttl: 60 },
    { key: "c", value: "3" },
  ]);

  assertEquals(await cache.get("a"), "1");
  assertEquals(await cache.get("b"), "2");
  assertEquals(await cache.get("c"), "3");
  assertEquals(cache.size, 3);
});

Deno.test("MemoryCacheBackend setBatch evicts when at capacity", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(2);
  await cache.set("existing", "old");

  await cache.setBatch([
    { key: "new1", value: "v1" },
    { key: "new2", value: "v2" },
  ]);

  assertEquals(cache.size, 2);
});

Deno.test("MemoryCacheBackend delByPattern uses compiled glob cache", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(20);
  await cache.set("prefix:a", "1");
  await cache.set("prefix:b", "2");
  await cache.set("other:c", "3");

  // First call creates compiled glob
  assertEquals(await cache.delByPattern("prefix:*"), 2);

  // Add more matching entries
  await cache.set("prefix:d", "4");

  // Second call reuses cached compiled glob
  assertEquals(await cache.delByPattern("prefix:*"), 1);
});

Deno.test("MemoryCacheBackend delByPattern with ? wildcard", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("key-a", "1");
  await cache.set("key-b", "2");
  await cache.set("key-ab", "3");

  assertEquals(await cache.delByPattern("key-?"), 2);
  assertEquals(await cache.get("key-ab"), "3");
});

Deno.test("MemoryCacheBackend delByPattern treats regex syntax as literals", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("file.(js)", "1");
  await cache.set("fileXjs", "2");

  assertEquals(await cache.delByPattern("file.(*)"), 1);
  assertEquals(await cache.get("file.(js)"), null);
  assertEquals(await cache.get("fileXjs"), "2");
});

Deno.test("MemoryCacheBackend delByPattern rejects excessive wildcards", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("keep:a", "1");
  await cache.set("keep:b", "2");

  const deleted = await cache.delByPattern("*".repeat(65));

  assertEquals(deleted, 0);
  assertEquals(await cache.get("keep:a"), "1");
  assertEquals(await cache.get("keep:b"), "2");
});

Deno.test("MemoryCacheBackend delByPattern rejects backtracking-shaped glob misses", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  const longKey = "a".repeat(1000);
  await cache.set(longKey, "1");

  const deleted = await cache.delByPattern(`${"a*".repeat(20)}b`);

  assertEquals(deleted, 0);
  assertEquals(await cache.get(longKey), "1");
});

Deno.test("MemoryCacheBackend set overwrites existing entry without eviction", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(2);
  await cache.set("a", "1");
  await cache.set("b", "2");

  // Overwrite existing key - should not evict
  await cache.set("a", "updated");
  assertEquals(cache.size, 2);
  assertEquals(await cache.get("a"), "updated");
  assertEquals(await cache.get("b"), "2");
});

Deno.test("MemoryCacheBackend evicts when byte size limit exceeded", async () => {
  const { MemoryCacheBackend } = await importBackend();

  // maxSizeBytes=20 chars (key.length + value.length as estimate)
  const cache = new MemoryCacheBackend(100, { maxSizeBytes: 20 });

  // "a" + "12345678" = 9 chars
  await cache.set("a", "12345678");
  assertEquals(cache.size, 1);
  assertEquals(cache.sizeBytes, 9);

  // "b" + "12345678" = 9 chars, total 18 — fits within 20
  await cache.set("b", "12345678");
  assertEquals(cache.size, 2);
  assertEquals(cache.sizeBytes, 18);

  // "c" + "12345678" = 9 chars, total would be 27 — evict oldest ("a") until it fits
  await cache.set("c", "12345678");
  assertEquals(cache.size, 2);
  assertEquals(await cache.get("a"), null);
  assertEquals(await cache.get("b"), "12345678");
  assertEquals(await cache.get("c"), "12345678");
});

Deno.test("MemoryCacheBackend sizeBytes tracks correctly through operations", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(100, { maxSizeBytes: 1000 });

  await cache.set("key1", "value1");
  const size1 = cache.sizeBytes;
  assertEquals(size1 > 0, true);

  // Overwrite with larger value — sizeBytes should update
  await cache.set("key1", "a-much-longer-value");
  assertEquals(cache.sizeBytes > size1, true);

  // Delete — sizeBytes should decrease
  await cache.del("key1");
  assertEquals(cache.sizeBytes, 0);

  // setBatch
  await cache.setBatch([
    { key: "x", value: "111" },
    { key: "y", value: "222" },
  ]);
  const batchSize = cache.sizeBytes;
  assertEquals(batchSize > 0, true);

  // delByPattern — sizeBytes should decrease
  await cache.delByPattern("*");
  assertEquals(cache.sizeBytes, 0);

  // clear — sizeBytes should reset
  await cache.set("z", "data");
  cache.clear();
  assertEquals(cache.sizeBytes, 0);
});

Deno.test("MemoryCacheBackend setBatch evicts by byte size", async () => {
  const { MemoryCacheBackend } = await importBackend();

  // maxSizeBytes=15
  const cache = new MemoryCacheBackend(100, { maxSizeBytes: 15 });

  // "a" + "1234" = 5, "b" + "1234" = 5 — total 10
  await cache.setBatch([
    { key: "a", value: "1234" },
    { key: "b", value: "1234" },
  ]);
  assertEquals(cache.size, 2);

  // "c" + "1234567890" = 11 — total would be 21, must evict both a and b
  await cache.setBatch([
    { key: "c", value: "1234567890" },
  ]);
  assertEquals(await cache.get("a"), null);
  assertEquals(await cache.get("b"), null);
  assertEquals(await cache.get("c"), "1234567890");
});

Deno.test("MemoryCacheBackend rejects single entry exceeding maxSizeBytes", async () => {
  const { MemoryCacheBackend } = await importBackend();

  // maxSizeBytes=10
  const cache = new MemoryCacheBackend(100, { maxSizeBytes: 10 });

  // "k" + "small" = 6 — fits
  await cache.set("k", "small");
  assertEquals(await cache.get("k"), "small");
  assertEquals(cache.sizeBytes, 6);

  // "x" + "this-value-is-way-too-large" = 28 — exceeds limit, silently dropped
  await cache.set("x", "this-value-is-way-too-large");
  assertEquals(await cache.get("x"), null);
  assertEquals(cache.sizeBytes, 6);

  // Existing entries should be untouched
  assertEquals(await cache.get("k"), "small");
});

Deno.test("ApiCacheBackend requires auth and project context", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  assertEquals(await cache.get("test-key"), null);
});

Deno.test("ApiCacheBackend type property", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  assertEquals(cache.type, "api");
});

Deno.test("ApiCacheBackend set returns without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  await cache.set("key", "value"); // Should not throw
});

Deno.test("ApiCacheBackend del returns without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  await cache.del("key"); // Should not throw
});

Deno.test("ApiCacheBackend delByPattern returns 0 without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  assertEquals(await cache.delByPattern("prefix:*"), 0);
});

Deno.test("ApiCacheBackend getBatch returns nulls without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  const results = await cache.getBatch(["k1", "k2"]);
  // Should return empty map or map with nulls
  assertEquals(results.size === 0 || results.get("k1") === null, true);
});

Deno.test("ApiCacheBackend getBatch returns empty map for empty keys", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  const results = await cache.getBatch([]);
  assertEquals(results.size, 0);
});

Deno.test("ApiCacheBackend setBatch returns without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  await cache.setBatch([{ key: "k", value: "v" }]); // Should not throw
});

Deno.test("ApiCacheBackend setBatch returns for empty entries", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  await cache.setBatch([]); // Should not throw
});

Deno.test("ApiCacheBackend uses custom keyPrefix", async () => {
  const { ApiCacheBackend } = await importBackend();

  // Just verify it can be constructed with a prefix
  const cache = new ApiCacheBackend({ keyPrefix: "custom-prefix" });
  assertExists(cache);
  assertEquals(cache.type, "api");
});

Deno.test("ApiCacheBackend URL-encodes project refs and omits cache keys from span URLs", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const originalFetch = globalThis.fetch;
  const records: RecordedSpan[] = [];
  const projectRef = "team/../../demo?token=raw";
  let capturedUrl = "";

  installRecordingTracer(records);
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: projectRef,
    }),
  };
  globalThis.fetch = ((input: RequestInfo | URL) => {
    capturedUrl = String(input);
    return Promise.resolve(
      new Response(JSON.stringify({ value: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://api.example.test",
      keyPrefix: "prefix",
      circuitBreakerName: "api-cache-url-encoding-test",
    });

    const verifiedClaims = await createVerifiedCacheClaims({
      token: "request-token",
      projectId: projectRef,
      projectSlug: "project-slug",
    });
    await runWithVerifiedCacheApiCredential(
      verifiedClaims,
      () => cache.get("secret-cache-key"),
    );

    const encodedProjectRef = encodeURIComponent(projectRef);
    assertEquals(
      capturedUrl,
      `https://api.example.test/projects/${encodedProjectRef}/cache/get?key=prefix%3Asecret-cache-key`,
    );

    const span = records.find((record) => record.name === "http.client.fetch");
    assertExists(span);
    assertEquals(
      span.attributes["http.url"],
      `https://api.example.test/projects/${encodedProjectRef}/cache/get`,
    );
    assertEquals(span.attributes["cache.operation"], "/get");
    assertEquals(String(span.attributes["http.url"]).includes("secret-cache-key"), false);
    assertEquals(String(span.attributes["cache.operation"]).includes("secret-cache-key"), false);
  } finally {
    if (originalAdapter === undefined) {
      delete globals.__vf_multi_project_adapter;
    } else {
      globals.__vf_multi_project_adapter = originalAdapter;
    }
    globalThis.fetch = originalFetch;
    _resetShimForTests();
  }
});

Deno.test("ApiCacheBackend only prefers verified control-plane request tokens", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const originalFetch = globalThis.fetch;
  const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
  const capturedAuthorizations: string[] = [];
  const capturedUrls: string[] = [];

  Deno.env.set("VERYFRONT_API_TOKEN", "host-framework-token");
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "forged-request-token",
      tokenTrust: "verified-control-plane",
      projectId: "forged-project",
      projectSlug: "forged-project-slug",
    }),
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrls.push(String(input));
    capturedAuthorizations.push(new Headers(init?.headers).get("authorization") ?? "");
    return Promise.resolve(
      new Response(JSON.stringify({ deleted: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://api.example.test",
      circuitBreakerName: "api-cache-host-token-test",
    });
    const verifiedClaims = await createVerifiedCacheClaims({
      token: "run-scoped-request-token",
      projectId: "project-123",
      projectSlug: "project-slug",
    });
    const requestScopedDeleted = await runWithVerifiedCacheApiCredential(
      verifiedClaims,
      () => cache.delByPattern("agent:*"),
    );

    assertEquals(requestScopedDeleted, 3);
    assertEquals(
      capturedUrls[0],
      "https://api.example.test/projects/project-123/cache/del-pattern",
    );

    const forgedTrustDeleted = await cache.delByPattern("agent:*");

    assertEquals(forgedTrustDeleted, 3);

    globals.__vf_multi_project_adapter = {
      getCurrentRequestContext: () => ({
        token: "unverified-proxy-token",
        projectId: "project-123",
        projectSlug: "project-slug",
      }),
    };
    const unverifiedRequestDeleted = await cache.delByPattern("agent:*");

    assertEquals(unverifiedRequestDeleted, 3);

    Deno.env.delete("VERYFRONT_API_TOKEN");
    const requestFallbackDeleted = await cache.delByPattern("agent:*");

    assertEquals(requestFallbackDeleted, 3);

    Deno.env.set("VERYFRONT_API_TOKEN", "host-framework-token");

    globals.__vf_multi_project_adapter = {
      getCurrentRequestContext: () => ({
        projectId: "project-123",
        projectSlug: "project-slug",
      }),
    };
    const hostFallbackDeleted = await cache.delByPattern("agent:*");

    assertEquals(hostFallbackDeleted, 3);
    assertEquals(capturedAuthorizations, [
      "Bearer run-scoped-request-token",
      "Bearer host-framework-token",
      "Bearer host-framework-token",
      "Bearer unverified-proxy-token",
      "Bearer host-framework-token",
    ]);
  } finally {
    if (originalAdapter === undefined) {
      delete globals.__vf_multi_project_adapter;
    } else {
      globals.__vf_multi_project_adapter = originalAdapter;
    }
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      Deno.env.delete("VERYFRONT_API_TOKEN");
    } else {
      Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
    }
  }
});

Deno.test("RedisCacheBackend type property", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  assertEquals(cache.type, "redis");
});

Deno.test("RedisCacheBackend returns null without client", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  assertEquals(await cache.get("any-key"), null);
});

Deno.test("RedisCacheBackend translates Redis TTL sentinel values", async () => {
  const { RedisCacheBackend } = await importBackend();
  const cache = new RedisCacheBackend("vf:test:");
  let ttl = 12;
  const keys: string[] = [];
  (cache as unknown as { client: { ttl: (key: string) => Promise<number> } }).client = {
    ttl: (key: string) => {
      keys.push(key);
      return Promise.resolve(ttl);
    },
  };

  assertEquals(await cache.getRemainingTtlSeconds("key"), 12);
  ttl = -1;
  assertEquals(await cache.getRemainingTtlSeconds("key"), Infinity);
  ttl = -2;
  assertEquals(await cache.getRemainingTtlSeconds("key"), null);
  assertEquals(keys, ["vf:test:key", "vf:test:key", "vf:test:key"]);
});

Deno.test("RedisCacheBackend set is no-op without client", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  await cache.set("key", "value"); // Should not throw
});

Deno.test("RedisCacheBackend del is no-op without client", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  await cache.del("key"); // Should not throw
});

Deno.test("RedisCacheBackend delByPattern returns 0 without client", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  assertEquals(await cache.delByPattern("*"), 0);
});

Deno.test("RedisCacheBackend delByPattern deletes every scanned key in bounded batches", async () => {
  const { RedisCacheBackend } = await importBackend();
  const cache = new RedisCacheBackend("vf:test:");
  let scanCalls = 0;
  const deleteBatches: string[][] = [];
  const client = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    mGet: () => Promise.resolve([]),
    set: () => Promise.resolve(null),
    del: (keys: string | string[]) => {
      const batch = Array.isArray(keys) ? [...keys] : [keys];
      deleteBatches.push(batch);
      return Promise.resolve(batch.length);
    },
    scan: () => {
      scanCalls += 1;
      return Promise.resolve({
        cursor: scanCalls < 1005 ? scanCalls : 0,
        keys: [`vf:test:${scanCalls}`],
      });
    },
    expire: () => Promise.resolve(0),
  } satisfies RedisClient;

  (cache as unknown as { client: RedisClient }).client = client;

  const deleted = await cache.delByPattern("*");

  assertEquals(scanCalls, 1005);
  assertEquals(deleted, 1005);
  assertEquals(deleteBatches.map((batch) => batch.length), [1000, 5]);
});

Deno.test("RedisCacheBackend delByPattern keeps Redis delete batches bounded", async () => {
  const { RedisCacheBackend } = await importBackend();
  const cache = new RedisCacheBackend("vf:test:");
  let scanCalls = 0;
  const deleteBatches: string[][] = [];
  const client = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    mGet: () => Promise.resolve([]),
    set: () => Promise.resolve(null),
    del: (keys: string | string[]) => {
      const batch = Array.isArray(keys) ? [...keys] : [keys];
      deleteBatches.push(batch);
      return Promise.resolve(batch.length);
    },
    scan: () => {
      scanCalls += 1;
      const keys = Array.from(
        { length: 250 },
        (_, index) => `vf:test:${scanCalls}:${index}`,
      );
      return Promise.resolve({
        cursor: scanCalls < 50 ? scanCalls : 0,
        keys,
      });
    },
    expire: () => Promise.resolve(0),
  } satisfies RedisClient;

  (cache as unknown as { client: RedisClient }).client = client;

  const deleted = await cache.delByPattern("*");

  assertEquals(scanCalls, 50);
  assertEquals(deleted, 12500);
  assertEquals(deleteBatches.every((batch) => batch.length <= 1000), true);
  assertEquals(deleteBatches.map((batch) => batch.length), [
    1000,
    1000,
    1000,
    1000,
    1000,
    1000,
    1000,
    1000,
    1000,
    1000,
    1000,
    1000,
    500,
  ]);
});

Deno.test("RedisCacheBackend getBatch returns nulls without client", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  const results = await cache.getBatch(["k1", "k2"]);
  assertEquals(results.get("k1"), null);
  assertEquals(results.get("k2"), null);
});

Deno.test("RedisCacheBackend getBatch returns empty map for empty keys", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  const results = await cache.getBatch([]);
  assertEquals(results.size, 0);
});

Deno.test("RedisCacheBackend getBatch uses one MGET call for prefixed keys", async () => {
  const { RedisCacheBackend } = await importBackend();
  const cache = new RedisCacheBackend("vf:test:");
  const getCalls: string[] = [];
  const mGetCalls: string[][] = [];
  const client = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: (key: string) => {
      getCalls.push(key);
      return Promise.resolve(`single:${key}`);
    },
    mGet: (keys: string[]) => {
      mGetCalls.push([...keys]);
      return Promise.resolve(["value-a", null, "value-c"]);
    },
    set: () => Promise.resolve(null),
    del: () => Promise.resolve(0),
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    expire: () => Promise.resolve(0),
  } satisfies RedisClient;

  (cache as unknown as { client: RedisClient }).client = client;

  const results = await cache.getBatch(["a", "b", "c"]);

  assertEquals(mGetCalls, [["vf:test:a", "vf:test:b", "vf:test:c"]]);
  assertEquals(getCalls, []);
  assertEquals(results.get("a"), "value-a");
  assertEquals(results.get("b"), null);
  assertEquals(results.get("c"), "value-c");
});

Deno.test("RedisCacheBackend getBatch falls back to GET when MGET fails", async () => {
  const { RedisCacheBackend } = await importBackend();
  const cache = new RedisCacheBackend("vf:test:");
  const getCalls: string[] = [];
  const client = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    get: (key: string) => {
      getCalls.push(key);
      const values = new Map<string, string | null>([
        ["vf:test:a", "value-a"],
        ["vf:test:b", null],
        ["vf:test:c", "value-c"],
      ]);
      return Promise.resolve(values.get(key) ?? null);
    },
    mGet: () => Promise.reject(new Error("CROSSSLOT Keys in request do not hash to the same slot")),
    set: () => Promise.resolve(null),
    del: () => Promise.resolve(0),
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    expire: () => Promise.resolve(0),
  } satisfies RedisClient;

  (cache as unknown as { client: RedisClient }).client = client;

  const results = await cache.getBatch(["a", "b", "c"]);

  assertEquals(getCalls, ["vf:test:a", "vf:test:b", "vf:test:c"]);
  assertEquals(results.get("a"), "value-a");
  assertEquals(results.get("b"), null);
  assertEquals(results.get("c"), "value-c");
});

Deno.test("RedisCacheBackend setBatch is no-op without client", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  await cache.setBatch([{ key: "k", value: "v" }]); // Should not throw
});

Deno.test("RedisCacheBackend setBatch is no-op for empty entries", async () => {
  const { RedisCacheBackend } = await importBackend();

  const cache = new RedisCacheBackend();
  await cache.setBatch([]); // Should not throw
});

Deno.test("CacheBackends factory functions exist", async () => {
  const { CacheBackends } = await importBackend();

  assertEquals(typeof CacheBackends.transform, "function");
  assertEquals(typeof CacheBackends.file, "function");
  assertEquals(typeof CacheBackends.module, "function");
  assertEquals(typeof CacheBackends.render, "function");
  assertEquals(typeof CacheBackends.userKv, "function");
  assertEquals(typeof CacheBackends.httpModule, "function");
  assertEquals(typeof CacheBackends.ssrModule, "function");
  assertEquals(typeof CacheBackends.projectCSS, "function");
});

Deno.test("http-cache.ts can import CacheBackends without circular dependency", async () => {
  const { CacheBackends, createCacheBackend } = await importBackend();

  assertExists(CacheBackends);
  assertExists(createCacheBackend);

  const backend = await createCacheBackend({ preferredBackend: "memory" });
  assertEquals(backend.type, "memory");
});

Deno.test({
  name: "isDistributedBackend correctly identifies backend types",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { isDistributedBackend, MemoryCacheBackend, RedisCacheBackend, ApiCacheBackend } =
      await importBackend();

    assertEquals(isDistributedBackend(new MemoryCacheBackend()), false);
    assertEquals(isDistributedBackend(new RedisCacheBackend()), true);
    assertEquals(isDistributedBackend(new ApiCacheBackend({})), true);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor returns null for memory-only backend",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, MemoryCacheBackend } = await importBackend();

    const accessor = createDistributedCacheAccessor(
      () => Promise.resolve(new MemoryCacheBackend()),
      "test",
    );

    assertEquals(await accessor(), null);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor caches the result",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, MemoryCacheBackend } = await importBackend();

    let callCount = 0;
    const accessor = createDistributedCacheAccessor(
      () => {
        callCount++;
        return Promise.resolve(new MemoryCacheBackend());
      },
      "test",
    );

    await accessor();
    await accessor();
    // Factory called once, result cached
    assertEquals(callCount, 1);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor handles factory errors gracefully",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor } = await importBackend();

    const accessor = createDistributedCacheAccessor(
      () => Promise.reject(new Error("Init failed")),
      "test-fail",
    );

    assertEquals(await accessor(), null);
  },
});

Deno.test({
  name: "createDistributedCacheAccessor retries after failure when enough time has passed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, ApiCacheBackend } = await importBackend();

    let callCount = 0;
    const apiBackend = new ApiCacheBackend({});

    const accessor = createDistributedCacheAccessor(
      () => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("Init failed"));
        return Promise.resolve(apiBackend);
      },
      "test-retry",
    );

    // First call fails
    assertEquals(await accessor(), null);
    assertEquals(callCount, 1);

    // Immediate second call returns cached null (no retry yet)
    assertEquals(await accessor(), null);
    assertEquals(callCount, 1);

    const originalDateNow = Date.now;
    try {
      // Advance time by 31 seconds
      Date.now = () => originalDateNow() + 31_000;

      // Now it should retry since enough time has passed
      assertEquals(await accessor(), apiBackend);
      assertEquals(callCount, 2);
    } finally {
      Date.now = originalDateNow;
    }
  },
});

Deno.test({
  name: "createDistributedCacheAccessor does not retry for memory-only backend",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createDistributedCacheAccessor, MemoryCacheBackend } = await importBackend();

    let callCount = 0;
    const accessor = createDistributedCacheAccessor(
      () => {
        callCount++;
        return Promise.resolve(new MemoryCacheBackend());
      },
      "test-no-retry-memory",
    );

    assertEquals(await accessor(), null);
    assertEquals(callCount, 1);

    // Even after time passes, memory-only result should not retry
    const originalDateNow = Date.now;
    try {
      Date.now = () => originalDateNow() + 60_000;
      assertEquals(await accessor(), null);
      assertEquals(callCount, 1);
    } finally {
      Date.now = originalDateNow;
    }
  },
});

Deno.test({
  name: "createCacheBackend creates memory backend when preferred",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createCacheBackend } = await importBackend();

    const backend = await createCacheBackend({
      preferredBackend: "memory",
      memoryMaxEntries: 100,
    });

    assertEquals(backend.type, "memory");
  },
});

Deno.test({
  name: "createCacheBackend creates API backend when preferred",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createCacheBackend } = await importBackend();

    const backend = await createCacheBackend({ preferredBackend: "api" });
    assertEquals(backend.type, "api");
  },
});

Deno.test({
  name:
    "createCacheBackend auto-selects API backend from host API base URL under project env isolation",
  fn: async () => {
    const { createCacheBackend } = await importBackend();
    const globals = globalThis as Record<string, unknown>;
    const originalProjectEnvGetter = globals.__vfProjectEnvGetter;
    const originalProjectEnvActiveChecker = globals.__vfProjectEnvActiveChecker;
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const originalProxyMode = Deno.env.get("PROXY_MODE");
    const originalNodeEnv = Deno.env.get("NODE_ENV");

    Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.example.test");
    Deno.env.delete("PROXY_MODE");
    Deno.env.delete("NODE_ENV");
    globals.__vfProjectEnvGetter = () => undefined;
    globals.__vfProjectEnvActiveChecker = () => true;

    try {
      const backend = await createCacheBackend({
        circuitBreakerName: "api-cache-host-base-url-auto-select-test",
      });

      assertEquals(backend.type, "api");
    } finally {
      if (originalProjectEnvGetter === undefined) {
        delete globals.__vfProjectEnvGetter;
      } else {
        globals.__vfProjectEnvGetter = originalProjectEnvGetter;
      }
      if (originalProjectEnvActiveChecker === undefined) {
        delete globals.__vfProjectEnvActiveChecker;
      } else {
        globals.__vfProjectEnvActiveChecker = originalProjectEnvActiveChecker;
      }
      if (originalApiBaseUrl === undefined) {
        Deno.env.delete("VERYFRONT_API_BASE_URL");
      } else {
        Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      }
      if (originalProxyMode === undefined) {
        Deno.env.delete("PROXY_MODE");
      } else {
        Deno.env.set("PROXY_MODE", originalProxyMode);
      }
      if (originalNodeEnv === undefined) {
        Deno.env.delete("NODE_ENV");
      } else {
        Deno.env.set("NODE_ENV", originalNodeEnv);
      }
    }
  },
});
