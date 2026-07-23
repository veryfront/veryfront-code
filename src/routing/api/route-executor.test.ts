import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetInProcessIsolationWarningForTests,
  executeAppRoute,
  executePagesRoute,
} from "./route-executor.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { __resetLoggerConfigForTests } from "../../utils/logger/index.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";

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

function captureConsoleWarn(): { getOutput: () => string; restore: () => void } {
  const originalWarn = console.warn;
  const output: string[] = [];

  console.warn = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };

  return {
    getOutput: () => output.join("\n"),
    restore: () => {
      console.warn = originalWarn;
    },
  };
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, Deno.env.get(key)]));
}

describe("routing/api/route-executor", () => {
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

    it("should accept cross-context Response-like objects (duck typing)", async () => {
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

      assert(response instanceof Response, "should be normalized to a real Response instance");
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-type"), "application/json");
      assertEquals(await response.text(), '{"cross":"context"}');
    });

    it("should normalize cross-context Response for HEAD requests", async () => {
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

      assert(response instanceof Response, "should be a real Response instance");
      assertEquals(response.status, 201);
      assertEquals(response.headers.get("x-custom"), "value");
      assertEquals(await response.text(), "");
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

    it("should serve HEAD through GET without returning a body", async () => {
      const response = await executePagesRoute(
        { GET: () => new Response("pages get", { headers: { "x-route": "get" } }) },
        new Request("http://localhost/api/test", { method: "HEAD" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("x-route"), "get");
      assertEquals(await response.text(), "");
    });

    it("should reject filesystem paths outside the project scope", async () => {
      const adapter = makeAdapter();
      let readPath: string | undefined;
      adapter.fs.readFile = (path) => {
        readPath = path;
        return Promise.resolve("secret");
      };
      const response = await executePagesRoute(
        {
          GET: async (ctx: { fs: { readFile(path: string): Promise<string> } }) => {
            await ctx.fs.readFile("../secret.txt");
            return new Response("unreachable");
          },
        },
        new Request("http://localhost/api/test"),
        makeMatch(),
        "/api/test",
        adapter,
        "/project",
      );

      assertEquals(response.status, 400);
      assertEquals(readPath, undefined);
    });

    it("should reject symlinks whose canonical target leaves the project", async () => {
      const adapter = makeAdapter();
      let readCalled = false;
      adapter.fs.realPath = (path) =>
        Promise.resolve(path === "/project/link/secret.txt" ? "/outside/secret.txt" : path);
      adapter.fs.readFile = () => {
        readCalled = true;
        return Promise.resolve("secret");
      };
      const response = await executePagesRoute(
        {
          GET: async (ctx: { fs: { readFile(path: string): Promise<string> } }) => {
            await ctx.fs.readFile("link/secret.txt");
            return new Response("unreachable");
          },
        },
        new Request("http://localhost/api/test"),
        makeMatch(),
        "/api/test",
        adapter,
        "/project",
      );

      assertEquals(response.status, 400);
      assertEquals(readCalled, false);
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

    it("continues pages API route execution when isolation warning logging fails", async () => {
      const envSnapshot = snapshotEnv([
        "WORKER_ISOLATION_ENABLED",
        "WORKER_ISOLATION_API",
        "LOG_FORMAT",
        "LOG_LEVEL",
        "NO_COLOR",
      ]);
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("LOG_LEVEL", "WARN");
      Deno.env.set("NO_COLOR", "1");
      __resetPoolForTests();
      __resetInProcessIsolationWarningForTests();
      __resetLoggerConfigForTests();
      const originalWarn = console.warn;

      try {
        console.warn = () => {
          throw new Error("warning sink unavailable");
        };

        const handler = {
          GET: () => Response.json({ msg: "pages api" }),
        };

        const request = new Request("http://localhost/api/hello", { method: "GET" });
        const response = await executePagesRoute(
          handler,
          request,
          makeMatch("/api/hello", "/tmp/test/pages/api/hello.ts"),
          "/api/hello",
          makeAdapter("production"),
          "/tmp/test",
          {
            modulePath: "/tmp/test/pages/api/hello.ts",
            projectDir: "/tmp/test",
            isLocalProject: false,
          },
        );

        assertEquals(response.status, 200);
        assertEquals(await response.json(), { msg: "pages api" });
      } finally {
        console.warn = originalWarn;
        restoreEnv(envSnapshot);
        __resetLoggerConfigForTests();
      }
    });
  });

  describe("untrusted in-process execution warning", () => {
    const envKeys = [
      "WORKER_ISOLATION_ENABLED",
      "WORKER_ISOLATION_API",
      "LOG_FORMAT",
      "LOG_LEVEL",
      "NO_COLOR",
    ];

    afterEach(() => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      __resetPoolForTests();
      __resetInProcessIsolationWarningForTests();
      __resetLoggerConfigForTests();
    });

    it("warns once when a remote app route falls back to in-process execution", async () => {
      const envSnapshot = snapshotEnv(envKeys);
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("LOG_LEVEL", "WARN");
      Deno.env.set("NO_COLOR", "1");
      __resetPoolForTests();
      __resetInProcessIsolationWarningForTests();
      __resetLoggerConfigForTests();

      const captured = captureConsoleWarn();
      try {
        const handler = {
          GET: () => new Response("ok"),
        };
        const request = new Request("http://localhost/api/test", { method: "GET" });
        const options = {
          modulePath: "/tmp/test/handler.ts",
          projectDir: "/tmp/test",
          isLocalProject: false,
        };

        const first = await executeAppRoute(
          handler,
          request,
          makeMatch(),
          "/api/test",
          makeAdapter(),
          options,
        );
        const second = await executeAppRoute(
          handler,
          new Request("http://localhost/api/test", { method: "GET" }),
          makeMatch(),
          "/api/test",
          makeAdapter(),
          options,
        );

        assertEquals(first.status, 200);
        assertEquals(second.status, 200);
        assertEquals(await first.text(), "ok");
        assertEquals(await second.text(), "ok");

        const output = captured.getOutput();
        assertEquals((output.match(/worker isolation disabled/g) ?? []).length, 1);
        assert(output.includes("WORKER_ISOLATION_ENABLED"));
        assert(output.includes("WORKER_ISOLATION_API"));
      } finally {
        captured.restore();
        restoreEnv(envSnapshot);
        __resetLoggerConfigForTests();
      }
    });

    it("does not warn for local app route in-process execution", async () => {
      const envSnapshot = snapshotEnv(envKeys);
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("LOG_LEVEL", "WARN");
      Deno.env.set("NO_COLOR", "1");
      __resetPoolForTests();
      __resetInProcessIsolationWarningForTests();
      __resetLoggerConfigForTests();

      const captured = captureConsoleWarn();
      try {
        const response = await executeAppRoute(
          { GET: () => new Response("ok") },
          new Request("http://localhost/api/test", { method: "GET" }),
          makeMatch(),
          "/api/test",
          makeAdapter(),
          {
            modulePath: "/tmp/test/handler.ts",
            projectDir: "/tmp/test",
            isLocalProject: true,
          },
        );

        assertEquals(response.status, 200);
        assertEquals(captured.getOutput(), "");
      } finally {
        captured.restore();
        restoreEnv(envSnapshot);
        __resetLoggerConfigForTests();
      }
    });
  });

  describe("body size guard (isolated execution)", () => {
    afterEach(() => {
      try {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
      } catch { /* ok */ }
      try {
        Deno.env.delete("WORKER_ISOLATION_API");
      } catch { /* ok */ }
      __resetPoolForTests();
    });

    it("should reject oversized request bodies in isolated app route execution", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // Create a body larger than 10 MB
      const largeBody = new Uint8Array(11 * 1024 * 1024);
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: largeBody,
      });

      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      // Should get an error response due to body size limit
      assertEquals(response.status, 400);
    });

    it("should allow normal-sized request bodies in isolated app route execution", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      // Create a small body (under 10 MB)
      const smallBody = JSON.stringify({ data: "hello" });
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: smallBody,
      });

      // This will fail at the worker execution level (module not found),
      // but should NOT fail at the body size guard
      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      // The error should be about worker execution, not body size
      const body = await response.json();
      const detail = body.detail ?? "";
      assert(
        !detail.includes("too large"),
        "should not reject small request bodies",
      );
    });

    it("should reject oversized request bodies in isolated pages route execution", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const handler = {
        POST: (_ctx: unknown) => new Response("ok"),
      };

      // Create a body larger than 10 MB
      const largeBody = new Uint8Array(11 * 1024 * 1024);
      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: largeBody,
      });

      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        undefined,
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      assertEquals(response.status, 400);
    });

    it("should reject via Content-Length header before buffering the body", async () => {
      // Enable worker isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

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

      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      assertEquals(response.status, 400);
    });

    it("should reject large body without Content-Length via fallback check", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

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

      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      assertEquals(response.status, 400);
    });

    it("should cancel a streaming body as soon as it exceeds the limit", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      let chunk = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunk++ < 11) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          } else {
            controller.close();
          }
        },
        cancel() {
          cancelled = true;
        },
      });
      const response = await executeAppRoute(
        { POST: () => new Response("ok") },
        new Request("http://localhost/api/test", { method: "POST", body }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      assertEquals(response.status, 400);
      assertEquals(cancelled, true);
    });

    it("should skip body size guard for requests without a body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const handler = {
        GET: (_req: Request) => new Response("ok"),
      };

      // GET request with no body — should pass the size guard
      const request = new Request("http://localhost/api/test", { method: "GET" });

      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      // Error is about worker execution (module not found), not body size
      const body = await response.json();
      assert(
        !(body.detail ?? "").includes("too large"),
        "should not reject request without body",
      );
    });

    it("does not require a host-loaded route for isolated execution", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const response = await executePagesRoute(
        null,
        new Request("http://localhost/api/test"),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        undefined,
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      assertEquals(response.status, 500);
    });

    it("should reject requests with malformed Content-Length headers", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      const request = new Request("http://localhost/api/test", {
        method: "POST",
        body: "small body",
        headers: { "content-length": "not-a-number" },
      });

      const response = await executeAppRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/tmp/test/handler.ts", projectDir: "/tmp/test" },
      );

      const body = await response.json();
      assertEquals(response.status, 400);
      assertEquals(body.detail, "Invalid Content-Length header");
    });
  });

  describe("source policy propagation (isolated execution)", () => {
    afterEach(() => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      __resetPoolForTests();
    });

    it("restores the exact source integration policy inside the worker", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const policy = normalizeSourceIntegrationPolicy({
        allow: { confluence: { allowedTools: ["get_page"] } },
      });
      const modulePath = new URL("./fixtures/source-policy-route.ts", import.meta.url).pathname;
      const projectDir = new URL("../../../", import.meta.url).pathname;

      const response = await runWithExactSourceIntegrationPolicy(
        policy,
        () =>
          executeAppRoute(
            { GET: () => Response.json({ unreachable: true }) },
            new Request("http://localhost/api/source-policy", { method: "GET" }),
            makeMatch("/api/source-policy", modulePath),
            "/api/source-policy",
            makeAdapter(),
            { modulePath, projectDir, isLocalProject: true },
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.json(), policy);
    });
  });

  describe("isolated error boundary", () => {
    afterEach(() => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      __resetPoolForTests();
    });

    it("does not expose remote worker diagnostics", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const modulePath = new URL("./fixtures/worker-error-route.ts", import.meta.url).pathname;
      const projectDir = new URL("../../../", import.meta.url).pathname;
      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({
          allow: { confluence: { allowedTools: ["get_page"] } },
        }),
        () =>
          executeAppRoute(
            null,
            new Request("http://localhost/api/private"),
            makeMatch(),
            "/api/private",
            makeAdapter(),
            { modulePath, projectDir, isLocalProject: false },
          ),
      );

      const body = await response.text();
      assertEquals(response.status, 500);
      assertEquals(response.headers.get("Cache-Control"), "no-store");
      assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
      assertEquals(body.includes("Sensitive worker failure"), false);
      assertEquals(body.includes("/private/project/route.ts"), false);
      assertEquals(body.includes("stack"), false);
    });
  });
});
