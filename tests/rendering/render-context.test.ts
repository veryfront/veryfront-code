/**
 * RenderContext Tests
 *
 * Tests for the render context module, ensuring proper tenant isolation
 * through cache key generation and context creation.
 */

import { assertEquals, assertThrows } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import {
  createCacheKey,
  createRenderContext,
  isSameTenant,
  parseCacheKey,
  type RenderContext,
} from "../../src/rendering/context/render-context.ts";
import type { HandlerContext } from "../../src/server/handlers/types.ts";
import { VERSION } from "../../src/utils/version.ts";

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
};

const mockConfig = {
  directories: {},
  cache: {},
};

function createHandlerContext(
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: "/projects/test-project",
    adapter: mockAdapter as any,
    config: mockConfig as any,
    securityConfig: null,
    cspUserHeader: null,
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
    config: mockConfig as any,
    mode: "production",
    adapter: mockAdapter as any,
    cachePrefix: "proj_123:production:rel_456",
    environment: "production",
    contentSourceId: "release-rel_456",
    releaseId: "rel_456",
    ...overrides,
  };
}

describe("RenderContext", () => {
  describe("createRenderContext", () => {
    it("creates context from handler context", () => {
      const handlerCtx: HandlerContext = createHandlerContext({
        projectId: "proj_123",
        projectSlug: "test-project",
        requestContext: {
          mode: "production",
          slug: "test-project",
          branch: null,
          token: "token_xyz",
          isLocalDev: true,
        },
        releaseId: "rel_456",
        proxyToken: "token_xyz",
      });

      const ctx = createRenderContext(handlerCtx);

      assertEquals(ctx.projectId, "proj_123");
      assertEquals(ctx.projectSlug, "test-project");
      assertEquals(ctx.projectDir, "/projects/test-project");
      // mode is "development" because isLocalDev=true
      assertEquals(ctx.mode, "development");
      assertEquals(ctx.environment, "production");
      assertEquals(ctx.releaseId, "rel_456");
      assertEquals(ctx.proxyToken, "token_xyz");
      // Local dev uses branch for cache prefix (no real releases in local dev)
      assertEquals(ctx.cachePrefix, `proj_123:production:main:${VERSION}`);
      // Local dev uses local-{branch} format
      assertEquals(ctx.contentSourceId, "local-main");
    });

    it("uses main branch for preview environment", () => {
      const handlerCtx: HandlerContext = createHandlerContext({
        projectId: "proj_123",
        projectSlug: "test-project",
        requestContext: {
          mode: "preview",
          slug: "test-project",
          branch: null,
          token: "",
          isLocalDev: true,
        },
      });

      const ctx = createRenderContext(handlerCtx);

      assertEquals(ctx.environment, "preview");
      assertEquals(ctx.cachePrefix, `proj_123:preview:main:${VERSION}`);
      assertEquals(ctx.contentSourceId, "local-main");
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
        adapter: mockAdapter as any,
        securityConfig: null,
        cspUserHeader: null,
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
          isLocalDev: false,
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
});
