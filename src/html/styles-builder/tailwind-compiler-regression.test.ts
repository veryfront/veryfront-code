import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  cacheCSSAsync,
  cacheCSSInputsAsync,
  clearCSSCache,
  generateTailwindCSS,
  getCompilerCacheStats,
  hashCSS,
  invalidateCompiler,
  regenerateCSSByHash,
} from "./tailwind-compiler.ts";

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

describe("styles-builder/tailwind-compiler regressions", () => {
  beforeEach(() => {
    clearCSSCache();
    invalidateCompiler();
  });

  afterEach(() => {
    clearCSSCache();
    invalidateCompiler();
  });

  describe("regenerateCSSByHash", () => {
    it("regenerates CSS when inputs exist in unified CSS cache entry", async () => {
      const restoreFetch = mockTailwindFetch();

      try {
        const stylesheet = '@import "tailwindcss";/*vf-unified-regression*/';
        const candidates = ["text-red-500", "font-bold"];

        const generated = await generateTailwindCSS(stylesheet, candidates, { minify: true });
        assertEquals(generated.error, undefined);

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

        const generated = await generateTailwindCSS(stylesheet, candidates, { minify: true });
        assertEquals(generated.error, undefined);

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

        const generatedA = await generateTailwindCSS(stylesheet, candidatesA, {
          minify: true,
          projectSlug: projectA,
        });
        assertEquals(generatedA.error, undefined);

        const generatedB = await generateTailwindCSS(stylesheet, candidatesB, {
          minify: true,
          projectSlug: projectB,
        });
        assertEquals(generatedB.error, undefined);

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
        const firstResult = await generateTailwindCSS(firstStylesheet, [], { minify: false });
        assertEquals(firstResult.error, undefined);

        const initialStats = getCompilerCacheStats();
        assertEquals(initialStats.size, 1);
        const firstHash = initialStats.entries[0]?.hash ?? "";
        assertEquals(firstHash.length > 0, true);

        for (let i = 1; i <= initialStats.maxSize; i++) {
          const stylesheet = `@import "tailwindcss";/*vf-compiler-cache-${i}*/`;
          const result = await generateTailwindCSS(stylesheet, [], { minify: false });
          assertEquals(result.error, undefined);
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
