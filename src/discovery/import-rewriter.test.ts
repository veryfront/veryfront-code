import "#veryfront/schemas/_test-setup.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteDiscoveryImports, rewriteForDeno } from "./import-rewriter.ts";

describe("discovery/import-rewriter", () => {
  it("rewrites veryfront public imports for Deno temp module imports", () => {
    const transformed = rewriteForDeno(
      [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        'import { step, workflow } from "veryfront/workflow";',
      ].join("\n"),
      "/project/workflows",
    );

    assertStringIncludes(transformed, import.meta.resolve("veryfront/schemas"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/tool"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/workflow"));
    assertEquals(transformed.includes('from "veryfront/'), false);
  });

  it("rewrites supported veryfront public imports to globals in compiled Deno binaries", () => {
    const transformed = rewriteForDeno(
      [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        'import { step, workflow } from "veryfront/workflow";',
      ].join("\n"),
      "/project/workflows",
      { compiled: true },
    );

    assertStringIncludes(
      transformed,
      'const { defineSchema } = globalThis.__VERYFRONT_MODULES__["veryfront/schemas"]',
    );
    assertStringIncludes(
      transformed,
      'const { tool } = globalThis.__VERYFRONT_MODULES__["veryfront/tool"]',
    );
    assertStringIncludes(
      transformed,
      'const { step, workflow } = globalThis.__VERYFRONT_MODULES__["veryfront/workflow"]',
    );
    assertEquals(transformed.includes('from "veryfront/'), false);
  });

  it("resolves veryfront public imports for Node discovery modules without project-local dependencies", async () => {
    const transformed = await rewriteDiscoveryImports(
      [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        'import { step, workflow } from "veryfront/workflow";',
      ].join("\n"),
      "/tmp/veryfront-project-without-node-modules",
      createFileSystem(),
      "/tmp/veryfront-project-without-node-modules/workflows",
    );

    assertStringIncludes(transformed, import.meta.resolve("veryfront/schemas"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/tool"));
    assertStringIncludes(transformed, import.meta.resolve("veryfront/workflow"));
    assertEquals(transformed.includes('from "veryfront/'), false);
  });
});
