import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "esbuild";
import { compileMDXFile } from "./compiler.ts";

describe(
  "build/compiler/mdx-compiler/compiler",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      if ((globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) return;
      await esbuild.stop();
    });

    describe("compileMDXFile", () => {
      it("should compile a simple MDX file with frontmatter", async () => {
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
          assertExists(result.outputPath);
          assertEquals(result.frontmatter.title, "Test Page");
          assertEquals(result.frontmatter.description, "A test");
          assertEquals(Array.isArray(result.imports), true);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      it("should reject empty filePath", async () => {
        await assertRejects(
          () =>
            compileMDXFile("", "# content", {
              projectDir: "/tmp",
              outputDir: "/tmp/out",
              mode: "production",
            }),
          TypeError,
          "filePath must be a non-empty string",
        );
      });

      it("should reject invalid options", async () => {
        await assertRejects(
          () => compileMDXFile("/tmp/test.mdx", "# content", null as never),
          TypeError,
          "options must be an object",
        );
      });

      it("should reject invalid mode", async () => {
        await assertRejects(
          () =>
            compileMDXFile("/tmp/test.mdx", "# content", {
              projectDir: "/tmp",
              outputDir: "/tmp/out",
              mode: "invalid" as never,
            }),
          TypeError,
          'options.mode must be either "development" or "production"',
        );
      });

      it("should handle MDX without frontmatter", async () => {
        const tmpDir = await Deno.makeTempDir();
        const outDir = `${tmpDir}/out`;
        await Deno.mkdir(outDir, { recursive: true });

        const filePath = `${tmpDir}/no-fm.mdx`;
        const content = "# Just a heading\n\nSome text.";
        await Deno.writeTextFile(filePath, content);

        try {
          const result = await compileMDXFile(filePath, content, {
            projectDir: tmpDir,
            outputDir: outDir,
            mode: "production",
          });
          assertExists(result.outputPath);
          assertExists(result.frontmatter);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      it("should handle MDX with export const variables", async () => {
        const tmpDir = await Deno.makeTempDir();
        const outDir = `${tmpDir}/out`;
        await Deno.mkdir(outDir, { recursive: true });

        const filePath = `${tmpDir}/exports.mdx`;
        const content = `export const title = "My Title"
export const layout = false

# Content here`;
        await Deno.writeTextFile(filePath, content);

        try {
          const result = await compileMDXFile(filePath, content, {
            projectDir: tmpDir,
            outputDir: outDir,
            mode: "production",
          });
          assertExists(result.frontmatter);
          assertEquals(result.frontmatter.title, "My Title");
          assertEquals(result.frontmatter.layout, false);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });
    });
  },
);
