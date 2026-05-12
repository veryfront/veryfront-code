import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  reset as resetContracts,
  tryResolve as tryResolveContract,
} from "#veryfront/extensions/contracts.ts";
import type { CSSProcessor } from "#veryfront/extensions/css/index.ts";
import { generateTailwindCSS, invalidateCompiler } from "./tailwind-compiler.ts";

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

describe("styles-builder/tailwind default CSSProcessor", () => {
  let restoreFetch: (() => void) | undefined;

  beforeEach(() => {
    resetContracts();
    invalidateCompiler();
    restoreFetch = mockTailwindFetch();
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
    resetContracts();
    invalidateCompiler();
  });

  it("uses the built-in Tailwind processor when no project extension registered one", async () => {
    const result = await generateTailwindCSS(
      '@import "tailwindcss";/*vf-default-css-processor*/',
      ["text-red-500"],
      { minify: true, projectSlug: "vf-default-css-processor" },
    );

    assertEquals(result.error, undefined);
    assertEquals(tryResolveContract<CSSProcessor>("CSSProcessor") !== undefined, true);
  });
});
