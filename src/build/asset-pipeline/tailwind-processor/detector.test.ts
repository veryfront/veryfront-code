import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";

function createFileAdapter(): RuntimeAdapter {
  return {
    name: "test",
    fs: {
      readFile: (path: string) => Deno.readTextFile(path),
      readTextFile: (path: string) => Deno.readTextFile(path),
      writeFile: (path: string, content: string) => Deno.writeTextFile(path, content),
      writeTextFile: (path: string, content: string) => Deno.writeTextFile(path, content),
      exists: async (path: string) => {
        try {
          await Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      },
      mkdir: (path: string, options?: { recursive?: boolean }) => Deno.mkdir(path, options),
      readDir: (path: string) => Deno.readDir(path),
      stat: (path: string) => Deno.stat(path),
      lstat: (path: string) => Deno.lstat(path),
      realPath: (path: string) => Deno.realPath(path),
      remove: (path: string, options?: { recursive?: boolean }) => Deno.remove(path, options),
      makeTempDir: (prefix: string) => Deno.makeTempDir({ prefix }),
      watch: (paths: string | string[], options?: { recursive?: boolean }) =>
        options?.recursive === undefined
          ? Deno.watchFs(paths)
          : Deno.watchFs(paths, { recursive: options.recursive }),
    },
  } as unknown as RuntimeAdapter;
}

describe("build/asset-pipeline/tailwind-processor/detector", () => {
  it("retains the detector's intentional false result for rejected paths", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const outsideFile = `${projectDir}-outside.css`;
      await Deno.writeTextFile(outsideFile, '@import "tailwindcss";');
      try {
        assertEquals(
          await isTailwindV4File(outsideFile, projectDir, createFileAdapter()),
          false,
        );
      } finally {
        await Deno.remove(outsideFile);
      }
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("detects Tailwind v4 stylesheets by their tailwindcss import", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const adapter = createFileAdapter();
      await Deno.writeTextFile(`${projectDir}/app.css`, '@import "tailwindcss";');
      await Deno.writeTextFile(
        `${projectDir}/preflight.css`,
        '@import "tailwindcss/preflight";',
      );
      await Deno.writeTextFile(`${projectDir}/plain.css`, "body { color: red; }");

      assertEquals(
        await isTailwindV4File(`${projectDir}/app.css`, projectDir, adapter),
        true,
        "a stylesheet importing tailwindcss is a Tailwind v4 file",
      );
      assertEquals(
        await isTailwindV4File(`${projectDir}/preflight.css`, projectDir, adapter),
        true,
        "a tailwindcss sub-path import is a Tailwind v4 file",
      );
      assertEquals(
        await isTailwindV4File(`${projectDir}/plain.css`, projectDir, adapter),
        false,
        "a stylesheet without a tailwindcss import is not a Tailwind v4 file",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  describe("autoDetectContentPaths", () => {
    it("should return four content path patterns", () => {
      assertEquals(autoDetectContentPaths("/project").length, 4);
    });

    it("should include app, pages, components, and src directories", () => {
      const joined = autoDetectContentPaths("/project").join("\n");
      assertEquals(joined.includes("/project/app/"), true);
      assertEquals(joined.includes("/project/pages/"), true);
      assertEquals(joined.includes("/project/components/"), true);
      assertEquals(joined.includes("/project/src/"), true);
    });

    it("should include the glob pattern for supported extensions", () => {
      for (const p of autoDetectContentPaths("/project")) {
        assertEquals(p.includes("**/*.{js,ts,jsx,tsx,mdx}"), true);
      }
    });

    it("should use the provided project directory as base", () => {
      for (const p of autoDetectContentPaths("/my/custom/dir")) {
        assertEquals(p.startsWith("/my/custom/dir/"), true);
      }
    });
  });
});
