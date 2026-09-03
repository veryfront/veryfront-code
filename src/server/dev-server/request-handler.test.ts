import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  __destroyRSCHandlerForTests,
  __injectCacheForTests,
  getRSCHandler,
  type HandlerCache,
} from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";
import type { RSCDevServerHandler } from "#veryfront/server/services/rsc/orchestrators/index.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  extractProjectCandidates,
  invalidateProjectCandidateScans,
} from "../handlers/dev/styles-candidate-scanner.ts";
import {
  extractProjectCssImports,
  invalidateProjectCssImportScans,
} from "../handlers/dev/styles-css-import-scanner.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { RequestHandler } from "./request-handler.ts";

function createHandlerCache(): HandlerCache<RSCDevServerHandler> {
  const entries = new Map<string, RSCDevServerHandler>();
  return {
    get: (key) => entries.get(key),
    set: (key, value) => entries.set(key, value),
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

describe("server/dev-server/request-handler", () => {
  afterEach(() => __destroyRSCHandlerForTests());

  it("invalidates the project RSC handler during file-change invalidation", () => {
    __injectCacheForTests(createHandlerCache());
    const handlerOptions = {
      mode: "development" as const,
      config: { react: { version: "19.1.1" } },
    };
    const before = getRSCHandler("/project/a", "project-a", handlerOptions);
    const requestHandler = new RequestHandler(
      "/project/a",
      {} as RuntimeAdapter,
      () => true,
      undefined,
      undefined,
      "project-a",
    );

    requestHandler.invalidateRuntimeHandler();

    const after = getRSCHandler("/project/a", "project-a", handlerOptions);
    assertEquals(after !== before, true);
  });

  it("drops the stylesheet route's memoized source scans for this project", async () => {
    // The scans behind /_vf_styles/styles.css are memoized, and a local project
    // resolves no content context, so they are scoped by the project directory
    // and no content-push callback reaches them. A save must retire them here
    // or the class it added is missing from the next stylesheet fetch: the
    // reload lands well inside the scan cache's short mutable TTL.
    __injectCacheForTests(createHandlerCache());
    const projectDir = "/project/styles-scan";
    let sourceWalks = 0;
    let source = {
      path: `${projectDir}/app/page.tsx`,
      content: 'import "./page.css";\n<div className="text-amber-500" />',
    };
    const base = createMockAdapter();
    const underlying = {
      getAllSourceFiles: () => {
        sourceWalks++;
        return Promise.resolve([source]);
      },
      getContentContext: () => null,
    };
    const ctx = {
      projectDir,
      adapter: { ...base, fs: { ...base.fs, getUnderlyingAdapter: () => underlying } },
      securityConfig: null,
    } as unknown as HandlerContext;
    const requestHandler = new RequestHandler(projectDir, {} as RuntimeAdapter, () => true);
    const reset = () => {
      invalidateProjectCandidateScans();
      invalidateProjectCssImportScans();
      invalidateProjectCandidateManifests();
    };

    try {
      reset();

      const beforeCandidates = await extractProjectCandidates(ctx);
      await extractProjectCandidates(ctx);
      await extractProjectCssImports(ctx);
      await extractProjectCssImports(ctx);
      assertEquals(sourceWalks, 2, "each scan must be memoized between requests");
      assertEquals(beforeCandidates.has("text-amber-500"), true);

      source = {
        path: `${projectDir}/app/page.tsx`,
        content: 'import "./changed.css";\n<div className="text-blue-500" />',
      };
      requestHandler.invalidateRuntimeHandler();

      const afterCandidates = await extractProjectCandidates(ctx);
      const afterImports = await extractProjectCssImports(ctx);
      assertEquals(sourceWalks, 4, "a file change must retire both memoized scans");
      assertEquals(afterCandidates.has("text-blue-500"), true);
      assertEquals(afterCandidates.has("text-amber-500"), false);
      assertEquals(afterImports, [`${projectDir}/app/changed.css`]);
    } finally {
      reset();
    }
  });
});
