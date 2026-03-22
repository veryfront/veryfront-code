import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
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
  contentContext: ResolvedContentContext,
  client?: Pick<VeryfrontApiClient, "resolveStyleArtifact" | "upsertStyleArtifact">,
): RuntimeAdapter & { setFiles: (nextFiles: Array<{ path: string; content?: string }>) => void } {
  const adapter = createMockAdapter();
  adapter.fs.files.set("/project/globals.css", TEST_STYLESHEET);
  let currentFiles = files;
  const underlyingAdapter: {
    getAllSourceFiles: () => Promise<Array<{ path: string; content?: string }>>;
    getContentContext: () => ResolvedContentContext;
    getClient?: () => Pick<VeryfrontApiClient, "resolveStyleArtifact" | "upsertStyleArtifact">;
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
  } as RuntimeAdapter & {
    setFiles: (nextFiles: Array<{ path: string; content?: string }>) => void;
  };
}

function makeCtx(adapter: RuntimeAdapter): HandlerContext {
  return {
    projectDir: "/project",
    adapter,
    securityConfig: null,
    cspUserHeader: null,
    projectSlug: PROJECT_SLUG,
  };
}

describe("server/handlers/dev/styles-css.handler", () => {
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

  it("resolves prepared CSS through style artifact metadata before rescanning files", async () => {
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
      upsertStyleArtifact: async (input: { artifactHash: string }) => {
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
});
