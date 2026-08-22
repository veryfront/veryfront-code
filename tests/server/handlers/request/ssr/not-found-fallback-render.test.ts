/**
 * Reserved not-found renders that compile a project component for real.
 *
 * These live in the integration suite rather than beside the unit tests for
 * `tryNotFoundFallback` because compiling the component pulls React and React
 * DOM from esm.sh at run time. The unit suite runs with network permission
 * narrowed to loopback, so a test that reaches a CDN belongs here, where the
 * dependency is visible instead of hidden behind a passing unit run.
 *
 * Everything about `tryNotFoundFallback` that can be settled without egress
 * (directory probing, ancestor search, the injected loader seam, the text
 * extraction fallback) stays in `src/server/handlers/request/ssr/`.
 */
import "#veryfront/schemas/_test-setup.ts";
import "../../../../../src/transforms/plugins/__tests__/code-parser-setup.ts";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { tryNotFoundFallback } from "../../../../../src/server/handlers/request/ssr/not-found-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../../../../src/server/handlers/types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { cleanupBundler } from "../../../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../../../_helpers/context.ts";
import { resetReactCache } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";

function makeCtx(
  adapter: RuntimeAdapter,
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter,
    securityConfig: null,
    ...overrides,
  };
}

describe(
  "tests/server/handlers/request/ssr/not-found-fallback render",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    afterEach(() => {
      resetReactCache();
    });

    it("renders the nearest ancestor app not-found component", async () => {
      const adapter = await getAdapter();

      await withTestContext("not-found-fallback-success", async (context) => {
        const segDir = join(context.projectDir, "app", "a", "b");
        await mkdir(segDir, { recursive: true });
        await writeTextFile(
          join(context.projectDir, "app", "not-found.tsx"),
          `export default function RootNotFound(){ return <p>Root Missing</p>; }`,
        );
        await writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p>Missing B</p>; }`,
        );

        const ctx = makeCtx(adapter, {
          projectDir: context.projectDir,
          isLocalProject: true,
        });
        const req = new Request("http://localhost/a/b/missing");
        const builder = new ResponseBuilder();

        const result = await tryNotFoundFallback(req, "a/b/missing", ctx, builder);
        assertExists(result);
        assertEquals(result.status, 404);
        const html = await result.text();
        assertStringIncludes(html, "Missing B");
        assertStringIncludes(html, 'data-node-file="app/a/b/not-found.tsx"');
        assertEquals(html.includes("Root Missing"), false);
      });
    });

    it("renders the reserved not-found component without instrumentation in hosted production", async () => {
      const adapter = await getAdapter();

      await withTestContext("not-found-fallback-hosted", async (context) => {
        const segDir = join(context.projectDir, "app", "a", "b");
        await mkdir(segDir, { recursive: true });
        await writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p id="hosted-not-found">Missing Hosted</p>; }`,
        );

        const ctx = makeCtx(adapter, {
          projectDir: context.projectDir,
          isLocalProject: false,
          resolvedEnvironment: "production",
          // Hosted production is release-addressed: computeContentSourceId
          // refuses a production content source without one.
          releaseId: "release-not-found-1",
        });
        const req = new Request("http://localhost/a/b/missing");
        const builder = new ResponseBuilder();

        const result = await tryNotFoundFallback(req, "a/b/missing", ctx, builder);
        assertExists(result);
        assertEquals(result.status, 404);
        const html = await result.text();
        // The id attribute only survives a real SSR render: the
        // extractNotFoundText fallback rebuilds the text as a bare <p>, so
        // this pins the assertion below to the render path.
        assertStringIncludes(html, '<p id="hosted-not-found">Missing Hosted</p>');
        assertEquals(html.includes("data-node-file"), false);
      });
    });

    it("keeps node positions on the reserved not-found component in hosted preview", async () => {
      const adapter = await getAdapter();

      await withTestContext("not-found-fallback-hosted-preview", async (context) => {
        const segDir = join(context.projectDir, "app", "a", "b");
        await mkdir(segDir, { recursive: true });
        await writeTextFile(
          join(segDir, "not-found.tsx"),
          `export default function NotFound(){ return <p id="preview-not-found">Missing Preview</p>; }`,
        );

        // Hosted preview compiles as production. Only the request
        // environment separates it from the case above.
        const ctx = makeCtx(adapter, {
          projectDir: context.projectDir,
          isLocalProject: false,
          resolvedEnvironment: "preview",
        });
        const req = new Request("http://localhost/a/b/missing");
        const builder = new ResponseBuilder();

        const result = await tryNotFoundFallback(req, "a/b/missing", ctx, builder);
        assertExists(result);
        assertEquals(result.status, 404);
        const html = await result.text();
        assertStringIncludes(html, "Missing Preview");
        assertStringIncludes(html, 'data-node-file="app/a/b/not-found.tsx"');
      });
    });
  },
);
