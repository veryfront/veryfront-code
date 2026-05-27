import "#veryfront/schemas/_test-setup.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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

  it("prefixes bare side-effect imports for Deno temp module imports", () => {
    const transformed = rewriteForDeno(
      [
        'import "reflect-metadata";',
        'import "dotenv/config";',
        'import { z } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'import "npm:reflect-metadata"');
    assertStringIncludes(transformed, 'import "npm:dotenv/config"');
    assertStringIncludes(transformed, 'from "npm:zod"');
  });

  it("leaves node: and relative side-effect imports untouched", () => {
    const transformed = rewriteForDeno(
      [
        'import "node:crypto";',
        'import "./side-effects.ts";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'import "node:crypto"');
    assertStringIncludes(transformed, 'import "./side-effects.ts"');
  });

  it("rewrites `export … from` re-exports of bare npm packages for Deno", () => {
    const transformed = rewriteForDeno(
      [
        'export { z } from "zod";',
        'export * from "pdf-parse";',
        'export { type ZodSchema } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    assertStringIncludes(transformed, 'export { z } from "npm:zod"');
    assertStringIncludes(transformed, 'export * from "npm:pdf-parse"');
    assertEquals(transformed.includes('from "zod";'), false);
    assertEquals(transformed.includes('from "pdf-parse";'), false);
  });

  it("does not rewrite `import type` / `export type` lines for Deno", () => {
    const transformed = rewriteForDeno(
      [
        'import type { ZodSchema } from "zod";',
        'export type { ZodSchema } from "zod";',
        'import { z, type ZodTypeAny } from "zod";',
      ].join("\n"),
      "/project/tools",
    );

    // type-only lines are erased by TS; they must not gain an npm: prefix
    assertStringIncludes(transformed, 'import type { ZodSchema } from "zod"');
    assertStringIncludes(transformed, 'export type { ZodSchema } from "zod"');
    // The value-bearing `import { z, type ZodTypeAny }` is still rewritten
    assertStringIncludes(transformed, 'import { z, type ZodTypeAny } from "npm:zod"');
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

  it("resolves bare-package subpath imports via package.json#exports in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const reactDir = `${projectDir}/node_modules/react`;
    await Deno.mkdir(reactDir, { recursive: true });
    await Deno.writeTextFile(
      `${reactDir}/package.json`,
      JSON.stringify({
        name: "react",
        version: "19.0.0",
        exports: {
          ".": "./index.js",
          "./jsx-runtime": "./jsx-runtime.js",
        },
      }),
    );
    await Deno.writeTextFile(`${reactDir}/index.js`, "");
    await Deno.writeTextFile(`${reactDir}/jsx-runtime.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import { jsx } from "react/jsx-runtime";',
          'import React from "react";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, "react/jsx-runtime.js");
      assertStringIncludes(transformed, "react/index.js");
      assertEquals(transformed.includes('from "react/jsx-runtime"'), false);
      assertEquals(transformed.includes('from "react"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("resolves side-effect imports via the project's node_modules in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const dotenvDir = `${projectDir}/node_modules/dotenv`;
    await Deno.mkdir(dotenvDir, { recursive: true });
    await Deno.writeTextFile(
      `${dotenvDir}/package.json`,
      JSON.stringify({
        name: "dotenv",
        version: "16.0.0",
        exports: {
          ".": "./lib/main.js",
          "./config": "./config.js",
        },
      }),
    );
    await Deno.writeTextFile(`${dotenvDir}/config.js`, "");
    await Deno.mkdir(`${dotenvDir}/lib`, { recursive: true });
    await Deno.writeTextFile(`${dotenvDir}/lib/main.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import "dotenv/config";',
          'import { config } from "dotenv";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, 'import "file://');
      assertStringIncludes(transformed, "dotenv/config.js");
      assertStringIncludes(transformed, "dotenv/lib/main.js");
      assertEquals(transformed.includes('import "dotenv/config"'), false);
      assertEquals(transformed.includes('from "dotenv"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rewrites `export … from` re-exports of bare npm packages in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const zodDir = `${projectDir}/node_modules/zod`;
    await Deno.mkdir(zodDir, { recursive: true });
    await Deno.writeTextFile(
      `${zodDir}/package.json`,
      JSON.stringify({ name: "zod", version: "3.24.0", main: "./index.js" }),
    );
    await Deno.writeTextFile(`${zodDir}/index.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'export { z } from "zod";',
          'export * from "zod";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, "zod/index.js");
      assertEquals(transformed.includes('export { z } from "zod"'), false);
      assertEquals(transformed.includes('export * from "zod"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not resolve `import type` lines in the Node discovery path", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    // Intentionally no node_modules — a real resolution would fail.
    // The rewriter must not even try, because `import type` is erased.

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import type { Foo } from "some-pkg-not-installed";',
          'export type { Bar } from "another-missing-pkg";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      assertStringIncludes(transformed, 'import type { Foo } from "some-pkg-not-installed"');
      assertStringIncludes(transformed, 'export type { Bar } from "another-missing-pkg"');
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("resolves bare-package subpath imports via package.json#exports glob patterns (lodash-es style)", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const pkgDir = `${projectDir}/node_modules/lodash-es`;
    await Deno.mkdir(pkgDir, { recursive: true });
    await Deno.writeTextFile(
      `${pkgDir}/package.json`,
      JSON.stringify({
        name: "lodash-es",
        version: "4.17.21",
        type: "module",
        exports: {
          ".": "./lodash.js",
          "./*": "./*.js",
        },
      }),
    );
    await Deno.writeTextFile(`${pkgDir}/lodash.js`, "");
    await Deno.writeTextFile(`${pkgDir}/debounce.js`, "");
    await Deno.writeTextFile(`${pkgDir}/throttle.js`, "");

    try {
      const transformed = await rewriteDiscoveryImports(
        [
          'import debounce from "lodash-es/debounce";',
          'import throttle from "lodash-es/throttle";',
        ].join("\n"),
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      // Glob pattern `./*` → `./*.js` must produce `debounce.js`, not bare `debounce`
      assertStringIncludes(transformed, "lodash-es/debounce.js");
      assertStringIncludes(transformed, "lodash-es/throttle.js");
      assertEquals(transformed.includes('"lodash-es/debounce"'), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("does not cache missing-package lookups, so a later install is picked up without restart", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const pkgDir = `${projectDir}/node_modules/late-installed`;
    const code = 'import x from "late-installed";';

    try {
      // First pass: package not present yet → should leave bare import alone.
      const before = await rewriteDiscoveryImports(
        code,
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );
      assertStringIncludes(before, 'from "late-installed"');
      assert(!before.includes("file://"));

      // Simulate `npm install` between passes.
      await Deno.mkdir(pkgDir, { recursive: true });
      await Deno.writeTextFile(
        `${pkgDir}/package.json`,
        JSON.stringify({ name: "late-installed", main: "./index.js" }),
      );
      await Deno.writeTextFile(`${pkgDir}/index.js`, "");

      // Second pass: must now resolve — null lookups are intentionally
      // NOT cached so dev servers recover after `npm install` without a
      // process restart.
      const after = await rewriteDiscoveryImports(
        code,
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );
      assertStringIncludes(after, "late-installed/index.js");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("refuses to resolve a package whose exports map escapes the package directory", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-rewriter-test-" });
    const pkgDir = `${projectDir}/node_modules/evil`;
    const outside = `${projectDir}/SECRET.js`;
    await Deno.mkdir(pkgDir, { recursive: true });
    // The malicious exports value attempts to point the bare import at
    // `<projectDir>/SECRET.js`, which sits outside `node_modules/evil`.
    await Deno.writeTextFile(
      `${pkgDir}/package.json`,
      JSON.stringify({
        name: "evil",
        version: "1.0.0",
        exports: { ".": "../../SECRET.js" },
      }),
    );
    await Deno.writeTextFile(outside, 'throw new Error("you should never load me");');

    try {
      const transformed = await rewriteDiscoveryImports(
        'import x from "evil";',
        projectDir,
        createFileSystem(),
        `${projectDir}/app`,
      );

      // The rewriter must refuse the resolution — the import must be left
      // bare (or otherwise NOT point at the file outside the package dir).
      assertEquals(transformed.includes("SECRET.js"), false);
      assertStringIncludes(transformed, 'from "evil"');
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
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
