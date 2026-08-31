import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __serializeRequestForTests,
  executeAppRoute as executeAppRouteRaw,
  executePagesRoute as executePagesRouteRaw,
  executePreparedAppRoute,
  executePreparedPagesRoute,
  type ExecuteRouteOptions,
  type PreparedRouteExecutionOptions,
  resolvePreparedRouteMethods,
} from "./route-executor.ts";
import type { APIContext } from "./context-builder.ts";
import type { AppRouteContext } from "./module-loader/types.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";

function makeAdapter(mode = "development"): RuntimeAdapter {
  const envMap = new Map<string, string>([["MODE", mode]]);

  return {
    id: "node",
    name: "test-stub",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: false,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: false,
    },
    env: {
      get: (key: string) => envMap.get(key),
      set: (key: string, value: string) => envMap.set(key, value),
      toObject: () => Object.fromEntries(envMap),
    },
    fs: {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      readDir: async function* () {},
      exists: () => Promise.resolve(false),
      stat: () =>
        Promise.resolve({
          isFile: false,
          isDirectory: false,
          isSymlink: false,
          size: 0,
          mtime: null,
        }),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      makeTempDir: () => Promise.resolve("/tmp/mock"),
      watch: () => ({
        close: () => {},
        [Symbol.asyncIterator]: async function* () {},
      }),
    },
    server: {
      upgradeWebSocket: () => {
        throw new Error("not implemented");
      },
    },
    serve: () => {
      throw new Error("not implemented");
    },
  };
}

function makeMatch(
  pattern = "/api/test",
  page = "/api/test.ts",
  params: RouteMatch["params"] = {},
): RouteMatch {
  return { route: { pattern, page }, params };
}

const LOCAL_EXECUTION: ExecuteRouteOptions = Object.freeze({
  isLocalProject: true,
  allowHostProjectCodeExecution: true,
});

function createIdentity(): ApplicationIdentity {
  return Object.freeze({
    issuer: "veryfront:trusted-proxy",
    subject: "user-123",
    email: "user@example.test",
    groups: Object.freeze(["admin"]),
    roles: Object.freeze([]),
    groupsComplete: true,
    claims: Object.freeze({ sub: "user-123" }),
  });
}

function executeAppRoute(
  handler: Parameters<typeof executeAppRouteRaw>[0],
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  return executeAppRouteRaw(
    handler,
    request,
    match,
    pathname,
    adapter,
    options ?? LOCAL_EXECUTION,
  );
}

function executePagesRoute(
  handler: Parameters<typeof executePagesRouteRaw>[0],
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  return executePagesRouteRaw(
    handler,
    request,
    match,
    pathname,
    adapter,
    projectDir,
    options ?? LOCAL_EXECUTION,
  );
}

async function prepareModuleSource(source: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return { source, sha256: new Uint8Array(digest).toHex() };
}

async function isolatedRouteOptions(
  source: string,
  executionScopeId: string,
): Promise<ExecuteRouteOptions> {
  return {
    modulePath: "/test/project/handler.ts",
    projectDir: "/test/project",
    isLocalProject: false,
    preparedModule: await prepareModuleSource(source),
    executionScopeId,
  };
}

async function preparedRouteOptions(
  source: string,
  executionScopeId: string,
): Promise<PreparedRouteExecutionOptions> {
  return {
    executionScopeId,
    module: await prepareModuleSource(source),
    modulePath: "/test/project/handler.ts",
    projectDir: "/test/project",
    isLocalProject: false,
  };
}

describe("routing/api/route-executor", () => {
  describe("application request boundary", () => {
    it("withholds infrastructure credentials from remote project code", async () => {
      const serialized = await __serializeRequestForTests(
        new Request("https://tenant.example/api/test", {
          headers: {
            "authorization": "Bearer application-user-token",
            "cookie": "session=application-cookie",
            "proxy-authorization": "Basic infrastructure-proxy-token",
            "x-project-slug": "tenant",
            "x-token": "platform-service-token",
            "x-veryfront-control-plane-jws": "signed-control-plane-request",
            "x-veryfront-dispatch-jws": "signed-dispatch-request",
            "x-veryfront-future-infrastructure-secret": "future-secret",
          },
        }),
      );

      assertEquals(serialized.headers, [
        ["authorization", "Bearer application-user-token"],
        ["cookie", "session=application-cookie"],
      ]);
    });

    it("withholds reserved infrastructure headers from local project code too", async () => {
      const serialized = await __serializeRequestForTests(
        new Request("http://localhost/api/test", {
          headers: {
            authorization: "Bearer local-application-token",
            "x-token": "local-infrastructure-token",
          },
        }),
      );

      assertEquals(serialized.headers, [[
        "authorization",
        "Bearer local-application-token",
      ]]);
    });
  });

  describe("executeAppRoute()", () => {
    it("should call the matching HTTP method handler", async () => {
      const handler = {
        GET: (_req: Request) => new Response("get response", { status: 200 }),
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "get response");
    });

    it("should fall back to default handler when method not found", async () => {
      const handler = {
        default: (_req: Request) => new Response("default response"),
      };

      const request = new Request("http://localhost/api/test", { method: "POST" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "default response");
    });

    it("should return 405 when no matching handler exists", async () => {
      const handler = {
        POST: (_req: Request) => new Response("post only"),
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 405);
    });

    it("should handle HEAD method by falling back to GET", async () => {
      const handler = {
        GET: (_req: Request) => new Response("get body", { status: 200 }),
      };

      const request = new Request("http://localhost/api/test", { method: "HEAD" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "");
    });

    it("should return error response when handler throws", async () => {
      const handler = {
        GET: () => {
          throw new Error("handler error");
        },
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should return error response when handler returns non-Response", async () => {
      const handler = {
        GET: () => "not a response" as unknown as Response,
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should accept Response.json() return value", async () => {
      const handler = {
        GET: () => Response.json({ ok: true }),
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.json(), { ok: true });
    });

    it("passes admitted application identity to host app route context", async () => {
      const identity = createIdentity();
      const handler = {
        GET: (_req: Request, ctx: AppRouteContext) =>
          Response.json({
            sameIdentity: ctx.identity === identity,
            subject: ctx.identity?.subject ?? null,
            rootFrozen: ctx.identity === null ? null : Object.isFrozen(ctx.identity),
            rootProtoNull: ctx.identity === null
              ? null
              : Object.getPrototypeOf(ctx.identity) === null,
            claimsProtoNull: ctx.identity === null
              ? null
              : Object.getPrototypeOf(ctx.identity.claims) === null,
          }),
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { ...LOCAL_EXECUTION, applicationIdentity: identity },
      );

      assertEquals(await response.json(), {
        sameIdentity: false,
        subject: "user-123",
        rootFrozen: true,
        rootProtoNull: true,
        claimsProtoNull: true,
      });
    });

    it("keeps explicit null anonymous and rejects malformed host app route identity options", async () => {
      let calls = 0;
      const handler = {
        GET: (_req: Request, ctx: AppRouteContext) => {
          calls += 1;
          return Response.json({ identityIsNull: ctx.identity === null });
        },
      };
      const request = new Request("http://localhost/api/test", { method: "GET" });
      const anonymous = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { ...LOCAL_EXECUTION, applicationIdentity: null },
      );
      assertEquals(await anonymous.json(), { identityIsNull: true });

      assertThrows(
        () =>
          executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            {
              ...LOCAL_EXECUTION,
              applicationIdentity: "malformed" as unknown as ApplicationIdentity,
            },
          ),
        TypeError,
        "Application identity must be a plain object",
      );

      let accessorCalls = 0;
      const accessorIdentity = { ...createIdentity() };
      Object.defineProperty(accessorIdentity, "email", {
        enumerable: true,
        get() {
          accessorCalls += 1;
          return "user@example.test";
        },
      });
      assertThrows(
        () =>
          executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            { ...LOCAL_EXECUTION, applicationIdentity: accessorIdentity },
          ),
        TypeError,
        "accessor property",
      );
      assertEquals(accessorCalls, 0);
      assertEquals(calls, 1);
    });

    it("should reject forged Response-like objects", async () => {
      const bodyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"cross":"context"}'));
          controller.close();
        },
      });
      const fakeResponse = {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        body: bodyStream,
        ok: true,
        redirected: false,
        type: "basic" as ResponseType,
        url: "",
        text: () => Promise.resolve('{"cross":"context"}'),
        json: () => Promise.resolve({ cross: "context" }),
        clone: () => fakeResponse,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        bodyUsed: false,
      };

      const handler = {
        GET: () => fakeResponse as unknown as Response,
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should reject forged Response-like objects for HEAD requests", async () => {
      const fakeResponse = {
        status: 201,
        statusText: "Created",
        headers: new Headers({ "x-custom": "value" }),
        body: new ReadableStream(),
        ok: true,
        redirected: false,
        type: "basic" as ResponseType,
        url: "",
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
        clone: () => fakeResponse,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        bodyUsed: false,
      };

      const handler = {
        GET: () => fakeResponse as unknown as Response,
      };

      const request = new Request("http://localhost/api/test", { method: "HEAD" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should return error response when handler returns null", async () => {
      const handler = {
        GET: () => null as unknown as Response,
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should return error response when handler returns undefined", async () => {
      const handler = {
        GET: () => undefined as unknown as Response,
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should return error response when async handler rejects", async () => {
      const handler = {
        GET: () => Promise.reject(new Error("async failure")),
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should reject objects missing Response interface", async () => {
      const handler = {
        GET: () => ({ data: "not a response" }) as unknown as Response,
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should pass route params to handler context", async () => {
      let capturedCtx: { params: Record<string, string> } | undefined;

      const handler = {
        GET: (_req: Request, ctx: { params: Record<string, string> }) => {
          capturedCtx = ctx;
          return new Response("ok");
        },
      };

      const match = makeMatch("/api/users/[id]", "/api/users/[id].ts", { id: "123" });
      const request = new Request("http://localhost/api/users/123", { method: "GET" });
      await executeAppRoute(handler, request, match, "/api/users/123", makeAdapter());

      assertEquals(capturedCtx?.params.id, "123");
    });

    it("should normalize catch-all params to slash-separated strings", async () => {
      let capturedCtx: { params: Record<string, string> } | undefined;

      const handler = {
        GET: (_req: Request, ctx: { params: Record<string, string> }) => {
          capturedCtx = ctx;
          return new Response("ok");
        },
      };

      const match = makeMatch("/api/docs/[...slug]", "/api/docs/[...slug].ts", {
        slug: ["guide", "intro"],
      });
      const request = new Request("http://localhost/api/docs/guide/intro", { method: "GET" });
      await executeAppRoute(handler, request, match, "/api/docs/guide/intro", makeAdapter());

      assertEquals(capturedCtx?.params.slug, "guide/intro");
    });

    it("fails closed when isolation is required but no prepared module exists", async () => {
      let called = false;
      const handler = {
        GET: () => {
          called = true;
          return new Response("leaked");
        },
      };

      const response = await executeAppRouteRaw(
        handler,
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        {
          modulePath: "/test/project/handler.ts",
          projectDir: "/test/project",
          isLocalProject: false,
        },
      );

      assertEquals(response.status, 500, "isolation-required routes must fail closed");
      assertEquals(called, false, "the tenant handler must never run in the host realm");
    });

    it("names the missing prepared route source for a local isolation-required route", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      let called = false;
      const handler = {
        GET: () => {
          called = true;
          return new Response("leaked");
        },
      };

      try {
        const response = await executeAppRouteRaw(
          handler,
          new Request("http://localhost/api/test", { method: "GET" }),
          makeMatch(),
          "/api/test",
          makeAdapter(),
          {
            modulePath: "/test/project/handler.ts",
            projectDir: "/test/project",
            isLocalProject: true,
          },
        );

        assertEquals(response.status, 500, "isolation-required routes must fail closed");
        assertEquals(called, false, "the project handler must never run in the host realm");
        const problem = await response.json() as { detail?: string };
        assertStringIncludes(
          problem.detail ?? "",
          "requires prepared route source",
          "the fail-closed response must name the missing prepared route source",
        );
      } finally {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
        Deno.env.delete("WORKER_ISOLATION_API");
        await __resetPoolForTests();
      }
    });
  });

  describe("executePagesRoute()", () => {
    it("should call the matching method handler", async () => {
      const handler = {
        GET: (_ctx: unknown) => new Response("pages get"),
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "pages get");
    });

    it("passes admitted application identity to host pages route context", async () => {
      const identity = createIdentity();
      const handler = {
        GET: (ctx: APIContext) => {
          const ctxIdentity = ctx.identity ?? null;
          return Response.json({
            sameIdentity: ctxIdentity === identity,
            subject: ctxIdentity?.subject ?? null,
            rootFrozen: ctxIdentity === null ? null : Object.isFrozen(ctxIdentity),
            rootProtoNull: ctxIdentity === null
              ? null
              : Object.getPrototypeOf(ctxIdentity) === null,
            claimsProtoNull: ctxIdentity === null
              ? null
              : Object.getPrototypeOf(ctxIdentity.claims) === null,
          });
        },
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        undefined,
        { ...LOCAL_EXECUTION, applicationIdentity: identity },
      );

      assertEquals(await response.json(), {
        sameIdentity: false,
        subject: "user-123",
        rootFrozen: true,
        rootProtoNull: true,
        claimsProtoNull: true,
      });
    });

    it("keeps explicit null anonymous and rejects malformed host pages route identity options", async () => {
      let calls = 0;
      const handler = {
        GET: (ctx: APIContext) => {
          calls += 1;
          return Response.json({ identityIsNull: ctx.identity === null });
        },
      };
      const request = new Request("http://localhost/api/test", { method: "GET" });
      const anonymous = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        "/test/project",
        { ...LOCAL_EXECUTION, applicationIdentity: null },
      );
      assertEquals(await anonymous.json(), { identityIsNull: true });

      assertThrows(
        () =>
          executePagesRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            "/test/project",
            { ...LOCAL_EXECUTION, applicationIdentity: 7 as unknown as ApplicationIdentity },
          ),
        TypeError,
        "Application identity must be a plain object",
      );

      let accessorCalls = 0;
      const accessorIdentity = { ...createIdentity() };
      Object.defineProperty(accessorIdentity, "email", {
        enumerable: true,
        get() {
          accessorCalls += 1;
          return "user@example.test";
        },
      });
      assertThrows(
        () =>
          executePagesRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            "/test/project",
            { ...LOCAL_EXECUTION, applicationIdentity: accessorIdentity },
          ),
        TypeError,
        "accessor property",
      );
      assertEquals(accessorCalls, 0);
      assertEquals(calls, 1);
    });

    it("should fall back to default handler", async () => {
      const handler = {
        default: (_ctx: unknown) => new Response("pages default"),
      };

      const request = new Request("http://localhost/api/test", { method: "POST" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(await response.text(), "pages default");
    });

    it("should return 405 when no handler matches", async () => {
      const handler = {
        POST: (_ctx: unknown) => new Response("post only"),
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 405);
    });

    it("should handle errors from handler", async () => {
      const handler = {
        GET: () => {
          throw new Error("pages error");
        },
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("should return error when handler returns non-Response", async () => {
      const handler = {
        GET: () => "string" as unknown as Response,
      };

      const request = new Request("http://localhost/api/test", { method: "GET" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("scopes ctx.fs relative paths to the project directory", async () => {
      const seen: string[] = [];
      const adapter = makeAdapter();
      adapter.fs.readFile = (path: string) => {
        seen.push(path);
        return Promise.resolve("{}");
      };

      const handler = {
        GET: async (ctx: { fs: { readFile: (path: string) => Promise<string> } }) => {
          await ctx.fs.readFile("data.json");
          await ctx.fs.readFile("/etc/hosts");
          return new Response("ok");
        },
      };

      const response = await executePagesRoute(
        handler,
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        adapter,
        "/test/project",
      );

      assertEquals(response.status, 200, "the scoped handler still returns its response");
      assertEquals(
        seen,
        ["/test/project/data.json", "/etc/hosts"],
        "relative ctx.fs paths resolve under projectDir and absolute paths pass through",
      );
    });

    it("fails closed when isolation is required but no prepared module exists", async () => {
      let called = false;
      const handler = {
        GET: () => {
          called = true;
          return new Response("leaked");
        },
      };

      const response = await executePagesRouteRaw(
        handler,
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        "/test/project",
        {
          modulePath: "/test/project/handler.ts",
          projectDir: "/test/project",
          isLocalProject: false,
        },
      );

      assertEquals(response.status, 500, "isolation-required routes must fail closed");
      assertEquals(called, false, "the tenant handler must never run in the host realm");
    });

    it("names the missing prepared route source for a local isolation-required route", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      let called = false;
      const handler = {
        GET: () => {
          called = true;
          return new Response("leaked");
        },
      };

      try {
        const response = await executePagesRouteRaw(
          handler,
          new Request("http://localhost/api/test", { method: "GET" }),
          makeMatch(),
          "/api/test",
          makeAdapter(),
          "/test/project",
          {
            modulePath: "/test/project/handler.ts",
            projectDir: "/test/project",
            isLocalProject: true,
          },
        );

        assertEquals(response.status, 500, "isolation-required routes must fail closed");
        assertEquals(called, false, "the project handler must never run in the host realm");
        const problem = await response.json() as { detail?: string };
        assertStringIncludes(
          problem.detail ?? "",
          "requires prepared route source",
          "the fail-closed response must name the missing prepared route source",
        );
      } finally {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
        Deno.env.delete("WORKER_ISOLATION_API");
        await __resetPoolForTests();
      }
    });
  });

  describe("body size guard (isolated execution)", () => {
    afterEach(async () => {
      try {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
      } catch { /* ok */ }
      try {
        Deno.env.delete("WORKER_ISOLATION_API");
      } catch { /* ok */ }
      await __resetPoolForTests();
    });

    it("should reject oversized request bodies in isolated app route execution", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // Create a body larger than 10 MB
      const largeBody = new Uint8Array(11 * 1024 * 1024);
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: largeBody,
      });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            await isolatedRouteOptions(
              "export function POST() { return new Response('ok'); }",
              "body-oversized-app",
            ),
          ),
      );

      // Should get an error response due to body size limit
      assertEquals(response.status, 500);
    });

    it("should allow normal-sized request bodies in isolated app route execution", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // Create a small body (under 10 MB)
      const smallBody = JSON.stringify({ data: "hello" });
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: smallBody,
      });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            await isolatedRouteOptions(
              "export function POST() { return new Response('ok'); }",
              "body-normal-app",
            ),
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "ok");
    });

    it("should reject oversized request bodies in isolated pages route execution", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        POST: (_ctx: unknown) => new Response("ok"),
      };

      // Create a body larger than 10 MB
      const largeBody = new Uint8Array(11 * 1024 * 1024);
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: largeBody,
      });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executePagesRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            undefined,
            await isolatedRouteOptions(
              "export function POST() { return new Response('ok'); }",
              "body-oversized-pages",
            ),
          ),
      );

      assertEquals(response.status, 500);
    });

    it("should reject via Content-Length header before buffering the body", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // Create a small body but with a Content-Length header claiming 20 MB.
      // The fast path should reject based on Content-Length before reading.
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: "small",
        headers: { "content-length": String(20 * 1024 * 1024) },
      });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            await isolatedRouteOptions(
              "export function POST() { return new Response('ok'); }",
              "body-declared-oversized",
            ),
          ),
      );

      assertEquals(response.status, 500);
    });

    it("should reject large body without Content-Length via fallback check", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // ReadableStream body has no Content-Length header — fallback check catches it
      const chunks = [new Uint8Array(11 * 1024 * 1024)];
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });

      const request = new Request(
        "http://localhost/api/test",
        {
          method: "POST",
          body: stream,
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      );

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            await isolatedRouteOptions(
              "export function POST() { return new Response('ok'); }",
              "body-stream-oversized",
            ),
          ),
      );

      assertEquals(response.status, 500);
    });

    it("should skip body size guard for requests without a body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        GET: (_req: Request) => new Response("ok"),
      };

      // GET request with no body — should pass the size guard
      const request = new Request("http://localhost/api/test", { method: "GET" });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            await isolatedRouteOptions(
              "export function GET() { return new Response('ok'); }",
              "body-empty",
            ),
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "ok");
    });

    it("should reject malformed Content-Length headers", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // Malformed Content-Length — parseInt returns NaN, NaN > limit is false
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: "small body",
        headers: { "content-length": "not-a-number" },
      });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            await isolatedRouteOptions(
              "export function POST() { return new Response('ok'); }",
              "body-invalid-content-length",
            ),
          ),
      );

      assertEquals(response.status, 500, "a malformed Content-Length must be rejected");
    });

    it("rejects a non-decimal Content-Length whose value matches the body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // "+5" is not a decimal Content-Length, yet Number("+5") equals the five
      // body bytes, so only the format guard can reject this request.
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: "small",
        headers: { "content-length": "+5" },
      });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          await executeAppRoute(
            handler,
            request,
            makeMatch(),
            "/api/test",
            makeAdapter(),
            await isolatedRouteOptions(
              "export function POST() { return new Response('ok'); }",
              "body-non-decimal-content-length",
            ),
          ),
      );

      assertEquals(
        response.status,
        500,
        "a non-decimal Content-Length must be rejected by the format guard, not merely by the body-length mismatch",
      );
    });
  });

  describe("source policy propagation (isolated execution)", () => {
    afterEach(async () => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      await __resetPoolForTests();
    });

    it("restores the exact source integration policy inside the worker", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const policy = normalizeSourceIntegrationPolicy({
        allow: { confluence: { allowedTools: ["get_page"] } },
      });
      const modulePath = new URL("./fixtures/source-policy-route.ts", import.meta.url).pathname;
      const projectDir = new URL("../../../", import.meta.url).pathname;
      const sourcePolicyModuleUrl = new URL(
        "../../integrations/source-policy-context.ts",
        import.meta.url,
      ).href;

      const response = await runWithExactSourceIntegrationPolicy(
        policy,
        async () =>
          executeAppRoute(
            { GET: () => Response.json({ unreachable: true }) },
            new Request("http://localhost/api/source-policy", { method: "GET" }),
            makeMatch("/api/source-policy", modulePath),
            "/api/source-policy",
            makeAdapter(),
            {
              modulePath,
              projectDir,
              isLocalProject: true,
              preparedModule: await prepareModuleSource(
                [
                  `import { getActiveSourceIntegrationPolicy } from ${
                    JSON.stringify(sourcePolicyModuleUrl)
                  };`,
                  "export function GET() {",
                  "  return Response.json(getActiveSourceIntegrationPolicy());",
                  "}",
                ].join("\n"),
              ),
              executionScopeId: "route-executor-source-policy",
            },
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.json(), policy);
    });
  });

  describe("response helpers (isolated pages execution)", () => {
    afterEach(async () => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      await __resetPoolForTests();
    });

    it("drops ctx.text bodies for null-body statuses", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const modulePath = new URL(
        "./fixtures/null-body-pages-route.ts",
        import.meta.url,
      ).pathname;
      const projectDir = new URL("../../../", import.meta.url).pathname;

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        async () =>
          executePagesRoute(
            { GET: () => new Response("unreachable") },
            new Request("http://localhost/api/no-content", { method: "GET" }),
            makeMatch("/api/no-content", modulePath),
            "/api/no-content",
            makeAdapter(),
            undefined,
            {
              modulePath,
              projectDir,
              isLocalProject: true,
              preparedModule: await prepareModuleSource(
                "export function GET(ctx) { return ctx.text('ignored', { status: 204 }); }",
              ),
              executionScopeId: "route-executor-null-body",
            },
          ),
      );

      assertEquals(response.status, 204);
      assertEquals(response.body, null);
    });
  });

  describe("executePreparedAppRoute() / executePreparedPagesRoute() / resolvePreparedRouteMethods()", () => {
    afterEach(async () => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      await __resetPoolForTests();
    });

    it("executes a prepared app route module in the worker and returns its response", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export function GET(_req, ctx) { return Response.json({ id: ctx.params.id }); }",
        "prepared-app-happy",
      );

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          executePreparedAppRoute(
            new Request("http://localhost/api/users/42", { method: "GET" }),
            makeMatch("/api/users/[id]", "/test/project/handler.ts", { id: "42" }),
            "/api/users/42",
            options,
          ),
      );

      assertEquals(response.status, 200);
      assertStringIncludes(response.headers.get("content-type") ?? "", "application/json");
      assertEquals(await response.json(), { id: "42" });
    });

    it("passes admitted identity to prepared app route worker context", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const identity = createIdentity();
      const options = {
        ...(await preparedRouteOptions(
          `
            export function GET(_req, ctx) {
              return Response.json({
                subject: ctx.identity?.subject ?? null,
                sameWithinContext: ctx.identity === ctx.identity,
                frozen: ctx.identity === null ? null : {
                  root: Object.isFrozen(ctx.identity),
                  groups: Object.isFrozen(ctx.identity.groups),
                  claims: Object.isFrozen(ctx.identity.claims),
                },
              });
            }
          `,
          "prepared-app-identity",
        )),
        applicationIdentity: identity,
      };

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          executePreparedAppRoute(
            new Request("http://localhost/api/test", { method: "GET" }),
            makeMatch(),
            "/api/test",
            options,
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.json(), {
        subject: "user-123",
        sameWithinContext: true,
        frozen: { root: true, groups: true, claims: true },
      });
    });

    it("returns a 500 error response when the prepared app route handler throws", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export function GET() { throw new Error('prepared app boom'); }",
        "prepared-app-error",
      );

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          executePreparedAppRoute(
            new Request("http://localhost/api/test", { method: "GET" }),
            makeMatch(),
            "/api/test",
            options,
          ),
      );

      assertEquals(response.status, 500);
    });

    it("executes a prepared pages route module in the worker and returns its response", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export function GET(ctx) { return ctx.text('prepared pages ok'); }",
        "prepared-pages-happy",
      );

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          executePreparedPagesRoute(
            new Request("http://localhost/api/test", { method: "GET" }),
            makeMatch(),
            "/api/test",
            options,
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "prepared pages ok");
    });

    it("passes admitted identity to prepared pages route worker context", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const identity = createIdentity();
      const options = {
        ...(await preparedRouteOptions(
          `
            export function GET(ctx) {
              return Response.json({
                subject: ctx.identity?.subject ?? null,
                sameWithinContext: ctx.identity === ctx.identity,
                frozen: ctx.identity === null ? null : {
                  root: Object.isFrozen(ctx.identity),
                  roles: Object.isFrozen(ctx.identity.roles),
                  claims: Object.isFrozen(ctx.identity.claims),
                },
              });
            }
          `,
          "prepared-pages-identity",
        )),
        applicationIdentity: identity,
      };

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          executePreparedPagesRoute(
            new Request("http://localhost/api/test", { method: "GET" }),
            makeMatch(),
            "/api/test",
            options,
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.json(), {
        subject: "user-123",
        sameWithinContext: true,
        frozen: { root: true, roles: true, claims: true },
      });
    });

    it("returns a 500 error response when the prepared pages route handler throws", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export function GET() { throw new Error('prepared pages boom'); }",
        "prepared-pages-error",
      );

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          executePreparedPagesRoute(
            new Request("http://localhost/api/test", { method: "GET" }),
            makeMatch(),
            "/api/test",
            options,
          ),
      );

      assertEquals(response.status, 500);
    });

    it("resolves the exported HTTP methods for a prepared route", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export function GET() {} export function POST() {}",
        "prepared-methods-happy",
      );

      const methods = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () => resolvePreparedRouteMethods(undefined, options),
      );

      assertEquals(methods, ["GET", "HEAD", "POST", "OPTIONS"]);
    });

    it("can omit the framework OPTIONS fallback from prepared route methods", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export function GET() {}",
        "prepared-methods-authored",
      );

      const methods = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          resolvePreparedRouteMethods(
            undefined,
            options,
            { includeFrameworkOptions: false },
          ),
      );

      assertEquals(methods, ["GET", "HEAD"]);
    });

    it("keeps authored OPTIONS when omitting the framework fallback", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export function GET() {} export function OPTIONS() {}",
        "prepared-methods-options",
      );

      const methods = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
          resolvePreparedRouteMethods(
            undefined,
            options,
            { includeFrameworkOptions: false },
          ),
      );

      assertEquals(methods, ["GET", "HEAD", "OPTIONS"]);
    });

    it("rejects when the prepared module has no callable route export", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      await __resetPoolForTests();

      const options = await preparedRouteOptions(
        "export const notARouteHandler = 1;",
        "prepared-methods-error",
      );

      await assertRejects(
        () =>
          runWithExactSourceIntegrationPolicy(
            normalizeSourceIntegrationPolicy({ allow: {} }),
            () => resolvePreparedRouteMethods(undefined, options),
          ),
        Error,
        "Prepared API route module has no callable route export",
      );
    });
  });
});
