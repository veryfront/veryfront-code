import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProdHydrationModuleHandler } from "./prod-hydration-module.handler.ts";
import { StaticHandler } from "./static.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { RouteRegistry } from "#veryfront/routing/registry/index.ts";
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
    ...overrides,
  };
}

function staleVersionedPath(): string {
  const currentPath = getProdHydrationModulePath();
  const currentHash = currentPath.match(/hydration-runtime\.([0-9a-f]{8})\.js$/)?.[1];
  assertExists(currentHash);
  const staleHash = currentHash === "00000000" ? "11111111" : "00000000";
  return `/_veryfront/hydration-runtime.${staleHash}.js`;
}

function makeStaticHandler(content: string | null): StaticHandler {
  const handler = new StaticHandler();
  (handler as any).staticService = {
    resolveFile: (pathname: string) =>
      Promise.resolve(
        content === null ? null : {
          path: `/tmp/test-project/dist${pathname}`,
          data: new TextEncoder().encode(content),
          etag: '"release-runtime"',
          contentType: "application/javascript; charset=utf-8",
          cacheStrategy: "immutable",
          source: "dist",
        },
      ),
    isAssetRequest: () => true,
  };
  return handler;
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
    assertStringIncludes(body, "/_vf_modules");
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

  it("lets a non-current versioned path fall through to release static assets", async () => {
    const handler = new ProdHydrationModuleHandler();
    const result = await handler.handle(
      new Request(`http://localhost${staleVersionedPath()}`),
      makeCtx(),
    );

    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("serves a release-baked versioned runtime through the handler chain", async () => {
    const releasePath = staleVersionedPath();
    const registry = new RouteRegistry()
      .register(new ProdHydrationModuleHandler())
      .register(makeStaticHandler("export const releaseRuntime = true;"));
    const response = await registry.execute(
      new Request(`http://localhost${releasePath}`),
      makeCtx(),
    );

    assertExists(response);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), IMMUTABLE_CACHE_CONTROL);
    assertEquals(await response.text(), "export const releaseRuntime = true;");
  });

  it("returns a non-cacheable 404 after a versioned release asset misses", async () => {
    const registry = new RouteRegistry()
      .register(new ProdHydrationModuleHandler())
      .register(makeStaticHandler(null));
    const response = await registry.execute(
      new Request(`http://localhost${staleVersionedPath()}`),
      makeCtx(),
    );

    assertExists(response);
    assertEquals(response.status, 404);
    assertEquals(response.headers.get("cache-control"), NO_CACHE_CONTROL);
    assertEquals(await response.text(), "Not Found");
  });

  it("does not answer 304 for a release runtime when the current ETag matches", async () => {
    const currentHandler = new ProdHydrationModuleHandler();
    const current = await currentHandler.handle(
      new Request(`http://localhost${getProdHydrationModulePath()}`),
      makeCtx(),
    );
    const etag = current.response?.headers.get("etag");
    assertExists(etag);

    const registry = new RouteRegistry()
      .register(currentHandler)
      .register(makeStaticHandler("export const releaseRuntime = true;"));
    const response = await registry.execute(
      new Request(`http://localhost${staleVersionedPath()}`, {
        headers: { "if-none-match": etag },
      }),
      makeCtx(),
    );

    assertExists(response);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "export const releaseRuntime = true;");
  });

  it("serves a release-baked runtime on HEAD requests without a body", async () => {
    const registry = new RouteRegistry()
      .register(new ProdHydrationModuleHandler())
      .register(makeStaticHandler("export const releaseRuntime = true;"));
    const response = await registry.execute(
      new Request(`http://localhost${staleVersionedPath()}`, { method: "HEAD" }),
      makeCtx(),
    );

    assertExists(response);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "", "HEAD responses carry no body");
  });
});
