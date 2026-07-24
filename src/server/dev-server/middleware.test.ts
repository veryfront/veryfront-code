import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { MiddlewarePipeline } from "#veryfront/middleware/core/index.ts";
import { loadMiddlewareFile, setupMiddleware } from "./middleware.ts";

function createVirtualAdapter(source: string): RuntimeAdapter {
  const fs = {
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    exists: (path: string) => Promise.resolve(path.endsWith("/middleware.ts")),
    readFile: () => Promise.resolve(source),
  } as unknown as RuntimeAdapter["fs"];

  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs,
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

describe("loadMiddlewareFile", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("fails closed for invalid production middleware", async () => {
    const adapter = createVirtualAdapter("export default function broken( {");

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      Error,
    );
  });

  it("fails closed when production middleware has no valid default export", async () => {
    const adapter = createVirtualAdapter("export const middleware = () => new Response('ok');");

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
      "Invalid middleware export",
    );
  });

  it("fails closed when a production middleware array contains invalid entries", async () => {
    const adapter = createVirtualAdapter(
      "export default [() => new Response('ok'), 'invalid'];",
    );

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
      "Invalid middleware export",
    );
  });

  it("preserves nonfatal development loading for invalid middleware", async () => {
    const adapter = createVirtualAdapter("export default function broken( {");

    assertEquals(await loadMiddlewareFile("/app", adapter), []);
  });
});

describe("dev-server/middleware: actionable rejection", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("names the Next.js convention when a named middleware export is found", async () => {
    // A root middleware.ts written for Next.js takes down every route, so the
    // error has to be enough to fix the file without reading framework source.
    const adapter = createVirtualAdapter(
      "export function middleware(request) { return new Response('ok'); }",
    );

    const error = await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
    );

    // assertRejects hands back an unknown; narrow it before reading the copy.
    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "middleware.ts");
    assertStringIncludes(error.message, "Next.js convention");
    assertStringIncludes(error.message, "(c, next)");
    assertStringIncludes(error.message, "export default");
    assertStringIncludes(error.message, "docs/guides/middleware.md");
  });

  it("lists the offending exports when the shape is merely wrong", async () => {
    const adapter = createVirtualAdapter("export const handler = 1; export const other = 2;");

    const error = await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "Found export(s):");
    assertStringIncludes(error.message, "handler");
    assertStringIncludes(error.message, "other");
  });

  it("describes a default export array with a non-function entry", async () => {
    // Every wrong shape with a default export used to collapse to the useless
    // "Found export(s): default." because the message read the namespace keys,
    // not the resolved default.
    const adapter = createVirtualAdapter(
      "export default [async (c, next) => await next(), 'audit'];",
    );

    const error = await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "non-function at index 1");
    assertStringIncludes(error.message, "(string)");
  });

  it("describes an empty default export array", async () => {
    const adapter = createVirtualAdapter("export default [];");

    const error = await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "empty default export array");
  });

  it("describes a default export object that is not middleware", async () => {
    const adapter = createVirtualAdapter(
      "export default { handler: async (c, next) => await next() };",
    );

    const error = await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
    );

    assertInstanceOf(error, TypeError);
    assertStringIncludes(error.message, "default export of type object");
    assertStringIncludes(error.message, "handler");
  });

  it("still accepts a valid default export", async () => {
    const adapter = createVirtualAdapter(
      "export default async function (c, next) { return await next(); }",
    );

    const middleware = await loadMiddlewareFile("/app", adapter, { throwOnError: true });
    assertEquals(middleware.length, 1);
  });

  it("still accepts an array of functions", async () => {
    const adapter = createVirtualAdapter(
      "export default [async (c, next) => await next(), async (c, next) => await next()];",
    );

    const middleware = await loadMiddlewareFile("/app", adapter, { throwOnError: true });
    assertEquals(middleware.length, 2);
  });
});

describe("dev-server/middleware: runtime-owned CORS", () => {
  it("does not apply bootstrap CORS to an application response", async () => {
    let validatorCalls = 0;
    const downstreamResponse = new Response("tenant response", {
      status: 201,
      headers: {
        "access-control-allow-origin": "https://tenant.example",
        "access-control-allow-credentials": "true",
      },
    });
    const pipeline = new MiddlewarePipeline();
    await setupMiddleware(
      pipeline,
      {
        security: {
          cors: {
            origin: () => {
              validatorCalls++;
              return false;
            },
          },
        },
      },
      () => Promise.resolve(downstreamResponse),
    );

    const response = await pipeline.execute(
      new Request("http://localhost/api/test", {
        headers: { origin: "https://app.example.com" },
      }),
    );

    assertEquals(response === downstreamResponse, true);
    assertEquals(response.status, 201);
    assertEquals(await response.text(), "tenant response");
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://tenant.example",
    );
    assertEquals(response.headers.get("access-control-allow-credentials"), "true");
    assertEquals(validatorCalls, 0);
  });

  it("passes application preflights through without altering runtime headers", async () => {
    let downstreamCalls = 0;
    const downstreamResponse = new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "https://tenant.example",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "content-security-policy": "default-src 'self'",
      },
    });
    const pipeline = new MiddlewarePipeline();
    await setupMiddleware(
      pipeline,
      {
        security: {
          cors: {
            origin: "https://bootstrap.example",
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
          },
        },
      },
      () => {
        downstreamCalls++;
        return Promise.resolve(downstreamResponse);
      },
    );

    const response = await pipeline.execute(
      new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://tenant.example",
          "access-control-request-method": "GET",
        },
      }),
    );

    assertEquals(response === downstreamResponse, true);
    assertEquals(response.status, 204);
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://tenant.example",
    );
    assertEquals(
      response.headers.get("access-control-allow-methods"),
      "GET, HEAD, OPTIONS",
    );
    assertEquals(
      response.headers.get("content-security-policy"),
      "default-src 'self'",
    );
    assertEquals(downstreamCalls, 1);
  });
});
