import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetInProcessIsolationWarningForTests,
  executeAppRoute,
  executePagesRoute,
  executePreparedAppRoute,
  type ExecuteRouteOptions,
} from "./route-executor.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { __resetPoolForTests, getWorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import { MAX_WORKER_BODY_BYTES } from "#veryfront/security/sandbox/worker-types.ts";
import { __resetLoggerConfigForTests } from "../../utils/logger/index.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { deserializeRouteResponse } from "./response-normalization.ts";
import { prepareHandlerModule } from "./module-loader/loader.ts";
import { computeHash } from "#veryfront/utils";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { nodeAdapter } from "#veryfront/platform/adapters/runtime/node/adapter.ts";

const TEST_ISOLATED_MODULE_SOURCE = `
  export default function handler() {
    throw new Error("synthetic isolated route failure");
  }
`;
const TEST_ISOLATED_MODULE = {
  source: TEST_ISOLATED_MODULE_SOURCE,
  sha256: await computeHash(TEST_ISOLATED_MODULE_SOURCE),
};

function isolatedTestOptions(
  modulePath: string,
  projectDir: string,
  isLocalProject = true,
): ExecuteRouteOptions {
  return {
    modulePath,
    projectDir,
    isLocalProject,
    preparedModule: TEST_ISOLATED_MODULE,
    executionScopeId: "api:test-route-executor",
  };
}

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

async function withRealWorkerRoute<T>(
  source: string,
  run: (
    modulePath: string,
    projectDir: string,
    options: ExecuteRouteOptions,
  ) => Promise<T>,
): Promise<T> {
  const projectDir = await Deno.makeTempDir();
  const modulePath = `${projectDir}/route.mjs`;
  await Deno.writeTextFile(modulePath, source);
  const options: ExecuteRouteOptions = {
    modulePath,
    projectDir,
    isLocalProject: true,
    preparedModule: {
      source,
      sha256: await computeHash(source),
    },
    executionScopeId: `api:test-real-worker:${crypto.randomUUID()}`,
  };

  try {
    return await withRealWorkerIsolation(() => run(modulePath, projectDir, options));
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

async function withRealWorkerIsolation<T>(run: () => Promise<T>): Promise<T> {
  const envSnapshot = snapshotEnv([
    "WORKER_ISOLATION_ENABLED",
    "WORKER_ISOLATION_API",
  ]);

  Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
  Deno.env.set("WORKER_ISOLATION_API", "1");
  __resetPoolForTests();

  try {
    return await runWithExactSourceIntegrationPolicy(
      normalizeSourceIntegrationPolicy(undefined),
      run,
    );
  } finally {
    __resetPoolForTests();
    restoreEnv(envSnapshot);
  }
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

    it("uses a default handler for a valid custom HTTP method", async () => {
      const response = await executeAppRoute(
        { default: () => new Response("custom default") },
        new Request("http://localhost/api/test", { method: "PROPFIND" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "custom default");
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

    it("uses explicit request locality instead of host mode for in-process errors", async () => {
      const response = await executeAppRoute(
        {
          GET: () => {
            throw new Error("hosted-secret");
          },
        },
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        makeAdapter("development"),
        { isLocalProject: false },
      );

      const body = await response.json();
      assertEquals(body.detail, undefined);
      assertEquals(body.stack, undefined);
      assertEquals(JSON.stringify(body).includes("hosted-secret"), false);
    });

    it("snapshots request locality once before every in-process error path", async () => {
      const envSnapshot = snapshotEnv([
        "WORKER_ISOLATION_ENABLED",
        "WORKER_ISOLATION_API",
      ]);
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      __resetPoolForTests();
      let localityReads = 0;
      const options = Object.defineProperty({}, "isLocalProject", {
        enumerable: true,
        get() {
          localityReads++;
          if (localityReads > 1) throw new Error("locality read twice");
          return false;
        },
      }) as ExecuteRouteOptions;
      const handler = Object.defineProperty({}, "GET", {
        enumerable: true,
        get() {
          throw new Error("hosted-resolver-secret");
        },
      });

      try {
        const response = await executeAppRoute(
          handler,
          new Request("http://localhost/api/test"),
          makeMatch(),
          "/api/test",
          makeAdapter("development"),
          options,
        );

        const body = await response.json();
        assertEquals(response.status, 500);
        assertEquals(localityReads, 1);
        assertEquals(body.detail, undefined);
        assertEquals(body.stack, undefined);
        assertEquals(JSON.stringify(body).includes("hosted-resolver-secret"), false);
      } finally {
        restoreEnv(envSnapshot);
        __resetPoolForTests();
      }
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

    it("rejects the non-HTTP Response.error sentinel at the route boundary", async () => {
      const response = await executeAppRoute(
        { GET: () => Response.error() },
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 500);
    });

    it("rejects noncanonical worker status-zero payloads", () => {
      const forgedPayloads = [
        { status: 0, statusText: "Forged", headers: [], body: null },
        {
          status: 0,
          statusText: "",
          headers: [["x-forged", "yes"]],
          body: null,
        },
        {
          status: 0,
          statusText: "",
          headers: [],
          body: new Uint8Array([1]),
        },
      ];

      for (const payload of forgedPayloads) {
        assertThrows(
          () => deserializeRouteResponse(payload),
          Error,
          "API handler must return a Response",
        );
      }
    });

    it("normalizes a genuine Response with a distinct immediate prototype", async () => {
      const bodyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"cross":"context"}'));
          controller.close();
        },
      });
      const crossContextResponse = new Response(bodyStream, {
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
      });
      const responseSubclassPrototype = Object.create(Response.prototype);
      Object.setPrototypeOf(crossContextResponse, responseSubclassPrototype);
      assert(Object.getPrototypeOf(crossContextResponse) !== Response.prototype);

      const handler = {
        GET: () => crossContextResponse,
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

    it("normalizes a genuine subclassed HEAD Response without consuming its body", async () => {
      let pulls = 0;
      const crossContextResponse = new Response(
        new ReadableStream({
          pull() {
            pulls += 1;
            throw new Error("HEAD normalization must not consume the body");
          },
        }, { highWaterMark: 0 }),
        {
          status: 201,
          statusText: "Created",
          headers: { "x-custom": "value" },
        },
      );
      Object.setPrototypeOf(crossContextResponse, Object.create(Response.prototype));

      const handler = {
        GET: () => crossContextResponse,
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
      assertEquals(pulls, 0);
    });

    it("rejects Response lookalikes without invoking project-owned getters", async () => {
      let getterCalls = 0;
      const lookalike = Object.defineProperties({}, {
        status: {
          get() {
            getterCalls += 1;
            return 201;
          },
        },
        statusText: {
          get() {
            getterCalls += 1;
            return "Created";
          },
        },
        headers: {
          get() {
            getterCalls += 1;
            return new Headers({ "x-spoof": "accepted" });
          },
        },
        body: {
          get() {
            getterCalls += 1;
            return null;
          },
        },
        arrayBuffer: {
          get() {
            getterCalls += 1;
            return () => Promise.resolve(new ArrayBuffer(0));
          },
        },
        then: {
          get() {
            getterCalls += 1;
            throw new Error("then getter must not run");
          },
        },
      });

      const response = await executeAppRoute(
        { GET: () => lookalike as unknown as Response },
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { isLocalProject: true },
      );

      assertEquals(response.status, 500);
      assertEquals(response.headers.get("x-spoof"), null);
      assertEquals(
        (await response.json()).detail,
        "API handler must return a Response",
      );
      assertEquals(getterCalls, 0);
    });

    it("rejects proxied Responses without invoking proxy traps", async () => {
      let trapCalls = 0;
      const proxiedResponse = new Proxy(new Response("must not escape"), {
        get(target, property, receiver) {
          trapCalls += 1;
          return Reflect.get(target, property, receiver);
        },
        getPrototypeOf(target) {
          trapCalls += 1;
          return Reflect.getPrototypeOf(target);
        },
      });

      const response = await executeAppRoute(
        { GET: () => proxiedResponse },
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { isLocalProject: true },
      );

      assertEquals(response.status, 500);
      assertEquals(
        (await response.json()).detail,
        "API handler must return a Response",
      );
      assertEquals(trapCalls, 0);
    });

    it("uses captured Web API primordials after project code replaces globals", async () => {
      const nativeResponseConstructor = Response;
      const responseDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Response");
      const headersDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Headers");
      const responseThenDescriptor = Object.getOwnPropertyDescriptor(
        nativeResponseConstructor.prototype,
        "then",
      );
      const source = new nativeResponseConstructor("trusted-body", {
        status: 203,
        statusText: "Non-Authoritative Information",
        headers: { "x-native": "yes" },
      });
      let forgedResponseConstructions = 0;
      let forgedHeadersConstructions = 0;
      let prototypeThenReads = 0;

      class ForgedResponse {
        constructor() {
          forgedResponseConstructions += 1;
        }
      }
      class ForgedHeaders {
        constructor() {
          forgedHeadersConstructions += 1;
        }
      }

      let response: Response | undefined;
      try {
        response = await executeAppRoute(
          {
            GET: () => {
              Object.defineProperty(globalThis, "Response", {
                configurable: true,
                value: ForgedResponse,
                writable: true,
              });
              Object.defineProperty(globalThis, "Headers", {
                configurable: true,
                value: ForgedHeaders,
                writable: true,
              });
              Object.defineProperty(nativeResponseConstructor.prototype, "then", {
                configurable: true,
                get() {
                  prototypeThenReads += 1;
                  throw new Error("Response.prototype.then must not run");
                },
              });
              return source;
            },
          },
          new Request("http://localhost/api/test", { method: "GET" }),
          makeMatch(),
          "/api/test",
          makeAdapter(),
        );
      } finally {
        if (responseDescriptor) {
          Object.defineProperty(globalThis, "Response", responseDescriptor);
        }
        if (headersDescriptor) {
          Object.defineProperty(globalThis, "Headers", headersDescriptor);
        }
        if (responseThenDescriptor) {
          Object.defineProperty(
            nativeResponseConstructor.prototype,
            "then",
            responseThenDescriptor,
          );
        } else {
          delete (nativeResponseConstructor.prototype as Response & { then?: unknown }).then;
        }
      }

      assert(response);
      assert(response instanceof nativeResponseConstructor);
      assertEquals(response.status, 203);
      assertEquals(response.statusText, "Non-Authoritative Information");
      assertEquals(response.headers.get("x-native"), "yes");
      assertEquals(await response.text(), "trusted-body");
      assertEquals(forgedResponseConstructions, 0);
      assertEquals(forgedHeadersConstructions, 0);
      assertEquals(prototypeThenReads, 0);
    });

    it("rejects an instance created by a forged Response constructor", async () => {
      class ForgedResponse {
        readonly status = 299;
        readonly statusText = "Forged";
        readonly headers = new Headers({ "x-forged": "yes" });
        readonly body = null;
      }

      const forged = new ForgedResponse();
      const response = await executeAppRoute(
        { GET: () => forged as unknown as Response },
        new Request("http://localhost/api/test", { method: "GET" }),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { isLocalProject: true },
      );

      assertEquals(response.status, 500);
      assertEquals(response.headers.get("x-forged"), null);
      assertEquals(
        (await response.json()).detail,
        "API handler must return a Response",
      );
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

    it("should handle HEAD by falling back to GET and stripping the body", async () => {
      const handler = {
        GET: (_ctx: unknown) =>
          new Response("pages get", {
            status: 201,
            headers: { "x-route": "pages-get" },
          }),
      };

      const request = new Request("http://localhost/api/test", { method: "HEAD" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 201);
      assertEquals(response.headers.get("x-route"), "pages-get");
      assertEquals(await response.text(), "");
    });

    it("should strip the body when a Pages default handler serves HEAD", async () => {
      const handler = {
        default: (_ctx: unknown) => new Response("pages default"),
      };

      const request = new Request("http://localhost/api/test", { method: "HEAD" });
      const response = await executePagesRoute(
        handler,
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "");
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

    it("uses the same fail-closed locality snapshot for Pages resolver errors", async () => {
      const envSnapshot = snapshotEnv([
        "WORKER_ISOLATION_ENABLED",
        "WORKER_ISOLATION_API",
      ]);
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      __resetPoolForTests();
      let localityReads = 0;
      const options = Object.defineProperty({}, "isLocalProject", {
        enumerable: true,
        get() {
          localityReads++;
          if (localityReads > 1) throw new Error("locality read twice");
          return false;
        },
      }) as ExecuteRouteOptions;
      const handler = Object.defineProperty({}, "GET", {
        enumerable: true,
        get() {
          throw new Error("hosted-pages-resolver-secret");
        },
      });

      try {
        const response = await executePagesRoute(
          handler,
          new Request("http://localhost/api/test"),
          makeMatch(),
          "/api/test",
          makeAdapter("development"),
          undefined,
          options,
        );

        const body = await response.json();
        assertEquals(response.status, 500);
        assertEquals(localityReads, 1);
        assertEquals(body.detail, undefined);
        assertEquals(body.stack, undefined);
        assertEquals(JSON.stringify(body).includes("hosted-pages-resolver-secret"), false);
      } finally {
        restoreEnv(envSnapshot);
        __resetPoolForTests();
      }
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

  describe("worker isolation admission", () => {
    afterEach(() => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      __resetPoolForTests();
    });

    it("does not execute App handlers on the host when isolation metadata is absent or partial", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();
      let hostExecutions = 0;
      const handler = {
        GET: () => {
          hostExecutions++;
          return new Response("host execution");
        },
      };

      const absent = await executeAppRoute(
        handler,
        new Request("http://localhost/api/test"),
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );
      const partial = await executeAppRoute(
        handler,
        new Request("http://localhost/api/test"),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        { modulePath: "/private/project/route.ts", isLocalProject: false },
      );

      assertEquals(absent.status, 500);
      assertEquals(partial.status, 500);
      assertEquals(hostExecutions, 0);
      assertEquals((await absent.text()).includes("host execution"), false);
      assertEquals((await partial.text()).includes("/private/project"), false);
    });

    it("does not execute Pages handlers on the host when isolation metadata is absent or partial", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();
      let hostExecutions = 0;
      const handler = {
        GET: () => {
          hostExecutions++;
          return new Response("host execution");
        },
      };

      const absent = await executePagesRoute(
        handler,
        new Request("http://localhost/api/test"),
        makeMatch(),
        "/api/test",
        makeAdapter(),
      );
      const partial = await executePagesRoute(
        handler,
        new Request("http://localhost/api/test"),
        makeMatch(),
        "/api/test",
        makeAdapter(),
        undefined,
        { projectDir: "/private/project", isLocalProject: false },
      );

      assertEquals(absent.status, 500);
      assertEquals(partial.status, 500);
      assertEquals(hostExecutions, 0);
      assertEquals((await absent.text()).includes("host execution"), false);
      assertEquals((await partial.text()).includes("/private/project"), false);
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
        isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
      );

      // Should get an error response due to body size limit
      assertEquals(response.status, 500);
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
        isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
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
        isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
      );

      assertEquals(response.status, 500);
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
        isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
      );

      assertEquals(response.status, 500);
    });

    it("cancels a chunked body as soon as it exceeds the isolation limit", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      const chunks = [
        new Uint8Array(MAX_WORKER_BODY_BYTES),
        new Uint8Array(1),
        new Uint8Array(1),
      ];
      let pulls = 0;
      let cancellations = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[pulls++];
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
        cancel() {
          cancellations++;
        },
      }, { highWaterMark: 0 });

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
        isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
      );

      assertEquals(response.status, 500);
      assertEquals((await response.json()).detail.includes("too large"), true);
      assertEquals(pulls, 2, "the reader pulled beyond limit + 1 byte");
      assertEquals(cancellations, 1, "the oversized stream was not cancelled");
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
        isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
      );

      // Error is about worker execution (module not found), not body size
      const body = await response.json();
      assert(
        !(body.detail ?? "").includes("too large"),
        "should not reject request without body",
      );
    });

    it("rejects malformed Content-Length before reading the body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const handler = {
        POST: (_req: Request) => new Response("ok"),
      };

      for (const contentLength of ["not-a-number", "1x", "-1", "+1", "1.5"]) {
        let pulls = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }, { highWaterMark: 0 });
        const request = new Request(
          "http://localhost/api/test",
          {
            method: "POST",
            body: stream,
            headers: { "content-length": contentLength },
            duplex: "half",
          } as RequestInit & { duplex: "half" },
        );

        const response = await executeAppRoute(
          handler,
          request,
          makeMatch(),
          "/api/test",
          makeAdapter(),
          isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
        );
        const body = await response.json();

        assertEquals(response.status, 500);
        assertEquals(body.detail.includes("Invalid Content-Length"), true);
        assertEquals(pulls, 0, `body was read for Content-Length ${contentLength}`);
      }
    });

    it("fails deterministically when an isolated request body is already locked", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const request = new Request(
        "http://localhost/api/test",
        {
          method: "POST",
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      );
      const lock = request.body!.getReader();

      try {
        const response = await executeAppRoute(
          { POST: () => new Response("ok") },
          request,
          makeMatch(),
          "/api/test",
          makeAdapter(),
          isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
        );

        assertEquals(response.status, 500);
        assertEquals(
          (await response.json()).detail,
          "Request body is unavailable for isolated execution",
        );
      } finally {
        await lock.cancel();
        lock.releaseLock();
      }
    });

    it("wraps isolated request-body reader failures deterministically", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const request = new Request(
        "http://localhost/api/test",
        {
          method: "POST",
          body: new ReadableStream<Uint8Array>({
            pull() {
              throw new Error("body source failed");
            },
          }),
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      );
      const response = await executeAppRoute(
        { POST: () => new Response("ok") },
        request,
        makeMatch(),
        "/api/test",
        makeAdapter(),
        isolatedTestOptions("/tmp/test/handler.ts", "/tmp/test"),
      );

      assertEquals(response.status, 500);
      assertEquals(
        (await response.json()).detail,
        "Failed to read request body for isolated execution: body source failed",
      );
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
      const source = await Deno.readTextFile(modulePath);
      const preparedModule = {
        source,
        sha256: await computeHash(source),
      };

      const response = await runWithExactSourceIntegrationPolicy(
        policy,
        () =>
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
              preparedModule,
              executionScopeId: "api:test-source-policy",
            },
          ),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.json(), policy);
    });
  });

  describe("response helpers (isolated pages execution)", () => {
    afterEach(() => {
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_API");
      __resetPoolForTests();
    });

    it("drops ctx.text bodies for null-body statuses", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_API", "1");
      __resetPoolForTests();

      const modulePath = new URL(
        "./fixtures/null-body-pages-route.ts",
        import.meta.url,
      ).pathname;
      const projectDir = new URL("../../../", import.meta.url).pathname;
      const preparedModule = await prepareHandlerModule({
        projectDir,
        modulePath,
        adapter: nodeAdapter,
      }).finally(async () => {
        const { stop } = await import("veryfront/extensions/bundler");
        await stop();
      });

      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy({ allow: {} }),
        () =>
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
              preparedModule,
              executionScopeId: "api:test-null-body-pages-route",
            },
          ),
      );

      assertEquals(response.status, 204);
      assertEquals(response.body, null);
    });

    it("uses captured response primitives after project-owned global poisoning", async () => {
      const [textResponse, jsonResponse] = await withRealWorkerRoute(
        `
          globalThis.Response = class ForgedResponse {
            constructor() {
              throw new Error("project Response constructor must not run");
            }
          };
          Set.prototype.has = function () {
            throw new Error("project Set.prototype.has must not run");
          };

          export function GET(ctx) {
            return ctx.url.searchParams.get("kind") === "json"
              ? ctx.json({ ignored: true }, { status: 304 })
              : ctx.text("ignored", { status: 204 });
          }
        `,
        async (modulePath, projectDir, options) => {
          const execute = (kind: "text" | "json") =>
            executePagesRoute(
              {},
              new Request(`http://localhost/api/no-content?kind=${kind}`, {
                method: "GET",
              }),
              makeMatch("/api/no-content", modulePath),
              "/api/no-content",
              makeAdapter("production"),
              projectDir,
              options,
            );

          return [await execute("text"), await execute("json")];
        },
      );

      assertEquals(textResponse.status, 204);
      assertEquals(textResponse.body, null);
      assertEquals(jsonResponse.status, 304);
      assertEquals(jsonResponse.body, null);
    });
  });

  describe("project env propagation (isolated execution)", () => {
    it("forwards the exact tenant env without exposing an ambient host secret", async () => {
      const tenantKey = `VERYFRONT_TEST_TENANT_${crypto.randomUUID().replaceAll("-", "_")}`;
      const hostKey = `VERYFRONT_TEST_HOST_${crypto.randomUUID().replaceAll("-", "_")}`;
      const previousHostValue = Deno.env.get(hostKey);
      Deno.env.set(hostKey, "host-only-secret");

      try {
        const response = await withRealWorkerRoute(
          `
            export function GET() {
              let hostValue = null;
              try {
                hostValue = Deno.env.get(${JSON.stringify(hostKey)}) ?? null;
              } catch {
                hostValue = null;
              }
              return Response.json({
                tenantValue: Deno.env.get(${JSON.stringify(tenantKey)}) ?? null,
                hostValue,
              });
            }
          `,
          (_modulePath, _projectDir, options) =>
            runWithProjectEnv(
              { [tenantKey]: "tenant-only-value" },
              () =>
                executeAppRoute(
                  {},
                  new Request("http://localhost/api/env", { method: "GET" }),
                  makeMatch("/api/env", options.modulePath),
                  "/api/env",
                  makeAdapter("production"),
                  options,
                ),
            ),
        );

        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
          tenantValue: "tenant-only-value",
          hostValue: null,
        });
      } finally {
        if (previousHostValue === undefined) {
          Deno.env.delete(hostKey);
        } else {
          Deno.env.set(hostKey, previousHostValue);
        }
      }
    });

    it("uses a distinct worker generation when tenant env changes for the same scope", async () => {
      const tenantKey = `VERYFRONT_TEST_GENERATION_${crypto.randomUUID().replaceAll("-", "_")}`;

      await withRealWorkerRoute(
        `
          const capturedTenantValue = Deno.env.get(${JSON.stringify(tenantKey)}) ?? null;
          export function GET() {
            return Response.json({ capturedTenantValue });
          }
        `,
        async (_modulePath, _projectDir, options) => {
          const executeWithValue = (value: string) =>
            runWithProjectEnv(
              { [tenantKey]: value },
              () =>
                executeAppRoute(
                  {},
                  new Request("http://localhost/api/env-generation", { method: "GET" }),
                  makeMatch("/api/env-generation", options.modulePath),
                  "/api/env-generation",
                  makeAdapter("production"),
                  options,
                ),
            );

          const first = await executeWithValue("tenant-a");
          const second = await executeWithValue("tenant-b");

          assertEquals(first.status, 200);
          assertEquals(await first.json(), { capturedTenantValue: "tenant-a" });
          assertEquals(second.status, 200);
          assertEquals(await second.json(), { capturedTenantValue: "tenant-b" });

          const generationPrefix = `${options.executionScopeId}:generation:`;
          const generationKeys = Object.keys(getWorkerPool().getStats().workers)
            .filter((key) => key.startsWith(generationPrefix));
          assertEquals(generationKeys.length, 2);
        },
      );
    });

    it("rejects accessor and oversized tenant env before worker admission", async () => {
      await withRealWorkerRoute(
        `export function GET() { return new Response("unreachable"); }`,
        async (_modulePath, _projectDir, options) => {
          const accessorEnv = Object.create(null) as Record<string, string>;
          let getterCalls = 0;
          let routeCalls = 0;
          Object.defineProperty(accessorEnv, "SECRET", {
            enumerable: true,
            get() {
              getterCalls += 1;
              throw new Error("tenant getter must not run");
            },
          });

          assertThrows(
            () =>
              runWithProjectEnv(accessorEnv, () => {
                routeCalls += 1;
                return executeAppRoute(
                  {},
                  new Request("http://localhost/api/env-invalid", { method: "GET" }),
                  makeMatch("/api/env-invalid", options.modulePath),
                  "/api/env-invalid",
                  makeAdapter("production"),
                  options,
                );
              }),
            TypeError,
            "accessor properties are not allowed",
          );
          assertEquals(getterCalls, 0);
          assertEquals(routeCalls, 0);
          assertEquals(getWorkerPool().getStats().poolSize, 0);

          assertThrows(
            () =>
              runWithProjectEnv(
                { TOO_LARGE: "x".repeat(1024 * 1024 + 1) },
                () => {
                  routeCalls += 1;
                  return executeAppRoute(
                    {},
                    new Request("http://localhost/api/env-oversized", { method: "GET" }),
                    makeMatch("/api/env-oversized", options.modulePath),
                    "/api/env-oversized",
                    makeAdapter("production"),
                    options,
                  );
                },
              ),
            TypeError,
            "value length exceeds",
          );
          assertEquals(routeCalls, 0);
          assertEquals(getWorkerPool().getStats().poolSize, 0);
        },
      );
    });
  });

  describe("real-worker route parity and error boundaries", () => {
    it("does not expose rejected module paths or execution scopes to hosted callers", async () => {
      const modulePath = "/private/host/secret-route.ts";
      const executionScopeId = "api:secret-host-scope";
      const response = await runWithExactSourceIntegrationPolicy(
        normalizeSourceIntegrationPolicy(undefined),
        () =>
          executePreparedAppRoute(
            new Request("https://project.example/api/failure"),
            makeMatch("/api/failure", modulePath),
            "/api/failure",
            {
              module: TEST_ISOLATED_MODULE,
              modulePath,
              projectDir: "/safe/project",
              executionScopeId,
              isLocalProject: false,
            },
          ),
      );

      const body = await response.text();
      assertEquals(body.includes(modulePath), false);
      assertEquals(body.includes(executionScopeId), false);
      assertEquals(body.includes("/private/host"), false);
    });

    it("uses an explicit App HEAD export and strips its body", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return new Response("get body", {
              status: 201,
              headers: { "x-selected-handler": "get" },
            });
          }
          export default function () {
            return new Response("default body", {
              status: 203,
              headers: { "x-selected-handler": "default" },
            });
          }
          export function HEAD() {
            return new Response(new ReadableStream({
              pull() {
                throw new Error("HEAD body must never be consumed");
              },
            }), {
              status: 202,
              statusText: "Explicit Head",
              headers: { "x-selected-handler": "head" },
            });
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/head", { method: "HEAD" }),
            makeMatch("/api/head", modulePath),
            "/api/head",
            makeAdapter("production"),
            { ...options, isLocalProject: false },
          ),
      );

      assertEquals(response.status, 202);
      assertEquals(response.statusText, "Explicit Head");
      assertEquals(response.headers.get("x-selected-handler"), "head");
      assertEquals(await response.text(), "");
    });

    it("falls back from App HEAD to GET and strips its body", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return new Response(new ReadableStream({
              pull() {
                throw new Error("App GET body must never be consumed for HEAD");
              },
            }), {
              status: 201,
              statusText: "App Get",
              headers: { "x-selected-handler": "get" },
            });
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/head", { method: "HEAD" }),
            makeMatch("/api/head", modulePath),
            "/api/head",
            makeAdapter("production"),
            { ...options, isLocalProject: false },
          ),
      );

      assertEquals(response.status, 201);
      assertEquals(response.statusText, "App Get");
      assertEquals(response.headers.get("x-selected-handler"), "get");
      assertEquals(await response.text(), "");
    });

    it("prefers an App default export over GET for HEAD without consuming its body", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return new Response("get body", {
              status: 201,
              headers: { "x-selected-handler": "get" },
            });
          }
          export default function () {
            return new Response(new ReadableStream({
              pull() {
                throw new Error("App default body must never be consumed for HEAD");
              },
            }), {
              status: 202,
              statusText: "App Default",
              headers: { "x-selected-handler": "default" },
            });
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/head", { method: "HEAD" }),
            makeMatch("/api/head", modulePath),
            "/api/head",
            makeAdapter("production"),
            { ...options, isLocalProject: false },
          ),
      );

      assertEquals(response.status, 202);
      assertEquals(response.statusText, "App Default");
      assertEquals(response.headers.get("x-selected-handler"), "default");
      assertEquals(await response.text(), "");
    });

    it("uses an explicit Pages HEAD export before default and GET", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return new Response("get body", {
              status: 201,
              headers: { "x-selected-handler": "get" },
            });
          }
          export default function () {
            return new Response("default body", {
              status: 202,
              headers: { "x-selected-handler": "default" },
            });
          }
          export function HEAD() {
            return new Response(new ReadableStream({
              pull() {
                throw new Error("Pages HEAD body must never be consumed");
              },
            }), {
              status: 203,
              statusText: "Pages Head",
              headers: { "x-selected-handler": "head" },
            });
          }
        `,
        (modulePath, projectDir, options) =>
          executePagesRoute(
            {},
            new Request("http://localhost/api/head", { method: "HEAD" }),
            makeMatch("/api/head", modulePath),
            "/api/head",
            makeAdapter("production"),
            projectDir,
            { ...options, isLocalProject: false },
          ),
      );

      assertEquals(response.status, 203);
      assertEquals(response.statusText, "Pages Head");
      assertEquals(response.headers.get("x-selected-handler"), "head");
      assertEquals(await response.text(), "");
    });

    it("falls back from Pages HEAD to GET and strips its body", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return new Response(new ReadableStream({
              pull() {
                throw new Error("Pages GET body must never be consumed for HEAD");
              },
            }), {
              status: 203,
              statusText: "Pages Get",
              headers: { "x-selected-handler": "get" },
            });
          }
        `,
        (modulePath, projectDir, options) =>
          executePagesRoute(
            {},
            new Request("http://localhost/api/head", { method: "HEAD" }),
            makeMatch("/api/head", modulePath),
            "/api/head",
            makeAdapter("production"),
            projectDir,
            { ...options, isLocalProject: false },
          ),
      );

      assertEquals(response.status, 203);
      assertEquals(response.statusText, "Pages Get");
      assertEquals(response.headers.get("x-selected-handler"), "get");
      assertEquals(await response.text(), "");
    });

    it("prefers a Pages default export over GET for HEAD without consuming its body", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return new Response("get body", {
              status: 201,
              headers: { "x-selected-handler": "get" },
            });
          }
          export default function () {
            return new Response(new ReadableStream({
              pull() {
                throw new Error("Pages default body must never be consumed for HEAD");
              },
            }), {
              status: 202,
              statusText: "Pages Default",
              headers: { "x-selected-handler": "default" },
            });
          }
        `,
        (modulePath, projectDir, options) =>
          executePagesRoute(
            {},
            new Request("http://localhost/api/head", { method: "HEAD" }),
            makeMatch("/api/head", modulePath),
            "/api/head",
            makeAdapter("production"),
            projectDir,
            { ...options, isLocalProject: false },
          ),
      );

      assertEquals(response.status, 202);
      assertEquals(response.statusText, "Pages Default");
      assertEquals(response.headers.get("x-selected-handler"), "default");
      assertEquals(await response.text(), "");
    });

    it("rejects a plain Response lookalike exactly as the in-process path does", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return {
              status: 201,
              statusText: "Plain Object",
              headers: new Headers({ "x-lookalike": "accepted" }),
              body: null,
            };
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/lookalike", { method: "GET" }),
            makeMatch("/api/lookalike", modulePath),
            "/api/lookalike",
            makeAdapter("production"),
            options,
          ),
      );

      assertEquals(response.status, 500);
      assertEquals(response.headers.get("x-lookalike"), null);
      assertEquals(
        (await response.json()).detail,
        "API handler must return a Response",
      );
    });

    it("serializes native worker Response slots after project-owned poisoning", async () => {
      const response = await withRealWorkerRoute(
        `
          const NativeResponse = Response;

          export function GET() {
            const response = new NativeResponse("trusted-worker-body", {
              status: 207,
              statusText: "Multi-Status",
              headers: { "x-worker-native": "yes" },
            });
            Object.defineProperties(response, {
              status: {
                configurable: true,
                get() {
                  throw new Error("project status getter must not run");
                },
              },
              headers: {
                configurable: true,
                get() {
                  throw new Error("project headers getter must not run");
                },
              },
              body: {
                configurable: true,
                get() {
                  throw new Error("project body getter must not run");
                },
              },
              arrayBuffer: {
                configurable: true,
                value() {
                  throw new Error("project arrayBuffer must not run");
                },
              },
            });
            globalThis.Response = class ForgedResponse {
              constructor() {
                throw new Error("forged Response constructor must not run");
              }
            };
            globalThis.Headers = class ForgedHeaders {
              constructor() {
                throw new Error("forged Headers constructor must not run");
              }
            };
            return response;
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/native-slots", { method: "GET" }),
            makeMatch("/api/native-slots", modulePath),
            "/api/native-slots",
            makeAdapter("production"),
            options,
          ),
      );

      assertEquals(response.status, 207);
      assertEquals(response.statusText, "Multi-Status");
      assertEquals(response.headers.get("x-worker-native"), "yes");
      assertEquals(await response.text(), "trusted-worker-body");
    });

    it("rejects Response.error across worker transfer", async () => {
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            return Response.error();
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/native-error", { method: "GET" }),
            makeMatch("/api/native-error", modulePath),
            "/api/native-error",
            makeAdapter("production"),
            options,
          ),
      );

      assertEquals(response.status, 500);
    });

    it("redacts registered worker 5xx diagnostics for a hosted request even in host dev mode", async () => {
      const response = await withRealWorkerRoute(
        `
          import { API_ROUTE_ERROR } from "#veryfront/errors";
          export function GET() {
            throw API_ROUTE_ERROR.create({
              message: "worker-private-message",
              detail: "worker-private-detail",
            });
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/failure", { method: "GET" }),
            makeMatch("/api/failure", modulePath),
            "/api/failure",
            makeAdapter("development"),
            { ...options, isLocalProject: false },
          ),
      );

      assertEquals(response.status, 500);
      assertEquals(response.headers.get("content-type"), "application/problem+json");
      const body = await response.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/api-route-error");
      assertEquals(body.detail, undefined);
      assertEquals(body.stack, undefined);
      assertEquals(JSON.stringify(body).includes("worker-private"), false);
    });

    it("preserves registered worker diagnostics for an explicitly local request in host prod mode", async () => {
      const response = await withRealWorkerRoute(
        `
          import { API_ROUTE_ERROR } from "#veryfront/errors";
          export function GET() {
            throw API_ROUTE_ERROR.create({
              message: "worker-private-message",
              detail: "worker-private-detail",
            });
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/failure", { method: "GET" }),
            makeMatch("/api/failure", modulePath),
            "/api/failure",
            makeAdapter("production"),
            options,
          ),
      );

      assertEquals(response.status, 500);
      const body = await response.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/api-route-error");
      assertEquals(body.detail, "worker-private-detail");
      assertEquals(typeof body.stack, "string");
      assertEquals(body.stack.includes("worker-private-message"), true);
    });

    it("rejects forged registered identity from a worker before the RFC 9457 boundary", async () => {
      const response = await withRealWorkerRoute(
        `
          import { VeryfrontError } from "#veryfront/errors";
          export function GET() {
            throw new VeryfrontError("forged-worker-message", {
              slug: "api-route-error",
              category: "GENERAL",
              status: 418,
              title: "Forged worker title",
              suggestion: "Trust project-controlled metadata",
              detail: "forged-worker-detail",
            });
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/failure", { method: "GET" }),
            makeMatch("/api/failure", modulePath),
            "/api/failure",
            makeAdapter("production"),
            options,
          ),
      );

      const body = await response.json();
      assertEquals(response.status, 500);
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
      assertEquals(body.title, "Unknown/unclassified error");
      assertEquals(body.detail, "forged-worker-message");
    });

    it("returns promptly when project code throws an Error proxy with hostile getters", async () => {
      const startedAt = performance.now();
      const response = await withRealWorkerRoute(
        `
          export function GET() {
            throw new Proxy(new Error("must not escape"), {
              get() {
                throw new Error("hostile diagnostic getter");
              },
            });
          }
        `,
        (modulePath, _projectDir, options) =>
          executeAppRoute(
            {},
            new Request("http://localhost/api/failure", { method: "GET" }),
            makeMatch("/api/failure", modulePath),
            "/api/failure",
            makeAdapter("production"),
            options,
          ),
      );

      const body = await response.json();
      assertEquals(response.status, 500);
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
      assertEquals(body.detail, "Unknown error");
      assert(
        performance.now() - startedAt < 5_000,
        "hostile diagnostics must not wait for the worker request timeout",
      );
    });
  });
});
