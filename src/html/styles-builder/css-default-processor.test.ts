import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  CSSOptimizationEngineName,
  type CSSProcessor,
  CSSProcessorName,
} from "#veryfront/extensions/css/index.ts";
import { createTestCSSOptimizationEngine } from "../../../tests/_helpers/css-optimization-engine.ts";
import { TailwindCSSProcessor } from "../../../extensions/ext-css-tailwind/src/index.ts";
import { registerTailwindExtension } from "./__tests__/css-processor-setup.ts";
import { generateCSS, getCSSCompilationCacheIdentity, invalidateCompiler } from "./css-compiler.ts";

describe("styles-builder explicit CSSProcessor", () => {
  beforeEach(() => {
    reset();
    register(CSSOptimizationEngineName, createTestCSSOptimizationEngine());
    invalidateCompiler();
  });

  afterEach(() => {
    reset();
    invalidateCompiler();
  });

  it("fails clearly instead of auto-loading or returning empty CSS", async () => {
    await assertRejects(
      () =>
        generateCSS('@import "tailwindcss";', ["text-red-500"], {
          minify: true,
          projectSlug: "vf-missing-css-processor",
        }),
      Error,
      'Missing extension for contract "CSSProcessor"',
    );
    assertEquals(tryResolve<CSSProcessor>(CSSProcessorName), undefined);
  });

  it("uses only an explicitly registered processor and its complete identity", async () => {
    await registerTailwindExtension();
    const processor = tryResolve<CSSProcessor>(CSSProcessorName);
    if (!processor) throw new Error("CSSProcessor was not registered");
    const identity = await getCSSCompilationCacheIdentity();
    const result = await generateCSS(
      '@import "tailwindcss";',
      ["text-red-500"],
      { minify: true, projectSlug: "vf-explicit-css-processor" },
    );

    assertEquals(processor instanceof TailwindCSSProcessor, true);
    assertEquals(identity.includes(processor.cacheIdentity), true);
    assertEquals(result.css.includes(".text-red-500"), true);
  });

  it("uses and identifies the processor-owned default stylesheet", async () => {
    let compiledStylesheet: string | undefined;
    const createProcessor = (defaultStylesheet: string): CSSProcessor => ({
      cacheIdentity: "test-provider-default@1",
      defaultStylesheet,
      compile(stylesheet) {
        compiledStylesheet = stylesheet;
        return Promise.resolve({ build: () => stylesheet });
      },
    });
    register(CSSProcessorName, createProcessor("provider-default-a"));
    const identityA = await getCSSCompilationCacheIdentity();
    const result = await generateCSS(undefined, [], { minify: false });

    reset();
    register(CSSProcessorName, createProcessor("provider-default-b"));
    const identityB = await getCSSCompilationCacheIdentity();

    assertEquals(compiledStylesheet, "provider-default-a");
    assertEquals(result.css, "provider-default-a");
    assertNotEquals(identityA, identityB);
  });

  it("does not invoke an accessor-backed processor default", async () => {
    let accessorCalls = 0;
    const processor = {
      cacheIdentity: "hostile-provider-default@1",
      compile: () => Promise.resolve({ build: () => "wrong" }),
    } as Record<string, unknown>;
    Object.defineProperty(processor, "defaultStylesheet", {
      get() {
        accessorCalls++;
        return "wrong";
      },
    });
    register(CSSProcessorName, processor as unknown as CSSProcessor);

    await assertRejects(
      () => getCSSCompilationCacheIdentity(),
      TypeError,
      "defaultStylesheet",
    );
    assertEquals(accessorCalls, 0);
  });
});
