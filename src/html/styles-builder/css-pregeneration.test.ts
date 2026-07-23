import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createStyleScopeProfile } from "./style-scope-profile.ts";
import {
  buildPreparedCSSArtifactFromFiles,
  collectLocalProjectSourceFiles,
  findGlobalStylesheet,
  findStylesheetFromFiles,
  readLocalProjectStylesheet,
} from "./css-pregeneration.ts";
import {
  invalidatePreparedProjectCSS,
  invalidatePreparedProjectCSSAsync,
  tryGetPreparedProjectCSS,
} from "./prepared-project-css-cache.ts";
import { clearCSSCache, invalidateCompiler, invalidateProjectCSS } from "./tailwind-compiler.ts";

describe("styles-builder/css-pregeneration", () => {
  describe("buildPreparedCSSArtifactFromFiles", () => {
    it("builds and persists a prepared artifact from a bounded source snapshot", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response("@layer theme, base, components, utilities;", { status: 200 }),
        )) as typeof fetch;
      const projectSlug = `prepared-build-${crypto.randomUUID()}`;

      try {
        const result = await buildPreparedCSSArtifactFromFiles({
          projectSlug,
          projectVersion: "release-1",
          projectDir: "/project",
          files: [{
            path: "/project/pages/index.tsx",
            content: 'export default () => <main className="block text-red-500" />;',
          }],
          styleProfile: createStyleScopeProfile(),
          stylesheet: '@import "tailwindcss";',
          minify: false,
        });

        assertEquals(result.candidateCount > 0, true);
        assertEquals(result.css.length > 0, true);
        assertEquals(await tryGetPreparedProjectCSS(result.context), {
          css: result.css,
          hash: result.hash,
          fromCache: true,
        });
      } finally {
        globalThis.fetch = originalFetch;
        clearCSSCache();
        invalidateCompiler();
        invalidateProjectCSS(projectSlug);
        invalidatePreparedProjectCSS(projectSlug);
        await invalidatePreparedProjectCSSAsync(projectSlug);
      }
    });
  });

  describe("findGlobalStylesheet", () => {
    it("should return undefined when no files match", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "pages/index.tsx", content: "export default () => {}" },
          { path: "components/button.tsx", content: "<button/>" },
        ]),
        undefined,
      );
    });

    it("should find globals.css at root level", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css", content: "@tailwind base;" },
          { path: "pages/index.tsx", content: "export default () => {}" },
        ]),
        "@tailwind base;",
      );
    });

    it("should find global.css at root level", () => {
      assertEquals(
        findGlobalStylesheet([{ path: "global.css", content: "body { margin: 0; }" }]),
        "body { margin: 0; }",
      );
    });

    it("should find styles/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "styles/globals.css", content: "@import 'tailwindcss';" },
        ]),
        "@import 'tailwindcss';",
      );
    });

    it("should find app/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "app/globals.css", content: ".app { color: red; }" },
        ]),
        ".app { color: red; }",
      );
    });

    it("should find src/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([{ path: "src/globals.css", content: "/* src globals */" }]),
        "/* src globals */",
      );
    });

    it("should find src/styles/globals.css", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "src/styles/globals.css", content: "/* src styles globals */" },
        ]),
        "/* src styles globals */",
      );
    });

    it("should return first matching file when multiple exist", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css", content: "first" },
          { path: "styles/globals.css", content: "second" },
          { path: "app/globals.css", content: "third" },
        ]),
        "first",
      );
    });

    it("should skip files without content", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css" },
          { path: "global.css", content: "has content" },
        ]),
        "has content",
      );
    });

    it("should skip files with empty content", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css", content: "" },
          { path: "global.css", content: "not empty" },
        ]),
        "not empty",
      );
    });

    it("should return undefined for empty file list", () => {
      assertEquals(findGlobalStylesheet([]), undefined);
    });

    it("should not match files that end with globals.css but have different prefix", () => {
      assertEquals(
        findGlobalStylesheet([{ path: "my-globals.css", content: "should not match" }]),
        undefined,
      );
    });
  });

  describe("findStylesheetFromFiles", () => {
    it("should return stylesheet by exact path", () => {
      assertEquals(
        findStylesheetFromFiles(
          [
            { path: "styles/custom.css", content: "custom css" },
            { path: "globals.css", content: "globals" },
          ],
          "styles/custom.css",
        ),
        "custom css",
      );
    });

    it("should strip leading slashes from stylesheetPath", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "styles/custom.css", content: "custom css" }],
          "/styles/custom.css",
        ),
        "custom css",
      );
    });

    it("should strip multiple leading slashes", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "styles/custom.css", content: "custom css" }],
          "///styles/custom.css",
        ),
        "custom css",
      );
    });

    it("should match file path ending with normalized path", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "project/src/styles/custom.css", content: "nested custom css" }],
          "styles/custom.css",
        ),
        "nested custom css",
      );
    });

    it("should fallback to findGlobalStylesheet when stylesheetPath not found", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "globals.css", content: "fallback globals" }],
          "nonexistent.css",
        ),
        "fallback globals",
      );
    });

    it("should fallback to findGlobalStylesheet when no stylesheetPath given", () => {
      assertEquals(
        findStylesheetFromFiles([{ path: "globals.css", content: "default globals" }]),
        "default globals",
      );
    });

    it("should return undefined when stylesheetPath not found and no global stylesheet", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "pages/index.tsx", content: "page content" }],
          "missing.css",
        ),
        undefined,
      );
    });

    it("should return undefined when no stylesheetPath and no global stylesheet", () => {
      assertEquals(
        findStylesheetFromFiles([{ path: "pages/index.tsx", content: "page content" }]),
        undefined,
      );
    });

    it("should skip file without content even when path matches", () => {
      assertEquals(
        findStylesheetFromFiles(
          [
            { path: "styles/custom.css" },
            { path: "globals.css", content: "fallback" },
          ],
          "styles/custom.css",
        ),
        "fallback",
      );
    });
  });

  describe("local project helpers", () => {
    it("collects local source files while skipping ignored roots", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });

      try {
        await mkdir(join(projectDir, "pages"), { recursive: true });
        await mkdir(join(projectDir, "components"), { recursive: true });
        await mkdir(join(projectDir, "dist"), { recursive: true });

        await writeTextFile(
          join(projectDir, "pages", "index.tsx"),
          `export default function Page() {
  return <div className="text-red-500" />;
}`,
        );
        await writeTextFile(
          join(projectDir, "components", "Button.tsx"),
          `export function Button() {
  return <button className="rounded-md" />;
}`,
        );
        await writeTextFile(
          join(projectDir, "dist", "ignored.tsx"),
          `export default function Ignored() { return <div className="text-blue-500" />; }`,
        );

        const files = await collectLocalProjectSourceFiles({
          projectDir,
          styleProfile: createStyleScopeProfile(),
        });

        assertEquals(
          files.map((file) => file.path.replace(`${projectDir}/`, "")).sort(),
          ["components/Button.tsx", "pages/index.tsx"],
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("does not traverse source-directory symlinks", async () => {
      const rootDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });
      const projectDir = join(rootDir, "project");
      const outsideDir = join(rootDir, "outside");

      try {
        await mkdir(projectDir, { recursive: true });
        await mkdir(outsideDir, { recursive: true });
        await writeTextFile(
          join(outsideDir, "outside.tsx"),
          'export default () => <div className="should-not-be-scanned" />;',
        );
        await Deno.symlink(outsideDir, join(projectDir, "linked"));

        const files = await collectLocalProjectSourceFiles({
          projectDir,
          styleProfile: createStyleScopeProfile(),
        });

        assertEquals(files, []);
      } finally {
        await remove(rootDir, { recursive: true });
      }
    });

    it("reads the configured stylesheet path before default globals fallbacks", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });

      try {
        await mkdir(join(projectDir, "styles"), { recursive: true });
        await writeTextFile(join(projectDir, "styles", "custom.css"), ".custom { color: red; }");
        await writeTextFile(join(projectDir, "globals.css"), ".globals { color: blue; }");

        assertEquals(
          await readLocalProjectStylesheet(projectDir, "styles/custom.css"),
          ".custom { color: red; }",
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("does not read configured stylesheets outside the project root", async () => {
      const rootDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });
      const projectDir = join(rootDir, "project");

      try {
        await mkdir(projectDir, { recursive: true });
        await writeTextFile(join(rootDir, "secret.css"), ".secret { display: block; }");

        await assertRejects(
          () => readLocalProjectStylesheet(projectDir, "../secret.css"),
          TypeError,
          "Configured stylesheet path is invalid",
        );
      } finally {
        await remove(rootDir, { recursive: true });
      }
    });

    it("does not silently replace an unreadable configured stylesheet", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });

      try {
        await assertRejects(
          () => readLocalProjectStylesheet(projectDir, "styles/missing.css"),
          TypeError,
          "Configured stylesheet could not be read",
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("does not load oversized project stylesheets", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });

      try {
        await writeTextFile(
          join(projectDir, "globals.css"),
          "x".repeat(2 * 1024 * 1024 + 1),
        );

        assertEquals(await readLocalProjectStylesheet(projectDir), undefined);
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });
  });
});
