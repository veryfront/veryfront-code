import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { OpenAPIHandler } from "./openapi.handler.ts";
import type { HandlerContext } from "../types.ts";

function createMockFs(
  opts: { existsReturn?: boolean; needsContext?: boolean; multiProject?: boolean } = {},
) {
  const calls: string[] = [];
  const fs: Record<string, unknown> = {
    exists: async (_path: string) => {
      calls.push(`exists:${_path}`);
      return opts.existsReturn ?? false;
    },
    readDir: async function* (path: string) {
      calls.push(`readDir:${path}`);
      yield* [];
    },
    readFile: async (path: string) => {
      calls.push(`readFile:${path}`);
      return "";
    },
    stat: async () => ({
      size: 0,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      mtime: null,
    }),
  };

  if (opts.needsContext) {
    // Simulate extended FS adapter that requires context
    fs.isVeryfrontAdapter = () => true;
    fs.getUnderlyingAdapter = () => ({});
    fs.isMultiProjectMode = () => opts.multiProject !== false;
    fs.isContextualMode = () => true;
    fs.getAdapterType = () => "VeryfrontFSAdapter";
    fs.runWithContext = async (
      _slug: string,
      _token: string,
      fn: () => Promise<unknown>,
      _projectId?: string,
      _options?: Record<string, unknown>,
    ) => {
      calls.push("runWithContext");
      return await fn();
    };
  }

  return { fs, calls };
}

function createCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: { fs: createMockFs().fs } as never,
    config: { openapi: { enabled: true } },
    isLocalProject: false,
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/openapi.handler", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("returns 503 before entering proxy context or reading remote route modules", async () => {
    const { fs, calls } = createMockFs({ needsContext: true, existsReturn: true });
    const handler = new OpenAPIHandler();
    const jsonPath = "/metadata/openapi.json";
    const yamlPath = "/metadata/openapi.yaml";
    const ctx = createCtx({
      adapter: { fs } as never,
      isLocalProject: false,
      projectSlug: "test-project",
      proxyToken: "test-token",
      projectId: "proj-123",
      resolvedEnvironment: "production",
      config: {
        openapi: {
          enabled: true,
          paths: { json: jsonPath, yaml: yamlPath },
        },
      },
    });

    for (const path of [jsonPath, yamlPath]) {
      const result = await handler.handle(
        new Request(`https://example.com${path}`),
        ctx,
      );

      assertEquals(result.response?.status, 503);
      assertEquals(await result.response?.text(), "OpenAPI specification unavailable");
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
    }
    assertEquals(calls, []);
  });

  it("preserves explicitly local OpenAPI generation", async () => {
    const { fs, calls } = createMockFs({ needsContext: true });
    const handler = new OpenAPIHandler();
    const ctx = createCtx({
      adapter: { fs } as never,
      isLocalProject: true,
      projectSlug: "test-project",
      proxyToken: "test-token",
    });

    const result = await handler.handle(
      new Request("https://example.com/_openapi.json"),
      ctx,
    );

    assertEquals(result.response?.status, 200);
    const body = JSON.parse(await result.response!.text());
    assertEquals(typeof body.paths, "object");
    assertEquals(calls.includes("runWithContext"), false);
    assertEquals(calls.filter((call) => call.startsWith("exists:")), [
      "exists:/project/pages/api",
      "exists:/project/app",
    ]);
  });

  it("allows approved standalone source without enabling local-development policy", async () => {
    const { fs, calls } = createMockFs();
    const handler = new OpenAPIHandler();
    const ctx = createCtx({
      adapter: { fs } as never,
      isLocalProject: false,
      allowHostProjectCodeExecution: true,
    });

    const result = await handler.handle(
      new Request("https://example.com/_openapi.json"),
      ctx,
    );

    assertEquals(result.response?.status, 200);
    assertEquals(
      result.response?.headers.get("cache-control"),
      "no-cache, no-store, must-revalidate",
    );
    assertEquals(calls.filter((call) => call.startsWith("exists:")), [
      "exists:/project/pages/api",
      "exists:/project/app",
    ]);
  });

  it("discovers Pages and App API routes without traversing app/api twice", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set(
      "/project/pages/api/legacy.ts",
      "export function POST() {}",
    );
    adapter.fs.files.set(
      "/project/app/api/users/route.ts",
      "export function GET() {}",
    );
    const readDirCalls: string[] = [];
    const readDir = adapter.fs.readDir.bind(adapter.fs);
    adapter.fs.readDir = async function* (path: string) {
      readDirCalls.push(path);
      yield* readDir(path);
    };
    const handler = new OpenAPIHandler();
    const ctx = createCtx({ adapter, isLocalProject: true });

    const result = await handler.handle(
      new Request("https://example.com/_openapi.json"),
      ctx,
    );
    const body = JSON.parse(await result.response!.text());

    assertEquals(result.response?.status, 200);
    assertEquals(Object.keys(body.paths).sort(), ["/api/legacy", "/api/users"]);
    assertEquals(body.paths["/api/legacy"].post.summary, "POST /api/legacy");
    assertEquals(body.paths["/api/users"].get.summary, "GET /api/users");
    assertEquals(
      readDirCalls.filter((path) => path === "/project/pages/api").length,
      1,
    );
    assertEquals(
      readDirCalls.filter((path) => path === "/project/app/api").length,
      2,
    );
  });

  it("treats omitted locality as remote without touching the filesystem", async () => {
    const { fs, calls } = createMockFs({ existsReturn: true });
    const handler = new OpenAPIHandler();
    const ctx = createCtx({
      adapter: { fs } as never,
      isLocalProject: undefined,
    });

    for (const path of ["/_openapi.json", "/_openapi.yaml"]) {
      const result = await handler.handle(
        new Request(`https://example.com${path}`),
        ctx,
      );

      assertEquals(result.response?.status, 503);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
    }
    assertEquals(calls, []);
  });

  it("fails closed when locality is unreadable", async () => {
    const { fs, calls } = createMockFs({ existsReturn: true });
    const handler = new OpenAPIHandler();
    const ctx = createCtx({ adapter: { fs } as never });
    let accessorCalls = 0;
    Object.defineProperty(ctx, "isLocalProject", {
      enumerable: true,
      get() {
        accessorCalls++;
        throw new Error("locality unavailable");
      },
    });

    const result = await handler.handle(
      new Request("https://example.com/_openapi.json"),
      ctx,
    );

    assertEquals(result.response?.status, 503);
    assertEquals(calls, []);
    assertEquals(accessorCalls, 0);
  });

  it("keeps inherited and throwing locality remote after prototype poisoning", async () => {
    const { fs, calls } = createMockFs({ existsReturn: true });
    const handler = new OpenAPIHandler();
    const makeRemoteCtx = (): HandlerContext => {
      const ctx = createCtx({ adapter: { fs } as never });
      delete (ctx as { isLocalProject?: boolean }).isLocalProject;
      return ctx;
    };
    const inherited = makeRemoteCtx();
    Object.setPrototypeOf(inherited, { isLocalProject: true });
    let throwingDescriptorCalls = 0;
    const throwingProxy = new Proxy(makeRemoteCtx(), {
      getOwnPropertyDescriptor(target, key) {
        if (key === "isLocalProject") {
          throwingDescriptorCalls++;
          throw new Error("locality descriptor unavailable");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "isLocalProject",
    );

    try {
      for (const ctx of [inherited, throwingProxy]) {
        const result = await handler.handle(
          new Request("https://example.com/_openapi.json"),
          ctx,
        );
        assertEquals(result.response?.status, 503);
      }

      Object.defineProperty(Object.prototype, "isLocalProject", {
        configurable: true,
        value: true,
      });
      const poisoned = await handler.handle(
        new Request("https://example.com/_openapi.json"),
        makeRemoteCtx(),
      );
      assertEquals(poisoned.response?.status, 503);
    } finally {
      if (previous) {
        Object.defineProperty(Object.prototype, "isLocalProject", previous);
      } else {
        delete (Object.prototype as { isLocalProject?: boolean }).isLocalProject;
      }
    }

    assertEquals(calls, []);
    assertEquals(throwingDescriptorCalls, 1);
  });

  it("does not turn local discovery adapter failures into a partial 200 spec", async () => {
    const { fs, calls } = createMockFs();
    fs.exists = (path: string) => {
      calls.push(`exists:${path}`);
      return Promise.reject(new Error("permission denied"));
    };
    const handler = new OpenAPIHandler();
    const ctx = createCtx({
      adapter: { fs } as never,
      isLocalProject: true,
    });

    const result = await handler.handle(
      new Request("https://example.com/_openapi.json"),
      ctx,
    );
    const body = JSON.parse(await result.response!.text());

    assertEquals(result.response?.status, 500);
    assertEquals(body.error, "Failed to generate OpenAPI specification");
    assertEquals(String(body.message).includes("permission denied"), true);
    assertEquals(result.response?.headers.get("cache-control"), "no-store");
    assertEquals(calls.length, 1);
  });
});
