import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TailwindProcessor } from "./processor.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(baseDir: string): RuntimeAdapter {
  return {
    name: "test",
    fs: {
      readFile: (path: string) => Deno.readTextFile(path),
      writeFile: (path: string, content: string) => Deno.writeTextFile(path, content),
      exists: async (path: string) => {
        try {
          await Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      },
      mkdir: (path: string, opts?: { recursive?: boolean }) => Deno.mkdir(path, opts),
      readDir: (path: string) => Deno.readDir(path),
      stat: (path: string) => Deno.stat(path),
      remove: (path: string, opts?: { recursive?: boolean }) => Deno.remove(path, opts),
      readTextFile: (path: string) => Deno.readTextFile(path),
      writeTextFile: (path: string, content: string) => Deno.writeTextFile(path, content),
    },
  } as unknown as RuntimeAdapter;
}

describe("build/asset-pipeline/tailwind-processor/processor", () => {
  describe("TailwindProcessor", () => {
    it("should construct with default options merged", () => {
      const tmpDir = "/tmp/test-tailwind";
      const adapter = createMockAdapter(tmpDir);
      const processor = new TailwindProcessor({
        projectDir: tmpDir,
        adapter,
        inputFile: `${tmpDir}/styles/main.css`,
      });
      assertExists(processor);
    });

    it("should process a plain CSS file (no tailwind directives)", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const adapter = createMockAdapter(tmpDir);
        const cssFile = `${tmpDir}/main.css`;
        await Deno.writeTextFile(cssFile, "body { margin: 0; }");

        const processor = new TailwindProcessor({
          projectDir: tmpDir,
          adapter,
          inputFile: cssFile,
          minify: false,
        });
        const result = await processor.process();
        assertExists(result.css);
        assertEquals(Array.isArray(result.processedFiles), true);
        assertEquals(typeof result.detectedUtilities, "number");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("should write output file when outputFile is specified", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const adapter = createMockAdapter(tmpDir);
        const cssFile = `${tmpDir}/input.css`;
        const outputFile = `${tmpDir}/output/result.css`;
        await Deno.writeTextFile(cssFile, "body { color: blue; }");

        const processor = new TailwindProcessor({
          projectDir: tmpDir,
          adapter,
          inputFile: cssFile,
          outputFile,
          minify: false,
        });
        const result = await processor.process();
        assertExists(result.css);

        // Verify file was written
        const written = await Deno.readTextFile(outputFile);
        assertExists(written);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
