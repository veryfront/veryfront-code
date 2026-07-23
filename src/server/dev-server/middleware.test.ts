import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FS_ADAPTER_KIND } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { RuntimeMiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { serverLogger } from "#veryfront/utils";
import { dirname, fromFileUrl } from "#veryfront/compat/path/index.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import {
  loadMiddlewareFile,
  MAX_MIDDLEWARE_FUNCTIONS,
  MAX_MIDDLEWARE_SOURCE_BYTES,
  setupMiddleware,
} from "./middleware.ts";

function createVirtualAdapter(source: string | Record<string, string>): RuntimeAdapter {
  const sources = typeof source === "string" ? { "middleware.ts": source } : source;
  const fs = {
    [FS_ADAPTER_KIND]: "veryfront-multi-project",
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    exists: (path: string) =>
      Promise.resolve(Object.keys(sources).some((file) => path.endsWith(`/${file}`))),
    readFile: (path: string) => {
      const file = Object.keys(sources).find((candidate) => path.endsWith(`/${candidate}`));
      if (!file) return Promise.reject(new Error("missing test middleware"));
      return Promise.resolve(sources[file]!);
    },
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
  afterEach(() => {
    __resetLogRecordEmitterForTests();
  });

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

  it("does not run a lower-priority middleware file after the selected file fails", async () => {
    const canary = `__vf_middleware_fallback_${crypto.randomUUID().replaceAll("-", "_")}`;
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const adapter = createVirtualAdapter({
      "middleware.ts": "export default function broken( {",
      "middleware.js": `globalThis.${canary} = true; export default () => new Response("unsafe");`,
    });

    try {
      assertEquals(await loadMiddlewareFile("/app", adapter), []);
      assertEquals(globalRecord[canary], undefined);
    } finally {
      delete globalRecord[canary];
    }
  });

  it("does not partially install an invalid development middleware array", async () => {
    const adapter = createVirtualAdapter(
      "export default [() => new Response('partial'), 'invalid'];",
    );

    assertEquals(await loadMiddlewareFile("/app", adapter), []);
  });

  it("rejects middleware source above the compilation byte limit", async () => {
    const adapter = createVirtualAdapter("x".repeat(MAX_MIDDLEWARE_SOURCE_BYTES + 1));

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      Error,
      "size limit",
    );
  });

  it("bounds direct-host middleware files before importing them", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-middleware-size-" });
    try {
      await Deno.writeTextFile(
        `${projectDir}/middleware.js`,
        "x".repeat(MAX_MIDDLEWARE_SOURCE_BYTES + 1),
      );

      await assertRejects(
        () => loadMiddlewareFile(projectDir, new DenoAdapter(), { throwOnError: true }),
        Error,
        "size limit",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("loads direct-host middleware from paths with URL-significant characters", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf middleware # " });
    try {
      await Deno.writeTextFile(
        `${projectDir}/middleware.js`,
        "export default () => new Response('direct');",
      );
      const [middleware] = await loadMiddlewareFile(
        projectDir,
        new DenoAdapter(),
        { throwOnError: true },
      );
      assert(middleware);

      const response = await middleware({} as never, () => new Response("next"));
      assert(response instanceof Response);
      assertEquals(await response.text(), "direct");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects direct-host middleware symlinks that leave the project", async () => {
    const tempRoot = await Deno.makeTempDir({ prefix: "vf-middleware-path-" });
    const projectDir = `${tempRoot}/project`;
    const outsideFile = `${tempRoot}/outside.js`;
    const canary = `__vf_middleware_symlink_${crypto.randomUUID().replaceAll("-", "_")}`;
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    try {
      await Deno.mkdir(projectDir);
      await Deno.writeTextFile(
        outsideFile,
        `globalThis.${canary} = true; export default () => new Response('unsafe');`,
      );
      await Deno.symlink(outsideFile, `${projectDir}/middleware.js`);

      await assertRejects(
        () => loadMiddlewareFile(projectDir, new DenoAdapter(), { throwOnError: true }),
        Error,
        "outside the project",
      );
      assertEquals(globalRecord[canary], undefined);
    } finally {
      delete globalRecord[canary];
      await Deno.remove(tempRoot, { recursive: true });
    }
  });

  it("fails closed and sanitizes logs when middleware discovery fails", async () => {
    const canary = "PRIVATE_MIDDLEWARE_DISCOVERY_ERROR";
    const adapter = createVirtualAdapter("");
    adapter.fs.exists = () => {
      const error = new Error("private failure");
      error.name = canary;
      return Promise.reject(error);
    };
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    await assertRejects(() => loadMiddlewareFile("/app", adapter), Error);
    assertEquals(JSON.stringify(entries).includes(canary), false);
  });

  it("rejects middleware exports above the function-count limit", async () => {
    const handlers = Array.from(
      { length: MAX_MIDDLEWARE_FUNCTIONS + 1 },
      () => "() => new Response('ok')",
    ).join(",");
    const adapter = createVirtualAdapter(`export default [${handlers}];`);

    await assertRejects(
      () => loadMiddlewareFile("/app", adapter, { throwOnError: true }),
      TypeError,
      "too many functions",
    );
  });

  it("removes virtual middleware temporary files after module evaluation", async () => {
    const adapter = createVirtualAdapter(
      "export default () => new Response(import.meta.url);",
    );
    const [middleware] = await loadMiddlewareFile("/app", adapter, { throwOnError: true });
    assert(middleware);

    const response = await middleware({} as never, () => new Response("next"));
    assert(response instanceof Response);
    const tempFile = fromFileUrl(await response.text());

    await assertRejects(() => Deno.stat(tempFile), Deno.errors.NotFound);
    await assertRejects(() => Deno.stat(dirname(tempFile)), Deno.errors.NotFound);
  });

  it("omits request query data from development logs", async () => {
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const pipeline = new RuntimeMiddlewarePipeline();
    await setupMiddleware(
      pipeline,
      {} as never,
      () => {
        serverLogger.info("development request log probe");
        return new Response("ok");
      },
    );

    await pipeline.execute(
      new Request("http://localhost/page?customer_note=private-value"),
    );

    const requestUrls = entries
      .map((entry) => entry.request_url)
      .filter((value): value is string => typeof value === "string");
    assertEquals(requestUrls.length > 0, true);
    assertEquals(requestUrls.some((value) => value.includes("customer_note")), false);
    assertEquals(requestUrls.some((value) => value.includes("private-value")), false);
  });

  it("does not propagate raw request routing identities into development logs", async () => {
    const canaries = [
      "PRIVATE_HOST",
      "PRIVATE_PATH",
      "PRIVATE_PROJECT_SLUG",
      "PRIVATE_PROJECT_ID",
      "PRIVATE_RELEASE_ID",
      "PRIVATE_BRANCH_ID",
      "PRIVATE_BRANCH_NAME",
    ] as const;
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const pipeline = new RuntimeMiddlewarePipeline();
    await setupMiddleware(pipeline, {} as never, () => {
      serverLogger.info("privacy probe");
      return new Response("ok");
    });

    await pipeline.execute(
      new Request(`http://localhost/${canaries[1]}`, {
        headers: {
          host: `${canaries[0]}.example`,
          "x-project-slug": canaries[2],
          "x-project-id": canaries[3],
          "x-release-id": canaries[4],
          "x-branch-id": canaries[5],
          "x-branch-name": canaries[6],
        },
      }),
    );

    const middlewareEntries = entries.filter((entry) => entry.component === "middleware");
    assert(middlewareEntries.length > 0);
    const serialized = JSON.stringify(middlewareEntries);
    for (const canary of canaries) assertEquals(serialized.includes(canary), false);
  });

  it("bounds untrusted request IDs before logging and response propagation", async () => {
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const pipeline = new RuntimeMiddlewarePipeline();
    await setupMiddleware(pipeline, {} as never, () => new Response("ok"));
    const invalidRequestId = "x".repeat(129);

    const response = await pipeline.execute(
      new Request("http://localhost/", {
        headers: { "x-request-id": invalidRequestId },
      }),
    );
    const requestId = response.headers.get("x-request-id") ?? "";

    assertMatch(
      requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assertEquals(JSON.stringify(entries).includes(invalidRequestId), false);
  });

  it("adds the request ID without replacing immutable redirect responses with an error", async () => {
    const pipeline = new RuntimeMiddlewarePipeline();
    await setupMiddleware(
      pipeline,
      {} as never,
      () => Response.redirect("https://example.com/next", 302),
    );

    const response = await pipeline.execute(
      new Request("http://localhost/", { headers: { "x-request-id": "request-123" } }),
    );

    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "https://example.com/next");
    assertEquals(response.headers.get("x-request-id"), "request-123");
  });
});
