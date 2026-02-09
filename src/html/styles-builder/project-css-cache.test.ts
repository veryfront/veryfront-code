import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearCSSCache,
  getProjectCSS,
  invalidateCompiler,
  invalidateProjectCSS,
} from "./tailwind-compiler.ts";

describe("styles-builder/project-css-cache", () => {
  it("invalidates project CSS cache when candidates change or explicit invalidation runs", async () => {
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

      return Promise.resolve(
        new Response("@layer theme, base, components, utilities;", { status: 200 }),
      );
    }) as typeof fetch;

    const projectSlug = `cache-test-${crypto.randomUUID()}`;
    const stylesheet = undefined;
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
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });
});
