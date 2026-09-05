import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
/**
 * Cache Backend Tests
 *
 * Tests MemoryCacheBackend, ApiCacheBackend, RedisCacheBackend,
 * isDistributedBackend, createDistributedCacheAccessor, and
 * CacheBackends factory functions.
 *
 * @module cache/backend.test
 */

import { assertEquals, assertExists, assertMatch, assertRejects } from "#std/assert";
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
import { buildQueryAwareCacheKey, isValidCacheKey } from "./keys.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  deleteHostSecret,
  markEnvFileValue,
  setHostSecret,
} from "#veryfront/platform/compat/process/env.ts";
import { resolveCacheRequestAuthority } from "./request-authority.ts";
import { __resetEnvLoaderForTests } from "#veryfront/utils/env-loader.ts";

const API_CACHE_KEY_MAX_LENGTH = 512;
const API_CACHE_KEY_PATTERN = /^[a-zA-Z0-9_:.\-/]+$/;

type RecordedSpan = {
  name: string;
  attributes: Record<string, AttributeValue>;
};

async function importBackend(): Promise<typeof import("./backend.ts")> {
  const backend = await import("./backend.ts");
  class ModeledApiCacheBackend extends backend.ApiCacheBackend {
    constructor(...args: ConstructorParameters<typeof backend.ApiCacheBackend>) {
      super(...args);
      return new Proxy(this, {
        get(target, property) {
          const value = Reflect.get(target, property, target) as unknown;
          if (typeof value !== "function") return value;
          return (...methodArgs: unknown[]) => {
            const adapter = (globalThis as Record<string, unknown>).__vf_multi_project_adapter;
            const getContext = typeof adapter === "object" && adapter !== null &&
                "getCurrentRequestContext" in adapter &&
                typeof adapter.getCurrentRequestContext === "function"
              ? adapter.getCurrentRequestContext
              : undefined;
            const context = getContext?.();
            if (typeof context !== "object" || context === null) {
              return Reflect.apply(value, target, methodArgs);
            }
            const requestContext = context as Record<string, unknown>;
            return runWithRequestContext(
              {
                projectSlug: typeof requestContext.projectSlug === "string"
                  ? requestContext.projectSlug
                  : "",
                projectId: typeof requestContext.projectId === "string"
                  ? requestContext.projectId
                  : undefined,
                token: typeof requestContext.token === "string" ? requestContext.token : "",
                productionMode: requestContext.productionMode === true,
                releaseId: typeof requestContext.releaseId === "string"
                  ? requestContext.releaseId
                  : null,
                branch: typeof requestContext.branch === "string" ? requestContext.branch : null,
                environmentName: typeof requestContext.environmentName === "string"
                  ? requestContext.environmentName
                  : null,
              },
              () => Reflect.apply(value, target, methodArgs) as Promise<unknown>,
            );
          };
        },
      });
    }
  }
  return {
    ...backend,
    ApiCacheBackend: ModeledApiCacheBackend,
  } as typeof backend;
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
        method: "POST",
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

  const results = await cache.getBatch(["exp"]);
  assertEquals(results.get("exp"), null);
});

Deno.test("MemoryCacheBackend expires a zero TTL immediately", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("k", "v", 60);
  await cache.set("k", "v", 0);

  // Read the store before any get(): get() lazily deletes an expired entry and
  // would hide a retained one.
  assertEquals(cache.size, 0, "a zero TTL must remove the existing entry and store nothing");
  assertEquals(await cache.get("k"), null, "a zero-TTL key must read as a miss");
});

Deno.test("MemoryCacheBackend expires a negative TTL immediately", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("k", "v", 60);
  await cache.set("k", "v", -5);

  assertEquals(cache.size, 0, "a negative TTL must remove the existing entry and store nothing");
  assertEquals(await cache.get("k"), null, "a negative-TTL key must read as a miss");
});

Deno.test("MemoryCacheBackend expires oversized non-positive TTL overwrites immediately", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10, { maxSizeBytes: 8 });
  await cache.set("k", "small", 60);
  await cache.set("k", "value-too-large", 0);

  assertEquals(cache.size, 0, "an oversized zero-TTL overwrite must remove the old entry");
  assertEquals(await cache.get("k"), null, "the old value must not survive size admission");
});

Deno.test("MemoryCacheBackend setBatch expires a non-positive TTL immediately", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await cache.set("k", "v", 60);
  await cache.setBatch([{ key: "k", value: "v", ttl: 0 }]);

  assertEquals(
    cache.size,
    0,
    "a batched zero TTL must remove the existing entry and store nothing",
  );
  assertEquals(await cache.get("k"), null, "a batched zero-TTL key must read as a miss");
});

Deno.test("MemoryCacheBackend setBatch expires oversized non-positive TTL overwrites immediately", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10, { maxSizeBytes: 8 });
  await cache.set("k", "small", 60);
  await cache.setBatch([{ key: "k", value: "value-too-large", ttl: 0 }]);

  assertEquals(cache.size, 0, "a batched oversized zero-TTL overwrite must remove the old entry");
  assertEquals(await cache.get("k"), null, "the old value must not survive batch size admission");
});

Deno.test("MemoryCacheBackend preserves an existing value for an oversized positive-TTL overwrite", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10, { maxSizeBytes: 8 });
  await cache.set("k", "small", 60);
  await cache.set("k", "value-too-large", 60);

  assertEquals(await cache.get("k"), "small");
});

Deno.test("MemoryCacheBackend rejects a non-finite TTL", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  await assertRejects(
    () => cache.set("k", "v", Number.POSITIVE_INFINITY),
    RangeError,
    "finite number of seconds",
    "a non-finite TTL must be rejected before it is persisted",
  );
  assertEquals(cache.size, 0, "a rejected TTL must not leave an entry behind");
});

Deno.test("MemoryCacheBackend setBatch rejects a non-finite TTL without throwing synchronously", async () => {
  const { MemoryCacheBackend } = await importBackend();

  const cache = new MemoryCacheBackend(10);
  // `assertRejects` fails when the call throws synchronously, which is exactly
  // the contract at stake: callers hold a declared `Promise<void>`, so an
  // invalid TTL must surface through `.catch()` the way `set` and the
  // API/Redis backends surface it.
  await assertRejects(
    () => cache.setBatch([{ key: "k", value: "v", ttl: Number.POSITIVE_INFINITY }]),
    RangeError,
    "finite number of seconds",
    "a batched non-finite TTL must reject the returned promise",
  );
  assertEquals(cache.size, 0, "a rejected batch TTL must not leave an entry behind");
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
  let fetchCalls = 0;
  installMockFetch(
    (() => {
      fetchCalls++;
      return Promise.resolve(Response.json({ value: null }));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({});
    assertEquals(
      await cache.get("test-key"),
      null,
      "a request without auth or project context must miss",
    );
    assertEquals(
      fetchCalls,
      0,
      "the cache API must not be contacted without a token and a project ref",
    );
  } finally {
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend type property", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  assertEquals(cache.type, "api");
});

Deno.test("ApiCacheBackend enforces exact bounded decoded values", async () => {
  const { ApiCacheBackend, CacheValueTooLargeError } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch((() => Promise.resolve(Response.json({ value: "é" }))) as typeof fetch);

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      circuitBreakerName: "api-cache-bounded-value-test",
    });
    assertEquals(await cache.getWithinLimit("key", 2), "é");
    await assertRejects(
      () => cache.getWithinLimit("key", 1),
      CacheValueTooLargeError,
      "1 UTF-8 bytes",
    );
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend reserves JSON escape bytes outside its response policy", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const body = '{"value":"\\u0000\\u0000"}';
  assertEquals(new TextEncoder().encode(body).byteLength, 24);
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch((() => Promise.resolve(new Response(body))) as typeof fetch);

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      // The compact string envelope is 12 bytes; the selected value receives
      // its own deterministic six-bytes-per-logical-byte wire allowance.
      maxResponseBytes: 12,
      circuitBreakerName: "api-cache-bounded-wire-headroom-test",
    });
    assertEquals(await cache.getWithinLimit("key", 2), "\0\0");
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend keeps unused string headroom outside its response policy", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const body = '{"value":"","x":0}';
  let fetchCalls = 0;
  assertEquals(new TextEncoder().encode(body).byteLength, 18);
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch(
    (() => {
      fetchCalls++;
      return Promise.resolve(new Response(body));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      // The empty value uses none of its 12 bytes of wire headroom. The extra
      // metadata must still fail the independent 12-byte response policy.
      maxResponseBytes: 12,
      circuitBreakerName: "api-cache-independent-non-value-budget-test",
    });
    assertEquals(await cache.getWithinLimit("key", 2), null);
    assertEquals(fetchCalls, 1);
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend rejects unsafe combined response limits before fetching", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  let fetchCalls = 0;
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch(
    (() => {
      fetchCalls++;
      return Promise.resolve(Response.json({ value: "small" }));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      maxResponseBytes: 1,
      circuitBreakerName: "api-cache-unsafe-combined-limit-test",
    });
    await assertRejects(
      () => cache.getWithinLimit("key", Number.MAX_SAFE_INTEGER),
      RangeError,
      "safe integer range",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend rejects oversized escaped values before JSON.parse", async () => {
  const { ApiCacheBackend, CacheValueTooLargeError } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const originalJsonParse = JSON.parse;
  let parseCalls = 0;
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch(
    (() =>
      Promise.resolve(
        new Response(JSON.stringify({ value: "\0".repeat(1_000) })),
      )) as typeof fetch,
  );
  JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
    parseCalls++;
    return Reflect.apply(originalJsonParse, JSON, args);
  }) as typeof JSON.parse;

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      circuitBreakerName: "api-cache-bounded-envelope-test",
    });
    await assertRejects(
      () => cache.getWithinLimit("key", 1),
      CacheValueTooLargeError,
      "1 UTF-8 bytes",
    );
    assertEquals(parseCalls, 0);
  } finally {
    JSON.parse = originalJsonParse;
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend bounded overflows do not open the dependency circuit", async () => {
  const { ApiCacheBackend, CacheValueTooLargeError } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  let fetchCalls = 0;
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch(
    (() => {
      fetchCalls++;
      return Promise.resolve(new Response(JSON.stringify({ value: "xx" })));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      circuitBreakerName: "api-cache-neutral-bounded-overflow-test",
    });
    for (let attempt = 0; attempt < 12; attempt++) {
      await assertRejects(
        () => cache.getWithinLimit("key", 1),
        CacheValueTooLargeError,
      );
    }
    assertEquals(fetchCalls, 12);
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend set returns without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();
  let fetchCalls = 0;
  installMockFetch(
    (() => {
      fetchCalls++;
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({});
    await cache.set("key", "value"); // Should not throw
    assertEquals(
      fetchCalls,
      0,
      "the cache API must not be contacted without a token and a project ref",
    );
  } finally {
    restoreMockFetch();
  }
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

Deno.test("ApiCacheBackend propagates attempted delete failures", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");

  Deno.env.set("VERYFRONT_API_TOKEN", "host-framework-token");
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({ projectSlug: "project-slug" }),
  };
  installMockFetch(
    (() =>
      Promise.resolve(
        new Response("cache unavailable", { status: 503 }),
      )) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      circuitBreakerName: "api-cache-delete-failure-test",
    });

    await assertRejects(() => cache.del("key"));
    await assertRejects(() => cache.delByPattern("prefix:*"));
  } finally {
    if (originalAdapter === undefined) {
      delete globals.__vf_multi_project_adapter;
    } else {
      globals.__vf_multi_project_adapter = originalAdapter;
    }
    restoreMockFetch();
    if (originalToken === undefined) {
      Deno.env.delete("VERYFRONT_API_TOKEN");
    } else {
      Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
    }
  }
});

Deno.test("ApiCacheBackend prefers the request runtime token over the host fallback", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const originalBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
  const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
  let authorization = "";

  Deno.env.set("VERYFRONT_API_BASE_URL", "https://93.184.216.34");
  Deno.env.set("VERYFRONT_API_TOKEN", "host-framework-token");
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "project-runtime-token",
      projectId: "project-123",
    }),
  };
  installMockFetch(
    ((_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(Response.json({ deleted: 1 }));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      circuitBreakerName: "api-cache-request-runtime-token-test",
    });
    assertEquals(await cache.delByPattern("agent:*"), 1);
    assertEquals(authorization, "Bearer project-runtime-token");
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
    if (originalBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
    else Deno.env.set("VERYFRONT_API_BASE_URL", originalBaseUrl);
    if (originalToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
    else Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
  }
});

Deno.test("ApiCacheBackend refuses host fallback for an uncredentialed tenant context", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const originalBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
  const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
  let fetchCalls = 0;

  Deno.env.set("VERYFRONT_API_BASE_URL", "https://93.184.216.34");
  Deno.env.set("VERYFRONT_API_TOKEN", "host-framework-token");
  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      projectId: "attacker-selected-project",
    }),
  };
  installMockFetch(() => {
    fetchCalls += 1;
    return Promise.resolve(Response.json({ deleted: 1 }));
  });

  try {
    const cache = new ApiCacheBackend({
      circuitBreakerName: "api-cache-uncredentialed-context-test",
    });
    assertEquals(await cache.delByPattern("agent:*"), 0);
    assertEquals(fetchCalls, 0);
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
    if (originalBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
    else Deno.env.set("VERYFRONT_API_BASE_URL", originalBaseUrl);
    if (originalToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
    else Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
  }
});

Deno.test("ApiCacheBackend getBatch returns nulls without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  const results = await cache.getBatch(["k1", "k2"]);
  assertEquals(results.size, 2, "getBatch must return one entry per requested key");
  assertEquals(results.get("k1"), null, "missing keys must map to null, not undefined");
  assertEquals(results.get("k2"), null, "missing keys must map to null, not undefined");
});

Deno.test("ApiCacheBackend getBatch falls back to individual gets when the batch endpoint fails", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;

  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch(
    ((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/get-batch")) {
        return Promise.resolve(new Response("batch unavailable", { status: 503 }));
      }
      return Promise.resolve(Response.json({ value: `v-${url.searchParams.get("key")}` }));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      circuitBreakerName: "api-cache-get-batch-fallback-test",
    });

    const results = await cache.getBatch(["k1", "k2"]);

    assertEquals(results.size, 2, "getBatch must return one entry per requested key");
    assertEquals(results.get("k1"), "v-k1", "a failed batch must fall back to individual gets");
    assertEquals(results.get("k2"), "v-k2", "a failed batch must fall back to individual gets");
  } finally {
    if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
    else globals.__vf_multi_project_adapter = originalAdapter;
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend getBatch returns empty map for empty keys", async () => {
  const { ApiCacheBackend } = await importBackend();

  const cache = new ApiCacheBackend({});
  const results = await cache.getBatch([]);
  assertEquals(results.size, 0);
});

Deno.test("ApiCacheBackend setBatch returns without auth context", async () => {
  const { ApiCacheBackend } = await importBackend();
  let fetchCalls = 0;
  installMockFetch(
    (() => {
      fetchCalls++;
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({});
    await cache.setBatch([{ key: "k", value: "v" }]); // Should not throw
    assertEquals(
      fetchCalls,
      0,
      "the cache API must not be contacted without a token and a project ref",
    );
  } finally {
    restoreMockFetch();
  }
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

Deno.test("ApiCacheBackend safely maps query-aware keys without logging key-derived data", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const originalWarn = console.warn;
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const warnings: string[] = [];

  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  installMockFetch(
    ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const response = url.includes("/get-batch")
        ? { values: {} }
        : url.includes("/get?")
        ? { value: null }
        : {};
      return Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      keyPrefix: "prefix",
      circuitBreakerName: "api-cache-malformed-key-test",
    });
    const rawKey = buildQueryAwareCacheKey(
      "/reset/token/secret123",
      new URL(
        "https://example.test/reset/token/secret123?access_token=secret%20value",
      ),
      { policy: "include-all" },
    );
    assertEquals(rawKey.includes("*"), true);

    await cache.get(rawKey);
    await cache.getBatch([rawKey]);
    await cache.set(rawKey, "value");
    await cache.setBatch([{ key: rawKey, value: "value" }]);
    await cache.del(rawKey);

    const [getRequest, getBatchRequest, setRequest, setBatchRequest, delRequest] = requests;
    assertExists(getRequest);
    assertExists(getBatchRequest);
    assertExists(setRequest);
    assertExists(setBatchRequest);
    assertExists(delRequest);
    const getBatchKeys = getBatchRequest.body?.keys as string[];
    const setBatchEntries = setBatchRequest.body?.entries as Array<{ key: string }>;
    assertExists(getBatchKeys[0]);
    assertExists(setBatchEntries[0]);
    const outboundKeys = [
      new URL(getRequest.url).searchParams.get("key"),
      getBatchKeys[0],
      setRequest.body?.key,
      setBatchEntries[0].key,
      delRequest.body?.key,
    ];
    assertEquals(outboundKeys.length, 5);
    for (const key of outboundKeys) {
      assertEquals(typeof key, "string");
      assertEquals(isValidCacheKey(key as string), true);
      assertMatch(key as string, API_CACHE_KEY_PATTERN);
      assertEquals((key as string).length <= API_CACHE_KEY_MAX_LENGTH, true);
      assertEquals((key as string).includes("access_token"), false);
      assertEquals((key as string).includes("secret123"), false);
      assertEquals((key as string).startsWith("prefix:vf-sanitized:"), true);
    }
    assertEquals(new Set(outboundKeys).size, 1);
    const warningOutput = warnings.join("\n");
    assertEquals(warningOutput.includes("originalLength"), true);
    assertEquals(warningOutput.includes("keyHash"), false);
    assertEquals(warningOutput.includes("access_token"), false);
    assertEquals(warningOutput.includes("secret123"), false);
  } finally {
    if (originalAdapter === undefined) {
      delete globals.__vf_multi_project_adapter;
    } else {
      globals.__vf_multi_project_adapter = originalAdapter;
    }
    restoreMockFetch();
    console.warn = originalWarn;
  }
});

Deno.test("ApiCacheBackend bounds long keys and refuses malformed delete patterns", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];

  globals.__vf_multi_project_adapter = {
    getCurrentRequestContext: () => ({
      token: "request-token",
      projectSlug: "project-slug",
    }),
  };
  installMockFetch(
    ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
      keyPrefix: "prefix",
      circuitBreakerName: "api-cache-long-key-test",
    });

    const overlongKey = `secret-path-token-${"a".repeat(API_CACHE_KEY_MAX_LENGTH)}`;
    await cache.set(overlongKey, "value");
    assertEquals(requests.length, 1);
    const setRequest = requests[0];
    assertExists(setRequest);
    const outboundKey = setRequest.body?.key as string;
    assertEquals(isValidCacheKey(outboundKey), true);
    assertMatch(outboundKey, API_CACHE_KEY_PATTERN);
    assertEquals(outboundKey.length <= API_CACHE_KEY_MAX_LENGTH, true);
    assertEquals(outboundKey.includes("secret-path-token"), false);

    const deleted = await cache.delByPattern("render:bad pattern:*");
    assertEquals(deleted, 0);
    assertEquals(requests.length, 1);

    const overlongPattern = `render:${"*".repeat(API_CACHE_KEY_MAX_LENGTH)}`;
    assertEquals(await cache.delByPattern(overlongPattern), 0);
    assertEquals(requests.length, 1);
  } finally {
    if (originalAdapter === undefined) {
      delete globals.__vf_multi_project_adapter;
    } else {
      globals.__vf_multi_project_adapter = originalAdapter;
    }
    restoreMockFetch();
  }
});

Deno.test("ApiCacheBackend URL-encodes project refs and omits cache keys from span URLs", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
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
  installMockFetch(
    ((input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ value: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
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
      `https://93.184.216.34/projects/${encodedProjectRef}/cache/get?key=prefix%3Asecret-cache-key`,
    );

    const span = records.find((record) => record.name === "http.client.fetch");
    assertExists(span);
    assertEquals(
      span.attributes["http.url"],
      `https://93.184.216.34/projects/${encodedProjectRef}/cache/get`,
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
    restoreMockFetch();
    _resetShimForTests();
  }
});

Deno.test("ApiCacheBackend uses the credential paired with an explicit endpoint", async () => {
  const { ApiCacheBackend } = await importBackend();
  const globals = globalThis as Record<string, unknown>;
  const originalAdapter = globals.__vf_multi_project_adapter;
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
  installMockFetch(
    ((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input));
      capturedAuthorizations.push(new Headers(init?.headers).get("authorization") ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ deleted: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch,
  );

  try {
    const cache = new ApiCacheBackend({
      apiBaseUrl: "https://93.184.216.34",
      apiToken: "test-explicit-token",
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
      "https://93.184.216.34/projects/project-123/cache/del-pattern",
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
      "Bearer test-explicit-token",
      "Bearer test-explicit-token",
      "Bearer test-explicit-token",
      "Bearer test-explicit-token",
      "Bearer test-explicit-token",
    ]);
  } finally {
    if (originalAdapter === undefined) {
      delete globals.__vf_multi_project_adapter;
    } else {
      globals.__vf_multi_project_adapter = originalAdapter;
    }
    restoreMockFetch();
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

Deno.test("RedisCacheBackend propagates delete failures", async () => {
  const { RedisCacheBackend } = await importBackend();
  const cache = new RedisCacheBackend("vf:test:");
  (cache as unknown as { client: RedisClient }).client = {
    del: () => Promise.reject(new Error("redis delete failed")),
  } as unknown as RedisClient;

  await assertRejects(
    () => cache.del("key"),
    Error,
    "redis delete failed",
  );
});

Deno.test("RedisCacheBackend propagates pattern delete failures", async () => {
  const { RedisCacheBackend } = await importBackend();
  const cache = new RedisCacheBackend("vf:test:");
  (cache as unknown as { client: RedisClient }).client = {
    scan: () => Promise.reject(new Error("redis scan failed")),
  } as unknown as RedisClient;

  await assertRejects(
    () => cache.delByPattern("*"),
    Error,
    "redis scan failed",
  );
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
    eval: () => Promise.resolve(null),
    incr: () => Promise.resolve(0),
    pExpire: () => Promise.resolve(false),
    pTTL: () => Promise.resolve(-1),
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
    eval: () => Promise.resolve(null),
    incr: () => Promise.resolve(0),
    pExpire: () => Promise.resolve(false),
    pTTL: () => Promise.resolve(-1),
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
    eval: () => Promise.resolve(null),
    incr: () => Promise.resolve(0),
    pExpire: () => Promise.resolve(false),
    pTTL: () => Promise.resolve(-1),
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
    eval: () => Promise.resolve(null),
    incr: () => Promise.resolve(0),
    pExpire: () => Promise.resolve(false),
    pTTL: () => Promise.resolve(-1),
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

    Deno.env.set("VERYFRONT_API_BASE_URL", "https://93.184.216.34");
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

Deno.test({
  name: "ApiCacheBackend does not pair a tenant env endpoint with a host credential",
  fn: async () => {
    const { ApiCacheBackend } = await importBackend();
    const globals = globalThis as Record<string, unknown>;
    const originalAdapter = globals.__vf_multi_project_adapter;
    const originalProjectEnvGetter = globals.__vfProjectEnvGetter;
    const originalProjectEnvActiveChecker = globals.__vfProjectEnvActiveChecker;
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const capturedUrls: string[] = [];

    Deno.env.set("VERYFRONT_API_BASE_URL", "https://93.184.216.34");
    Deno.env.set("VERYFRONT_API_TOKEN", "host-token");
    globals.__vfProjectEnvGetter = (key: string) =>
      key === "VERYFRONT_API_BASE_URL" ? "https://93.184.216.35" : undefined;
    globals.__vfProjectEnvActiveChecker = () => true;
    globals.__vf_multi_project_adapter = {
      getCurrentRequestContext: () => ({ projectId: "project-123" }),
    };
    installMockFetch(
      ((input: RequestInfo | URL) => {
        capturedUrls.push(String(input));
        return Promise.resolve(
          Response.json({ deleted: 1 }),
        );
      }) as typeof fetch,
    );

    try {
      const cache = new ApiCacheBackend({
        circuitBreakerName: "api-cache-tenant-endpoint-isolation-test",
      });
      assertEquals(await cache.delByPattern("agent:*"), 0);
      assertEquals(capturedUrls, []);
    } finally {
      if (originalAdapter === undefined) delete globals.__vf_multi_project_adapter;
      else globals.__vf_multi_project_adapter = originalAdapter;
      if (originalProjectEnvGetter === undefined) delete globals.__vfProjectEnvGetter;
      else globals.__vfProjectEnvGetter = originalProjectEnvGetter;
      if (originalProjectEnvActiveChecker === undefined) {
        delete globals.__vfProjectEnvActiveChecker;
      } else {
        globals.__vfProjectEnvActiveChecker = originalProjectEnvActiveChecker;
      }
      restoreMockFetch();
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
    }
  },
});

Deno.test({
  name: "ApiCacheBackend selects the endpoint paired with credential provenance",
  fn: async () => {
    const { ApiCacheBackend } = await importBackend();
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const capturedUrls: string[] = [];
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://93.184.216.35");
    Deno.env.set("VERYFRONT_API_URL", "https://93.184.216.36/graphql");
    markEnvFileValue("VERYFRONT_API_BASE_URL");
    installMockFetch(
      ((input: RequestInfo | URL) => {
        capturedUrls.push(String(input));
        return Promise.resolve(Response.json({ deleted: 1 }));
      }) as typeof fetch,
    );

    try {
      const cache = new ApiCacheBackend({
        circuitBreakerName: "api-cache-credential-provenance-test",
      });
      cache.cacheAuthority = () => ({
        token: "stored-login-token",
        projectRef: "project-123",
        tokenSource: "host-env",
      });
      assertEquals(await cache.delByPattern("agent:*"), 1);
      assertEquals(capturedUrls, [
        "https://93.184.216.35/projects/project-123/cache/del-pattern",
      ]);

      cache.cacheAuthority = () => ({
        token: "project-env-token",
        projectRef: "project-123",
        tokenSource: "env-file",
      });
      assertEquals(await cache.delByPattern("agent:*"), 1);
      assertEquals(capturedUrls[1], "https://93.184.216.35/projects/project-123/cache/del-pattern");

      cache.cacheAuthority = () => ({
        token: "request-token",
        projectRef: "project-123",
        tokenSource: "request",
      });
      assertEquals(await cache.delByPattern("agent:*"), 1);
      assertEquals(capturedUrls[2], "https://93.184.216.35/projects/project-123/cache/del-pattern");

      cache.cacheAuthority = () => ({
        token: "verified-control-plane-token",
        projectRef: "project-123",
        tokenSource: "verified-control-plane",
      });
      assertEquals(await cache.delByPattern("agent:*"), 1);
      assertEquals(
        capturedUrls[3],
        "https://93.184.216.36/api/projects/project-123/cache/del-pattern",
      );
    } finally {
      restoreMockFetch();
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      __resetEnvLoaderForTests();
    }
  },
});

Deno.test({
  name: "ApiCacheBackend honors API_URL for ambient credentials",
  fn: async () => {
    const { ApiCacheBackend } = await importBackend();
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const capturedUrls: string[] = [];
    Deno.env.delete("VERYFRONT_API_BASE_URL");
    Deno.env.set("VERYFRONT_API_URL", "https://93.184.216.36/graphql");
    installMockFetch(
      ((input: RequestInfo | URL) => {
        capturedUrls.push(String(input));
        return Promise.resolve(Response.json({ deleted: 1 }));
      }) as typeof fetch,
    );

    try {
      const cache = new ApiCacheBackend({
        circuitBreakerName: "api-cache-ambient-url-test",
      });
      cache.cacheAuthority = () => ({
        token: "request-token",
        projectRef: "project-123",
        tokenSource: "request",
      });

      assertEquals(await cache.delByPattern("agent:*"), 1);
      assertEquals(capturedUrls, [
        "https://93.184.216.36/api/projects/project-123/cache/del-pattern",
      ]);
    } finally {
      restoreMockFetch();
      if (originalApiBaseUrl === undefined) Deno.env.delete("VERYFRONT_API_BASE_URL");
      else Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      __resetEnvLoaderForTests();
    }
  },
});

Deno.test({
  name: "cache authority classifies a stored token independently of blank env-file provenance",
  fn: () => {
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    Deno.env.set("VERYFRONT_API_TOKEN", "   ");
    markEnvFileValue("VERYFRONT_API_TOKEN");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
    try {
      const authority = resolveCacheRequestAuthority();
      assertEquals(authority.token, "stored-login-token");
      assertEquals(authority.tokenSource, "host-private");
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
      if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      __resetEnvLoaderForTests();
    }
  },
});

Deno.test({
  name: "cache authority keeps env-file provenance when a stored host token also exists",
  fn: () => {
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    Deno.env.set("VERYFRONT_API_TOKEN", "project-env-token");
    markEnvFileValue("VERYFRONT_API_TOKEN");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
    try {
      const authority = resolveCacheRequestAuthority();
      assertEquals(authority.token, "project-env-token");
      assertEquals(authority.tokenSource, "env-file");
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
      if (originalApiToken === undefined) Deno.env.delete("VERYFRONT_API_TOKEN");
      else Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      __resetEnvLoaderForTests();
    }
  },
});

Deno.test({
  name: "ApiCacheBackend honors the host API URL paired with a stored credential",
  fn: async () => {
    const { ApiCacheBackend } = await importBackend();
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const capturedUrls: string[] = [];
    Deno.env.set("VERYFRONT_API_URL", "https://93.184.216.36/graphql");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
    installMockFetch(
      ((input: RequestInfo | URL) => {
        capturedUrls.push(String(input));
        return Promise.resolve(Response.json({ deleted: 1 }));
      }) as typeof fetch,
    );

    try {
      const cache = new ApiCacheBackend({
        circuitBreakerName: "api-cache-host-url-test",
      });
      cache.cacheAuthority = () => ({
        token: "stored-login-token",
        projectRef: "project-123",
        tokenSource: "host-private",
      });

      assertEquals(await cache.delByPattern("agent:*"), 1);
      assertEquals(capturedUrls, [
        "https://93.184.216.36/api/projects/project-123/cache/del-pattern",
      ]);
    } finally {
      restoreMockFetch();
      deleteHostSecret("VERYFRONT_API_TOKEN");
      if (originalApiUrl === undefined) Deno.env.delete("VERYFRONT_API_URL");
      else Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
    }
  },
});
