import "#veryfront/schemas/_test-setup.ts";
// Activates the @veryfront/ext-css-tailwind CSSProcessor so the pure
// `generateCSS` compile path resolves a real compiler.
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTestCSSOptimizationEngine,
  installTestCSSOptimizationEngine,
} from "../../tests/_helpers/css-optimization-engine.ts";
import {
  isCSSPipelineIdentity,
  isStyleProfileHash,
} from "#veryfront/utils/css-artifact-identity.ts";
import { acquireCSSGenerationSession } from "#veryfront/html/styles-builder/css-compiler.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createCompileProjectCss } from "./css-compile.ts";

const RELEASE_CONFIG = { config: {} as VeryfrontConfig };

describe("release-assets/css-compile", () => {
  let restoreCSSOptimizationEngine: (() => void) | undefined;

  beforeEach(() => {
    restoreCSSOptimizationEngine = installTestCSSOptimizationEngine();
  });

  afterEach(() => {
    restoreCSSOptimizationEngine?.();
    restoreCSSOptimizationEngine = undefined;
  });

  it("returns the canonical profile and exact pipeline identities used for compilation", async () => {
    const compile = createCompileProjectCss({ projectScope: "css-compile-test" });
    const expectedPipelineIdentity = (await acquireCSSGenerationSession(true)).cacheIdentity;

    const candidates = new Set(["p-4", "text-red-500", "flex"]);
    const result = await compile(candidates, '@import "tailwindcss";', RELEASE_CONFIG);

    assert(result !== null, "expected a compiled result");
    assert(result.css.length > 0, "expected non-empty CSS output");
    // The compiled output should reference at least one requested utility.
    assert(
      result.css.includes("padding") || result.css.includes(".p-4"),
      "expected the p-4 utility to be present in the compiled CSS",
    );
    assert(isStyleProfileHash(result.styleProfileHash));
    assert(isCSSPipelineIdentity(result.cssPipelineIdentity));
    assertEquals(result.cssPipelineIdentity, expectedPipelineIdentity);
    assertStringIncludes(result.cssPipelineIdentity, "test-css-optimization-engine@1");
  });

  it("returns null only when there are no candidates AND no stylesheet", async () => {
    const compile = createCompileProjectCss({ projectScope: "css-compile-empty" });
    const result = await compile(new Set<string>(), undefined, RELEASE_CONFIG);
    assertEquals(result, null);
  });

  it("compiles base/custom CSS from a stylesheet even without candidates", async () => {
    const compile = createCompileProjectCss({ projectScope: "css-compile-stylesheet-only" });
    const result = await compile(
      new Set<string>(),
      '@import "tailwindcss"; :root { --brand: #123456; }',
      RELEASE_CONFIG,
    );
    // Stylesheet-only compiles must not be skipped: base/custom rules ship.
    assertExists(result);
    assert(result.css.length > 0, "stylesheet-only compile produced CSS");
  });

  it("propagates compiler failures instead of publishing a CSS gap", async () => {
    const compile = createCompileProjectCss({ projectScope: "css-compile-fail" });
    const candidates = new Set(["p-4"]);
    const restoreFailingEngine = installTestCSSOptimizationEngine(
      createTestCSSOptimizationEngine(() => {
        throw new Error("release CSS optimization failed");
      }, "test-failing-css-optimization-engine@1"),
    );
    try {
      await assertRejects(
        () => compile(candidates, '@import "tailwindcss";', RELEASE_CONFIG),
        Error,
        "release CSS optimization failed",
      );
    } finally {
      restoreFailingEngine();
    }
  });

  it("rejects invalid project scopes at configuration time", () => {
    assertThrows(() => createCompileProjectCss({ projectScope: "bad\nscope" }));
    assertThrows(() => createCompileProjectCss(null as never));
  });

  it("rejects malformed candidate input", async () => {
    const compile = createCompileProjectCss({ projectScope: "project-1" });
    const candidates = new Set<string>(["text-red-500", "bad\u0000candidate"]);

    await assertRejects(
      () => compile(candidates, undefined, RELEASE_CONFIG),
      TypeError,
      "candidate is invalid",
    );
  });
});
