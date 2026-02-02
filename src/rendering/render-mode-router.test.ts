/**
 * Render Mode Router Tests
 *
 * Tests for the render mode router that uses the JIT renderer.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getEffectiveRenderMode, shouldUseJitRenderer } from "./render-mode-router.ts";
import { _resetRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import type { RenderContext } from "./context/render-context.ts";

// Mock minimal RenderContext for testing
function createMockContext(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    projectId: "test-project",
    projectSlug: "test-slug",
    projectDir: "/test/project",
    environment: "preview",
    mode: "development",
    config: {},
    adapter: {} as any,
    contentSourceId: "test-branch",
    moduleServerUrl: "http://localhost:3001",
    debug: false,
    ...overrides,
  } as RenderContext;
}

describe("rendering/render-mode-router", () => {
  beforeEach(() => {
    _resetRuntimeEnv();
  });

  afterEach(() => {
    _resetRuntimeEnv();
  });

  describe("getEffectiveRenderMode", () => {
    it("should always return jit-bundle (deprecated function)", () => {
      const mode = getEffectiveRenderMode();
      assertEquals(mode, "jit-bundle");
    });

    it("should return jit-bundle for production context", () => {
      const ctx = createMockContext({
        environment: "production",
        mode: "production",
      });

      const mode = getEffectiveRenderMode(ctx);
      assertEquals(mode, "jit-bundle");
    });

    it("should return jit-bundle for preview development context", () => {
      const ctx = createMockContext({
        environment: "preview",
        mode: "development",
      });

      const mode = getEffectiveRenderMode(ctx);
      assertEquals(mode, "jit-bundle");
    });

    it("should return jit-bundle when no context provided", () => {
      const mode = getEffectiveRenderMode();
      assertEquals(mode, "jit-bundle");
    });
  });

  describe("shouldUseJitRenderer", () => {
    it("should return true for production context", () => {
      const ctx = createMockContext({
        environment: "production",
        mode: "production",
      });

      const result = shouldUseJitRenderer(ctx);
      assertEquals(result, true);
    });

    it("should return true regardless of context (JIT is the only renderer)", () => {
      const result = shouldUseJitRenderer();
      assertEquals(result, true);
    });

    it("should return true for preview development mode", () => {
      const ctx = createMockContext({
        environment: "preview",
        mode: "development",
      });

      const result = shouldUseJitRenderer(ctx);
      assertEquals(result, true);
    });
  });
});
