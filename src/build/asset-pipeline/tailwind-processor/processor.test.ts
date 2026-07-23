import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TailwindProcessor } from "./processor.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { MAX_STYLE_SOURCE_FILE_BYTES } from "#veryfront/html/styles-builder/resource-limits.ts";

function createMockAdapter(_baseDir: string): RuntimeAdapter {
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

    it("rejects a plain CSS file without Tailwind directives", async () => {
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
        await assertRejects(
          () => processor.process(),
          TypeError,
          "must include",
        );
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
        await Deno.mkdir(`${tmpDir}/app`, { recursive: true });
        await Deno.writeTextFile(cssFile, '@import "tailwindcss";');
        await Deno.writeTextFile(
          `${tmpDir}/app/page.tsx`,
          '<main className="flex items-center">Hello</main>',
        );

        const processor = new TailwindProcessor({
          projectDir: tmpDir,
          adapter,
          inputFile: cssFile,
          outputFile,
          minify: true,
        });
        const result = await processor.process();
        assertExists(result.css);
        assertEquals(result.css.includes(".flex"), true);
        assertEquals(result.processedFiles, ["input.css", "app/page.tsx"]);

        // Verify file was written
        const written = await Deno.readTextFile(outputFile);
        assertExists(written);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("rejects unsafe paths and unsupported source-map requests", () => {
      const tmpDir = "/tmp/test-tailwind";
      const adapter = createMockAdapter(tmpDir);
      assertThrows(
        () =>
          new TailwindProcessor({
            projectDir: tmpDir,
            adapter,
            inputFile: "/outside/main.css",
          }),
        TypeError,
        "inside projectDir",
      );
      assertThrows(
        () =>
          new TailwindProcessor({
            projectDir: tmpDir,
            adapter,
            inputFile: "main.css",
            sourceMap: true,
          }),
        TypeError,
        "source maps",
      );
    });

    it("rejects an oversized content source before reading it", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const adapter = createMockAdapter(tmpDir);
        const cssFile = `${tmpDir}/input.css`;
        const sourceFile = `${tmpDir}/page.tsx`;
        await Deno.writeTextFile(cssFile, '@import "tailwindcss";');
        await Deno.writeTextFile(sourceFile, "");
        await Deno.truncate(sourceFile, MAX_STYLE_SOURCE_FILE_BYTES + 1);
        const readFile = adapter.fs.readFile.bind(adapter.fs);
        adapter.fs.readFile = (path: string) =>
          path === sourceFile
            ? Promise.reject(new Error("oversized source was read"))
            : readFile(path);

        const processor = new TailwindProcessor({
          projectDir: tmpDir,
          adapter,
          inputFile: cssFile,
          content: [sourceFile],
        });
        await assertRejects(
          () => processor.process(),
          TypeError,
          "size limit",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("rejects invalid input size metadata before reading the stylesheet", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        const adapter = createMockAdapter(tmpDir);
        const cssFile = `${tmpDir}/input.css`;
        await Deno.writeTextFile(cssFile, '@import "tailwindcss";');
        const stat = adapter.fs.stat.bind(adapter.fs);
        adapter.fs.stat = (path: string) =>
          path === cssFile
            ? Promise.resolve({
              size: -1,
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              mtime: null,
            })
            : stat(path);
        const readFile = adapter.fs.readFile.bind(adapter.fs);
        let inputRead = false;
        adapter.fs.readFile = (path: string) => {
          if (path === cssFile) inputRead = true;
          return readFile(path);
        };

        const processor = new TailwindProcessor({
          projectDir: tmpDir,
          adapter,
          inputFile: cssFile,
          content: [],
        });
        await assertRejects(() => processor.process(), TypeError, "invalid size");
        assertEquals(inputRead, false);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
