import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
          outputPath.endsWith("pages/hello.js"),
          true,
          "should replace .mdx with .js in output path",
        );
        assertEquals(
          outputPath.startsWith(options.outputDir),
          true,
          "output should be under outputDir",
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
          outputPath.endsWith("pages/blog/post.js"),
          true,
          "should preserve nested directory structure",
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

    it("should strip leading slash from relative path", async () => {
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

        // Should not have double slashes from leading slash
        assertEquals(
          outputPath.includes("//"),
          false,
          "output path should not contain double slashes",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
