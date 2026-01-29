import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createCacheKey,
  createRenderContextFromEnriched,
  isSameTenant,
  type RenderContext,
} from "./render-context.ts";

function makeMockRenderContext(overrides: Partial<RenderContext> = {}): RenderContext {
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

describe("rendering/context/render-context", () => {
  describe("createCacheKey", () => {
    it("should combine cache prefix and content key", () => {
      const ctx = makeMockRenderContext({ cachePrefix: "proj-123:production:release-abc" });
      const key = createCacheKey(ctx, "page:/index");
      assertEquals(typeof key, "string");
      assertEquals(key.length > 0, true);
      // Should contain the content key somehow
      assertEquals(key.includes("page:/index"), true);
    });

    it("should produce different keys for different slugs", () => {
      const ctx = makeMockRenderContext();
      const key1 = createCacheKey(ctx, "page:/about");
      const key2 = createCacheKey(ctx, "page:/contact");
      assertEquals(key1 !== key2, true);
    });

    it("should produce different keys for different contexts", () => {
      const ctx1 = makeMockRenderContext({ cachePrefix: "proj-1:production:release-a" });
      const ctx2 = makeMockRenderContext({ cachePrefix: "proj-2:production:release-b" });
      const key1 = createCacheKey(ctx1, "page:/index");
      const key2 = createCacheKey(ctx2, "page:/index");
      assertEquals(key1 !== key2, true);
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
  });

  describe("createRenderContextFromEnriched", () => {
    it("should throw when enriched context is missing config", () => {
      const enriched = {
        projectId: "p1",
        projectSlug: "slug",
        projectDir: "/dir",
        config: undefined,
        adapter: {},
        cachePrefix: "prefix",
        environment: "production",
        contentSourceId: "release-x",
        mode: "production",
      };
      assertThrows(
        () => createRenderContextFromEnriched(enriched as any),
        Error,
        "missing required config",
      );
    });

    it("should throw when enriched context is missing adapter", () => {
      const enriched = {
        projectId: "p1",
        projectSlug: "slug",
        projectDir: "/dir",
        config: {},
        adapter: undefined,
        cachePrefix: "prefix",
        environment: "production",
        contentSourceId: "release-x",
        mode: "production",
      };
      assertThrows(
        () => createRenderContextFromEnriched(enriched as any),
        Error,
        "missing required adapter",
      );
    });

    it("should throw when enriched context is missing contentSourceId", () => {
      const enriched = {
        projectId: "p1",
        projectSlug: "slug",
        projectDir: "/dir",
        config: {},
        adapter: {},
        cachePrefix: "prefix",
        environment: "production",
        contentSourceId: undefined,
        mode: "production",
      };
      assertThrows(
        () => createRenderContextFromEnriched(enriched as any),
        Error,
        "missing required contentSourceId",
      );
    });

    it("should create render context from valid enriched context", () => {
      const enriched = {
        projectId: "p1",
        projectSlug: "slug",
        projectDir: "/dir",
        config: { dev: { port: 3000 } },
        adapter: { fs: {} },
        cachePrefix: "prefix",
        environment: "production" as const,
        contentSourceId: "release-x",
        mode: "production" as const,
        branch: "main",
        releaseId: "r1",
        token: "tok-123",
        moduleServerUrl: "http://modules.local",
        nonce: "abc",
      };

      const ctx = createRenderContextFromEnriched(enriched as any);
      assertEquals(ctx.projectId, "p1");
      assertEquals(ctx.projectSlug, "slug");
      assertEquals(ctx.projectDir, "/dir");
      assertEquals(ctx.environment, "production");
      assertEquals(ctx.contentSourceId, "release-x");
      assertEquals(ctx.branch, "main");
      assertEquals(ctx.releaseId, "r1");
      assertEquals(ctx.proxyToken, "tok-123");
      assertEquals(ctx.nonce, "abc");
    });

    it("should apply options overrides", () => {
      const enriched = {
        projectId: "p1",
        projectSlug: "slug",
        projectDir: "/dir",
        config: {},
        adapter: {},
        cachePrefix: "prefix",
        environment: "production" as const,
        contentSourceId: "release-x",
        mode: "production" as const,
      };

      const ctx = createRenderContextFromEnriched(enriched as any, {
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
