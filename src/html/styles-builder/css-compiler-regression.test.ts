import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { CSSOptimizationEngine } from "#veryfront/extensions/css/index.ts";
import { CSSOptimizationEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { createTestCSSOptimizationEngine } from "../../../tests/_helpers/css-optimization-engine.ts";
import {
  cacheCSSAsync,
  cacheCSSInputsAsync,
  clearCSSCache,
  generateCSS,
  getCompilerCacheStats,
  getCSSByHash,
  hashCSS,
  invalidateCompiler,
  regenerateCSSByHash,
} from "./css-compiler.ts";
import { persistRegeneratedCSSEntry } from "./css-hash-cache.ts";

const MOCK_TAILWIND_BASE_CSS = "@layer theme, base, components, utilities;";

function mockTailwindFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: URL | Request | string) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    if (!url.includes("tailwindcss")) {
      return Promise.reject(new Error(`Unexpected fetch URL during test: ${url}`));
    }

    return Promise.resolve(new Response(MOCK_TAILWIND_BASE_CSS, { status: 200 }));
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("styles-builder/css-compiler regressions", () => {
  let previousOptimizationEngine: CSSOptimizationEngine | undefined;

  beforeEach(() => {
    previousOptimizationEngine = tryResolve<CSSOptimizationEngine>(
      CSSOptimizationEngineName,
    );
    register(
      CSSOptimizationEngineName,
      createTestCSSOptimizationEngine(),
    );
    clearCSSCache();
    invalidateCompiler();
  });

  afterEach(() => {
    unregister(CSSOptimizationEngineName);
    if (previousOptimizationEngine !== undefined) {
      register(CSSOptimizationEngineName, previousOptimizationEngine);
    }
    previousOptimizationEngine = undefined;
    clearCSSCache();
    invalidateCompiler();
  });

  describe("candidate snapshot determinism", () => {
    it("matches a fresh build after another candidate snapshot compiled for the same project", async () => {
      const restoreFetch = mockTailwindFetch();

      try {
        const stylesheet = `
          @theme {
            --color-red-500: #ef4444;
            --color-blue-500: #3b82f6;
          }
          @tailwind utilities;
        `;
        const projectSlug = "vf-candidate-snapshot-determinism";

        await generateCSS(stylesheet, ["text-red-500"], {
          projectSlug,
        });
        const sequential = await generateCSS(stylesheet, ["text-blue-500"], {
          projectSlug,
        });

        invalidateCompiler();

        const fresh = await generateCSS(stylesheet, ["text-blue-500"], {
          projectSlug,
        });

        assertEquals(sequential.css, fresh.css);
        assertEquals(hashCSS(sequential.css), hashCSS(fresh.css));
      } finally {
        restoreFetch();
      }
    });
  });

  describe("regenerateCSSByHash", () => {
    it("rejects a caller-supplied hash that is not the CSS content identity", async () => {
      await assertRejects(
        () => cacheCSSAsync(".trusted{color:green}", "a".repeat(64)),
        TypeError,
        "does not match",
      );
    });

    it("rejects a regenerated entry whose content does not match its identity", async () => {
      await assertRejects(
        () =>
          persistRegeneratedCSSEntry("b".repeat(64), {
            css: ".substituted{color:red}",
            candidates: ["substituted"],
            stylesheet: '@import "tailwindcss";',
          }),
        TypeError,
        "does not match",
      );
    });

    it("keeps legacy-colliding project CSS payloads separate in the shared content cache", async () => {
      const projectACSS = ".vf-36{--vf-token:10}";
      const projectBCSS = ".vf-74183{--vf-token:1l8n}";
      const projectAHash = await cacheCSSAsync(projectACSS, undefined, {
        candidates: ["vf-36"],
        stylesheet: "/* project-a */",
      });
      const projectBHash = await cacheCSSAsync(projectBCSS, undefined, {
        candidates: ["vf-74183"],
        stylesheet: "/* project-b */",
      });

      assertEquals(projectAHash !== projectBHash, true);
      assertEquals(getCSSByHash(projectAHash), projectACSS);
      assertEquals(getCSSByHash(projectBHash), projectBCSS);
    });

    it("regenerates CSS when inputs exist in unified CSS cache entry", async () => {
      const restoreFetch = mockTailwindFetch();

      try {
        const stylesheet = '@import "tailwindcss";/*vf-unified-regression*/';
        const candidates = ["text-red-500", "font-bold"];

        const generated = await generateCSS(stylesheet, candidates, { minify: true });

        const hash = hashCSS(generated.css);
        await cacheCSSAsync(generated.css, hash, { candidates, stylesheet });

        const regenerated = await regenerateCSSByHash(hash, "vf-unified-regression");
        assertEquals(regenerated, generated.css);
      } finally {
        restoreFetch();
      }
    });

    it("falls back to legacy inputs cache when unified entry is missing", async () => {
      const restoreFetch = mockTailwindFetch();

      try {
        const stylesheet = '@import "tailwindcss";/*vf-legacy-fallback-regression*/';
        const candidates = ["text-blue-500", "underline"];

        const generated = await generateCSS(stylesheet, candidates, { minify: true });

        const hash = hashCSS(generated.css);
        // Seed a unified cache entry without inputs to simulate legacy split-cache state.
        await cacheCSSAsync(generated.css, hash);
        await cacheCSSInputsAsync(hash, { candidates, stylesheet });

        const regenerated = await regenerateCSSByHash(hash, "vf-legacy-fallback-regression");
        assertEquals(regenerated, generated.css);
      } finally {
        restoreFetch();
      }
    });

    it("returns undefined when cached inputs are missing", async () => {
      const regenerated = await regenerateCSSByHash("vf-missing-regeneration-hash", undefined);
      assertEquals(regenerated, undefined);
    });

    it("isolates JIT regeneration by project to avoid cross-project compiler contamination", async () => {
      const restoreFetch = mockTailwindFetch();

      try {
        const stylesheet = '@import "tailwindcss";/*vf-project-isolation-regression*/';
        const projectA = "vf-project-a";
        const projectB = "vf-project-b";
        const candidatesA = ["text-red-500"];
        const candidatesB = ["font-bold"];

        const generatedA = await generateCSS(stylesheet, candidatesA, {
          minify: true,
          projectSlug: projectA,
        });

        const generatedB = await generateCSS(stylesheet, candidatesB, {
          minify: true,
          projectSlug: projectB,
        });

        const hashA = hashCSS(generatedA.css);
        const hashB = hashCSS(generatedB.css);

        await cacheCSSAsync(generatedA.css, hashA, { candidates: candidatesA, stylesheet });
        await cacheCSSAsync(generatedB.css, hashB, { candidates: candidatesB, stylesheet });

        const regeneratedA = await regenerateCSSByHash(hashA, projectA);
        const regeneratedB = await regenerateCSSByHash(hashB, projectB);

        assertEquals(regeneratedA, generatedA.css);
        assertEquals(regeneratedB, generatedB.css);
      } finally {
        restoreFetch();
      }
    });
  });

  describe("compiler cache capacity", () => {
    it("evicts the oldest compiler when cache exceeds max size", async () => {
      const restoreFetch = mockTailwindFetch();

      try {
        const firstStylesheet = '@import "tailwindcss";/*vf-compiler-cache-0*/';
        await generateCSS(firstStylesheet, [], { minify: false });

        const initialStats = getCompilerCacheStats();
        assertEquals(initialStats.size, 1);
        const firstHash = initialStats.entries[0]?.hash ?? "";
        assertEquals(firstHash.length > 0, true);

        for (let i = 1; i <= initialStats.maxSize; i++) {
          const stylesheet = `@import "tailwindcss";/*vf-compiler-cache-${i}*/`;
          await generateCSS(stylesheet, [], { minify: false });
        }

        const stats = getCompilerCacheStats();
        assertEquals(stats.size, stats.maxSize);
        assertEquals(stats.entries.length, stats.maxSize);
        assertEquals(stats.entries.some((entry) => entry.hash === firstHash), false);
      } finally {
        restoreFetch();
      }
    });
  });
});
