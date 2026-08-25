import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import type { HandlerContext, HandlerResult } from "../../types.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RenderOptions } from "#veryfront/rendering/orchestrator/types.ts";
import type { Renderer } from "#veryfront/rendering/renderer.ts";
import {
  destroyRendererAdapter,
  type RendererInitializer,
  setRendererInitializer,
} from "../../../shared/renderer/index.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { handlePageModule } from "./page-module-handler.ts";

function makeCtx(projectDir: string): HandlerContext {
  return {
    projectDir,
    adapter: createMockAdapter(),
    securityConfig: null,
  };
}

function createInitializer(renderPage: Renderer["renderPage"]): RendererInitializer {
  const renderer = { renderPage } as Partial<Renderer>;
  return {
    initialize: () => Promise.resolve(renderer as Renderer),
    isInitialized: () => true,
    get: () => renderer as Renderer,
    destroy: () => Promise.resolve(),
  };
}

async function callPageModule(req: Request, ctx: HandlerContext): Promise<Response> {
  const result = await handlePageModule(
    req,
    new URL(req.url).pathname,
    ctx,
    () => new ResponseBuilder(),
    (response): HandlerResult => ({ response, continue: false }),
    (error) => error instanceof Error ? error.message : String(error),
  );
  return result.response!;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe("server/handlers/request/module/page-module-handler", () => {
  afterEach(async () => {
    clearReactVersionCache();
    await destroyRendererAdapter();
    setRendererInitializer(undefined);
  });

  it("renders a remembered requested snapshot after the project advances", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-page-module-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedOptions: RenderOptions | undefined;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "18.3.1" } }),
      );
      const snapshotA = await getDependencyPinningSnapshot(projectDir);

      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      const future = new Date(Date.now() + 2_000);
      await Deno.utime(packageJsonPath, future, future);
      const snapshotB = await getDependencyPinningSnapshot(projectDir);
      assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);

      setRendererInitializer(
        createInitializer((_slug, _ctx, options) => {
          observedOptions = options;
          return Promise.resolve({
            html: "",
            frontmatter: {},
            pageModule: {
              slug: "docs",
              code: 'export default "snapshot-a";',
              type: "component",
            },
          });
        }),
      );

      const response = await callPageModule(
        new Request(
          `http://localhost/_veryfront/pages/docs.js?pins=${
            encodeURIComponent(snapshotA.cacheKey)
          }&vf_release=rel-1`,
        ),
        makeCtx(projectDir),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), 'export default "snapshot-a";');
      assertEquals(observedOptions?.dependencyPinningCacheKey, snapshotA.cacheKey);
      assertEquals(observedOptions?.dependencyPinningDependencies?.react, "18.3.1");
      assertEquals(
        observedOptions?.url?.href,
        "http://localhost/_veryfront/pages/docs.js?vf_release=rel-1",
      );
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("fails closed for missing, duplicate, malformed, and unknown flag-on snapshots", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-page-module-conflict-" });
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let renderCalls = 0;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "19.2.4" } }),
      );
      await getDependencyPinningSnapshot(projectDir);
      setRendererInitializer(
        createInitializer(() => {
          renderCalls++;
          return Promise.resolve({ html: "", frontmatter: {} });
        }),
      );

      for (
        const url of [
          "http://localhost/_veryfront/pages/index.js",
          "http://localhost/_veryfront/pages/index.js?pins=on%3A1&pins=on%3A2",
          "http://localhost/_veryfront/pages/index.js?pins=",
          "http://localhost/_veryfront/pages/index.js?pins=off",
          "http://localhost/_veryfront/pages/index.js?pins=on%3Amissing",
          "http://localhost/_veryfront/pages/index.js?pins=on%3Aunknown",
        ]
      ) {
        const response = await callPageModule(new Request(url), makeCtx(projectDir));
        assertEquals(response.status, 409);
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(await response.text(), "Unknown dependency snapshot");
      }
      assertEquals(renderCalls, 0);
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("preserves normal flag-off responses and rejects stale pin transport", async () => {
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    let observedOptions: RenderOptions | undefined;
    let renderCalls = 0;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
      clearReactVersionCache();
      setRendererInitializer(
        createInitializer((_slug, _ctx, options) => {
          renderCalls++;
          observedOptions = options;
          return Promise.resolve({
            html: "",
            frontmatter: {},
            pageModule: {
              slug: "index",
              code: "export default {};",
              type: "component",
            },
          });
        }),
      );

      const response = await callPageModule(
        new Request("http://localhost/_veryfront/pages/index.js?visible=yes"),
        makeCtx("/tmp/test-project"),
      );

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "export default {};");
      assertEquals(observedOptions?.dependencyPinningCacheKey, "off");
      assertEquals(observedOptions?.dependencyPinningDependencies, undefined);
      assertEquals(
        observedOptions?.url?.href,
        "http://localhost/_veryfront/pages/index.js?visible=yes",
      );

      const noCacheCtx: HandlerContext = { ...makeCtx("/tmp/test-project"), isLocalProject: true };
      const noCacheResponse = await callPageModule(
        new Request("http://localhost/_veryfront/pages/index.js"),
        noCacheCtx,
      );
      assertEquals(noCacheResponse.status, 200);
      const etag = noCacheResponse.headers.get("etag");
      assertExists(etag, "a served page module must carry a validator");
      assertEquals(
        noCacheResponse.headers.get("cache-control"),
        "no-cache, no-store, must-revalidate",
        "a no-cache context must not get the short cache mode",
      );
      await noCacheResponse.text();

      const productionResponse = await callPageModule(
        new Request("http://localhost/_veryfront/pages/index.js"),
        {
          ...makeCtx("/tmp/test-project"),
          isLocalProject: false,
          resolvedEnvironment: "production",
          releaseId: "rel-1",
        },
      );
      assertEquals(productionResponse.status, 200);
      assertEquals(
        productionResponse.headers.get("cache-control"),
        "public, max-age=0",
        "a hosted production context must use the short cache mode",
      );
      await productionResponse.text();

      const revalidated = await callPageModule(
        new Request("http://localhost/_veryfront/pages/index.js", {
          headers: { "if-none-match": etag },
        }),
        noCacheCtx,
      );
      assertEquals(revalidated.status, 304, "a matching validator must answer 304");
      assertEquals(revalidated.headers.get("etag"), etag, "the 304 must echo the validator");
      assertEquals(await revalidated.text(), "", "a 304 must not carry the module body");

      const staleSnapshotResponse = await callPageModule(
        new Request("http://localhost/_veryfront/pages/index.js?pins=on%3Amissing"),
        makeCtx("/tmp/test-project"),
      );
      assertEquals(staleSnapshotResponse.status, 409);
      assertEquals(staleSnapshotResponse.headers.get("cache-control"), "no-store");
      assertEquals(renderCalls, 4);
    } finally {
      restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      clearReactVersionCache();
    }
  });

  it("hides internal render error details from the client", async () => {
    setRendererInitializer(
      createInitializer(() => {
        throw new Error("/abs/path/src/x.tsx: Unexpected token");
      }),
    );

    const response = await callPageModule(
      new Request("http://localhost/_veryfront/pages/index.js"),
      makeCtx("/tmp/test-project"),
    );

    assertEquals(response.status, 500);
    const body = await response.text();
    assertEquals(
      body,
      "Failed to generate module",
      "internal error text must never reach the client",
    );
    assertEquals(body.includes("/abs/path"), false, "server paths must not leak to the client");
    assertEquals(body.includes("Unexpected token"), false, "compiler messages must not leak");
  });
});
