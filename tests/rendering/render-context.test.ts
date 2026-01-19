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

// Mock adapter for testing
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

// Mock config for testing
const mockConfig = {
  directories: {},
  cache: {},
};

describe("RenderContext", () => {
  describe("createRenderContext", () => {
    it("creates context from handler context", () => {
      const handlerCtx: HandlerContext = {
        projectDir: "/projects/test-project",
        projectId: "proj_123",
        projectSlug: "test-project",
        mode: "production",
        adapter: mockAdapter as any,
        config: mockConfig as any,
        securityConfig: null,
        cspUserHeader: null,
        proxyEnvironment: "production",
        releaseId: "rel_456",
        proxyToken: "token_xyz",
      };

      const ctx = createRenderContext(handlerCtx);

      assertEquals(ctx.projectId, "proj_123");
      assertEquals(ctx.projectSlug, "test-project");
      assertEquals(ctx.projectDir, "/projects/test-project");
      assertEquals(ctx.mode, "production");
      assertEquals(ctx.environment, "production");
      assertEquals(ctx.releaseId, "rel_456");
      assertEquals(ctx.proxyToken, "token_xyz");
      assertEquals(ctx.cachePrefix, `proj_123:production:rel_456:${VERSION}`);
    });

    it("uses draft for preview environment", () => {
      const handlerCtx: HandlerContext = {
        projectDir: "/projects/test-project",
        projectId: "proj_123",
        projectSlug: "test-project",
        mode: "development",
        adapter: mockAdapter as any,
        config: mockConfig as any,
        securityConfig: null,
        cspUserHeader: null,
        proxyEnvironment: "preview",
      };

      const ctx = createRenderContext(handlerCtx);

      assertEquals(ctx.environment, "preview");
      assertEquals(ctx.cachePrefix, `proj_123:preview:draft:${VERSION}`);
    });

    it("uses __single__ for single-project mode", () => {
      const handlerCtx: HandlerContext = {
        projectDir: "/projects/test-project",
        mode: "development",
        adapter: mockAdapter as any,
        config: mockConfig as any,
        securityConfig: null,
        cspUserHeader: null,
      };

      const ctx = createRenderContext(handlerCtx);

      assertEquals(ctx.projectId, "__single__");
      assertEquals(ctx.projectSlug, "__single__");
      assertEquals(ctx.cachePrefix, `__single__:preview:draft:${VERSION}`);
    });

    it("throws without config", () => {
      const handlerCtx: HandlerContext = {
        projectDir: "/projects/test-project",
        projectId: "proj_123",
        mode: "development",
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
  });

  describe("createCacheKey", () => {
    it("creates properly prefixed keys", () => {
      const ctx: RenderContext = {
        projectId: "proj_123",
        projectSlug: "test-project",
        projectDir: "/projects/test-project",
        config: mockConfig as any,
        mode: "production",
        adapter: mockAdapter as any,
        cachePrefix: "proj_123:production:rel_456",
        environment: "production",
        releaseId: "rel_456",
      };

      const cacheKey = createCacheKey(ctx, "page:blog/post");
      assertEquals(cacheKey, "proj_123:production:rel_456:page:blog/post");
    });

    it("creates different keys for different projects", () => {
      const ctxA: RenderContext = {
        projectId: "proj_A",
        projectSlug: "project-a",
        projectDir: "/projects/a",
        config: mockConfig as any,
        mode: "production",
        adapter: mockAdapter as any,
        cachePrefix: "proj_A:production:v1",
        environment: "production",
        releaseId: "v1",
      };

      const ctxB: RenderContext = {
        projectId: "proj_B",
        projectSlug: "project-b",
        projectDir: "/projects/b",
        config: mockConfig as any,
        mode: "production",
        adapter: mockAdapter as any,
        cachePrefix: "proj_B:production:v1",
        environment: "production",
        releaseId: "v1",
      };

      const keyA = createCacheKey(ctxA, "page:index");
      const keyB = createCacheKey(ctxB, "page:index");

      // Same content key but different projects = different cache keys
      assertEquals(keyA, "proj_A:production:v1:page:index");
      assertEquals(keyB, "proj_B:production:v1:page:index");
      assertEquals(keyA !== keyB, true);
    });

    it("creates different keys for different releases", () => {
      const ctxV1: RenderContext = {
        projectId: "proj_123",
        projectSlug: "test-project",
        projectDir: "/projects/test",
        config: mockConfig as any,
        mode: "production",
        adapter: mockAdapter as any,
        cachePrefix: "proj_123:production:v1",
        environment: "production",
        releaseId: "v1",
      };

      const ctxV2: RenderContext = {
        ...ctxV1,
        cachePrefix: "proj_123:production:v2",
        releaseId: "v2",
      };

      const keyV1 = createCacheKey(ctxV1, "page:index");
      const keyV2 = createCacheKey(ctxV2, "page:index");

      assertEquals(keyV1 !== keyV2, true);
    });
  });

  describe("parseCacheKey", () => {
    it("parses valid cache keys", () => {
      const parsed = parseCacheKey("proj_123:production:v1:0.0.75:page:blog/post");

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
      assertEquals(parseCacheKey("a:b:c:d"), null); // Now needs 5 parts minimum
    });
  });

  describe("isSameTenant", () => {
    it("returns true for same tenant", () => {
      const ctxA: RenderContext = {
        projectId: "proj_123",
        projectSlug: "test-project",
        projectDir: "/projects/test",
        config: mockConfig as any,
        mode: "production",
        adapter: mockAdapter as any,
        cachePrefix: "proj_123:production:v1",
        environment: "production",
        releaseId: "v1",
      };

      const ctxB: RenderContext = {
        ...ctxA,
      };

      assertEquals(isSameTenant(ctxA, ctxB), true);
    });

    it("returns false for different tenants", () => {
      const ctxA: RenderContext = {
        projectId: "proj_A",
        projectSlug: "project-a",
        projectDir: "/projects/a",
        config: mockConfig as any,
        mode: "production",
        adapter: mockAdapter as any,
        cachePrefix: "proj_A:production:v1",
        environment: "production",
        releaseId: "v1",
      };

      const ctxB: RenderContext = {
        projectId: "proj_B",
        projectSlug: "project-b",
        projectDir: "/projects/b",
        config: mockConfig as any,
        mode: "production",
        adapter: mockAdapter as any,
        cachePrefix: "proj_B:production:v1",
        environment: "production",
        releaseId: "v1",
      };

      assertEquals(isSameTenant(ctxA, ctxB), false);
    });
  });
});
