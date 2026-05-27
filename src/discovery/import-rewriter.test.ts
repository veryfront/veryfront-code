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

  it("prefixes arbitrary bare npm imports with npm: for Deno temp module imports", () => {
    const transformed = rewriteForDeno(
      [
        'import pdfParse from "pdf-parse";',
        'import mammoth from "mammoth";',
        'const pdf = await import("pdf-parse");',
        'import { z } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'from "npm:pdf-parse"');
    assertStringIncludes(transformed, 'from "npm:mammoth"');
    assertStringIncludes(transformed, 'import("npm:pdf-parse")');
    assertStringIncludes(transformed, 'from "npm:zod"');
    assertEquals(transformed.includes('from "pdf-parse"'), false);
    assertEquals(transformed.includes('from "mammoth"'), false);
  });

  it("leaves node:, file:, relative, and veryfront specifiers untouched", () => {
    const transformed = rewriteForDeno(
      [
        'import fs from "node:fs";',
        'import path from "node:path";',
        'import local from "./helpers.ts";',
        'import remote from "https://esm.sh/some-pkg";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'from "node:fs"');
    assertStringIncludes(transformed, 'from "node:path"');
    assertStringIncludes(transformed, 'from "./helpers.ts"');
    assertStringIncludes(transformed, 'from "https://esm.sh/some-pkg"');
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
