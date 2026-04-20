import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "../../types.ts";
import type { SSRRenderOptions, SSRServiceLike } from "../../../services/rendering/ssr.service.ts";

export function createMockAdapter(): RuntimeAdapter {
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

export function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

/** Create a mock SSRService for handler tests. */
export function createMockSSRService(
  overrides: Partial<SSRServiceLike> = {},
): SSRServiceLike {
  return {
    checkMemoryPressure: () => ({
      shouldReject: false,
      heapUsedMB: 50,
      heapLimitMB: 500,
      heapUsedPercent: 10,
    }),
    renderPage: (_ctx: HandlerContext, _options: SSRRenderOptions) =>
      Promise.resolve({
        status: 200,
        html: "<html>mock render</html>",
        isStreaming: false,
        cacheStrategy: "short" as const,
        slug: "test",
      }),
    createMemoryPressureResult: (slug: string) => ({
      status: 503,
      html: "<html>memory pressure</html>",
      isStreaming: false,
      cacheStrategy: "no-cache" as const,
      slug,
    }),
    ...overrides,
  };
}
