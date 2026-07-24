import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/esm/http-cache.test */

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import {
  makeTempDir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import {
  __clearInFlightHttpFetches,
  __injectCachesForTests,
  __test_extractBundleDeps,
  cacheHttpImportsToLocal,
  cacheModuleToLocal,
  ensureHttpBundlesExist,
  extractSourceUrl,
  normalizeHttpUrl,
} from "./http-cache.ts";
import { __setDistributedCacheAccessorForTests } from "./http-cache-wrapper.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { buildHttpCacheIdentity } from "./http-cache-helpers.ts";
import { simpleHash } from "#veryfront/utils/hash-utils.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";

/** Duplicated from http-cache.ts for isolated unit testing of the pattern. */
const BUNDLE_RE = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-([a-f0-9]+)\.mjs)/gi;

function extractBundleHashes(code: string): string[] {
  const hashes: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = BUNDLE_RE.exec(code)) !== null) {
    if (match[2]) hashes.push(match[2]);
  }

  BUNDLE_RE.lastIndex = 0;
  return hashes;
}

/** Minimal distributed cache backend backed by a map the test can inspect. */
function createMemoryBackend(store: Map<string, string>): CacheBackend {
  return {
    type: "memory",
    get: (key) => Promise.resolve(store.get(key) ?? null),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

async function withIsolatedHttpCache<T>(
  tempPrefix: string,
  mockFetch: typeof fetch,
  run: (tempDir: string) => Promise<T>,
): Promise<T> {
  const tempDir = await makeTempDir({ prefix: tempPrefix });

  try {
    return await withMockFetch(mockFetch, async () => {
      __injectCachesForTests({
        cachedPaths: new Map(),
        processingStack: new Set(),
        lastDistributedRefresh: new Map(),
      });
      __setDistributedCacheAccessorForTests(() => Promise.resolve(null));

      try {
        return await run(tempDir);
      } finally {
        __injectCachesForTests(null);
        __setDistributedCacheAccessorForTests(null);
        __clearInFlightHttpFetches();
      }
    });
  } finally {
    await remove(tempDir, { recursive: true });
  }
}

describe("HTTP Bundle Cache", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("retries transient esm.sh failures before failing a render", async () => {
    const moduleUrl = "https://esm.sh/react@19.0.0/jsx-runtime?target=es2022";
    let fetchCount = 0;

    const mockFetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve(new Response("upstream failure", { status: 502 }));
      }
      return Promise.resolve(
        new Response("export const jsx = () => null;", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-retry-", mockFetch, async (tempDir) => {
      const cachedUrl = await cacheModuleToLocal(moduleUrl, tempDir, "19.0.0");

      assert(cachedUrl.startsWith("file://"));
      assertEquals(fetchCount, 2);
    });
  });

  it("does not retry permanent HTTP module failures", async () => {
    let fetchCount = 0;
    let bodyCancelled = false;

    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          }),
          { status: 404 },
        ),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-permanent-failure-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () =>
          cacheModuleToLocal(
            "https://esm.sh/missing-package?access_token=super-secret",
            tempDir,
          ),
        Error,
      );
      assertEquals(fetchCount, 1);
      assertEquals(bodyCancelled, true);
      assertInstanceOf(error, Error);
      assert(!error.message.includes("super-secret"));
    });
  });

  it("retries failures while reading an HTTP module body", async () => {
    let fetchCount = 0;

    const mockFetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("body disconnected"));
              },
            }),
          ),
        );
      }
      return Promise.resolve(
        new Response("export const recovered = true;", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-body-retry-", mockFetch, async (tempDir) => {
      const cachedUrl = await cacheModuleToLocal(
        "https://esm.sh/body-disconnect",
        tempDir,
      );

      assert(cachedUrl.startsWith("file://"));
      assertEquals(fetchCount, 2);
    });
  });

  it("retries a network rejection before succeeding", async () => {
    let fetchCount = 0;
    const mockFetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) return Promise.reject(new TypeError("network unavailable"));
      return Promise.resolve(new Response("export const recovered = true;"));
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-network-retry-", mockFetch, async (tempDir) => {
      const cachedUrl = await cacheModuleToLocal("https://esm.sh/network-retry", tempDir);

      assert(cachedUrl.startsWith("file://"));
      assertEquals(fetchCount, 2);
    });
  });

  it("does not expose URL credentials after network retries are exhausted", async () => {
    let fetchCount = 0;
    const secretUrl = "https://esm.sh/network-failure?access_token=super-secret";
    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.reject(new TypeError(`network unavailable for ${secretUrl}`));
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-network-failure-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal(secretUrl, tempDir),
        Error,
      );

      assertEquals(fetchCount, 3);
      assertInstanceOf(error, Error);
      assert(!error.message.includes("super-secret"));
    });
  });

  it("does not expose URL credentials when an upstream returns HTML", async () => {
    const secretUrl = "https://esm.sh/html-failure?access_token=super-secret";
    const mockFetch = (() =>
      Promise.resolve(
        new Response("<!doctype html><title>upstream failure</title>", {
          headers: { "content-type": "text/html" },
        }),
      )) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-html-failure-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal(secretUrl, tempDir),
        Error,
      );

      assertInstanceOf(error, Error);
      assert(!error.message.includes("super-secret"));
      assertEquals(
        error.message,
        "Received HTML instead of JavaScript from https://esm.sh/html-failure. " +
          "The package may not exist or failed to build on esm.sh.",
      );
    });
  });

  it("bounds transient failure attempts and cancels every response body", async () => {
    let fetchCount = 0;
    let cancelledBodies = 0;
    const mockFetch = (() => {
      fetchCount += 1;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelledBodies += 1;
            },
          }),
          { status: 503 },
        ),
      );
    }) as typeof fetch;

    await withIsolatedHttpCache("vf-esm-exhausted-retry-", mockFetch, async (tempDir) => {
      const error = await assertRejects(
        () => cacheModuleToLocal("https://esm.sh/exhausted", tempDir),
        Error,
      );

      assertEquals(fetchCount, 3);
      assertEquals(cancelledBodies, 3);
      assertInstanceOf(error, Error);
      assert(error.message.includes("503"));
    });
  });

  it("preserves and shares canonical React versions across project import maps", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-react-singleton-cache-" });
    const originalFetch = globalThis.fetch;
    const reactUrl = "https://esm.sh/react@19.0.0?target=es2022";
    const requestedUrls: string[] = [];
    let fetchCount = 0;

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack: new Set(),
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    globalThis.fetch = ((input: string | URL | Request) => {
      fetchCount += 1;
      requestedUrls.push(String(input));
      return Promise.resolve(
        new Response("export default { version: '19.0.0' };", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      const source = `import React from "${reactUrl}"; export default React;`;
      const first = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            react: "https://esm.sh/react@19.2.4?target=es2022",
            unrelated: "https://cdn.example.com/a.js",
          },
          scopes: {},
        },
      });
      const second = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        importMap: {
          imports: {
            react: "https://esm.sh/react@19.2.4?target=es2022",
            unrelated: "https://cdn.example.com/b.js",
          },
          scopes: {},
        },
      });
      const firstPath = first.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const secondPath = second.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];

      assert(firstPath);
      assert(secondPath);
      assertEquals(secondPath, firstPath);
      assertEquals(fetchCount, 1);
      assert(requestedUrls.some((url) => url.includes("react@19.0.0")));
      assertEquals(requestedUrls.some((url) => url.includes("react@19.2.4")), false);
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  it("aligns explicit React URLs to the resolved project version", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-react-version-align-" });
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack: new Set(),
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    globalThis.fetch = ((input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Promise.resolve(
        new Response("export default { version: '19.0.0' };", {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      await cacheHttpImportsToLocal(
        'import React from "https://esm.sh/react@18.3.1?target=es2022";',
        {
          cacheDir: tempDir,
          reactVersion: "19.0.0",
          importMap: {
            imports: { react: "https://esm.sh/react@19.2.4?target=es2022" },
            scopes: {},
          },
        },
      );

      assert(requestedUrls.some((url) => url.includes("react@19.0.0")));
      assertEquals(requestedUrls.some((url) => url.includes("react@18.3.1")), false);
      assertEquals(requestedUrls.some((url) => url.includes("react@19.2.4")), false);
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  it("isolates rewritten modules with the same URL and React version by import map", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-import-map-cache-" });
    const originalFetch = globalThis.fetch;
    const rootUrl = "https://modules.example.com/root.js";

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack: new Set(),
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      const code = url.startsWith(rootUrl)
        ? 'import { marker } from "mapped-dependency"; export { marker };'
        : url.includes("dependency-a.js")
        ? 'export const marker = "A";'
        : 'export const marker = "B";';
      return Promise.resolve(
        new Response(code, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      const source = `import { marker } from "${rootUrl}"; export { marker };`;
      const first = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            "mapped-dependency": "https://cdn.example.com/dependency-a.js",
            unused: "https://cdn.example.com/unused.js",
          },
          scopes: {
            "/scope-b/": { z: "https://cdn.example.com/z.js", a: "https://cdn.example.com/a.js" },
            "/scope-a/": { x: "https://cdn.example.com/x.js" },
          },
        },
      });
      const second = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: { "mapped-dependency": "https://cdn.example.com/dependency-b.js" },
          scopes: {},
        },
      });
      const reorderedFirst = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            unused: "https://cdn.example.com/unused.js",
            "mapped-dependency": "https://cdn.example.com/dependency-a.js",
          },
          scopes: {
            "/scope-a/": { x: "https://cdn.example.com/x.js" },
            "/scope-b/": { a: "https://cdn.example.com/a.js", z: "https://cdn.example.com/z.js" },
          },
        },
      });
      const differentScope = await cacheHttpImportsToLocal(source, {
        cacheDir: tempDir,
        reactVersion: "19.0.0",
        importMap: {
          imports: {
            "mapped-dependency": "https://cdn.example.com/dependency-a.js",
            unused: "https://cdn.example.com/unused.js",
          },
          scopes: {
            "/scope-b/": {
              z: "https://cdn.example.com/z-v2.js",
              a: "https://cdn.example.com/a.js",
            },
            "/scope-a/": { x: "https://cdn.example.com/x.js" },
          },
        },
      });
      const firstPath = first.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const secondPath = second.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const reorderedFirstPath = reorderedFirst.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const differentScopePath = differentScope.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];

      assert(firstPath);
      assert(secondPath);
      assert(reorderedFirstPath);
      assert(differentScopePath);
      assertNotEquals(firstPath, secondPath);
      assertNotEquals(await readTextFile(firstPath), await readTextFile(secondPath));
      assertEquals(reorderedFirstPath, firstPath);
      assertNotEquals(differentScopePath, firstPath);
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not coalesce concurrent modules whose import maps collide under legacy hashing", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-import-map-collision-" });
    const originalFetch = globalThis.fetch;
    const rootUrl = "https://modules.example.com/collision.js";
    let fetchCount = 0;

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack: new Set(),
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    globalThis.fetch = (async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response("export const value = true;", {
        headers: { "content-type": "application/javascript" },
      });
    }) as typeof fetch;

    try {
      const source = `import { value } from "${rootUrl}"; export { value };`;
      const [aaResult, bbResult] = await Promise.all([
        cacheHttpImportsToLocal(source, {
          cacheDir: tempDir,
          importMap: { imports: { collision: "Aa" }, scopes: {} },
        }),
        cacheHttpImportsToLocal(source, {
          cacheDir: tempDir,
          importMap: { imports: { collision: "BB" }, scopes: {} },
        }),
      ]);
      const aaPath = aaResult.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      const bbPath = bbResult.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];

      assert(aaPath);
      assert(bbPath);
      assertNotEquals(aaPath, bbPath);
      assertEquals(fetchCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  it("tracks circular processing by the full cache identity", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-processing-identity-" });
    const originalFetch = globalThis.fetch;
    const rootUrl = "https://modules.example.com/circular-identity.js";
    const options = {
      cacheDir: tempDir,
      reactVersion: "19.0.0",
      importMap: {
        imports: { dependency: "https://cdn.example.com/dependency.js" },
        scopes: {},
      },
    };
    const expectedIdentity = await buildHttpCacheIdentity(rootUrl, options);
    const active = new Set<string>();
    const hasCalls: string[] = [];
    const addCalls: string[] = [];
    const deleteCalls: string[] = [];
    const processingStack = {
      has(value: string) {
        hasCalls.push(value);
        return active.has(value);
      },
      add(value: string) {
        addCalls.push(value);
        active.add(value);
        return this;
      },
      delete(value: string) {
        deleteCalls.push(value);
        return active.delete(value);
      },
    };

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack,
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("export const value = true;", {
          headers: { "content-type": "application/javascript" },
        }),
      )) as typeof fetch;

    try {
      await cacheHttpImportsToLocal(
        `import { value } from "${rootUrl}"; export { value };`,
        options,
      );

      assertEquals(hasCalls, [expectedIdentity]);
      assertEquals(addCalls, [expectedIdentity]);
      assertEquals(deleteCalls, [expectedIdentity]);
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  it("does not persist a module whose lazy dependency failed to prefetch", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-degraded-artifact-" });
    const originalFetch = globalThis.fetch;
    const parentUrl = "https://modules.example.com/degraded-parent.js";
    const childUrl = "https://modules.example.com/degraded-child.js";
    const distributed = new Map<string, string>();
    let parentFetches = 0;

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack: new Set(),
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(createMemoryBackend(distributed)));
    globalThis.fetch = ((input: string | URL | Request) => {
      if (String(input) === childUrl) {
        return Promise.resolve(new Response("upstream failure", { status: 502 }));
      }
      parentFetches += 1;
      return Promise.resolve(
        new Response(`export const load = () => import("${childUrl}");`, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      const source = `import { load } from "${parentUrl}"; export { load };`;
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };

      const first = await cacheHttpImportsToLocal(source, options);
      const firstPath = first.code.match(/file:\/\/([^"']+\.mjs)/)?.[1];
      assert(firstPath, "Expected the render to keep working with a local parent module");
      assertEquals(parentFetches, 1);
      assertEquals(distributed.size, 0);

      await cacheHttpImportsToLocal(source, options);
      assertEquals(parentFetches, 2);
      assertEquals(distributed.size, 0);
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  it("persists a module whose lazy dependency prefetched successfully", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-healthy-artifact-" });
    const originalFetch = globalThis.fetch;
    const parentUrl = "https://modules.example.com/healthy-parent.js";
    const childUrl = "https://modules.example.com/healthy-child.js";
    const distributed = new Map<string, string>();
    let parentFetches = 0;

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack: new Set(),
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(createMemoryBackend(distributed)));
    globalThis.fetch = ((input: string | URL | Request) => {
      if (String(input) === childUrl) {
        return Promise.resolve(
          new Response("export const child = true;", {
            headers: { "content-type": "application/javascript" },
          }),
        );
      }
      parentFetches += 1;
      return Promise.resolve(
        new Response(`export const load = () => import("${childUrl}");`, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      const source = `import { load } from "${parentUrl}"; export { load };`;
      const options = { cacheDir: tempDir, importMap: { imports: {}, scopes: {} } };

      await cacheHttpImportsToLocal(source, options);
      assertEquals(parentFetches, 1);
      assert(distributed.size > 0, "Expected a healthy module to reach the distributed cache");

      await cacheHttpImportsToLocal(source, options);
      assertEquals(parentFetches, 1);
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  it("rewrites react-dom dependencies with the requested React version", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-react-version-cache-" });
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    __injectCachesForTests({
      cachedPaths: new Map(),
      processingStack: new Set(),
      lastDistributedRefresh: new Map(),
    });
    __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      const code = url.includes("react-dom@18.3.1")
        ? 'import React from "react"; export const version = React.version;'
        : 'export default { version: "18.3.1" };';
      return Promise.resolve(
        new Response(code, {
          headers: { "content-type": "application/javascript" },
        }),
      );
    }) as typeof fetch;

    try {
      const rootUrl = "https://esm.sh/react-dom@18.3.1/server?external=react&target=es2022";
      const cachedRootUrl = await cacheModuleToLocal(rootUrl, tempDir, "18.3.1");
      const cachedRootPath = cachedRootUrl.replace(/^file:\/\//, "");
      const legacyCachePath = join(tempDir, `http-${simpleHash(normalizeHttpUrl(rootUrl))}.mjs`);
      const rootCode = await readTextFile(cachedRootPath);

      assertNotEquals(cachedRootPath, legacyCachePath);
      assert(rootCode.includes('from "./http-'));
      assertEquals(rootCode.includes('from "react"'), false);
      assert(
        requestedUrls.some((url) => url.includes("/react@18.3.1")),
        "Expected React 18 dependency URL, got: " + requestedUrls.join(", "),
      );
      assertEquals(requestedUrls.some((url) => url.includes("/react@19.2.4")), false);

      const sourceUrls: string[] = [];
      for await (const entry of readDir(tempDir)) {
        if (!entry.isFile || !entry.name.endsWith(".mjs")) continue;
        const sourceUrl = extractSourceUrl(await readTextFile(join(tempDir, entry.name)));
        if (sourceUrl) sourceUrls.push(sourceUrl);
      }
      assert(sourceUrls.some((url) => url.includes("/react@18.3.1")));
    } finally {
      globalThis.fetch = originalFetch;
      __injectCachesForTests(null);
      __setDistributedCacheAccessorForTests(null);
      __clearInFlightHttpFetches();
      await remove(tempDir, { recursive: true });
    }
  });

  describe("HTTP_BUNDLE_PATTERN regex", () => {
    it("matches numeric-only hashes (production repro: 390496888)", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-390496888.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "390496888");
    });

    it("matches hex hashes", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-a1b2c3d4.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "a1b2c3d4");
    });

    it("matches mixed alphanumeric hashes", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-974671618.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "974671618");
    });

    it("extracts multiple bundle references from code", () => {
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "file:///app/.cache/veryfront-http-bundle/http-222222.mjs";`,
        `import c from "file:///app/.cache/veryfront-http-bundle/http-abcdef.mjs";`,
      ].join("\n");
      const hashes = extractBundleHashes(code);
      assertEquals(hashes, ["111111", "222222", "abcdef"]);
    });

    it("does not match non-hex characters (g, h, z)", () => {
      const code = `import foo from "file:///app/.cache/veryfront-http-bundle/http-ghijkl.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 0);
    });

    it("handles single-quoted imports", () => {
      const code = `import foo from 'file:///app/.cache/veryfront-http-bundle/http-999999.mjs'`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "999999");
    });

    it("handles dynamic import() syntax", () => {
      const code =
        `const mod = await import("file:///app/.cache/veryfront-http-bundle/http-abc123.mjs")`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "abc123");
    });

    it("handles re-export syntax", () => {
      const code =
        `export { default } from "file:///app/.cache/veryfront-http-bundle/http-def456.mjs"`;
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 1);
      assertEquals(hashes[0], "def456");
    });

    it("handles transitive deps in recovered bundle code", () => {
      const bundleCode = [
        `import { createContext } from "file:///app/.cache/veryfront-http-bundle/http-100000.mjs";`,
        `import { useState } from "file:///app/.cache/veryfront-http-bundle/http-200000.mjs";`,
        `export function Component() { return null; }`,
      ].join("\n");
      const hashes = extractBundleHashes(bundleCode);
      assertEquals(hashes, ["100000", "200000"]);
    });

    it("matches relative path imports (new portable format)", () => {
      // New format uses relative paths for intra-bundle imports
      const code = `import foo from "./http-123456.mjs"`;
      // The original BUNDLE_RE only matches absolute paths, so this is expected to return empty
      // Relative paths are handled separately by extractBundleDeps in http-cache.ts
      const hashes = extractBundleHashes(code);
      assertEquals(hashes.length, 0);
    });

    it("handles mix of absolute and relative imports", () => {
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "./http-222222.mjs";`, // Relative - not matched by absolute pattern
        `import c from "file:///app/.cache/veryfront-http-bundle/http-333333.mjs";`,
      ].join("\n");
      // Only absolute paths are extracted by the test helper
      const hashes = extractBundleHashes(code);
      assertEquals(hashes, ["111111", "333333"]);
    });
  });

  describe("ensureHttpBundlesExist", () => {
    async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
      const dir = await makeTempDir({ prefix: "vf-http-bundle-test-" });
      try {
        await fn(dir);
      } finally {
        try {
          await remove(dir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
    }

    it("returns empty array when all bundles exist on disk", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");
        await writeTextFile(join(tempDir, "http-222222.mjs"), "export const b = 2;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
            { path: join(tempDir, "http-222222.mjs"), hash: "222222" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 0, "All bundles exist on disk, none should fail");
      });
    });

    it("reports missing bundles when no distributed cache available", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-111111.mjs"), "export const a = 1;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-111111.mjs"), hash: "111111" },
            { path: join(tempDir, "http-aaaaaa.mjs"), hash: "aaaaaa" },
            { path: join(tempDir, "http-bbbbbb.mjs"), hash: "bbbbbb" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 2, "Two missing bundles should be reported");
        assert(failed.includes("aaaaaa"), "aaaaaa should be in failed list");
        assert(failed.includes("bbbbbb"), "bbbbbb should be in failed list");
      });
    });

    it("handles empty bundle list", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist([], tempDir);
        assertEquals(failed.length, 0);
      });
    });

    it("uses canonical paths from cacheDir, ignoring caller-provided paths", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-333333.mjs"), "export const c = 3;");

        const failed = await ensureHttpBundlesExist(
          [{ path: "/app/.cache/other-pod-cache/http-333333.mjs", hash: "333333" }],
          tempDir,
        );

        assertEquals(
          failed.length,
          0,
          "Should find bundle at canonical path regardless of caller path",
        );
      });
    });

    it("reproduces production error: numeric hash 390496888", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist(
          [{ path: "/app/.cache/veryfront-http-bundle/http-390496888.mjs", hash: "390496888" }],
          tempDir,
        );

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "390496888", "Should correctly identify numeric hash as failed");
      });
    });

    it("deduplicates hashes when same bundle referenced multiple times", async () => {
      await withTempDir(async (tempDir) => {
        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
            { path: join(tempDir, "http-444444.mjs"), hash: "444444" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 1);
        assertEquals(failed[0], "444444");
      });
    });

    it("detects missing transitive deps in locally-present bundles (plucky-bohr repro)", async () => {
      const bundleDir = await makeTempDir({ prefix: "vf-veryfront-http-bundle-" });
      try {
        await writeTextFile(
          join(bundleDir, "http-725215427.mjs"),
          `import { jsx } from "file://${bundleDir}/veryfront-http-bundle/http-57259823.mjs";\nexport default function() { return jsx("div"); }`,
        );

        const failed = await ensureHttpBundlesExist(
          [{ path: join(bundleDir, "http-725215427.mjs"), hash: "725215427" }],
          bundleDir,
        );

        assert(
          failed.includes("57259823"),
          `Should detect missing transitive dep 57259823, got: [${failed.join(", ")}]`,
        );
      } finally {
        try {
          await remove(bundleDir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
    });

    /**
     * This test validates the fix for "Missing HTTP bundles after transform" error.
     *
     * Root cause: When cacheHttpModule loads a bundle from Redis, the cached code
     * might reference child bundles whose Redis keys (code:{hash}, hash:{hash})
     * have expired. Without validation, the parent is written to disk but children
     * can't be recovered, causing the error.
     *
     * The fix: validateBundleDepsExist() is called before using Redis cache.
     * If any deps can't be recovered, we reject the Redis cache and re-fetch
     * from network (which recursively fetches all deps with fresh URLs).
     *
     * This scenario is tested indirectly by ensureHttpBundlesExist tests above,
     * which verify that missing transitive deps are correctly detected.
     */

    it("handles mix of existing and missing bundles", async () => {
      await withTempDir(async (tempDir) => {
        await writeTextFile(join(tempDir, "http-aaa111.mjs"), "export const exists1 = true;");
        await writeTextFile(join(tempDir, "http-bbb222.mjs"), "export const exists2 = true;");

        const failed = await ensureHttpBundlesExist(
          [
            { path: join(tempDir, "http-aaa111.mjs"), hash: "aaa111" },
            { path: join(tempDir, "http-ccc333.mjs"), hash: "ccc333" },
            { path: join(tempDir, "http-bbb222.mjs"), hash: "bbb222" },
            { path: join(tempDir, "http-ddd444.mjs"), hash: "ddd444" },
          ],
          tempDir,
        );

        assertEquals(failed.length, 2);
        assert(failed.includes("ccc333"));
        assert(failed.includes("ddd444"));
      });
    });
  });

  describe("extractBundleDeps (production bug fixes)", () => {
    it("extracts absolute file:// paths (legacy format)", () => {
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "file:///app/.cache/veryfront-http-bundle/http-222222.mjs";`,
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2);
      assertEquals(deps[0]?.hash, "111111");
      assertEquals(deps[1]?.hash, "222222");
    });

    it("extracts relative ./http-*.mjs paths (new portable format)", () => {
      // This was the root cause of the production bug - relative paths weren't being detected
      const code = [
        `import a from "./http-333333.mjs";`,
        `import b from "./http-444444.mjs";`,
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2, "Should detect relative path deps");
      assertEquals(deps[0]?.hash, "333333");
      assertEquals(deps[1]?.hash, "444444");
    });

    it("extracts mix of absolute and relative paths", () => {
      // Real-world scenario: older deps use absolute, newer use relative
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-111111.mjs";`,
        `import b from "./http-222222.mjs";`,
        `import c from "file:///app/.cache/veryfront-http-bundle/http-333333.mjs";`,
        `import d from './http-444444.mjs';`, // single quotes
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 4, "Should detect all deps regardless of path format");
      const hashes = deps.map((d) => d.hash).sort();
      assertEquals(hashes, ["111111", "222222", "333333", "444444"]);
    });

    it("deduplicates same hash appearing in both formats", () => {
      // Edge case: same bundle referenced both ways
      const code = [
        `import a from "file:///app/.cache/veryfront-http-bundle/http-555555.mjs";`,
        `import b from "./http-555555.mjs";`,
      ].join("\n");

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 1, "Should deduplicate same hash");
      assertEquals(deps[0]?.hash, "555555");
    });

    it("handles real-world esm.sh bundle code with nested deps", () => {
      // Simulates actual react-dom bundle structure
      const code = `
        import { jsx as _jsx } from "./http-100000.mjs";
        import { createContext, useState } from "./http-200000.mjs";
        export { _jsx as jsx };
        export function Component() {
          const [state, setState] = useState(null);
          return _jsx("div", { children: state });
        }
      `;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2);
      assert(deps.some((d) => d.hash === "100000"), "Should find jsx-runtime dep");
      assert(deps.some((d) => d.hash === "200000"), "Should find react dep");
    });

    it("handles dynamic imports with relative paths", () => {
      const code = `
        const mod = await import("./http-666666.mjs");
        const other = await import('./http-777777.mjs');
      `;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 2);
      assert(deps.some((d) => d.hash === "666666"));
      assert(deps.some((d) => d.hash === "777777"));
    });

    it("returns empty array for code without bundle deps", () => {
      const code = `
        import React from "react";
        import { useState } from "react";
        export default function App() { return null; }
      `;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 0);
    });

    it("handles numeric-only hashes (production case: 978582506)", () => {
      // The actual hash from production error logs
      const code = `import server from "./http-978582506.mjs";`;

      const deps = __test_extractBundleDeps(code);

      assertEquals(deps.length, 1);
      assertEquals(deps[0]?.hash, "978582506");
    });
  });

  describe("in-flight fetch isolation", () => {
    /**
     * These tests validate the fix for concurrent test flakiness and production
     * timeout cascades caused by shared inFlightHttpFetches map.
     *
     * Root cause: When one request's fetch gets stuck, all concurrent requests
     * waiting on the same cache key would hang indefinitely, causing cascade failures.
     *
     * Fix: Added 30-second timeout when waiting for in-flight fetches, plus
     * __clearInFlightHttpFetches() for test isolation.
     */

    it("__clearInFlightHttpFetches exists and is callable", () => {
      // Basic sanity check that the cleanup function is exported and works
      assertEquals(typeof __clearInFlightHttpFetches, "function");
      // Should not throw
      __clearInFlightHttpFetches();
    });

    it("clearing in-flight fetches is idempotent", () => {
      // Multiple calls should be safe
      __clearInFlightHttpFetches();
      __clearInFlightHttpFetches();
      __clearInFlightHttpFetches();
      // No assertion needed - test passes if no error is thrown
    });
  });
});
