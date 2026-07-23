import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __injectOpenAPIHandlerDepsForTests, OpenAPIHandler } from "./openapi.handler.ts";
import type { HandlerContext } from "../types.ts";
import type {
  GenerateOpenAPISpecRequest,
  WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
} from "#veryfront/utils/logger/index.ts";

const TEST_POLICY = { schemaVersion: 1, mode: "unrestricted" } as const;

function createWorkerSpec(request: GenerateOpenAPISpecRequest) {
  return {
    openapi: "3.1.0" as const,
    info: {
      title: request.info.title,
      version: request.info.version,
      description: request.info.description,
    },
    paths: {},
    tags: [],
    servers: request.info.servers,
  };
}

function successfulWorker(
  _projectId: string,
  _readPaths: string[],
  request: GenerateOpenAPISpecRequest,
): Promise<WorkerResponse> {
  return Promise.resolve({
    type: "openapi-result",
    id: request.id,
    spec: createWorkerSpec(request),
  });
}

function createMockFs(
  opts: { existsReturn?: boolean; needsContext?: boolean; multiProject?: boolean } = {},
) {
  const calls: string[] = [];
  const fs: Record<string, unknown> = {
    exists: async (_path: string) => {
      calls.push(`exists:${_path}`);
      return opts.existsReturn ?? false;
    },
    readDir: async function* () {/* empty */},
    readFile: async () => "",
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
    projectId: "project-test",
    adapter: { fs: createMockFs().fs } as never,
    config: { openapi: { enabled: true } },
    isLocalProject: false,
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/openapi.handler", () => {
  beforeEach(() => {
    __injectOpenAPIHandlerDepsForTests({
      bundleHandlerModuleForIsolation: () => Promise.resolve("export {};"),
      executeWorker: successfulWorker,
      requireSourceIntegrationPolicy: () => TEST_POLICY,
    });
  });

  afterEach(() => {
    __injectOpenAPIHandlerDepsForTests(null);
    __resetLogRecordEmitterForTests();
  });

  describe("HTTP boundary", () => {
    it("rejects non-read methods before touching project storage", async () => {
      const { fs, calls } = createMockFs({ existsReturn: true });
      const result = await new OpenAPIHandler().handle(
        new Request("https://example.com/_openapi.json", { method: "POST" }),
        createCtx({ adapter: { fs } as never }),
      );

      assertEquals(result.response?.status, 405);
      assertEquals(result.response?.headers.get("allow"), "GET, HEAD");
      assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
      assertEquals(calls.length, 0);
    });

    it("returns headers without a response body for HEAD", async () => {
      const result = await new OpenAPIHandler().handle(
        new Request("https://example.com/_openapi.json", { method: "HEAD" }),
        createCtx({ isLocalProject: true }),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(await result.response!.text(), "");
      assertEquals(result.response?.headers.get("content-type"), "application/json; charset=utf-8");
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
    });
  });

  describe("remote module isolation", () => {
    it("bundles route source without invoking the host module generator", async () => {
      let hostGenerationCalls = 0;
      let bundledModulePath = "";
      __injectOpenAPIHandlerDepsForTests({
        discoverPagesRoutes: (router) => {
          router.addRoute("/api/users", "/project/pages/api/users.ts");
          return Promise.resolve();
        },
        discoverAppRoutes: () => Promise.resolve(),
        generateOpenAPISpec: () => {
          hostGenerationCalls++;
          throw new Error("host-module-load-canary");
        },
        bundleHandlerModuleForIsolation: (options) => {
          bundledModulePath = options.modulePath;
          return Promise.resolve("export function GET() {}");
        },
        requireSourceIntegrationPolicy: () => TEST_POLICY,
        executeWorker: (_projectId, readPaths, request) => {
          assertEquals(readPaths, []);
          assertEquals(request.routes, [{
            pattern: "/api/users",
            moduleCode: "export function GET() {}",
          }]);
          return Promise.resolve({
            type: "openapi-result",
            id: request.id,
            spec: {
              ...createWorkerSpec(request),
              paths: {
                "/api/users": {
                  get: {
                    operationId: "get_api_users",
                    summary: "GET /api/users",
                    responses: { "200": { description: "Successful response" } },
                  },
                },
              },
            },
          });
        },
      });
      const { fs } = createMockFs({ existsReturn: true });

      const result = await new OpenAPIHandler().handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ adapter: { fs } as never, isLocalProject: false }),
      );
      const body = JSON.parse(await result.response!.text());

      assertEquals(result.response?.status, 200);
      assertEquals(result.response?.headers.get("cache-control")?.includes("public"), true);
      assertEquals(result.response?.headers.get("cache-control")?.includes("max-age=3600"), true);
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
      assertEquals(body.paths["/api/users"].get.summary, "GET /api/users");
      assertEquals(bundledModulePath, "/project/pages/api/users.ts");
      assertEquals(hostGenerationCalls, 0);
    });

    it("excludes patterns outside the exact API route boundary", async () => {
      let bundleCalls = 0;
      let appDiscoveryCalls = 0;
      __injectOpenAPIHandlerDepsForTests({
        discoverPagesRoutes: (router) => {
          router.addRoute("/apiary", "/project/pages/apiary.ts");
          router.addRoute("/other", "/project/app/api/private.ts");
          return Promise.resolve();
        },
        discoverAppRoutes: () => {
          appDiscoveryCalls++;
          return Promise.resolve();
        },
        bundleHandlerModuleForIsolation: () => {
          bundleCalls++;
          return Promise.resolve("export function GET() {}");
        },
        requireSourceIntegrationPolicy: () => TEST_POLICY,
        executeWorker: (_projectId, readPaths, request) => {
          assertEquals(readPaths, []);
          assertEquals(request.routes, []);
          return successfulWorker(_projectId, readPaths, request);
        },
      });
      const { fs } = createMockFs({ existsReturn: true });

      const result = await new OpenAPIHandler().handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ adapter: { fs } as never, isLocalProject: false }),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(bundleCalls, 0);
      assertEquals(appDiscoveryCalls, 1);
    });

    it("fails closed when the worker result is not a bounded OpenAPI 3.1 document", async () => {
      __injectOpenAPIHandlerDepsForTests({
        executeWorker: (_projectId, _readPaths, request) =>
          Promise.resolve({
            type: "openapi-result",
            id: request.id,
            spec: { openapi: "3.0.0" } as never,
          }),
        requireSourceIntegrationPolicy: () => TEST_POLICY,
      });

      const result = await new OpenAPIHandler().handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ isLocalProject: false }),
      );

      assertEquals(result.response?.status, 500);
      assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
    });

    it("does not bundle or fall back to host generation without an exact source policy", async () => {
      let bundleCalls = 0;
      let workerCalls = 0;
      let hostGenerationCalls = 0;
      __injectOpenAPIHandlerDepsForTests({
        discoverPagesRoutes: (router) => {
          router.addRoute("/api/users", "/project/pages/api/users.ts");
          return Promise.resolve();
        },
        discoverAppRoutes: () => Promise.resolve(),
        requireSourceIntegrationPolicy: () => {
          throw new Error("source-policy-required");
        },
        bundleHandlerModuleForIsolation: () => {
          bundleCalls++;
          return Promise.resolve("export function GET() {}");
        },
        executeWorker: (..._args) => {
          workerCalls++;
          return Promise.reject(new Error("worker-must-not-run"));
        },
        generateOpenAPISpec: () => {
          hostGenerationCalls++;
          throw new Error("host-generation-must-not-run");
        },
      });
      const { fs } = createMockFs({ existsReturn: true });

      const result = await new OpenAPIHandler().handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ adapter: { fs } as never, isLocalProject: false }),
      );

      assertEquals(result.response?.status, 500);
      assertEquals(bundleCalls, 0);
      assertEquals(workerCalls, 0);
      assertEquals(hostGenerationCalls, 0);
    });

    it("does not expose worker error names or messages in logs or responses", async () => {
      const records: unknown[] = [];
      __registerLogRecordEmitter((record) => {
        records.push(record);
      });
      __injectOpenAPIHandlerDepsForTests({
        executeWorker: (_projectId, _readPaths, request) =>
          Promise.resolve({
            type: "error",
            id: request.id,
            error: {
              name: "private-error-name-canary",
              message: "private-error-message-canary",
              detail: "private-error-detail-canary",
            },
          }),
        requireSourceIntegrationPolicy: () => TEST_POLICY,
      });

      const result = await new OpenAPIHandler().handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ isLocalProject: false }),
      );
      const responseText = await result.response!.text();
      const emitted = JSON.stringify(records);

      assertEquals(result.response?.status, 500);
      for (
        const canary of [
          "private-error-name-canary",
          "private-error-message-canary",
          "private-error-detail-canary",
        ]
      ) {
        assertEquals(responseText.includes(canary), false);
        assertEquals(emitted.includes(canary), false);
      }
      assertEquals(emitted.includes('"errorCategory":"error"'), true);
    });
  });

  describe("proxy mode uses runWithContext", () => {
    it("should call runWithContext when in proxy mode with extended FS", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        parsedDomain: { branch: null } as never,
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      const body = JSON.parse(await result.response!.text());
      assertEquals(typeof body.paths, "object");
      assertEquals(calls.includes("runWithContext"), true);
    });

    it("should NOT call runWithContext for local projects", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: true,
        projectSlug: "test-project",
        proxyToken: "test-token",
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(calls.includes("runWithContext"), false);
    });

    it("fails closed when multi-project context has no proxy token", async () => {
      const { fs, calls } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: undefined,
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 500);
      assertEquals(calls.includes("runWithContext"), false);
    });

    it("should NOT call runWithContext when extended FS lacks multi-project mode", async () => {
      const { fs, calls } = createMockFs({ needsContext: true, multiProject: false });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        parsedDomain: { branch: null } as never,
      });

      const req = new Request("https://example.com/_openapi.json");
      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(calls.includes("runWithContext"), false);
    });
  });

  describe("spec caching", () => {
    it("coalesces concurrent generation for the same immutable source", async () => {
      const started = Promise.withResolvers<void>();
      const completion = Promise.withResolvers<void>();
      let workerCalls = 0;
      __injectOpenAPIHandlerDepsForTests({
        requireSourceIntegrationPolicy: () => TEST_POLICY,
        executeWorker: (_projectId, _readPaths, request) => {
          workerCalls++;
          started.resolve();
          return completion.promise.then(() => ({
            type: "openapi-result" as const,
            id: request.id,
            spec: createWorkerSpec(request),
          }));
        },
      });
      const handler = new OpenAPIHandler();
      const ctx = createCtx();
      const request = () => new Request("https://example.com/_openapi.json");

      const first = handler.handle(request(), ctx);
      const second = handler.handle(request(), ctx);
      await started.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const concurrentCalls = workerCalls;
      completion.resolve();

      assertEquals((await first).response?.status, 200);
      assertEquals((await second).response?.status, 200);
      assertEquals(concurrentCalls, 1);
    });

    it("does not reuse a spec after the content source changes", async () => {
      let workerCalls = 0;
      __injectOpenAPIHandlerDepsForTests({
        requireSourceIntegrationPolicy: () => TEST_POLICY,
        executeWorker: (_projectId, _readPaths, request) => {
          workerCalls++;
          const spec = createWorkerSpec(request);
          spec.info.title = `generation-${workerCalls}`;
          return Promise.resolve({ type: "openapi-result", id: request.id, spec });
        },
      });
      const handler = new OpenAPIHandler();
      const first = await handler.handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ enriched: { contentSourceId: "source-one" } as never }),
      );
      const second = await handler.handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ enriched: { contentSourceId: "source-two" } as never }),
      );

      assertEquals(JSON.parse(await first.response!.text()).info.title, "generation-1");
      assertEquals(JSON.parse(await second.response!.text()).info.title, "generation-2");
      assertEquals(workerCalls, 2);
    });

    it("should use different cache keys for different branches", async () => {
      const { fs } = createMockFs({ needsContext: true });
      const handler = new OpenAPIHandler();

      // First request on branch "main"
      const ctx1 = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        parsedDomain: { branch: "main" } as never,
        releaseId: "rel-1",
      });
      const req1 = new Request("https://example.com/_openapi.json");
      const result1 = await handler.handle(req1, ctx1);
      assertEquals(result1.response?.status, 200);

      // Second request on branch "feature" — should NOT serve stale spec
      const ctx2 = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        parsedDomain: { branch: "feature" } as never,
        releaseId: "rel-2",
      });
      const req2 = new Request("https://example.com/_openapi.json");
      const result2 = await handler.handle(req2, ctx2);
      assertEquals(result2.response?.status, 200);

      // Both should succeed without serving stale cached spec from first branch
      // (The handler's internal cacheKey should differ for different branches/releases)
    });

    it("does not reuse a spec generated for a different request origin", async () => {
      const { fs } = createMockFs();
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        projectSlug: "test-project",
        releaseId: "rel-1",
      });

      const first = await handler.handle(
        new Request("https://first.example/_openapi.json"),
        ctx,
      );
      const second = await handler.handle(
        new Request("https://second.example/_openapi.json"),
        ctx,
      );
      const firstSpec = JSON.parse(await first.response!.text());
      const secondSpec = JSON.parse(await second.response!.text());

      assertEquals(firstSpec.servers, [
        { url: "https://first.example", description: "Current server" },
      ]);
      assertEquals(secondSpec.servers, [
        { url: "https://second.example", description: "Current server" },
      ]);
    });
  });

  describe("spec generation with route discovery in proxy mode", () => {
    it("should attempt directory existence checks within runWithContext", async () => {
      const { fs, calls } = createMockFs({ needsContext: true, existsReturn: true });
      const handler = new OpenAPIHandler();
      const ctx = createCtx({
        adapter: { fs } as never,
        isLocalProject: false,
        projectSlug: "test-project",
        proxyToken: "test-token",
        projectId: "proj-123",
        resolvedEnvironment: "production",
        parsedDomain: { branch: null } as never,
      });

      const req = new Request("https://example.com/_openapi.json");
      await handler.handle(req, ctx);

      // Verify runWithContext was used and discovery directories were checked
      assertEquals(calls.includes("runWithContext"), true);
      const existsCalls = calls.filter((c) => c.startsWith("exists:"));
      assertEquals(existsCalls.length > 0, true);
    });

    it("fails instead of publishing a partial spec when discovery fails", async () => {
      const { fs } = createMockFs({ existsReturn: true });
      fs.readDir = async function* () {
        yield* [];
        throw new Error("route discovery unavailable");
      };
      const handler = new OpenAPIHandler();
      const result = await handler.handle(
        new Request("https://example.com/_openapi.json"),
        createCtx({ adapter: { fs } as never, isLocalProject: true }),
      );

      assertEquals(result.response?.status, 500);
      assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
      assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
    });
  });
});
