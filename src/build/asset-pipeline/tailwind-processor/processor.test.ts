import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { TailwindProcessor } from "./processor.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    name: "test",
    fs: {
      readFile: (path: string) => Deno.readTextFile(path),
      writeFile: (path: string, content: string) => Deno.writeTextFile(path, content),
      rename: (from: string, to: string) => Deno.rename(from, to),
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
      lstat: (path: string) => Deno.lstat(path),
      realPath: (path: string) => Deno.realPath(path),
      remove: (path: string, opts?: { recursive?: boolean }) => Deno.remove(path, opts),
      readTextFile: (path: string) => Deno.readTextFile(path),
      writeTextFile: (path: string, content: string) => Deno.writeTextFile(path, content),
    },
  } as unknown as RuntimeAdapter;
}

describe("build/asset-pipeline/tailwind-processor/processor", () => {
  it("constructs with project-scoped defaults", () => {
    const processor = new TailwindProcessor({
      projectDir: "/tmp/test-tailwind",
      adapter: createMockAdapter(),
      inputFile: "/tmp/test-tailwind/styles/main.css",
    });
    assertExists(processor);
  });

  it("rejects a plain CSS file instead of pretending Tailwind was compiled", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const inputFile = `${projectDir}/main.css`;
      await Deno.writeTextFile(inputFile, "body { margin: 0; }");

      await assertRejects(
        () =>
          new TailwindProcessor({
            projectDir,
            adapter: createMockAdapter(),
            inputFile,
          }).process(),
        Error,
        'does not import "tailwindcss"',
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("compiles discovered candidates with the canonical Tailwind compiler", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/styles`);
      await Deno.mkdir(`${projectDir}/app`);
      const inputFile = `${projectDir}/styles/main.css`;
      await Deno.writeTextFile(inputFile, '@import "tailwindcss";');
      await Deno.writeTextFile(
        `${projectDir}/app/page.tsx`,
        '<main className="mt-4">Hello</main>',
      );

      const result = await new TailwindProcessor({
        projectDir,
        adapter: createMockAdapter(),
        inputFile,
        minify: false,
      }).process();

      assertStringIncludes(result.css, ".mt-4");
      assertEquals(result.detectedUtilities > 0, true);
      assertEquals(result.processedFiles.includes(`${projectDir}/app/page.tsx`), true);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("publishes output atomically when outputFile is specified", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/styles`);
      await Deno.mkdir(`${projectDir}/src`);
      const inputFile = `${projectDir}/styles/input.css`;
      const outputFile = `${projectDir}/output/result.css`;
      await Deno.writeTextFile(inputFile, '@import "tailwindcss";');
      await Deno.writeTextFile(
        `${projectDir}/src/component.tsx`,
        '<div className="text-red-500">Content</div>',
      );

      const result = await new TailwindProcessor({
        projectDir,
        adapter: createMockAdapter(),
        inputFile,
        outputFile,
        minify: true,
      }).process();

      assertEquals(await Deno.readTextFile(outputFile), result.css);
      assertStringIncludes(result.css, ".text-red-500");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
