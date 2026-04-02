import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProdHydrationModuleHandler } from "./prod-hydration-module.handler.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { PROD_HYDRATION_MODULE_PATH } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";

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
  it("serves the production hydration runtime module", async () => {
    const handler = new ProdHydrationModuleHandler();
    const result = await handler.handle(new Request(`http://localhost${PROD_HYDRATION_MODULE_PATH}`), makeCtx());

    assertEquals(result.continue, false);
    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(result.response.headers.get("content-type"), "application/javascript; charset=utf-8");

    const body = await result.response.text();
    assertStringIncludes(body, "MODULE_SERVER_URL");
    assertStringIncludes(body, "renderPage");
  });

  it("returns not modified when ETag matches", async () => {
    const handler = new ProdHydrationModuleHandler();
    const first = await handler.handle(new Request(`http://localhost${PROD_HYDRATION_MODULE_PATH}`), makeCtx());
    const etag = first.response?.headers.get("etag");
    assertExists(etag);

    const second = await handler.handle(
      new Request(`http://localhost${PROD_HYDRATION_MODULE_PATH}`, {
        headers: { "if-none-match": etag },
      }),
      makeCtx(),
    );

    assertEquals(second.response?.status, 304);
  });
});
