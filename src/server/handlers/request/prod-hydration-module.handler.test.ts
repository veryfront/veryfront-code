import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProdHydrationModuleHandler } from "./prod-hydration-module.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  getProdHydrationModulePath,
  PROD_HYDRATION_MODULE_PATH,
} from "#veryfront/html/hydration-script-builder/prod-scripts.ts";

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const NO_CACHE_CONTROL = "no-cache, no-store, must-revalidate";
const NO_STORE_CACHE_CONTROL = "no-store";

function createMockAdapter(): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

function unknownVersionedRuntimePath(): string {
  const canonicalPath = getProdHydrationModulePath();
  const replacementHash = canonicalPath.includes(".00000000.js") ? "ffffffff" : "00000000";
  return canonicalPath.replace(/[0-9a-f]{8}(?=\.js$)/, replacementHash);
}

async function requestRuntime(path: string, init?: RequestInit): Promise<Response> {
  const result = await new ProdHydrationModuleHandler().handle(
    new Request(`http://localhost${path}`, init),
    makeCtx(),
  );

  assertEquals(result.continue, false);
  assertExists(result.response);
  return result.response;
}

describe("server/handlers/request/prod-hydration-module.handler", () => {
  it("serves only the canonical versioned runtime with immutable caching", async () => {
    const response = await requestRuntime(getProdHydrationModulePath());

    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assertEquals(response.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
    assertEquals(response.headers.get("pragma"), null);
    assertEquals(response.headers.get("expires"), null);
    assertEquals(response.headers.get("location"), null);
    assertExists(response.headers.get("etag"));

    const body = await response.text();
    assertStringIncludes(body, "MODULE_SERVER_URL");
    assertStringIncludes(body, "renderPage");
  });

  it("redirects unknown versioned hashes without caching current bytes under the wrong key", async () => {
    const canonicalPath = getProdHydrationModulePath();
    const canonicalResponse = await requestRuntime(canonicalPath);
    const canonicalEtag = canonicalResponse.headers.get("etag");
    assertExists(canonicalEtag);

    for (
      const [label, method, headers] of [
        ["GET", "GET", undefined],
        ["conditional GET", "GET", { "if-none-match": canonicalEtag }],
        ["conditional HEAD", "HEAD", { "if-none-match": canonicalEtag }],
      ] as const
    ) {
      const response = await requestRuntime(unknownVersionedRuntimePath(), {
        method,
        headers,
      });

      assertEquals(response.status, 307, label);
      assertEquals(response.headers.get("location"), canonicalPath, label);
      assertEquals(response.headers.get("cache-control"), NO_STORE_CACHE_CONTROL, label);
      assertEquals(response.headers.get("pragma"), "no-cache", label);
      assertEquals(response.headers.get("expires"), "0", label);
      assertEquals(response.headers.get("etag"), null, label);
      assertEquals(response.headers.get("content-type"), null, label);
      assertEquals(await response.text(), "", label);
    }
  });

  it("redirects legacy 8-hex runtime identities to the SHA-256 path", async () => {
    const response = await requestRuntime(
      "/_veryfront/hydration-runtime.00000000.js",
    );

    assertEquals(response.status, 307);
    assertEquals(response.headers.get("location"), getProdHydrationModulePath());
    assertEquals(response.headers.get("cache-control"), NO_STORE_CACHE_CONTROL);
    assertEquals(response.headers.get("etag"), null);
  });

  it("keeps the unversioned compatibility path revalidated with the canonical bytes", async () => {
    const canonicalResponse = await requestRuntime(getProdHydrationModulePath());
    const canonicalEtag = canonicalResponse.headers.get("etag");
    const canonicalBody = await canonicalResponse.text();
    assertExists(canonicalEtag);

    const response = await requestRuntime(PROD_HYDRATION_MODULE_PATH);

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), NO_CACHE_CONTROL);
    assertEquals(response.headers.get("pragma"), "no-cache");
    assertEquals(response.headers.get("expires"), "0");
    assertEquals(response.headers.get("etag"), canonicalEtag);
    assertEquals(await response.text(), canonicalBody);
  });

  it("aligns HEAD metadata with GET for canonical and unversioned paths", async () => {
    for (
      const [path, cacheControl] of [
        [getProdHydrationModulePath(), IMMUTABLE_CACHE_CONTROL],
        [PROD_HYDRATION_MODULE_PATH, NO_CACHE_CONTROL],
      ] as const
    ) {
      const getResponse = await requestRuntime(path);
      const headResponse = await requestRuntime(path, { method: "HEAD" });

      assertEquals(headResponse.status, getResponse.status, path);
      assertEquals(headResponse.headers.get("etag"), getResponse.headers.get("etag"), path);
      assertEquals(
        headResponse.headers.get("content-type"),
        getResponse.headers.get("content-type"),
        path,
      );
      assertEquals(headResponse.headers.get("cache-control"), cacheControl, path);
      assertEquals(await headResponse.text(), "", path);
    }
  });

  it("returns path-appropriate cache headers for matching GET and HEAD ETags", async () => {
    for (
      const [path, cacheControl, pragma, expires] of [
        [getProdHydrationModulePath(), IMMUTABLE_CACHE_CONTROL, null, null],
        [PROD_HYDRATION_MODULE_PATH, NO_CACHE_CONTROL, "no-cache", "0"],
      ] as const
    ) {
      const initialResponse = await requestRuntime(path);
      const etag = initialResponse.headers.get("etag");
      assertExists(etag);

      for (const method of ["GET", "HEAD"]) {
        const response = await requestRuntime(path, {
          method,
          headers: { "if-none-match": etag },
        });

        assertEquals(response.status, 304, `${method} ${path}`);
        assertEquals(response.headers.get("etag"), etag, `${method} ${path}`);
        assertEquals(response.headers.get("cache-control"), cacheControl, `${method} ${path}`);
        assertEquals(response.headers.get("pragma"), pragma, `${method} ${path}`);
        assertEquals(response.headers.get("expires"), expires, `${method} ${path}`);
        assertEquals(await response.text(), "", `${method} ${path}`);
      }
    }
  });
});
