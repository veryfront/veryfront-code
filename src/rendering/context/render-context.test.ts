import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createCacheKey,
  createRenderContext,
  createRenderContextFromEnriched,
  isSameTenant,
  parseCacheKey,
  type RenderContext,
} from "./render-context.ts";
import type { EnrichedContext } from "#veryfront/server/context/enriched-context.ts";
import type { HandlerContext } from "#veryfront/server/handlers/types.ts";
import { VERSION } from "#veryfront/utils/version.ts";

const mockAdapter = {
  fs: {
    readFile: () => Promise.resolve(""),
    writeFile: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    readDir: () => (async function* () {})(),
    stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0 }),
    mkdir: () => Promise.resolve(),
    rm: () => Promise.resolve(),
    readBinaryFile: () => Promise.resolve(new Uint8Array()),
    writeBinaryFile: () => Promise.resolve(),
  },
} as unknown as RenderContext["adapter"];

const mockConfig = {
  directories: {},
  cache: {},
} as unknown as RenderContext["config"];

function createHandlerContext(
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: "/projects/test-project",
    adapter: mockAdapter,
    config: mockConfig,
    securityConfig: null,
    ...overrides,
  };
}

function createRenderContextFixture(
  overrides: Partial<RenderContext> = {},
): RenderContext {
  return {
    projectId: "proj_123",
    projectSlug: "test-project",
    projectDir: "/projects/test-project",
    config: mockConfig,
    mode: "production",
    adapter: mockAdapter,
    cachePrefix: "proj_123:production:rel_456",
    environment: "production",
    contentSourceId: "release-rel_456",
    releaseId: "rel_456",
    ...overrides,
  };
}

function makeMockRenderContext(
  overrides: Partial<RenderContext> = {},
): RenderContext {
  return {
    projectId: "proj-123",
    projectSlug: "my-project",
    projectDir: "/project",
    config: {} as RenderContext["config"],
    mode: "production",
    adapter: {} as RenderContext["adapter"],
    cachePrefix: "proj-123:production:release-abc",
    environment: "production",
    contentSourceId: "release-abc",
    ...overrides,
  };
}

function makeEnrichedContext(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    projectId: "p1",
    projectSlug: "slug",
    projectDir: "/dir",
    token: "token",
    branch: null,
    isLocalProject: false,
    parsedDomain: {} as EnrichedContext["parsedDomain"],
    createdAt: 0,
    config: {} as EnrichedContext["config"],
    adapter: {} as EnrichedContext["adapter"],
    cachePrefix: "prefix",
    environment: "production",
    contentSourceId: "release-x",
    mode: "production",
    ...overrides,
  };
}

describe("rendering/context/render-context", () => {
  describe("createRenderContext", () => {
    it("creates context from handler context", () => {
      const handlerCtx: HandlerContext = createHandlerContext({
        projectId: "proj_123",
        projectSlug: "test-project",
        isLocalProject: true,
        requestContext: {
          mode: "production",
          slug: "test-project",
          branch: null,
          token: "token_xyz",
        },
        releaseId: "rel_456",
        proxyToken: "token_xyz",
      });

      const ctx = createRenderContext(handlerCtx);

      assertEquals(ctx.projectId, "proj_123");
      assertEquals(ctx.projectSlug, "test-project");
      assertEquals(ctx.projectDir, "/projects/test-project");
      // mode is "development" because isLocalProject=true
      assertEquals(ctx.mode, "development");
      assertEquals(ctx.environment, "production");
      assertEquals(ctx.releaseId, "rel_456");
      assertEquals(ctx.proxyToken, "token_xyz");
      // Local dev uses branch for cache prefix (no real releases in local dev)
      assertEquals(ctx.cachePrefix, `proj_123:production:main:${VERSION}:cdev`);
      // Local dev uses local-{branch} format
      assertEquals(ctx.contentSourceId, "local-main");
    });

    it("uses main branch for preview environment", () => {
      const handlerCtx: HandlerContext = createHandlerContext({
        projectId: "proj_123",
        projectSlug: "test-project",
        isLocalProject: true,
        requestContext: {
          mode: "preview",
          slug: "test-project",
          branch: null,
          token: "",
        },
      });

      const ctx = createRenderContext(handlerCtx);

      assertEquals(ctx.environment, "preview");
      assertEquals(ctx.cachePrefix, `proj_123:preview:main:${VERSION}:cdev`);
      assertEquals(ctx.contentSourceId, "local-main");
    });

    it("separates the local development render cache from the hosted preview cache", () => {
      const shared = {
        projectId: "proj_1",
        projectSlug: "test-project",
        requestContext: {
          mode: "preview" as const,
          slug: "test-project",
          branch: "main",
          token: "",
        },
      };

      const localDev = createRenderContext(
        createHandlerContext({ ...shared, isLocalProject: true }),
      );
      const hostedPreview = createRenderContext(
        createHandlerContext({ ...shared, isLocalProject: false }),
      );

      // The two servers compile with different modes, so the hydration bundle
      // and page module they cache are not interchangeable.
      assertEquals(localDev.mode, "development");
      assertEquals(hostedPreview.mode, "production");
      assertEquals(localDev.cachePrefix === hostedPreview.cachePrefix, false);
    });

    it("throws without projectSlug or projectId", () => {
      const handlerCtx: HandlerContext = createHandlerContext({
        projectId: undefined,
        projectSlug: undefined,
      });

      assertThrows(
        () => createRenderContext(handlerCtx),
        Error,
        "RenderContext requires projectSlug or projectId",
      );
    });

    it("throws without config", () => {
      const handlerCtx: HandlerContext = {
        projectDir: "/projects/test-project",
        projectId: "proj_123",
        adapter: mockAdapter,
        securityConfig: null,
      };

      assertThrows(
        () => createRenderContext(handlerCtx),
        Error,
        "RenderContext requires config to be pre-loaded",
      );
    });

    it("throws for production without releaseId (remote)", () => {
      const handlerCtx: HandlerContext = createHandlerContext({
        projectId: "proj_123",
        projectSlug: "test-project",
        requestContext: {
          mode: "production",
          slug: "test-project",
          branch: null,
          token: "",
        },
      });

      assertThrows(
        () => createRenderContext(handlerCtx),
        Error,
        "Missing releaseId for production contentSourceId",
      );
    });
  });

  describe("createCacheKey", () => {
    it("should combine cache prefix and content key", () => {
      const ctx = makeMockRenderContext({
        cachePrefix: "proj-123:production:release-abc",
      });
      const key = createCacheKey(ctx, "page:/index");
      assertEquals(typeof key, "string");
      assertEquals(key.length > 0, true);
      assertEquals(key.includes("page:/index"), true);
    });

    it("should produce different keys for different slugs", () => {
      const ctx = makeMockRenderContext();
      const key1 = createCacheKey(ctx, "page:/about");
      const key2 = createCacheKey(ctx, "page:/contact");
      assertEquals(key1 !== key2, true);
    });

    it("should produce different keys for different contexts", () => {
      const ctx1 = makeMockRenderContext({
        cachePrefix: "proj-1:production:release-a",
      });
      const ctx2 = makeMockRenderContext({
        cachePrefix: "proj-2:production:release-b",
      });
      const key1 = createCacheKey(ctx1, "page:/index");
      const key2 = createCacheKey(ctx2, "page:/index");
      assertEquals(key1 !== key2, true);
    });

    it("creates properly prefixed keys", () => {
      const ctx: RenderContext = createRenderContextFixture({
        cachePrefix: "proj_123:production:rel_456",
        contentSourceId: "release-rel_456",
        releaseId: "rel_456",
      });

      const cacheKey = createCacheKey(ctx, "page:blog/post");
      assertEquals(cacheKey, "proj_123:production:rel_456:page:blog/post");
    });

    it("creates different keys for different projects", () => {
      const ctxA: RenderContext = createRenderContextFixture({
        projectId: "proj_A",
        projectSlug: "project-a",
        projectDir: "/projects/a",
        cachePrefix: "proj_A:production:v1",
        contentSourceId: "release-v1",
        releaseId: "v1",
      });

      const ctxB: RenderContext = createRenderContextFixture({
        projectId: "proj_B",
        projectSlug: "project-b",
        projectDir: "/projects/b",
        cachePrefix: "proj_B:production:v1",
        contentSourceId: "release-v1",
        releaseId: "v1",
      });

      const keyA = createCacheKey(ctxA, "page:index");
      const keyB = createCacheKey(ctxB, "page:index");

      assertEquals(keyA, "proj_A:production:v1:page:index");
      assertEquals(keyB, "proj_B:production:v1:page:index");
      assertEquals(keyA !== keyB, true);
    });

    it("creates different keys for different releases", () => {
      const ctxV1: RenderContext = createRenderContextFixture({
        projectDir: "/projects/test",
        cachePrefix: "proj_123:production:v1",
        contentSourceId: "release-v1",
        releaseId: "v1",
      });

      const ctxV2: RenderContext = {
        ...ctxV1,
        cachePrefix: "proj_123:production:v2",
        contentSourceId: "release-v2",
        releaseId: "v2",
      };

      const keyV1 = createCacheKey(ctxV1, "page:index");
      const keyV2 = createCacheKey(ctxV2, "page:index");

      assertEquals(keyV1 !== keyV2, true);
    });
  });

  describe("parseCacheKey", () => {
    it("parses valid cache keys", () => {
      const parsed = parseCacheKey(
        "proj_123:production:v1:0.0.75:page:blog/post",
      );

      assertEquals(parsed?.projectId, "proj_123");
      assertEquals(parsed?.environment, "production");
      assertEquals(parsed?.releaseKey, "v1");
      assertEquals(parsed?.version, "0.0.75");
      assertEquals(parsed?.contentKey, "page:blog/post");
    });

    it("returns null for invalid keys", () => {
      assertEquals(parseCacheKey("invalid"), null);
      assertEquals(parseCacheKey("too:short"), null);
      assertEquals(parseCacheKey("a:b:c"), null);
      assertEquals(parseCacheKey("a:b:c:d"), null);
    });
  });

  describe("isSameTenant", () => {
    it("should return true when cache prefixes match", () => {
      const a = makeMockRenderContext({ cachePrefix: "same-prefix" });
      const b = makeMockRenderContext({ cachePrefix: "same-prefix" });
      assertEquals(isSameTenant(a, b), true);
    });

    it("should return false when cache prefixes differ", () => {
      const a = makeMockRenderContext({ cachePrefix: "prefix-a" });
      const b = makeMockRenderContext({ cachePrefix: "prefix-b" });
      assertEquals(isSameTenant(a, b), false);
    });

    it("returns true for same tenant", () => {
      const ctxA: RenderContext = createRenderContextFixture({
        projectDir: "/projects/test",
        cachePrefix: "proj_123:production:v1",
        contentSourceId: "release-v1",
        releaseId: "v1",
      });

      const ctxB: RenderContext = { ...ctxA };

      assertEquals(isSameTenant(ctxA, ctxB), true);
    });

    it("returns false for different tenants", () => {
      const ctxA: RenderContext = createRenderContextFixture({
        projectId: "proj_A",
        projectSlug: "project-a",
        projectDir: "/projects/a",
        cachePrefix: "proj_A:production:v1",
        contentSourceId: "release-v1",
        releaseId: "v1",
      });

      const ctxB: RenderContext = createRenderContextFixture({
        projectId: "proj_B",
        projectSlug: "project-b",
        projectDir: "/projects/b",
        cachePrefix: "proj_B:production:v1",
        contentSourceId: "release-v1",
        releaseId: "v1",
      });

      assertEquals(isSameTenant(ctxA, ctxB), false);
    });
  });

  describe("createRenderContextFromEnriched", () => {
    it("should throw when enriched context is missing config", () => {
      const enriched = makeEnrichedContext({ config: undefined });
      assertThrows(
        () => createRenderContextFromEnriched(enriched),
        Error,
        "missing required config",
      );
    });

    it("should throw when enriched context is missing adapter", () => {
      const enriched = makeEnrichedContext({ adapter: undefined });
      assertThrows(
        () => createRenderContextFromEnriched(enriched),
        Error,
        "missing required adapter",
      );
    });

    it("should throw when enriched context is missing contentSourceId", () => {
      const enriched = makeEnrichedContext({ contentSourceId: undefined });
      assertThrows(
        () => createRenderContextFromEnriched(enriched),
        Error,
        "missing required contentSourceId",
      );
    });

    it("should create render context from valid enriched context", () => {
      const enriched = makeEnrichedContext({
        config: { dev: { port: 3000 } },
        adapter: { fs: {} } as EnrichedContext["adapter"],
        branch: "main",
        releaseId: "r1",
        token: "tok-123",
        moduleServerUrl: "http://modules.local",
        nonce: "abc",
        allowHostProjectCodeExecution: true,
      });

      const ctx = createRenderContextFromEnriched(enriched);
      assertEquals(ctx.projectId, "p1");
      assertEquals(ctx.projectSlug, "slug");
      assertEquals(ctx.projectDir, "/dir");
      assertEquals(ctx.environment, "production");
      assertEquals(ctx.contentSourceId, "release-x");
      assertEquals(ctx.branch, "main");
      assertEquals(ctx.releaseId, "r1");
      assertEquals(ctx.proxyToken, "tok-123");
      assertEquals(ctx.nonce, "abc");
      assertEquals(ctx.allowHostProjectCodeExecution, true);
    });

    it("should not infer host execution from a non-local enriched context", () => {
      const ctx = createRenderContextFromEnriched(
        makeEnrichedContext({ isLocalProject: false }),
      );

      assertEquals(ctx.allowHostProjectCodeExecution, false);
    });

    it("should apply options overrides", () => {
      const enriched = makeEnrichedContext();

      const ctx = createRenderContextFromEnriched(enriched, {
        port: 8080,
        moduleServerUrl: "http://custom:9090",
        nonce: "custom-nonce",
      });
      assertEquals(ctx.port, 8080);
      assertEquals(ctx.moduleServerUrl, "http://custom:9090");
      assertEquals(ctx.nonce, "custom-nonce");
    });
  });
});
