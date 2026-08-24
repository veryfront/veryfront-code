import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createStyleScopeProfile } from "./style-scope-profile.ts";
import {
  buildPreparedCSSArtifactFromFiles,
  collectLocalProjectSourceFiles,
  findGlobalStylesheet,
  findStylesheetFromFiles,
  readLocalProjectStylesheet,
  warmPreparedCSSArtifactFromFiles,
} from "./css-pregeneration.ts";
import { acquireCSSGenerationSession, extractCandidatesFromFiles } from "./tailwind-compiler.ts";
import { hashCandidates } from "./css-identity.ts";
import {
  createPreparedProjectCSSContext,
  invalidatePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "./prepared-project-css-cache.ts";

describe("styles-builder/css-pregeneration", () => {
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
        "a prefixed filename must not be treated as the global stylesheet",
      );
    });

    it("should still match a globals stylesheet under a nested repo root", () => {
      assertEquals(
        findGlobalStylesheet([{ path: "styles/globals.css", content: "nested" }]),
        "nested",
        "a conventional nested path must remain a global stylesheet match",
      );
      assertEquals(
        findGlobalStylesheet([{ path: "project/src/globals.css", content: "deep" }]),
        "deep",
        "a globals stylesheet under a nested repo root must remain a match",
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

    it("falls back to a convention-named globals stylesheet", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });

      try {
        await mkdir(join(projectDir, "styles"), { recursive: true });
        await writeTextFile(join(projectDir, "styles", "globals.css"), ".globals { color: blue; }");

        assertEquals(
          await readLocalProjectStylesheet(projectDir),
          ".globals { color: blue; }",
          "an unset tailwind.stylesheet must fall back to the conventional globals stylesheet",
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("returns undefined when the configured stylesheet is missing", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });

      try {
        await writeTextFile(join(projectDir, "globals.css"), ".globals { color: blue; }");

        assertEquals(
          await readLocalProjectStylesheet(projectDir, "styles/custom.css"),
          undefined,
          "a configured stylesheet path is exclusive and does not fall back to globals",
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });
  });

  describe("warmPreparedCSSArtifactFromFiles", () => {
    const STYLESHEET = `@import "tailwindcss";`;
    const SOURCE_FILE = {
      path: "pages/index.tsx",
      content: `<div className="text-red-500" />`,
    };

    function warmOptions(projectSlug: string) {
      return {
        projectSlug,
        projectVersion: "warm-version",
        files: [SOURCE_FILE],
        styleProfile: createStyleScopeProfile(),
        stylesheet: STYLESHEET,
        minify: false,
      };
    }

    /**
     * Rebuild the cache context the warm path derives, so a test can wait for
     * the background build to store its artifact without starting a second one.
     */
    function preparedContextFor(options: ReturnType<typeof warmOptions>) {
      const candidates = extractCandidatesFromFiles(options.files, {
        styleProfile: options.styleProfile,
      });
      const session = acquireCSSGenerationSession(options.minify);
      return createPreparedProjectCSSContext(
        options.projectSlug,
        options.projectVersion,
        options.stylesheet,
        options.styleProfile.hash,
        {
          cssPipelineIdentity: session.cacheIdentity,
          candidatesHash: hashCandidates(candidates),
          minify: options.minify,
          environment: "preview",
          buildMode: "production",
        },
      );
    }

    it("joins an in-flight build instead of starting a second compile", async () => {
      const projectSlug = `warm-inflight-${crypto.randomUUID()}`;
      const options = warmOptions(projectSlug);

      try {
        assertEquals(
          await warmPreparedCSSArtifactFromFiles(options),
          true,
          "the first warm call must start the build",
        );
        assertEquals(
          await warmPreparedCSSArtifactFromFiles(options),
          false,
          "a second warm call must join the in-flight build instead of recompiling",
        );

        await waitFor(
          async () => (await tryGetPreparedProjectCSS(preparedContextFor(options))) !== undefined,
          { message: "the warm build never stored its prepared artifact" },
        );
      } finally {
        invalidatePreparedProjectCSS(projectSlug);
      }
    });

    it("does not rebuild an artifact that is already prepared", async () => {
      const projectSlug = `warm-cached-${crypto.randomUUID()}`;
      const options = warmOptions(projectSlug);

      try {
        await buildPreparedCSSArtifactFromFiles(options);

        assertEquals(
          await warmPreparedCSSArtifactFromFiles(options),
          false,
          "a cached artifact must not be rebuilt",
        );
      } finally {
        invalidatePreparedProjectCSS(projectSlug);
      }
    });

    it("prefers an explicit stylesheet over one discovered in the files", async () => {
      const projectSlug = `warm-stylesheet-${crypto.randomUUID()}`;
      const options = warmOptions(projectSlug);

      try {
        // Prepare the artifact under the identity an explicit stylesheet
        // implies, with no competing stylesheet in the file list at all.
        await buildPreparedCSSArtifactFromFiles(options);

        // The same warm request, now carrying a globals.css that resolves to
        // different CSS, must still recognise the prepared artifact. It only
        // can when `options.stylesheet` outranks findStylesheetFromFiles.
        assertEquals(
          await warmPreparedCSSArtifactFromFiles({
            ...options,
            files: [
              SOURCE_FILE,
              { path: "globals.css", content: `@import "tailwindcss";\n.from-files{}` },
            ],
          }),
          false,
          "an explicit stylesheet must outrank one discovered in the files",
        );
      } finally {
        invalidatePreparedProjectCSS(projectSlug);
      }
    });
  });
});
