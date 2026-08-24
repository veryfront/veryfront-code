/**
 * Integration coverage for `compileMDXFile`'s emitted module text.
 *
 * This cannot live in the colocated unit test
 * (src/build/compiler/mdx-compiler/compiler.test.ts): the only way to observe
 * what `compileMDXFile` emits is to read the file it wrote, and
 * `writeCompiledFile` resolves its filesystem through a module-level
 * `const fs = createFileSystem()` (src/build/compiler/mdx-compiler/file-writer.ts)
 * while `CompileOptions` is `{ projectDir, outputDir, mode }` with no writer or
 * fs hook. With no injectable seam, the read-back is a genuine host effect and
 * belongs here. Every assertion the unit file can make hermetically
 * (outputPath, frontmatter, imports) stays there.
 */
import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { compileMDXFile } from "../../../../../src/build/compiler/mdx-compiler/compiler.ts";

describe(
  "build/compiler/mdx-compiler/compiler (emitted module)",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await esbuild.stop();
    });

    it("writes the compiled MDX and its frontmatter export to the output module", async () => {
      const tmpDir = await Deno.makeTempDir();
      const outDir = `${tmpDir}/out`;
      await Deno.mkdir(outDir, { recursive: true });

      const filePath = `${tmpDir}/test.mdx`;
      const content = `---
title: Test Page
description: A test
---

# Hello World

This is content.`;
      await Deno.writeTextFile(filePath, content);

      try {
        const result = await compileMDXFile(filePath, content, {
          projectDir: tmpDir,
          outputDir: outDir,
          mode: "production",
        });

        const written = await Deno.readTextFile(result.outputPath);
        assertStringIncludes(
          written,
          "Hello World",
          "compiled MDX heading must reach the emitted module",
        );
        assertStringIncludes(
          written,
          "This is content.",
          "compiled MDX paragraph must reach the emitted module",
        );
        assertStringIncludes(
          written,
          "as frontmatter",
          "emitted module must export frontmatter",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  },
);
