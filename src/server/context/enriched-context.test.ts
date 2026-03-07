import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { HandlerContext, ParsedDomain } from "#veryfront/types";
import {
  buildEnrichedContext,
  type BuildEnrichedContextOptions,
  type EnrichedContext,
  shouldUseNoCacheHeadersFromHandler,
} from "./enriched-context.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubAdapter = {} as RuntimeAdapter;
const stubConfig = {} as VeryfrontConfig;
const stubParsedDomain: ParsedDomain = {
  slug: "my-project",
  branch: null,
  environment: "production",
  isVeryfrontDomain: true,
  isDraft: false,
  allowIframeEmbed: false,
};

function makeOptions(
  overrides: Partial<BuildEnrichedContextOptions> = {},
): BuildEnrichedContextOptions {
  return {
    projectId: "proj_1",
    projectSlug: "my-project",
    projectDir: "/projects/my-project",
    token: "tok_abc",
    environment: "production",
    branch: null,
    isLocalProject: false,
    contentSourceId: "release-abc123",
    parsedDomain: stubParsedDomain,
    adapter: stubAdapter,
    config: stubConfig,
    ...overrides,
  };
}

function makeEnriched(
  overrides: Partial<EnrichedContext> = {},
): EnrichedContext {
  return {
    projectId: "proj_1",
    projectSlug: "my-project",
    projectDir: "/projects/my-project",
    token: "tok_abc",
    environment: "production",
    branch: null,
    isLocalProject: false,
    mode: "production",
    contentSourceId: "release-abc123",
    parsedDomain: stubParsedDomain,
    adapter: stubAdapter,
    config: stubConfig,
    cachePrefix: "proj_1:production:unknown:v1",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enriched-context", () => {
  // -----------------------------------------------------------------------
  // buildEnrichedContext
  // -----------------------------------------------------------------------
  describe("buildEnrichedContext", () => {
    it("should throw when contentSourceId is missing (empty string)", () => {
      assertThrows(
        () => buildEnrichedContext(makeOptions({ contentSourceId: "" })),
        Error,
        "Missing contentSourceId for my-project",
      );
    });

    it("should build enriched context with all required fields", () => {
      const ctx = buildEnrichedContext(makeOptions());
      assertEquals(ctx.projectId, "proj_1");
      assertEquals(ctx.projectSlug, "my-project");
      assertEquals(ctx.projectDir, "/projects/my-project");
      assertEquals(ctx.token, "tok_abc");
      assertEquals(ctx.environment, "production");
      assertEquals(ctx.branch, null);
      assertEquals(ctx.isLocalProject, false);
      assertEquals(ctx.contentSourceId, "release-abc123");
      assertEquals(ctx.adapter, stubAdapter);
      assertEquals(ctx.config, stubConfig);
      assertEquals(ctx.parsedDomain, stubParsedDomain);
      assertEquals(typeof ctx.createdAt, "number");
    });

    it("should set mode to 'development' for local projects", () => {
      const ctx = buildEnrichedContext(makeOptions({ isLocalProject: true }));
      assertEquals(ctx.mode, "development");
    });

    it("should set mode to 'production' for non-local projects", () => {
      const ctx = buildEnrichedContext(makeOptions({ isLocalProject: false }));
      assertEquals(ctx.mode, "production");
    });

    it("should use releaseId as releaseKey in production environment", () => {
      const ctx = buildEnrichedContext(
        makeOptions({ environment: "production", releaseId: "rel_99" }),
      );
      // cachePrefix = buildRenderCachePrefix("proj_1", "production", "rel_99")
      assertEquals(ctx.cachePrefix.includes("rel_99"), true);
      assertEquals(ctx.cachePrefix.startsWith("proj_1:production:rel_99:"), true);
    });

    it("should fallback to 'unknown' when releaseId is undefined in production", () => {
      const ctx = buildEnrichedContext(
        makeOptions({ environment: "production", releaseId: undefined }),
      );
      assertEquals(ctx.cachePrefix.startsWith("proj_1:production:unknown:"), true);
    });

    it("should use branch as releaseKey in preview environment", () => {
      const ctx = buildEnrichedContext(
        makeOptions({ environment: "preview", branch: "feat-x" }),
      );
      assertEquals(ctx.cachePrefix.startsWith("proj_1:preview:feat-x:"), true);
    });

    it("should fallback to 'main' when branch is null in preview", () => {
      const ctx = buildEnrichedContext(
        makeOptions({ environment: "preview", branch: null }),
      );
      assertEquals(ctx.cachePrefix.startsWith("proj_1:preview:main:"), true);
    });

    it("should pass through optional fields (moduleServerUrl, nonce, debug)", () => {
      const ctx = buildEnrichedContext(
        makeOptions({
          moduleServerUrl: "https://modules.example.com",
          nonce: "abc123",
          debug: true,
        }),
      );
      assertEquals(ctx.moduleServerUrl, "https://modules.example.com");
      assertEquals(ctx.nonce, "abc123");
      assertEquals(ctx.debug, true);
    });

    it("should leave optional fields undefined when not provided", () => {
      const ctx = buildEnrichedContext(makeOptions());
      assertEquals(ctx.moduleServerUrl, undefined);
      assertEquals(ctx.nonce, undefined);
      assertEquals(ctx.debug, undefined);
      assertEquals(ctx.releaseId, undefined);
      assertEquals(ctx.environmentName, undefined);
      assertEquals(ctx.projectData, undefined);
    });

    it("should pass through releaseId, environmentName, projectData", () => {
      const projectData = { id: "pd_1", slug: "my-project", name: "My Project" };
      const ctx = buildEnrichedContext(
        makeOptions({
          releaseId: "rel_1",
          environmentName: "Production",
          projectData,
        }),
      );
      assertEquals(ctx.releaseId, "rel_1");
      assertEquals(ctx.environmentName, "Production");
      assertEquals(ctx.projectData, projectData);
    });
  });

  // -----------------------------------------------------------------------
  // shouldUseNoCacheHeadersFromHandler
  // -----------------------------------------------------------------------
  describe("shouldUseNoCacheHeadersFromHandler", () => {
    it("should delegate to enriched when enriched is present (local)", () => {
      const ctx = {
        enriched: makeEnriched({ isLocalProject: true }),
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), true);
    });

    it("should delegate to enriched when enriched is present (non-local production)", () => {
      const ctx = {
        enriched: makeEnriched({ isLocalProject: false, environment: "production" }),
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), false);
    });

    it("should delegate to enriched when enriched is present (preview)", () => {
      const ctx = {
        enriched: makeEnriched({ isLocalProject: false, environment: "preview" }),
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), true);
    });

    it("should return true when enriched is absent and isLocalProject is true", () => {
      const ctx = {
        isLocalProject: true,
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), true);
    });

    it("should use resolvedEnvironment when enriched is absent", () => {
      const ctx = {
        resolvedEnvironment: "preview",
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), true);
    });

    it("should return false when resolvedEnvironment is production", () => {
      const ctx = {
        resolvedEnvironment: "production",
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), false);
    });

    it("should fallback to requestContext.mode when resolvedEnvironment is undefined", () => {
      const ctx = {
        requestContext: { token: "", slug: "", branch: null, mode: "preview" as const },
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), true);
    });

    it("should return false when requestContext.mode is production", () => {
      const ctx = {
        requestContext: { token: "", slug: "", branch: null, mode: "production" as const },
      } as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), false);
    });

    it("should return false when all fallback fields are absent", () => {
      const ctx = {} as HandlerContext;
      assertEquals(shouldUseNoCacheHeadersFromHandler(ctx), false);
    });
  });
});
