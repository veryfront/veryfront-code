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
