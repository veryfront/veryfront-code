import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  reset as resetContracts,
  tryResolve as tryResolveContract,
} from "#veryfront/extensions/contracts.ts";
import type { CSSProcessor } from "#veryfront/extensions/css/index.ts";
import { generateTailwindCSS, invalidateCompiler } from "./tailwind-compiler.ts";

describe("styles-builder explicit CSSProcessor", () => {
  let originalFetch: typeof fetch;
  let fetchCalls = 0;

  beforeEach(() => {
    resetContracts();
    invalidateCompiler();
    originalFetch = globalThis.fetch;
    fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.reject(new Error("missing-provider path must not fetch"));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetContracts();
    invalidateCompiler();
  });

  it("fails closed without discovering, registering, or fetching a provider", async () => {
    await assertRejects(
      () =>
        generateTailwindCSS(
          '@import "tailwindcss";',
          ["text-red-500"],
          { minify: false, projectSlug: "vf-missing-css-processor" },
        ),
      Error,
      'Missing extension for contract "CSSProcessor"',
    );
    assertEquals(tryResolveContract<CSSProcessor>("CSSProcessor"), undefined);
    assertEquals(fetchCalls, 0);
  });
});
