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
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import {
  API_CLIENT_ERROR,
  createStyleArtifactTuple,
  STYLE_ARTIFACT_CONTENT_TYPE,
} from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import type { HandlerContext } from "../types.ts";
import type {
  ResolvedContentContext,
  StyleArtifactRegistry,
} from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { MultiProjectFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
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

const branchOptOutRegistry: Readonly<StyleArtifactRegistry> = Object.freeze({
  resolveStyleArtifact: (_input: ResolveStyleArtifactInput) => {
    throw new Error("Branch style artifact lookup must remain disabled");
  },
  ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) => {
    throw new Error("Branch style artifact builds must remain disabled");
  },
  upsertStyleArtifact: (_input: UpsertStyleArtifactInput) => {
    throw new Error("Branch style artifact registration must remain disabled");
  },
});

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
  artifactRegistry?: StyleArtifactRegistry,
): MockRuntimeAdapter & {
  setFiles: (nextFiles: Array<{ path: string; content?: string }>) => void;
} {
  const adapter = createMockAdapter();
  adapter.fs.files.set("/project/globals.css", TEST_STYLESHEET);
  let currentFiles = files;
  const underlyingAdapter: {
    getAllSourceFiles: () => Promise<Array<{ path: string; content?: string }>>;
    getContentContext: () => ResolvedContentContext | null;
  } = {
    getAllSourceFiles: async () => currentFiles,
    getContentContext: () => contentContext,
  };

  const registry = artifactRegistry ??
    (contentContext?.sourceType === "branch" ? branchOptOutRegistry : undefined);
  const hasVeryfrontArtifactState = contentContext !== null || artifactRegistry !== undefined;
  const styleArtifactAccess = contentContext && registry
    ? () =>
      Promise.resolve(Object.freeze({
        contentContext: Object.freeze({ ...contentContext }),
        registry,
      }))
    : undefined;

  return {
    ...adapter,
    setFiles: (nextFiles) => {
      currentFiles = nextFiles;
    },
    fs: {
      ...adapter.fs,
      getUnderlyingAdapter: () => underlyingAdapter,
      ...(hasVeryfrontArtifactState
        ? {
          isVeryfrontAdapter: () => true,
          isMultiProjectMode: () => false,
        }
        : {}),
      ...(styleArtifactAccess ? { getStyleArtifactAccess: styleArtifactAccess } : {}),
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

  it("generates standalone production CSS locally without a Veryfront artifact capability", async () => {
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      null,
    );

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter, {
          isLocalProject: false,
          releaseId: "standalone-dev",
          resolvedEnvironment: "production",
        }),
      );
      const body = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(result.response!.headers.get("content-type"), "text/css; charset=utf-8");
      assertEquals(body.length > 0, true);
    } finally {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("fails closed when a Veryfront filesystem omits style artifact access", async () => {
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "rel-no-client" },
    );

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 502);
    assertEquals(problem.status, 502);
    assertEquals(
      String(problem.detail).includes("requires request-scoped style artifact access"),
      true,
    );
  });

  it("fails closed when style artifact access has no exact source selector", async () => {
    let remoteCalls = 0;
    const client = {
      resolveStyleArtifact: (_input: ResolveStyleArtifactInput) => {
        remoteCalls++;
        throw new Error("unexpected resolve");
      },
      ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) => {
        remoteCalls++;
        throw new Error("unexpected ensure");
      },
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) => {
        remoteCalls++;
        throw new Error("unexpected upsert");
      },
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG } as ResolvedContentContext,
      client,
    );

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter, { releaseId: "rel-must-not-be-used" }),
    );
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 502);
    assertEquals(problem.status, 502);
    assertEquals(String(problem.detail).includes("requires an exact source selector"), true);
    assertEquals(remoteCalls, 0);
  });

  it("validates remote artifact authority before consulting a warm prepared cache", async () => {
    const malformedReleaseId = " release-malformed ";
    const files = [{
      path: "/project/pages/index.tsx",
      content: '<div className="text-red-500">Hi</div>',
    }];
    const localAdapter = createHandlerAdapter(files, null);
    let remoteCalls = 0;
    const invalidRegistry = {
      resolveStyleArtifact: (_input: ResolveStyleArtifactInput) => {
        remoteCalls++;
        throw new Error("unexpected resolve");
      },
      ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) => {
        remoteCalls++;
        throw new Error("unexpected ensure");
      },
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) => {
        remoteCalls++;
        throw new Error("unexpected upsert");
      },
    };
    const invalidRemoteAdapter = createHandlerAdapter(
      files,
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: malformedReleaseId },
      invalidRegistry,
    );
    const handler = new StylesCSSHandler();
    const request = new Request("http://localhost/_vf_styles/styles.css");

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const warm = await handler.handle(
        request,
        makeCtx(localAdapter, { releaseId: malformedReleaseId }),
      );
      assertEquals(warm.response!.status, 200);

      // Preserve the prepared entry while removing lower-level generation
      // caches. A cache lookup before authority validation would now return the
      // standalone entry for this malformed hosted request.
      invalidateProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const rejected = await handler.handle(
        request,
        makeCtx(invalidRemoteAdapter, { releaseId: malformedReleaseId }),
      );
      const problem = await rejected.response!.json() as Record<string, unknown>;

      assertEquals(rejected.response!.status, 502);
      assertEquals(String(problem.detail).includes("requires an exact source selector"), true);
      assertEquals(remoteCalls, 0);
    } finally {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("rejects style artifact access for a different request project", async () => {
    let remoteCalls = 0;
    const registry = {
      resolveStyleArtifact: (_input: ResolveStyleArtifactInput) => {
        remoteCalls++;
        throw new Error("unexpected resolve");
      },
      ensureStyleArtifactBuild: (_input: EnsureStyleArtifactBuildInput) => {
        remoteCalls++;
        throw new Error("unexpected ensure");
      },
      upsertStyleArtifact: (_input: UpsertStyleArtifactInput) => {
        remoteCalls++;
        throw new Error("unexpected upsert");
      },
    };
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      {
        sourceType: "release",
        projectSlug: "different-project",
        releaseId: "release-a",
      },
      registry,
    );

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 502);
    assertEquals(String(problem.detail).includes("did not match the request project"), true);
    assertEquals(remoteCalls, 0);
  });

  it("snapshots mutable artifact context and registry operations before later awaits", async () => {
    const releaseId = "release-snapshot";
    const contentContext: ResolvedContentContext = {
      sourceType: "release",
      projectSlug: PROJECT_SLUG,
      releaseId,
    };
    const tupleReleaseIds: Array<string | undefined> = [];
    let capturedCalls = 0;
    let replacementCalls = 0;
    const registry: StyleArtifactRegistry = {
      resolveStyleArtifact(input) {
        capturedCalls++;
        tupleReleaseIds.push(input.releaseId);
        return Promise.resolve(missingStyleArtifact(input));
      },
      ensureStyleArtifactBuild(input) {
        capturedCalls++;
        tupleReleaseIds.push(input.releaseId);
        return Promise.resolve(buildingStyleArtifact(input));
      },
      upsertStyleArtifact(input) {
        capturedCalls++;
        tupleReleaseIds.push(input.releaseId);
        if (!input.artifactHash) throw new Error("Snapshot upsert requires an artifact hash");
        return Promise.resolve(readyStyleArtifact(input, input.artifactHash));
      },
    };
    const mutableAccess = { contentContext, registry };
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-rose-500">Snapshot</div>',
      }],
      contentContext,
      registry,
    );
    Object.assign(adapter.fs, {
      getStyleArtifactAccess: () => Promise.resolve(mutableAccess),
    });
    const readFile = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = async (path: string) => {
      contentContext.releaseId = "release-mutated";
      registry.resolveStyleArtifact = () => {
        replacementCalls++;
        throw new Error("replacement resolve must not run");
      };
      registry.ensureStyleArtifactBuild = () => {
        replacementCalls++;
        throw new Error("replacement ensure must not run");
      };
      registry.upsertStyleArtifact = () => {
        replacementCalls++;
        throw new Error("replacement upsert must not run");
      };
      return await readFile(path);
    };

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter, { releaseId }),
      );

      assertEquals(result.response!.status, 200);
      assertEquals(capturedCalls, 3);
      assertEquals(replacementCalls, 0);
      assertEquals(tupleReleaseIds, [releaseId, releaseId, releaseId]);
    } finally {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("rejects accessor-backed artifact access without invoking the accessor", async () => {
    let accessorCalls = 0;
    const registry: StyleArtifactRegistry = {
      resolveStyleArtifact: () => Promise.reject(new Error("not used")),
      ensureStyleArtifactBuild: () => Promise.reject(new Error("not used")),
      upsertStyleArtifact: () => Promise.reject(new Error("not used")),
    };
    const accessorAccess: Record<string, unknown> = { registry };
    Object.defineProperty(accessorAccess, "contentContext", {
      enumerable: true,
      get() {
        accessorCalls++;
        return {
          sourceType: "release",
          projectSlug: PROJECT_SLUG,
          releaseId: "release-accessor",
        };
      },
    });
    const adapter = createHandlerAdapter(
      [{ path: "/project/pages/index.tsx", content: '<div className="text-red-500">Hi</div>' }],
      { sourceType: "release", projectSlug: PROJECT_SLUG, releaseId: "release-accessor" },
      registry,
    );
    Object.assign(adapter.fs, {
      getStyleArtifactAccess: () => Promise.resolve(accessorAccess),
    });

    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 502);
    assertEquals(String(problem.detail).includes("invalid style artifact access"), true);
    assertEquals(accessorCalls, 0);
  });

  it("rejects nested context and registry accessors without invoking them", async () => {
    const files = [{
      path: "/project/pages/index.tsx",
      content: '<div className="text-red-500">Hi</div>',
    }];
    const contentContext: ResolvedContentContext = {
      sourceType: "release",
      projectSlug: PROJECT_SLUG,
      releaseId: "release-accessor",
    };
    const registry: StyleArtifactRegistry = {
      resolveStyleArtifact: () => Promise.reject(new Error("not used")),
      ensureStyleArtifactBuild: () => Promise.reject(new Error("not used")),
      upsertStyleArtifact: () => Promise.reject(new Error("not used")),
    };
    const assertRejected = async (
      access: Record<string, unknown>,
      getAccessorCalls: () => number,
      label: string,
    ) => {
      const adapter = createHandlerAdapter(files, contentContext, registry);
      Object.assign(adapter.fs, {
        getStyleArtifactAccess: () => Promise.resolve(access),
      });

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(adapter),
      );
      const problem = await result.response!.json() as Record<string, unknown>;

      assertEquals(result.response!.status, 502, label);
      assertEquals(
        String(problem.detail).includes("invalid style artifact access"),
        true,
        label,
      );
      assertEquals(getAccessorCalls(), 0, label);
    };

    for (const key of ["projectSlug", "sourceType", "releaseId"] as const) {
      let accessorCalls = 0;
      const rawContext = { ...contentContext } as Record<string, unknown>;
      Object.defineProperty(rawContext, key, {
        enumerable: true,
        get() {
          accessorCalls++;
          return contentContext[key];
        },
      });
      await assertRejected(
        { contentContext: rawContext, registry },
        () => accessorCalls,
        `contentContext.${key}`,
      );
    }

    for (
      const key of [
        "resolveStyleArtifact",
        "ensureStyleArtifactBuild",
        "upsertStyleArtifact",
      ] as const
    ) {
      let accessorCalls = 0;
      const rawRegistry = { ...registry } as Record<string, unknown>;
      Object.defineProperty(rawRegistry, key, {
        enumerable: true,
        get() {
          accessorCalls++;
          return registry[key];
        },
      });
      await assertRejected(
        { contentContext, registry: rawRegistry },
        () => accessorCalls,
        `registry.${key}`,
      );
    }
  });

  it("routes style artifact access through the wrapper and active multi-project adapter", async () => {
    const projectSlug = "topology-project";
    const projectId = "project-topology-id";
    const releaseId = "release-topology";
    const proxyToken = "vf_topology_token";
    const resolveInputs: ResolveStyleArtifactInput[] = [];
    const ensureInputs: EnsureStyleArtifactBuildInput[] = [];
    const upsertInputs: UpsertStyleArtifactInput[] = [];
    let accessCalls = 0;
    const selections: Array<{
      projectSlug: string;
      token: string;
      projectId: string | undefined;
      productionMode: boolean;
      releaseId: string | null;
      environmentName: string | null;
      branch: string | null;
    }> = [];
    const registry: Readonly<StyleArtifactRegistry> = Object.freeze({
      resolveStyleArtifact(input: ResolveStyleArtifactInput) {
        resolveInputs.push(input);
        return Promise.resolve(missingStyleArtifact(input));
      },
      ensureStyleArtifactBuild(input: EnsureStyleArtifactBuildInput) {
        ensureInputs.push(input);
        return Promise.resolve(buildingStyleArtifact(input));
      },
      upsertStyleArtifact(input: UpsertStyleArtifactInput) {
        upsertInputs.push(input);
        if (!input.artifactHash) throw new Error("Topology upsert requires an artifact hash");
        return Promise.resolve(readyStyleArtifact(input, input.artifactHash));
      },
    });
    const access = Object.freeze({
      contentContext: Object.freeze({
        sourceType: "release" as const,
        projectSlug,
        releaseId,
      }),
      registry,
    });
    const concreteAdapter = {
      readTextFile(path: string) {
        if (path === "/project/globals.css") return Promise.resolve(TEST_STYLESHEET);
        return Promise.reject(new Error(`Unexpected topology read: ${path}`));
      },
      getAllSourceFiles() {
        return Promise.resolve([{
          path: "/project/pages/index.tsx",
          content: '<div className="text-cyan-500">Topology</div>',
        }]);
      },
      getStyleArtifactAccess() {
        accessCalls++;
        return Promise.resolve(access);
      },
    };
    const multiProjectAdapter = new MultiProjectFSAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        apiToken: "base-token",
        projectSlug: "base-project",
        proxyMode: true,
        cache: { enabled: false },
      },
    });
    const managerInternals = multiProjectAdapter as unknown as {
      manager: {
        getAdapter: (
          projectSlug: string,
          token: string,
          projectId?: string,
          productionMode?: boolean,
          releaseId?: string | null,
          environmentName?: string | null,
          branch?: string | null,
        ) => Promise<unknown>;
      };
    };
    const originalManager = managerInternals.manager;
    managerInternals.manager = {
      getAdapter(
        selectedProjectSlug,
        token,
        selectedProjectId,
        productionMode = false,
        selectedReleaseId = null,
        environmentName = null,
        branch = null,
      ) {
        selections.push({
          projectSlug: selectedProjectSlug,
          token,
          projectId: selectedProjectId,
          productionMode,
          releaseId: selectedReleaseId,
          environmentName,
          branch,
        });
        return Promise.resolve(concreteAdapter);
      },
    };
    const baseRuntime = createMockAdapter();
    const runtime = {
      ...baseRuntime,
      fs: new FSAdapterWrapper(multiProjectAdapter),
    } as RuntimeAdapter;

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
      invalidatePreparedProjectCSS(projectSlug);
      invalidateProjectCandidateManifests(projectSlug);

      const result = await new StylesCSSHandler().handle(
        new Request("http://localhost/_vf_styles/styles.css"),
        makeCtx(runtime, {
          projectSlug,
          projectId,
          proxyToken,
          isLocalProject: false,
          releaseId,
          resolvedEnvironment: "production",
        }),
      );
      const css = await result.response!.text();

      assertEquals(result.response!.status, 200);
      assertEquals(css.length > 0, true);
      assertEquals(accessCalls, 1);
      assertEquals(resolveInputs.length, 1);
      assertEquals(ensureInputs.length, 1);
      assertEquals(upsertInputs.length, 1);
      assertEquals(resolveInputs[0]?.releaseId, releaseId);
      assertEquals("environmentName" in (resolveInputs[0] ?? {}), false);
      assertEquals(ensureInputs[0], resolveInputs[0]);
      assertEquals(upsertInputs[0]?.releaseId, releaseId);
      assertEquals(upsertInputs[0]?.cssPipelineIdentity, resolveInputs[0]?.cssPipelineIdentity);
      assertEquals(upsertInputs[0]?.styleProfileHash, resolveInputs[0]?.styleProfileHash);
      assertEquals(selections.length > 0, true);
      assertEquals(
        selections.every((selection) =>
          selection.projectSlug === projectSlug &&
          selection.token === proxyToken &&
          selection.projectId === projectId &&
          selection.productionMode &&
          selection.releaseId === releaseId &&
          selection.environmentName === null &&
          selection.branch === null
        ),
        true,
      );
    } finally {
      managerInternals.manager = originalManager;
      multiProjectAdapter.dispose();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
      invalidatePreparedProjectCSS(projectSlug);
      invalidateProjectCandidateManifests(projectSlug);
    }
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

  it("isolates branch prepared CSS and candidate manifests when a release ID is also present", async () => {
    const fetchMock = mockTailwindFetch();
    const sharedReleaseId = "release-must-not-win";
    const handler = new StylesCSSHandler();
    const adapter = createHandlerAdapter(
      [{
        path: "/project/pages/index.tsx",
        content: '<div className="text-red-500">Main</div>',
      }],
      null,
    );
    const request = new Request("http://localhost/_vf_styles/styles.css");
    const branchContext = (branch: string) =>
      makeCtx(adapter, {
        releaseId: sharedReleaseId,
        parsedDomain: { branch } as HandlerContext["parsedDomain"],
      });

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      const main = await handler.handle(request, branchContext("main"));
      const mainCSS = await main.response!.text();

      adapter.setFiles([{
        path: "/project/pages/index.tsx",
        content: '<div className="text-blue-500">Feature</div>',
      }]);
      const feature = await handler.handle(request, branchContext("feature"));
      const featureCSS = await feature.response!.text();

      // Leave candidate manifests warm while forcing the third request past
      // prepared and generated CSS caches.
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCSS(PROJECT_SLUG);
      adapter.setFiles([{
        path: "/project/pages/index.tsx",
        content: '<div className="text-green-500">Candidate</div>',
      }]);
      const candidate = await handler.handle(request, branchContext("candidate"));
      const candidateCSS = await candidate.response!.text();

      assertEquals(main.response!.status, 200);
      assertEquals(feature.response!.status, 200);
      assertEquals(candidate.response!.status, 200);
      assertEquals(featureCSS === mainCSS, false);
      assertEquals(candidateCSS === mainCSS, false);
      assertEquals(candidateCSS === featureCSS, false);
    } finally {
      fetchMock.restore();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);
    }
  });

  it("fails closed when branch artifact access has no exact branch selector", async () => {
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

    const result = await handler.handle(req, ctx);
    const problem = await result.response!.json() as Record<string, unknown>;

    assertEquals(result.response!.status, 502);
    assertEquals(String(problem.detail).includes("requires an exact branch selector"), true);
    assertEquals(resolveCalls, 0);
    assertEquals(upsertCalls, 0);
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

  it("does not cache prepared CSS when artifact registration fails", async () => {
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
    const handler = new StylesCSSHandler();
    const ctx = makeCtx(adapter);

    try {
      clearCSSCache();
      invalidateProjectCSS(PROJECT_SLUG);
      invalidatePreparedProjectCSS(PROJECT_SLUG);
      invalidateProjectCandidateManifests(PROJECT_SLUG);

      for (let attempt = 1; attempt <= 2; attempt++) {
        const result = await handler.handle(
          new Request("http://localhost/_vf_styles/styles.css"),
          ctx,
        );
        const problem = await result.response!.json() as Record<string, unknown>;

        assertEquals(result.response!.status, 503);
        assertEquals(String(problem.detail).includes("artifact registration unavailable"), true);
        assertEquals(upsertCalls, attempt);
      }
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
