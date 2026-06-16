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

describe("server/handlers/request/prod-hydration-module.handler", () => {
  it("serves the versioned production hydration runtime module with immutable caching", async () => {
    const handler = new ProdHydrationModuleHandler();
    const result = await handler.handle(
      new Request(`http://localhost${getProdHydrationModulePath()}`),
      makeCtx(),
    );

    assertEquals(result.continue, false);
    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(
      result.response.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assertEquals(result.response.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
    assertEquals(result.response.headers.get("pragma"), null);
    assertEquals(result.response.headers.get("expires"), null);

    const body = await result.response.text();
    assertStringIncludes(body, "MODULE_SERVER_URL");
    assertStringIncludes(body, "renderPage");
  });

  it("keeps the legacy production hydration runtime path revalidated", async () => {
    const handler = new ProdHydrationModuleHandler();
    const result = await handler.handle(
      new Request(`http://localhost${PROD_HYDRATION_MODULE_PATH}`),
      makeCtx(),
    );

    assertEquals(result.response?.status, 200);
    assertEquals(result.response?.headers.get("cache-control"), NO_CACHE_CONTROL);
    assertEquals(result.response?.headers.get("pragma"), "no-cache");
    assertEquals(result.response?.headers.get("expires"), "0");
  });

  it("returns not modified with immutable caching when the versioned ETag matches", async () => {
    const handler = new ProdHydrationModuleHandler();
    const runtimePath = getProdHydrationModulePath();
    const first = await handler.handle(
      new Request(`http://localhost${runtimePath}`),
      makeCtx(),
    );
    const etag = first.response?.headers.get("etag");
    assertExists(etag);

    const second = await handler.handle(
      new Request(`http://localhost${runtimePath}`, {
        headers: { "if-none-match": etag },
      }),
      makeCtx(),
    );

    assertEquals(second.response?.status, 304);
    assertEquals(second.response?.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
    assertEquals(second.response?.headers.get("pragma"), null);
    assertEquals(second.response?.headers.get("expires"), null);
  });
});
