/**
 * Render Mode Router Tests
 *
 * Tests for the render mode router that dispatches between JIT and legacy renderers.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getEffectiveRenderMode, shouldUseJitRenderer } from "./render-mode-router.ts";
import { _resetRuntimeEnv, _setRuntimeEnvForTesting } from "#veryfront/config/runtime-env.ts";
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
    it("should return on-demand when bundler is disabled", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: false,
        renderMode: "jit-bundle",
      });

      const mode = getEffectiveRenderMode();
      assertEquals(mode, "on-demand");
    });

    it("should return configured render mode when bundler is enabled", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: true,
        renderMode: "jit-bundle",
      });

      const mode = getEffectiveRenderMode();
      assertEquals(mode, "jit-bundle");
    });

    it("should return watch for preview development context", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: true,
        renderMode: "on-demand",
      });

      const ctx = createMockContext({
        environment: "preview",
        mode: "development",
      });

      const mode = getEffectiveRenderMode(ctx);
      assertEquals(mode, "watch");
    });

    it("should respect jit-bundle for production context", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: true,
        renderMode: "jit-bundle",
      });

      const ctx = createMockContext({
        environment: "production",
        mode: "production",
      });

      const mode = getEffectiveRenderMode(ctx);
      assertEquals(mode, "jit-bundle");
    });

    it("should fallback to on-demand for production when configured", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: true,
        renderMode: "on-demand",
      });

      const ctx = createMockContext({
        environment: "production",
        mode: "production",
      });

      const mode = getEffectiveRenderMode(ctx);
      assertEquals(mode, "on-demand");
    });
  });

  describe("shouldUseJitRenderer", () => {
    it("should return true when mode is jit-bundle", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: true,
        renderMode: "jit-bundle",
      });

      const ctx = createMockContext({
        environment: "production",
        mode: "production",
      });

      const result = shouldUseJitRenderer(ctx);
      assertEquals(result, true);
    });

    it("should return false when mode is on-demand", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: true,
        renderMode: "on-demand",
      });

      const ctx = createMockContext({
        environment: "production",
        mode: "production",
      });

      const result = shouldUseJitRenderer(ctx);
      assertEquals(result, false);
    });

    it("should return false when bundler is disabled", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: false,
        renderMode: "jit-bundle",
      });

      const result = shouldUseJitRenderer();
      assertEquals(result, false);
    });

    it("should return false for preview development mode (uses watch)", () => {
      _setRuntimeEnvForTesting({
        bundlerEnabled: true,
        renderMode: "jit-bundle",
      });

      const ctx = createMockContext({
        environment: "preview",
        mode: "development",
      });

      const result = shouldUseJitRenderer(ctx);
      assertEquals(result, false);
    });
  });
});
