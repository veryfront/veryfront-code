import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  cacheCSSAsync,
  clearCSSCache,
  generateTailwindCSS,
  getCompilerCacheStats,
  hashCSS,
  invalidateCompiler,
  regenerateCSSByHash,
} from "./tailwind-compiler.ts";

function forbidNetwork(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.reject(new Error("CSS compilation must not fetch"))) as typeof fetch;

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
      const restoreFetch = forbidNetwork();

      try {
        const stylesheet = '@import "tailwindcss";/*vf-unified-regression*/';
        const candidates = ["text-red-500", "font-bold"];

        const generated = await generateTailwindCSS(stylesheet, candidates, { minify: true });
        const hash = hashCSS(generated.css);
        await cacheCSSAsync(generated.css, hash, {
          candidates,
          stylesheet,
          pipelineIdentity: generated.cacheIdentity,
        });

        const regenerated = await regenerateCSSByHash(hash, "vf-unified-regression");
        assertEquals(regenerated, generated.css);
      } finally {
        restoreFetch();
      }
    });

    it("does not revive unsupported split legacy regeneration inputs", async () => {
      const restoreFetch = forbidNetwork();

      try {
        const stylesheet = '@import "tailwindcss";/*vf-no-legacy-fallback*/';
        const candidates = ["text-blue-500", "underline"];

        const generated = await generateTailwindCSS(stylesheet, candidates, { minify: true });
        const hash = hashCSS(generated.css);
        // An output-only entry is servable by content hash but cannot be regenerated.
        await cacheCSSAsync(generated.css, hash);

        const regenerated = await regenerateCSSByHash(hash, "vf-no-legacy-fallback");
        assertEquals(regenerated, undefined);
      } finally {
        restoreFetch();
      }
    });

    it("refuses regenerated CSS that does not reproduce the requested hash", async () => {
      const restoreFetch = forbidNetwork();

      try {
        const stylesheet = '@import "tailwindcss";/*vf-hash-mismatch-regression*/';
        const projectSlug = "vf-hash-mismatch-regression";
        const candidatesA = ["text-red-500"];
        const candidatesB = ["font-bold"];

        const generatedA = await generateTailwindCSS(stylesheet, candidatesA, {
          minify: true,
          projectSlug,
        });
        const hashA = hashCSS(generatedA.css);
        // The entry keeps A's output under A's hash but B's inputs, so the
        // regenerated CSS can no longer reproduce the requested content hash.
        await cacheCSSAsync(generatedA.css, hashA, {
          candidates: candidatesB,
          stylesheet,
          pipelineIdentity: generatedA.cacheIdentity,
        });

        assertEquals(
          await regenerateCSSByHash(hashA, projectSlug),
          undefined,
          "CSS that does not reproduce the requested content hash must not be served at an immutable URL",
        );
      } finally {
        restoreFetch();
      }
    });

    it("returns undefined when cached inputs are missing", async () => {
      const regenerated = await regenerateCSSByHash("vf-missing-regeneration-hash", undefined);
      assertEquals(regenerated, undefined);
    });

    it("isolates JIT regeneration by project to avoid cross-project compiler contamination", async () => {
      const restoreFetch = forbidNetwork();

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
        const generatedB = await generateTailwindCSS(stylesheet, candidatesB, {
          minify: true,
          projectSlug: projectB,
        });
        const hashA = hashCSS(generatedA.css);
        const hashB = hashCSS(generatedB.css);

        await cacheCSSAsync(generatedA.css, hashA, {
          candidates: candidatesA,
          stylesheet,
          pipelineIdentity: generatedA.cacheIdentity,
        });
        await cacheCSSAsync(generatedB.css, hashB, {
          candidates: candidatesB,
          stylesheet,
          pipelineIdentity: generatedB.cacheIdentity,
        });

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
      const restoreFetch = forbidNetwork();

      try {
        const firstStylesheet = '@import "tailwindcss";/*vf-compiler-cache-0*/';
        await generateTailwindCSS(firstStylesheet, [], { minify: false });

        const initialStats = getCompilerCacheStats();
        assertEquals(initialStats.size, 1);
        const firstHash = initialStats.entries[0]?.hash ?? "";
        assertEquals(firstHash.length > 0, true);

        for (let i = 1; i <= initialStats.maxSize; i++) {
          const stylesheet = `@import "tailwindcss";/*vf-compiler-cache-${i}*/`;
          await generateTailwindCSS(stylesheet, [], { minify: false });
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
