import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAdapter as createSourceAdapter } from "#veryfront/platform/adapters/fs/veryfront/adapter.test-helpers.ts";
import { buildFileListCacheKey } from "#veryfront/platform/adapters/fs/veryfront/cache-keys.ts";
import { createMockAdapter as createRouteMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createMockSSRService } from "#veryfront/server/handlers/request/ssr/ssr.handler.test-helpers.ts";
import { SSRHandler } from "#veryfront/server/handlers/request/ssr/index.ts";
import { seedPreviewDocumentSourceSnapshot } from "#veryfront/server/handlers/request/source-snapshot-freshness.ts";
import { createVeryfrontHandler } from "#veryfront/server/runtime-handler/index.ts";
import type { MiddlewareFunction } from "#veryfront/server/dev-server/middleware.ts";

describe("cold preview source recovery over HTTP", () => {
  for (
    const scenario of [
      { method: "GET", pokes: 2, middleware: false, status: 200, renders: 3 },
      { method: "HEAD", pokes: 2, middleware: false, status: 200, renders: 3 },
      {
        method: "GET",
        pokes: Number.POSITIVE_INFINITY,
        middleware: false,
        status: 503,
        renders: 3,
      },
      { method: "GET", pokes: 2, middleware: true, status: 503, renders: 1 },
    ]
  ) {
    it(`bounds post-render replay for ${scenario.method}, ${scenario.pokes} unchanged pokes, middleware=${scenario.middleware}`, async () => {
      const sourceAdapter = createSourceAdapter();
      const context = {
        sourceType: "branch",
        projectSlug: "test-project",
        branch: "main",
      } satisfies Parameters<typeof sourceAdapter.setContentContext>[0];
      const files = [{ path: "pages/index.tsx", content: "export default () => null;" }];
      // Exercise the same accepted-poke callbacks used by adapter.test.ts.
      const source = sourceAdapter as unknown as {
        sourceSnapshotFiles: typeof files | undefined;
        sourceSnapshotIdentity: string | undefined;
        wsManager: {
          deps: {
            clearMemoryCaches(): void;
            replaceSourceSnapshot(
              key: string,
              replacementFiles: typeof files,
            ): Promise<number | undefined>;
          };
        };
      };
      sourceAdapter.setContentContext(context);
      source.sourceSnapshotFiles = files;
      source.sourceSnapshotIdentity = sourceAdapter.getSourceSnapshotIdentity();
      const fingerprint = await sourceAdapter.getSourceSnapshotFingerprint();
      assertEquals(typeof fingerprint, "string");
      const originalHandle = SSRHandler.prototype.handle;
      const adapter = createRouteMockAdapter();
      Object.assign(adapter.fs, {
        sourceSnapshotFreshnessOptionsVersion: 1,
        ensureSourceSnapshotFresh: () => Promise.resolve(),
        getSourceSnapshotIdentity: () => "branch:post-render-replay:main",
        getSourceSnapshotVersion: () => sourceAdapter.getSourceSnapshotVersion(),
      });
      let renders = 0;
      let middlewareCalls = 0;
      SSRHandler.prototype.handle = function (request, ctx) {
        seedPreviewDocumentSourceSnapshot(ctx, {
          identity: "branch:post-render-replay:main",
          version: sourceAdapter.getSourceSnapshotVersion(),
        });
        const renderer = new SSRHandler(createMockSSRService({
          renderPage: async () => {
            renders++;
            if (renders <= scenario.pokes) {
              source.wsManager.deps.clearMemoryCaches();
              const published = await source.wsManager.deps.replaceSourceSnapshot(
                buildFileListCacheKey(context),
                files,
              );
              assertEquals(typeof published, "number");
              assertEquals(await sourceAdapter.getSourceSnapshotFingerprint(), fingerprint);
            }
            return {
              status: 200,
              html: "<html>saved project</html>",
              isStreaming: false,
              cacheStrategy: "short",
              slug: "dashboard",
            };
          },
        }));
        return originalHandle.call(renderer, request, ctx);
      };
      let server: Deno.HttpServer<Deno.NetAddr> | undefined;
      try {
        const middleware: MiddlewareFunction = async (_context, next) => {
          middlewareCalls++;
          return await next();
        };
        const handler = createVeryfrontHandler("/tmp/post-render-replay", adapter, {
          projectDir: "/tmp/post-render-replay",
          defaultProjectSlug: "post-render-replay",
          config: { ...(scenario.middleware ? { middleware: { custom: [middleware] } } : {}) },
          allowHostProjectCodeExecution: true,
        });
        // HEAD assertions use the actual HTTP transport, which suppresses its body.
        server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
        const response = await fetch(`http://127.0.0.1:${server.addr.port}/dashboard`, {
          method: scenario.method,
        });
        const body = await response.text();
        assertEquals(response.status, scenario.status, body);
        assertEquals(renders, scenario.renders);
        assertEquals(middlewareCalls, scenario.middleware ? 1 : 0);
        if (scenario.method === "HEAD") assertEquals(body, "");
        else if (response.ok) assertEquals(body, "<html>saved project</html>");
      } finally {
        if (server) await server.shutdown();
        SSRHandler.prototype.handle = originalHandle;
        sourceAdapter.dispose();
      }
    });
  }
});
