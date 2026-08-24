import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { writeCompiledFile } from "./file-writer.ts";

describe("build/compiler/mdx-compiler/file-writer", () => {
  describe("writeCompiledFile", () => {
    it("should write compiled file and return output path", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/pages/hello.mdx`;
        const code = "export default function Page() { return 'hello'; }";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.output`,
          mode: "production" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        assertEquals(
          outputPath,
          join(options.outputDir, "pages/hello.js"),
          "output path must be the projectDir-relative path under outputDir",
        );

        const written = await Deno.readTextFile(outputPath);
        assertEquals(written, code, "written content should match input code");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should handle nested directory paths", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/pages/blog/post.mdx`;
        const code = "export default function Post() { return 'post'; }";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.output`,
          mode: "production" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        assertEquals(
          outputPath,
          join(options.outputDir, "pages/blog/post.js"),
          "nested sources keep their projectDir-relative structure under outputDir",
        );

        const written = await Deno.readTextFile(outputPath);
        assertEquals(written, code, "content should be written correctly");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should create parent directories recursively", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/a/b/c/deep.mdx`;
        const code = "deep content";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.out`,
          mode: "development" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        const written = await Deno.readTextFile(outputPath);
        assertEquals(written, code, "should write to deeply nested path");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should mirror the project-relative path under outputDir", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const filePath = `${tmpDir}/pages/index.mdx`;
        const code = "index";
        const options = {
          projectDir: tmpDir,
          outputDir: `${tmpDir}/.output`,
          mode: "production" as const,
        };

        const outputPath = await writeCompiledFile(filePath, code, options);

        assertEquals(
          outputPath,
          join(options.outputDir, "pages", "index.js"),
          "output path mirrors the project-relative source path under outputDir",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
