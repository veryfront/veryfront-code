import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { executeAppRoute, executePagesRoute } from "./route-executor.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

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
    server: { upgradeWebSocket: () => { throw new Error("not implemented"); } },
    serve: () => { throw new Error("not implemented"); },
  };
}

function makeMatch(
  pattern = "/api/test",
  page = "/api/test.ts",
  params: RouteMatch["params"] = {},
): RouteMatch {
  return { route: { pattern, page }, params };
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
      const fakeResponse = {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        body: null,
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

      assertEquals(response.status, 200);
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
  });
});
