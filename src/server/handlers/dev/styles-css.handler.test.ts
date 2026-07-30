import "#veryfront/schemas/_test-setup.ts";
import "../../../html/styles-builder/__tests__/css-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter, type MockRuntimeAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type {
  EnsureStyleArtifactBuildInput,
  ProjectStyleArtifactResolution,
  ResolveStyleArtifactInput,
  UpsertStyleArtifactInput,
  VeryfrontApiClient,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import {
  API_CLIENT_ERROR,
  createStyleArtifactTuple,
  STYLE_ARTIFACT_CONTENT_TYPE,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import type { HandlerContext } from "../types.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import {
  cacheCSSAsync,
  cacheCSSInputsAsync,
  clearCSSCache,
  generateCSS,
  hashCSS,
  invalidateCompiler,
  invalidateProjectCSS,
} from "#veryfront/html/styles-builder/css-compiler.ts";
import { invalidatePreparedProjectCSS } from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";
import { CSSOptimizationEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { createTestCSSOptimizationEngine } from "../../../../tests/_helpers/css-optimization-engine.ts";
import { StylesCSSHandler } from "./styles-css.handler.ts";

const TEST_STYLESHEET = `@import "tailwindcss";`;
const PROJECT_SLUG = "dreamy-haven";

function missingStyleArtifact(
  input: ResolveStyleArtifactInput,
): ProjectStyleArtifactResolution {
  return Object.freeze({ ...createStyleArtifactTuple(input), status: "missing" as const });
}

function buildingStyleArtifact(
  input: ResolveStyleArtifactInput,
  buildRunId = "run_11111111-1111-4111-a111-111111111111",
): ProjectStyleArtifactResolution {
  return Object.freeze({
    ...createStyleArtifactTuple(input),
    status: "building" as const,
    buildRunId,
  });
}

function readyStyleArtifact(
  input: ResolveStyleArtifactInput,
  artifactHash: string,
): ProjectStyleArtifactResolution {
  return Object.freeze({
    ...createStyleArtifactTuple(input),
    status: "ready" as const,
    artifactHash,
    assetPath: `/_vf/css/${artifactHash}.css`,
    contentType: STYLE_ARTIFACT_CONTENT_TYPE,
    etag: `"${artifactHash}"`,
  });
}

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
  let previousOptimizationEngine: CSSOptimizationEngine | undefined;

  beforeEach(() => {
    previousOptimizationEngine = tryResolve<CSSOptimizationEngine>(CSSOptimizationEngineName);
    unregister(CSSOptimizationEngineName);
    register(CSSOptimizationEngineName, createTestCSSOptimizationEngine());
  });

  afterEach(() => {
    unregister(CSSOptimizationEngineName);
    if (previousOptimizationEngine !== undefined) {
      register(CSSOptimizationEngineName, previousOptimizationEngine);
    }
    previousOptimizationEngine = undefined;
  });

  it("serves project CSS from the project cache after the first request", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hello</div>' }],
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

  it("misses prepared and project caches when the optimizer identity changes", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-violet-500">Hi</div>' }],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
    );
    const ctx = makeCtx(adapter);
    const req = new Request("http://localhost/_vf_styles/styles.css");
    let firstOptimizationCalls = 0;
    let secondOptimizationCalls = 0;

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      unregister(CSSOptimizationEngineName);
      register(
        CSSOptimizationEngineName,
        createTestCSSOptimizationEngine((request) => {
          firstOptimizationCalls++;
          return { css: `${request.css}.pipeline-a{--vf-pipeline:a}` };
        }, "test-css-optimization-engine@pipeline-a"),
      );
      const first = await handler.handle(req, ctx);
      const firstBody = await first.response!.text();

      unregister(CSSOptimizationEngineName);
      register(
        CSSOptimizationEngineName,
        createTestCSSOptimizationEngine((request) => {
          secondOptimizationCalls++;
          return { css: `${request.css}.pipeline-b{--vf-pipeline:b}` };
        }, "test-css-optimization-engine@pipeline-b"),
      );
      const second = await handler.handle(req, ctx);
      const secondBody = await second.response!.text();

      assertEquals(first.response!.status, 200);
      assertEquals(second.response!.status, 200);
      assertEquals(firstBody.includes(".pipeline-a"), true);
      assertEquals(secondBody.includes(".pipeline-b"), true);
      assertEquals(secondBody.includes(".pipeline-a"), false);
      assertEquals(firstOptimizationCalls, 1);
      assertEquals(secondOptimizationCalls, 1);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("returns a typed non-success response when the CSS optimization extension is absent", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
    );
    const req = new Request("http://localhost/_vf_styles/styles.css");

    unregister(CSSOptimizationEngineName);
    const result = await handler.handle(req, makeCtx(adapter));
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 500);
    assertEquals(
      result.response!.headers.get("content-type"),
      "application/problem+json; charset=utf-8",
    );
    assertEquals(problem.status, 500);
    assertEquals(String(problem.type).endsWith("/missing-extension"), true);
  });

  it("returns a typed HTTP 500 response when CSS compilation fails", async () => {
    const fetchMock = mockTailwindFetch();
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
    );
    const req = new Request("http://localhost/_vf_styles/styles.css");

    try {
      unregister(CSSOptimizationEngineName);
      register(
        CSSOptimizationEngineName,
        createTestCSSOptimizationEngine(() => {
          throw new Error("optimizer exploded");
        }, "test-css-optimization-engine@failure"),
      );
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const result = await handler.handle(req, makeCtx(adapter));
      const problem = await result.response!.json() as Record<string, unknown>;

      assertEquals(result.response!.status, 500);
      assertEquals(problem.status, 500);
      assertEquals(String(problem.type).endsWith("/compilation-error"), true);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("does not mask operational stylesheet read failures with default CSS", async () => {
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      { sourceType: "branch", projectSlug: PROJECT_SLUG, branch: "main" },
    );
    const originalReadFile = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = (path: string) =>
      path === "/project/globals.css"
        ? Promise.reject(new Error("stylesheet permission denied"))
        : originalReadFile(path);

    const result = await handler.handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 500);
    assertEquals(String(problem.type).endsWith("/compilation-error"), true);
  });

  it("fails closed when a remote artifact response echoes another CSS pipeline", async () => {
    let ensureCalls = 0;
    const client = {
      resolveStyleArtifact: async (input: ResolveStyleArtifactInput) => ({
        ...readyStyleArtifact(input, "a".repeat(64)),
        cssPipelineIdentity: "different-pipeline@1",
      }),
      ensureStyleArtifactBuild: async (input: EnsureStyleArtifactBuildInput) => {
        ensureCalls++;
        return buildingStyleArtifact(input);
      },
      upsertStyleArtifact: async (input: UpsertStyleArtifactInput) =>
        readyStyleArtifact(input, input.status === "ready" ? input.artifactHash : "a".repeat(64)),
    };
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-protocol" },
      client,
    );

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const result = await handler.handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter),
      );
      const problem = await result.response!.json() as Record<string, unknown>;

      assertEquals(result.response!.status, 502);
      assertEquals(problem.status, 502);
      assertEquals(String(problem.type).endsWith("/api-client-error"), true);
      assertEquals(ensureCalls, 0);
    } finally {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("propagates operational control-plane failures instead of generating local CSS", async () => {
    const client = {
      resolveStyleArtifact: (_input: ResolveStyleArtifactInput) =>
        Promise.reject(
          API_CLIENT_ERROR.create({ detail: "control plane unavailable", status: 503 }),
        ),
      ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) =>
        Promise.reject(new Error("unexpected ensure")),
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) =>
        Promise.reject(new Error("unexpected upsert")),
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="px-4">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-api-failure" },
      client,
    );

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 503);
    assertEquals(problem.status, 503);
    assertEquals(String(problem.detail).includes("control plane unavailable"), true);
  });

  it("propagates build-enqueue failures after an exact missing response", async () => {
    const client = {
      resolveStyleArtifact: (input: ResolveStyleArtifactInput) =>
        Promise.resolve(missingStyleArtifact(input)),
      ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) =>
        Promise.reject(API_CLIENT_ERROR.create({ detail: "queue unavailable", status: 503 })),
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) =>
        Promise.reject(new Error("unexpected upsert")),
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="px-4">Hi</div>' }],
      {
        sourceType: "environment",
        projectSlug: PROJECT_SLUG,
        environmentName: "Preview",
      },
      client,
    );

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );

    assertEquals(result.response!.status, 503);
    assertEquals((await result.response!.json()).status, 503);
  });

  it("fails closed when a ready remote artifact cannot be loaded", async () => {
    const remoteHash = "d".repeat(64);
    const client = {
      resolveStyleArtifact: (input: ResolveStyleArtifactInput) =>
        Promise.resolve(readyStyleArtifact(input, remoteHash)),
      ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) =>
        Promise.reject(new Error("unexpected ensure")),
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) =>
        Promise.reject(new Error("unexpected upsert")),
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="px-4">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-unavailable" },
      client,
    );

    clearCSSCache();
    invalidateProjectCSS(PROJECT_SLUG);
    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 502);
    assertEquals(String(problem.detail).includes(remoteHash), true);
  });

  it("does not regenerate a ready remote artifact from cached build inputs", async () => {
    const fetchMock = mockTailwindFetch();
    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const candidates = new Set(["px-4"]);
      const generated = await generateCSS(TEST_STYLESHEET, candidates, {
        minify: true,
        projectSlug: PROJECT_SLUG,
      });
      const remoteHash = hashCSS(generated.css);
      await cacheCSSInputsAsync(remoteHash, {
        candidates,
        stylesheet: TEST_STYLESHEET,
      });
      const client = {
        resolveStyleArtifact: (input: ResolveStyleArtifactInput) =>
          Promise.resolve(readyStyleArtifact(input, remoteHash)),
        ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) =>
          Promise.reject(new Error("unexpected ensure")),
        upsertStyleArtifact: (_input: UpsertStyleArtifactInput) =>
          Promise.reject(new Error("unexpected upsert")),
      };
      const adapter = createHandlerAdapter(
        [{ path: "/project/pages/index.tsx", content: '<div className="px-4">Hi</div>' }],
        { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-inputs-only" },
        client,
      );

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter),
      );

      assertEquals(result.response!.status, 502);
      assertEquals(String((await result.response!.json()).detail).includes(remoteHash), true);
    } finally {
      fetchMock.restore();
    }
  });

  it("serves an empty ready artifact as valid cached CSS", async () => {
    const remoteHash = hashCSS("");
    const client = {
      resolveStyleArtifact: (input: ResolveStyleArtifactInput) =>
        Promise.resolve(readyStyleArtifact(input, remoteHash)),
      ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) =>
        Promise.reject(new Error("unexpected ensure")),
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) =>
        Promise.reject(new Error("unexpected upsert")),
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="px-4">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-empty-css" },
      client,
    );

    clearCSSCache();
    invalidateProjectCSS(PROJECT_SLUG);
    invalidatePreparedProjectCSS(PROJECT_SLUG);
    await cacheCSSAsync("", remoteHash);
    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );

    assertEquals(result.response!.status, 200);
    assertEquals(await result.response!.text(), "");
  });

  it("resolves release prepared CSS through style artifact metadata before rescanning files", async () => {
    const fetchMock = mockTailwindFetch();
    let storedHash: string | undefined;
    let storedCSSPipelineIdentity: string | undefined;
    let resolveCalls = 0;
    const client = {
      resolveStyleArtifact: async (input: ResolveStyleArtifactInput) => {
        resolveCalls++;
        return storedHash && input.cssPipelineIdentity === storedCSSPipelineIdentity
          ? readyStyleArtifact(input, storedHash)
          : missingStyleArtifact(input);
      },
      ensureStyleArtifactBuild: async (input: EnsureStyleArtifactBuildInput) =>
        buildingStyleArtifact(input),
      upsertStyleArtifact: async (input: UpsertStyleArtifactInput) => {
        if (input.status !== undefined && input.status !== "ready") {
          throw new Error("artifactHash is required");
        }
        storedHash = input.artifactHash;
        storedCSSPipelineIdentity = input.cssPipelineIdentity;
        return readyStyleArtifact(input, input.artifactHash);
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
      assertEquals(storedCSSPipelineIdentity?.includes("veryfront.css-pipeline.v1"), true);

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

  it("does not select a remote style artifact produced by another optimizer identity", async () => {
    const fetchMock = mockTailwindFetch();
    const artifacts = new Map<string, string>();
    const resolvedPipelineIdentities: string[] = [];
    const client = {
      resolveStyleArtifact: async (input: ResolveStyleArtifactInput) => {
        resolvedPipelineIdentities.push(input.cssPipelineIdentity);
        const artifactHash = artifacts.get(input.cssPipelineIdentity);
        return artifactHash ? readyStyleArtifact(input, artifactHash) : missingStyleArtifact(input);
      },
      ensureStyleArtifactBuild: async (input: EnsureStyleArtifactBuildInput) =>
        buildingStyleArtifact(input),
      upsertStyleArtifact: async (input: UpsertStyleArtifactInput) => {
        if (input.status !== undefined && input.status !== "ready") {
          throw new Error("artifactHash is required");
        }
        artifacts.set(input.cssPipelineIdentity, input.artifactHash);
        return readyStyleArtifact(input, input.artifactHash);
      },
    };
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-amber-500">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-pipeline-change" },
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

      unregister(CSSOptimizationEngineName);
      register(
        CSSOptimizationEngineName,
        createTestCSSOptimizationEngine(
          (request) => ({ css: `${request.css}.remote-pipeline-a{--vf-pipeline:a}` }),
          "test-css-optimization-engine@remote-pipeline-a",
        ),
      );
      const firstBody = await (await handler.handle(req, ctx)).response!.text();

      clearCSSCache();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
      unregister(CSSOptimizationEngineName);
      register(
        CSSOptimizationEngineName,
        createTestCSSOptimizationEngine(
          (request) => ({ css: `${request.css}.remote-pipeline-b{--vf-pipeline:b}` }),
          "test-css-optimization-engine@remote-pipeline-b",
        ),
      );
      const secondBody = await (await handler.handle(req, ctx)).response!.text();

      assertEquals(firstBody.includes(".remote-pipeline-a"), true);
      assertEquals(secondBody.includes(".remote-pipeline-b"), true);
      assertEquals(secondBody.includes(".remote-pipeline-a"), false);
      assertEquals(new Set(resolvedPipelineIdentities).size, 2);
      assertEquals(artifacts.size, 2);
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
      resolveStyleArtifact: async (input: ResolveStyleArtifactInput) => {
        resolveCalls++;
        return readyStyleArtifact(input, "a".repeat(64));
      },
      ensureStyleArtifactBuild: async (input: EnsureStyleArtifactBuildInput) => {
        ensureCalls++;
        return buildingStyleArtifact(input);
      },
      upsertStyleArtifact: async (input: UpsertStyleArtifactInput) => {
        upsertCalls++;
        return readyStyleArtifact(input, "b".repeat(64));
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
      resolveStyleArtifact: async (input: ResolveStyleArtifactInput) => {
        resolveCalls++;
        return readyStyleArtifact(input, "a".repeat(64));
      },
      ensureStyleArtifactBuild: async (input: EnsureStyleArtifactBuildInput) =>
        buildingStyleArtifact(input),
      upsertStyleArtifact: async (input: UpsertStyleArtifactInput) => {
        upsertCalls++;
        return readyStyleArtifact(input, "b".repeat(64));
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
      resolveStyleArtifact: async (input: ResolveStyleArtifactInput) => {
        resolveCalls++;
        return readyStyleArtifact(input, "a".repeat(64));
      },
      ensureStyleArtifactBuild: async (input: EnsureStyleArtifactBuildInput) =>
        buildingStyleArtifact(input),
      upsertStyleArtifact: async (input: UpsertStyleArtifactInput) => {
        upsertCalls++;
        return readyStyleArtifact(input, "b".repeat(64));
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
    const remotePipelineIdentities = new Set<string>();
    const client = {
      resolveStyleArtifact: async (input: ResolveStyleArtifactInput) => {
        remotePipelineIdentities.add(input.cssPipelineIdentity);
        return missingStyleArtifact(input);
      },
      ensureStyleArtifactBuild: async (input: EnsureStyleArtifactBuildInput) => {
        remotePipelineIdentities.add(input.cssPipelineIdentity);
        ensureCalls++;
        return buildingStyleArtifact(input);
      },
      upsertStyleArtifact: async (input: UpsertStyleArtifactInput) => {
        if (input.status !== undefined && input.status !== "ready") {
          throw new Error("artifactHash is required");
        }
        remotePipelineIdentities.add(input.cssPipelineIdentity);
        upsertCalls++;
        return readyStyleArtifact(input, input.artifactHash);
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
      assertEquals(remotePipelineIdentities.size, 1);
      assertEquals(
        [...remotePipelineIdentities][0]?.includes("veryfront.css-pipeline.v1"),
        true,
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

  it("propagates style artifact registration failures after an authorized local build", async () => {
    const fetchMock = mockTailwindFetch();
    let upsertCalls = 0;
    const client = {
      resolveStyleArtifact: (input: ResolveStyleArtifactInput) =>
        Promise.resolve(missingStyleArtifact(input)),
      ensureStyleArtifactBuild: (input: EnsureStyleArtifactBuildInput) =>
        Promise.resolve(buildingStyleArtifact(input)),
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) => {
        upsertCalls++;
        return Promise.reject(
          API_CLIENT_ERROR.create({ detail: "artifact registration unavailable", status: 503 }),
        );
      },
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="px-4">Hi</div>' }],
      {
        sourceType: "environment",
        projectSlug: PROJECT_SLUG,
        environmentName: "Preview",
      },
      client,
    );

    try {
      clearCSSCache();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter),
      );
      const problem = await result.response!.json() as Record<string, unknown>;

      assertEquals(result.response!.status, 503);
      assertEquals(String(problem.detail).includes("artifact registration unavailable"), true);
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
});
