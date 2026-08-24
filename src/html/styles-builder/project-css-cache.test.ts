import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearCSSCache,
  getCSSByHash,
  getProjectCSS,
  invalidateCompiler,
  invalidateProjectCSS,
} from "./tailwind-compiler.ts";
import {
  createProjectCSSRequestContext,
  storeProjectCSS,
  tryGetProjectCSSFromLocalFallback,
} from "./project-css-cache.ts";
import { hashCSS } from "./css-identity.ts";

// Simple provider-owned stylesheet without plugin directives.
const TEST_STYLESHEET = `@import "tailwindcss";`;

function forbidNetwork(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.reject(new Error("CSS project cache tests must not fetch"))) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("styles-builder/project-css-cache", () => {
  it("hash-frames project and environment segments before cache-key use", () => {
    const context = createProjectCSSRequestContext(
      "project:*:scope",
      TEST_STYLESHEET,
      ["alpha"],
      {
        cssPipelineIdentity: "pipeline",
        environment: "preview:*:environment",
      },
    );

    assertEquals(context.cacheKey.includes("project:*:scope"), false);
    assertEquals(context.cacheKey.includes("preview:*:environment"), false);
    assertEquals(context.cacheKey.startsWith("v4:"), true);
  });

  it("does not repopulate a project cache from a pre-invalidation context", async () => {
    const projectSlug = `stale-project-context-${crypto.randomUUID()}`;
    const candidates = ["alpha"];
    const context = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "pipeline" },
    );
    const css = ".alpha{display:block}";

    invalidateProjectCSS(projectSlug);
    await storeProjectCSS(
      context,
      { css, hash: hashCSS(css), candidatesHash: context.candidatesHash },
      candidates,
    );
    assertEquals(await tryGetProjectCSSFromLocalFallback(context, candidates), undefined);

    // The stale context is refused by the reader on its own, so the write guard
    // is only observable through a fresh post-invalidation context, which
    // resolves to the same epoch-independent cache key.
    const freshContext = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "pipeline" },
    );
    assertEquals(freshContext.cacheKey, context.cacheKey);
    assertEquals(
      await tryGetProjectCSSFromLocalFallback(freshContext, candidates),
      undefined,
      "a generation that started before invalidateProjectCSS must not seed the local fallback for later requests",
    );
  });

  it("populates hash-level cache on fresh generation so other pods can serve CSS", async () => {
    const restoreFetch = forbidNetwork();

    const projectSlug = `hash-cache-test-${crypto.randomUUID()}`;

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);

      const candidates = new Set(["text-green-500"]);
      const result = await getProjectCSS(projectSlug, TEST_STYLESHEET, candidates, {
        minify: false,
      });
      assertEquals(result.fromCache, false);

      // After fresh generation, the hash-level local cache must contain the CSS.
      // This is what allows /_vf/css/{hash}.css to be served by any pod.
      const cached = getCSSByHash(result.hash);
      assertEquals(typeof cached, "string");
      assertEquals(cached!.length > 0, true);
    } finally {
      restoreFetch();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("invalidates project CSS cache when candidates change or explicit invalidation runs", async () => {
    const restoreFetch = forbidNetwork();

    const projectSlug = `cache-test-${crypto.randomUUID()}`;
    const stylesheet = TEST_STYLESHEET;
    const options = { minify: false };

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);

      const candidatesA = new Set(["text-red-500"]);
      const first = await getProjectCSS(projectSlug, stylesheet, candidatesA, options);
      assertEquals(first.fromCache, false);

      const second = await getProjectCSS(projectSlug, stylesheet, candidatesA, options);
      assertEquals(second.fromCache, true);
      assertEquals(second.hash, first.hash);

      const candidatesB = new Set(["text-blue-500"]);
      const third = await getProjectCSS(projectSlug, stylesheet, candidatesB, options);
      assertEquals(third.fromCache, false);

      const fourth = await getProjectCSS(projectSlug, stylesheet, candidatesB, options);
      assertEquals(fourth.fromCache, true);
      assertEquals(fourth.hash, third.hash);

      invalidateProjectCSS(projectSlug);

      const afterInvalidation = await getProjectCSS(projectSlug, stylesheet, candidatesB, options);
      assertEquals(afterInvalidation.fromCache, false);
    } finally {
      restoreFetch();
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });
});
