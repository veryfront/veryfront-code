import "#veryfront/schemas/_test-setup.ts";
import "../../../html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter, type MockRuntimeAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import type { HandlerContext, HandlerResult } from "../types.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import {
  clearCSSCache,
  invalidateCompiler,
  invalidateProjectCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { invalidatePreparedProjectCSS } from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import {
  register as registerContract,
  tryResolve as tryResolveContract,
} from "#veryfront/extensions/contracts.ts";
import type { CSSProcessor } from "#veryfront/extensions/css/index.ts";
import { MAX_STYLESHEET_BYTES } from "#veryfront/html/styles-builder/resource-limits.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.8.0";
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
    cspUserHeader: null,
    projectSlug: PROJECT_SLUG,
    ...overrides,
  };
}

describe("server/handlers/dev/styles-css.handler", () => {
  afterEach(() => {
    __resetLogRecordEmitterForTests();
    _resetShimForTests();
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

      const first = await handler.handle(req, ctx);
      const firstBody = await first.response!.text();
      const initialFetchCount = fetchMock.getCallCount();

      assertEquals(first.continue, false);
      assertEquals(first.response!.status, 200);
      assertEquals(firstBody.length > 0, true);
      assertEquals(initialFetchCount > 0, true);

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
    }
  });

  it("serves prepared CSS without rescanning files after the first request", async () => {
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

      const first = await handler.handle(req, ctx);
      const firstBody = await first.response!.text();
      const initialFetchCount = fetchMock.getCallCount();

      assertEquals(first.response!.status, 200);
      assertEquals(firstBody.length > 0, true);

      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      adapter.setFiles([]);

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
    }
  });

  it("reads the project source snapshot once per uncached stylesheet request", async () => {
    const fetchMock = mockTailwindFetch();
    const adapter = createHandlerAdapter(
      [
        {
          path: "/project/app/layout.tsx",
          content: 'import "./styles.css"; export default ({ children }) => children;',
        },
        { path: "/project/app/page.tsx", content: '<div className="snapshot-test" />' },
      ],
      null,
    );
    adapter.fs.files.set("/project/app/styles.css", ".snapshot-test { color: red; }");
    const underlying = (adapter.fs as unknown as { getUnderlyingAdapter: () => unknown })
      .getUnderlyingAdapter() as {
        getAllSourceFiles: () => Promise<Array<{ path: string; content?: string }>>;
      };
    const getAllSourceFiles = underlying.getAllSourceFiles;
    let sourceSnapshotReads = 0;
    underlying.getAllSourceFiles = () => {
      sourceSnapshotReads++;
      return getAllSourceFiles();
    };

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(sourceSnapshotReads, 1);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
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
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const result = await handler.handle(req, ctx);
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(body.length > 0, true);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("returns an explicit empty stylesheet when no stylesheet exists", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter([], null);
    adapter.fs.files.delete("/project/globals.css");

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );

    assertEquals(result.response!.status, 200);
    assertEquals(await result.response!.text(), "");
    assertEquals(result.response!.headers.get("cache-control"), "no-store");
    assertEquals(result.response!.headers.get("content-type"), "text/css; charset=utf-8");
  });

  it("fails closed before entering a remote source context without a request credential", async () => {
    const adapter = createHandlerAdapter([], null);
    let contextCalls = 0;
    Object.assign(adapter.fs, {
      getUnderlyingAdapter: () => ({}),
      isVeryfrontAdapter: () => true,
      isMultiProjectMode: () => true,
      isContextualMode: () => true,
      runWithContext: async <T>(
        _slug: string,
        _token: string,
        fn: () => Promise<T>,
      ): Promise<T> => {
        contextCalls++;
        return await fn();
      },
    });

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter, {
        isLocalProject: false,
        projectSlug: "remote-project",
        proxyToken: undefined,
        requestContext: { mode: "preview", branch: null } as HandlerContext["requestContext"],
      }),
    );

    assertEquals(result.response?.status, 503);
    assertEquals(contextCalls, 0);
  });

  it("does not mutate an unscoped remote contextual adapter", async () => {
    const adapter = createHandlerAdapter([], null);
    let mutationCalls = 0;
    Object.assign(adapter.fs, {
      getUnderlyingAdapter: () => ({}),
      isVeryfrontAdapter: () => true,
      isMultiProjectMode: () => false,
      isContextualMode: () => true,
      setRequestToken: () => mutationCalls++,
      setRequestBranch: () => mutationCalls++,
      setProductionMode: () => mutationCalls++,
    });

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter, {
        isLocalProject: false,
        projectSlug: "remote-project",
        proxyToken: "proxy-token",
        requestContext: { mode: "preview", branch: null } as HandlerContext["requestContext"],
      }),
    );

    assertEquals(result.response?.status, 503);
    assertEquals(mutationCalls, 0);
  });

  it("returns a typed non-cacheable failure for unreadable configured stylesheets", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter([], null);
    const privateDetail = "private-permission-detail";
    adapter.fs.files.set("/project/private.css", '@import "tailwindcss";');
    const originalReadFile = adapter.fs.readFile;
    adapter.fs.readFile = (path) => {
      if (path.endsWith("/private.css")) {
        return Promise.reject(Object.assign(new Error(privateDetail), { code: "EACCES" }));
      }
      return originalReadFile(path);
    };

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter, {
        config: { tailwind: { stylesheet: "private.css" } } as HandlerContext["config"],
      }),
    );
    const body = await result.response!.text();

    assertEquals(result.response!.status, 403);
    assertEquals(result.response!.headers.get("cache-control"), "no-store");
    assertEquals(result.response!.headers.get("content-type"), "application/problem+json");
    assertEquals(body.includes("permission-denied"), true);
    assertEquals(body.includes(privateDetail), false);
  });

  it("does not classify a missing configured stylesheet as the supported empty state", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter([], null);

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter, {
        config: { tailwind: { stylesheet: "missing.css" } } as HandlerContext["config"],
      }),
    );
    const body = await result.response!.text();

    assertEquals(result.response!.status, 400);
    assertEquals(result.response!.headers.get("cache-control"), "no-store");
    assertEquals(body.includes("config-invalid"), true);
  });

  it("propagates imported stylesheet permission failures without exposing details", async () => {
    const handler = new StylesCSSHandler();
    const privateDetail = "private-imported-css-detail";
    const adapter = createHandlerAdapter(
      [{
        path: "/project/app/layout.tsx",
        content: 'import "./private.css"; export default ({ children }) => children;',
      }],
      null,
    );
    adapter.fs.files.set("/project/app/private.css", ".private { color: red; }");
    const originalReadFile = adapter.fs.readFile;
    adapter.fs.readFile = (path) => {
      if (path.endsWith("/private.css")) {
        return Promise.reject(Object.assign(new Error(privateDetail), { code: "EACCES" }));
      }
      return originalReadFile(path);
    };

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const body = await result.response!.text();

    assertEquals(result.response!.status, 403);
    assertEquals(body.includes("permission-denied"), true);
    assertEquals(body.includes(privateDetail), false);
  });

  it("rejects configured stylesheet traversal without reading outside the project", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter([], null);
    const reads: string[] = [];
    const originalReadFile = adapter.fs.readFile;
    adapter.fs.readFile = (path) => {
      reads.push(path);
      return originalReadFile(path);
    };

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter, {
        config: { tailwind: { stylesheet: "../outside.css" } } as HandlerContext["config"],
      }),
    );
    const body = await result.response!.text();

    assertEquals(result.response!.status, 400);
    assertEquals(body.includes("config-invalid"), true);
    assertEquals(reads.some((path) => path.includes("outside.css")), false);
  });

  it("rejects imported stylesheet symlink escapes before reading the target", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/app/layout.tsx",
        content: 'import "./linked.css"; export default ({ children }) => children;',
      }],
      null,
    );
    const outsidePath = "/outside/private.css";
    const reads: string[] = [];
    const originalReadFile = adapter.fs.readFile;
    adapter.fs.readFile = (path) => {
      reads.push(path);
      return originalReadFile(path);
    };
    adapter.fs.realPath = (path) =>
      Promise.resolve(path === "/project/app/linked.css" ? outsidePath : path);

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const body = await result.response!.text();

    assertEquals(result.response!.status, 403);
    assertEquals(result.response!.headers.get("cache-control"), "no-store");
    assertEquals(body.includes("security-violation"), true);
    assertEquals(body.includes(outsidePath), false);
    assertEquals(reads.includes(outsidePath), false);
  });

  it("rejects imported CSS that exceeds the compilation input budget", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/app/layout.tsx",
        content: 'import "./oversized.css"; export default ({ children }) => children;',
      }],
      null,
    );
    adapter.fs.files.set("/project/app/oversized.css", "x".repeat(MAX_STYLESHEET_BYTES));

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const body = await result.response!.text();

    assertEquals(result.response!.status, 500);
    assertEquals(result.response!.headers.get("cache-control"), "no-store");
    assertEquals(body.includes("compilation-error"), true);
  });

  it("returns a private typed failure when candidate discovery fails", async () => {
    const handler = new StylesCSSHandler();
    const privateDetail = "private-candidate-provider-detail";
    const adapter = createHandlerAdapter([], null);
    const underlying = (adapter.fs as unknown as { getUnderlyingAdapter: () => unknown })
      .getUnderlyingAdapter() as {
        getAllSourceFiles: () => Promise<Array<{ path: string; content?: string }>>;
      };
    underlying.getAllSourceFiles = () => Promise.reject(new Error(privateDetail));

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const body = await result.response!.text();

    assertEquals(result.response!.status, 500);
    assertEquals(result.response!.headers.get("cache-control"), "no-store");
    assertEquals(body.includes("compilation-error"), true);
    assertEquals(body.includes(privateDetail), false);
  });

  it("does not attach project or artifact identifiers to cache lookup traces", async () => {
    const privateProject = "private-trace-project";
    const privateArtifactHash = "private-artifact-hash-canary";
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    setGlobalTracerProvider(
      provider as unknown as Parameters<typeof setGlobalTracerProvider>[0],
    );

    const client = {
      resolveStyleArtifact: async () => ({
        status: "ready" as const,
        artifactHash: privateArtifactHash,
      }),
      ensureStyleArtifactBuild: async () => ({ status: "building" as const }),
      upsertStyleArtifact: async (input: { artifactHash?: string }) => ({
        status: "ready" as const,
        artifactHash: input.artifactHash,
      }),
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/app/page.tsx", content: '<div className="text-violet-500" />' }],
      { sourceType: "release", projectSlug: privateProject, releaseId: "rel-trace" },
      client,
    );
    const fetchMock = mockTailwindFetch();

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(privateProject);
      invalidatePreparedProjectCSS(privateProject);

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter, { projectSlug: privateProject }),
      );
      await provider.forceFlush();
      const tracePayload = JSON.stringify(
        exporter.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      );

      assertEquals(result.response!.status, 200);
      assertEquals(tracePayload.includes(privateArtifactHash), false);
      assertEquals(tracePayload.includes(privateProject), false);
      assertEquals(tracePayload.includes("/project"), false);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(privateProject);
      invalidatePreparedProjectCSS(privateProject);
      await provider.shutdown();
    }
  });

  it("does not expose compiler errors, project identity, or paths in responses or logs", async () => {
    const originalProcessor = tryResolveContract<CSSProcessor>("CSSProcessor");
    const privateCompilerDetail = "private-compiler-detail-123";
    const privatePath = "/private/customer/acme/globals.css";
    const privateProject = "private-project-identity";
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    registerContract(
      "CSSProcessor",
      {
        compile: () => Promise.reject(new Error(`${privateCompilerDetail} ${privatePath}`)),
      } satisfies CSSProcessor,
    );
    invalidateCompiler();

    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/app/page.tsx", content: '<div className="text-red-500" />' }],
      null,
    );
    Object.assign(adapter.fs, {
      isMultiProjectMode: () => true,
      runWithContext: (
        _slug: string,
        _token: string,
        fn: () => Promise<HandlerResult>,
      ) => fn(),
    });

    try {
      const result = await handler.handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter, { projectSlug: privateProject }),
      );
      const body = await result.response!.text();
      const logs = JSON.stringify(entries);

      assertEquals(result.response!.status, 500);
      assertEquals(result.response!.headers.get("cache-control"), "no-store");
      assertEquals(result.response!.headers.get("content-type"), "application/problem+json");
      assertEquals(body.includes("compilation-error"), true);
      assertEquals(body.includes(privateCompilerDetail), false);
      assertEquals(body.includes(privatePath), false);
      assertEquals(body.includes(privateProject), false);
      assertEquals(logs.includes(privateCompilerDetail), false);
      assertEquals(logs.includes(privatePath), false);
      assertEquals(logs.includes(privateProject), false);
    } finally {
      if (originalProcessor) registerContract("CSSProcessor", originalProcessor);
      invalidateCompiler();
      invalidateProjectCSS(privateProject);
      invalidatePreparedProjectCSS(privateProject);
      invalidateProjectCandidateManifests(privateProject);
    }
  });
});
