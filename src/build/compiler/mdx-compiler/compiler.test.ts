import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { compileMDXFile } from "./compiler.ts";

describe("build/compiler/mdx-compiler/compiler", () => {
  afterAll(async () => {
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

    it("rejects malformed YAML instead of compiling it as page content", async () => {
      const tmpDir = await Deno.makeTempDir();
      const filePath = `${tmpDir}/malformed.mdx`;
      const content = "---\ntitle: [unterminated\n---\n# Content";
      await Deno.writeTextFile(filePath, content);

      try {
        await assertRejects(() =>
          compileMDXFile(filePath, content, {
            projectDir: tmpDir,
            outputDir: `${tmpDir}/out`,
            mode: "production",
          })
        );
        await assertRejects(
          () => Deno.stat(`${tmpDir}/out/malformed.js`),
          Deno.errors.NotFound,
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("does not treat export examples in fenced code as frontmatter", async () => {
      const tmpDir = await Deno.makeTempDir();
      const filePath = `${tmpDir}/example.mdx`;
      const content = [
        "```js",
        'export const title = "Example only"',
        "```",
        "",
        "# Actual page",
      ].join("\n");
      await Deno.writeTextFile(filePath, content);

      try {
        const result = await compileMDXFile(filePath, content, {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/out`,
          mode: "development",
        });
        assertEquals(result.frontmatter.title, undefined);
        assertStringIncludes(await Deno.readTextFile(result.outputPath), "Example only");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("rejects dynamic metadata that collides with generated public exports", async () => {
      const tmpDir = await Deno.makeTempDir();
      const filePath = `${tmpDir}/dynamic.mdx`;
      const content = "export const title = getTitle()\n\n# Content";
      await Deno.writeTextFile(filePath, content);

      try {
        await assertRejects(() =>
          compileMDXFile(filePath, content, {
            projectDir: tmpDir,
            outputDir: `${tmpDir}/out`,
            mode: "production",
          })
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
