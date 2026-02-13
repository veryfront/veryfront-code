import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearCSSCache,
  getCSSByHash,
  getProjectCSS,
  invalidateCompiler,
  invalidateProjectCSS,
} from "./tailwind-compiler.ts";

// Simple stylesheet without plugins — avoids loading @tailwindcss/typography from esm.sh in tests
const TEST_STYLESHEET = `@import "tailwindcss";`;

describe("styles-builder/project-css-cache", () => {
  it("populates hash-level cache on fresh generation so other pods can serve CSS", async () => {
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
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });

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
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });
});
