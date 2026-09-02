import "#veryfront/schemas/_test-setup.ts";
import "../../../html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type CSSOptimizationEngine,
  CSSOptimizationEngineName,
} from "#veryfront/extensions/css/index.ts";
import { createMockAdapter, type MockRuntimeAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import type { HandlerContext } from "../types.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import {
  clearCSSCache,
  invalidateCompiler,
  invalidateProjectCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { invalidatePreparedProjectCSS } from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import { invalidateProjectCssImportScans } from "./styles-css-import-scanner.ts";
import { StylesCSSHandler } from "./styles-css.handler.ts";

const TEST_STYLESHEET = `@import "tailwindcss";`;
const PROJECT_SLUG = "dreamy-haven";

function mockTailwindFetch(): { restore: () => void; getCallCount: () => number } {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  globalThis.fetch = ((input: URL | Request | string) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    if (!url.includes("tailwindcss")) {
      return Promise.reject(new Error(`Unexpected fetch URL during test: ${url}`));
    }

    fetchCallCount++;
    return Promise.resolve(
      new Response("@layer theme, base, components, utilities;", { status: 200 }),
    );
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    getCallCount: () => fetchCallCount,
  };
}

function createHandlerAdapter(
  files: Array<{ path: string; content?: string }>,
  contentContext: ResolvedContentContext | null,
  client?: Pick<
    VeryfrontApiClient,
    "ensureStyleArtifactBuild" | "resolveStyleArtifact" | "upsertStyleArtifact"
  >,
): MockRuntimeAdapter & {
  setFiles: (nextFiles: Array<{ path: string; content?: string }>) => void;
} {
  const adapter = createMockAdapter();
  adapter.fs.files.set("/project/globals.css", TEST_STYLESHEET);
  let currentFiles = files;
  const underlyingAdapter: {
    getAllSourceFiles: () => Promise<Array<{ path: string; content?: string }>>;
    getContentContext: () => ResolvedContentContext | null;
    getClient?: () => Pick<
      VeryfrontApiClient,
      "ensureStyleArtifactBuild" | "resolveStyleArtifact" | "upsertStyleArtifact"
    >;
  } = {
    getAllSourceFiles: async () => currentFiles,
    getContentContext: () => contentContext,
  };

  if (client) {
    underlyingAdapter.getClient = () => client;
  }

  return {
    ...adapter,
    setFiles: (nextFiles) => {
      currentFiles = nextFiles;
    },
    fs: {
      ...adapter.fs,
      getUnderlyingAdapter: () => underlyingAdapter,
    },
  } as MockRuntimeAdapter & {
    setFiles: (nextFiles: Array<{ path: string; content?: string }>) => void;
  };
}

function makeCtx(adapter: RuntimeAdapter, overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter,
    securityConfig: null,
    projectSlug: PROJECT_SLUG,
    ...overrides,
  };
}

describe("server/handlers/dev/styles-css.handler", () => {
  it("carries the project @theme into the served stylesheet", async () => {
    // Mechanism check A: the stylesheet IS at the single path the dev route
    // reads. If the theme still does not reach the output, the loss is
    // downstream of loadStylesheet rather than in path resolution.
    const stub = mockTailwindFetch();
    try {
      const adapter = createHandlerAdapter(
        [{ path: "pages/index.tsx", content: '<div className="bg-brand" />' }],
        null,
      );
      adapter.fs.files.set(
        "/project/globals.css",
        '@import "tailwindcss";\n@theme { --color-brand: #123456; }',
      );
      const ctx = makeCtx(adapter);
      const req = new Request("http://localhost/_vf_styles/styles.css");

      const result = await new StylesCSSHandler().handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(body.includes("--color-brand"), true);
    } finally {
      stub.restore();
    }
  });

  it("finds a stylesheet at styles/globals.css like the production resolver", async () => {
    // Mechanism check B: production's findStylesheetFromFiles searches
    // globals.css, global.css, styles/globals.css and app/globals.css. The dev
    // route reads exactly one hardcoded path.
    const stub = mockTailwindFetch();
    try {
      const adapter = createHandlerAdapter(
        [{ path: "pages/index.tsx", content: '<div className="bg-brand" />' }],
        null,
      );
      adapter.fs.files.delete("/project/globals.css");
      adapter.fs.files.set(
        "/project/styles/globals.css",
        '@import "tailwindcss";\n@theme { --color-brand: #123456; }',
      );
      const ctx = makeCtx(adapter);
      const req = new Request("http://localhost/_vf_styles/styles.css");

      const result = await new StylesCSSHandler().handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(body.includes("--color-brand"), true);
    } finally {
      stub.restore();
    }
  });

  it("serves Tailwind-only development CSS without an optimization provider", async () => {
    const previousEngine = tryResolve<CSSOptimizationEngine>(CSSOptimizationEngineName);
    unregister(CSSOptimizationEngineName);
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-cyan-500">Hello</div>',
      }],
      null,
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(body.includes("StylesCSSHandler error"), false);
      assertEquals(body.includes("text-cyan-500"), true);
    } finally {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
      unregister(CSSOptimizationEngineName);
      if (previousEngine !== undefined) {
        register(CSSOptimizationEngineName, previousEngine);
      }
    }
  });

  it("serves successful CSS with a revalidating cache policy and ETag", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-cyan-500">Hello</div>',
      }],
      null,
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const etag = result.response!.headers.get("etag");

      assertEquals(result.response!.status, 200);
      assertExists(etag);
      assertEquals(
        result.response!.headers.get("cache-control"),
        "public, max-age=0, must-revalidate",
      );
      assertEquals(result.response!.headers.get("cache-control")?.includes("no-store"), false);
      assertEquals(result.response!.headers.get("pragma"), null);
      assertEquals(result.response!.headers.get("expires"), null);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("returns not modified when a successful CSS ETag matches", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-cyan-500">Hello</div>',
      }],
      null,
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const first = await handler.handle(req, ctx);
      const etag = first.response!.headers.get("etag");
      assertExists(etag);

      const second = await handler.handle(
        new Request("http://localhost/_vf_styles/styles.css", {
          headers: { "if-none-match": etag },
        }),
        ctx,
      );

      assertEquals(second.response!.status, 304);
      assertEquals(second.response!.headers.get("etag"), etag);
      assertEquals(
        second.response!.headers.get("cache-control"),
        "public, max-age=0, must-revalidate",
      );
      assertEquals(second.response!.headers.get("cache-control")?.includes("no-store"), false);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("serves project CSS from the project cache after the first request", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hello</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-1" },
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const first = await handler.handle(req, ctx);
      const firstBody = await first.response!.text();
      const initialFetchCount = fetchMock.getCallCount();

      assertEquals(first.continue, false);
      assertEquals(first.response!.status, 200);
      assertEquals(firstBody.length > 0, true);
      assertEquals(initialFetchCount, 0);

      invalidateCompiler();

      const second = await handler.handle(req, ctx);
      const secondBody = await second.response!.text();

      assertEquals(second.response!.status, 200);
      assertEquals(secondBody, firstBody);
      assertEquals(fetchMock.getCallCount(), initialFetchCount);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not reuse prepared CSS after the candidate snapshot changes", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-fuchsia-500">Hello</div>',
      }],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const first = await handler.handle(req, ctx);
      const firstBody = await first.response!.text();
      const initialFetchCount = fetchMock.getCallCount();

      assertEquals(first.response!.status, 200);
      assertEquals(firstBody.length > 0, true);

      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
      adapter.setFiles([]);

      const second = await handler.handle(req, ctx);
      const secondBody = await second.response!.text();

      assertEquals(second.response!.status, 200);
      assertEquals(secondBody === firstBody, false);
      assertEquals(secondBody.includes(".text-fuchsia-500"), false);
      assertEquals(fetchMock.getCallCount(), initialFetchCount);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("resolves release prepared CSS through style artifact metadata before rescanning files", async () => {
    const fetchMock = mockTailwindFetch();
    let storedHash: string | undefined;
    let resolveCalls = 0;
    const client = {
      resolveStyleArtifact: async () => {
        resolveCalls++;
        return storedHash
          ? { status: "ready" as const, artifactHash: storedHash }
          : { status: "missing" as const };
      },
      ensureStyleArtifactBuild: async () => ({ status: "building" as const }),
      upsertStyleArtifact: async (input: { artifactHash?: string }) => {
        if (!input.artifactHash) {
          throw new Error("artifactHash is required");
        }
        storedHash = input.artifactHash;
        return {
          status: "ready" as const,
          artifactHash: input.artifactHash,
          assetPath: `/_vf/css/${input.artifactHash}.css`,
        };
      },
    };
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-emerald-500">Hello</div>',
      }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-remote-css" },
      client,
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const first = await handler.handle(req, ctx);
      const firstBody = await first.response!.text();
      const initialFetchCount = fetchMock.getCallCount();

      assertEquals(first.response!.status, 200);
      assertEquals(firstBody.length > 0, true);
      assertEquals(!!storedHash, true);

      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
      adapter.setFiles([]);

      const second = await handler.handle(req, ctx);
      const secondBody = await second.response!.text();

      assertEquals(second.response!.status, 200);
      assertEquals(secondBody, firstBody);
      assertEquals(fetchMock.getCallCount(), initialFetchCount);
      assertEquals(resolveCalls > 0, true);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not use remote style artifacts for branch-scoped CSS", async () => {
    const fetchMock = mockTailwindFetch();
    let resolveCalls = 0;
    let ensureCalls = 0;
    let upsertCalls = 0;
    const client = {
      resolveStyleArtifact: async () => {
        resolveCalls++;
        return { status: "ready" as const, artifactHash: "stale-branch-css" };
      },
      ensureStyleArtifactBuild: async () => {
        ensureCalls++;
        return { status: "building" as const };
      },
      upsertStyleArtifact: async () => {
        upsertCalls++;
        return {
          status: "ready" as const,
          artifactHash: "new-branch-css",
          assetPath: "/_vf/css/new-branch-css.css",
        };
      },
    };
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-cyan-500">Hello</div>',
      }],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
      client,
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(body.length > 0, true);
      assertEquals(resolveCalls, 0);
      assertEquals(ensureCalls, 0);
      assertEquals(upsertCalls, 0);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not use remote style artifacts for branch fallback selectors", async () => {
    const fetchMock = mockTailwindFetch();
    let resolveCalls = 0;
    let upsertCalls = 0;
    const client = {
      resolveStyleArtifact: async () => {
        resolveCalls++;
        return { status: "ready" as const, artifactHash: "stale-branch-fallback-css" };
      },
      ensureStyleArtifactBuild: async () => ({ status: "building" as const }),
      upsertStyleArtifact: async () => {
        upsertCalls++;
        return {
          status: "ready" as const,
          artifactHash: "new-branch-fallback-css",
          assetPath: "/_vf/css/new-branch-fallback-css.css",
        };
      },
    };
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-lime-500">Hello</div>',
      }],
      null,
      client,
    );
    const ctx = makeCtx(adapter, {
      parsedDomain: { branch: "main" } as HandlerContext["parsedDomain"],
    });
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(body.length > 0, true);
      assertEquals(resolveCalls, 0);
      assertEquals(upsertCalls, 0);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not let branch content context fall through to release remote artifacts", async () => {
    const fetchMock = mockTailwindFetch();
    let resolveCalls = 0;
    let upsertCalls = 0;
    const client = {
      resolveStyleArtifact: async () => {
        resolveCalls++;
        return { status: "ready" as const, artifactHash: "stale-branch-release-css" };
      },
      ensureStyleArtifactBuild: async () => ({ status: "building" as const }),
      upsertStyleArtifact: async () => {
        upsertCalls++;
        return {
          status: "ready" as const,
          artifactHash: "new-branch-release-css",
          assetPath: "/_vf/css/new-branch-release-css.css",
        };
      },
    };
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-orange-500">Hello</div>',
      }],
      { sourceType: "branch", projectSlug: PROJECT_SLUG } as ResolvedContentContext,
      client,
    );
    const ctx = makeCtx(adapter, { releaseId: "rel-should-not-be-used" });
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(body.length > 0, true);
      assertEquals(resolveCalls, 0);
      assertEquals(upsertCalls, 0);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("ensures background style artifact builds for environment selectors before local fallback", async () => {
    const fetchMock = mockTailwindFetch();
    let ensureCalls = 0;
    let upsertCalls = 0;
    const client = {
      resolveStyleArtifact: async () => ({ status: "missing" as const }),
      ensureStyleArtifactBuild: async () => {
        ensureCalls++;
        return {
          status: "building" as const,
          buildRunId: "run_11111111-1111-4111-a111-111111111111",
        };
      },
      upsertStyleArtifact: async (input: { artifactHash?: string }) => {
        if (!input.artifactHash) {
          throw new Error("artifactHash is required");
        }
        upsertCalls++;
        return {
          status: "ready" as const,
          artifactHash: input.artifactHash,
          assetPath: `/_vf/css/${input.artifactHash}.css`,
        };
      },
    };
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-sky-500">Hello</div>',
      }],
      { sourceType: "environment", projectSlug: PROJECT_SLUG, environmentName: "Preview" },
      client,
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(body.length > 0, true);
      assertEquals(ensureCalls, 1);
      assertEquals(upsertCalls, 1);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("includes CSS imported by source modules in the compiled stylesheet", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [
        {
          path: "/project/app/layout.tsx",
          content:
            'import "./styles.css";\nexport default function Layout({ children }) { return children; }',
        },
        { path: "/project/app/page.tsx", content: '<div className="calc">Hello</div>' },
      ],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
    );
    adapter.fs.files.set(
      "/project/app/styles.css",
      ".calc { background: #191919; border-radius: 20px; }",
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(
        body.includes(".calc"),
        true,
        "CSS imported from app/layout.tsx must be part of the compiled stylesheet",
      );
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });

  it("does not duplicate the configured stylesheet when it is also imported by a module", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [
        {
          path: "/project/app/layout.tsx",
          content: 'import "../globals.css";\nexport default ({ children }) => children;',
        },
      ],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
    );
    // A passthrough rule that survives compilation, so the served stylesheet
    // can be checked for exactly one copy of the configured stylesheet.
    adapter.fs.files.set(
      "/project/globals.css",
      `${TEST_STYLESHEET}\n.vf-dup-probe { color: #123456; }`,
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(
        body.includes("STYLESHEET COULD NOT BE BUILT"),
        false,
        "the served CSS must be a real stylesheet, not the failure diagnostic",
      );
      assertEquals(
        (body.match(/vf-dup-probe/g) ?? []).length,
        1,
        "the configured stylesheet must be emitted exactly once",
      );
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      invalidateProjectCssImportScans(PROJECT_SLUG);
    }
  });
});
