import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createStyleScopeProfile } from "./style-scope-profile.ts";
import {
  collectLocalProjectSourceFiles,
  findGlobalStylesheet,
  findStylesheetFromFiles,
  readLocalProjectStylesheet,
} from "./css-pregeneration.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";

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

    it("treats an empty conventional stylesheet as present", () => {
      assertEquals(
        findGlobalStylesheet([
          { path: "globals.css", content: "" },
          { path: "global.css", content: "not empty" },
        ]),
        "",
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

    it("rejects absolute configured stylesheet paths", () => {
      assertThrows(
        () =>
          findStylesheetFromFiles(
            [{ path: "styles/custom.css", content: "custom css" }],
            "/styles/custom.css",
          ),
        TypeError,
        "Stylesheet path",
      );
    });

    it("rejects traversal and non-canonical configured stylesheet paths", () => {
      for (const path of ["../custom.css", "styles/../custom.css", "styles//custom.css"]) {
        assertThrows(
          () =>
            findStylesheetFromFiles(
              [{ path: "styles/custom.css", content: "custom css" }],
              path,
            ),
          TypeError,
          "Stylesheet path",
        );
      }
    });

    it("returns an explicitly configured empty stylesheet", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "styles/custom.css", content: "" }],
          "styles/custom.css",
        ),
        "",
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

    it("does not substitute a conventional stylesheet when the configured path is absent", () => {
      assertEquals(
        findStylesheetFromFiles(
          [{ path: "globals.css", content: "fallback globals" }],
          "nonexistent.css",
        ),
        undefined,
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

    it("does not substitute a conventional stylesheet when configured content is unavailable", () => {
      assertEquals(
        findStylesheetFromFiles(
          [
            { path: "styles/custom.css" },
            { path: "globals.css", content: "fallback" },
          ],
          "styles/custom.css",
        ),
        undefined,
      );
    });

    it("rejects ambiguous configured stylesheet source keys", () => {
      assertThrows(
        () =>
          findStylesheetFromFiles(
            [
              { path: "styles/custom.css", content: "first" },
              { path: "project/styles/custom.css", content: "second" },
            ],
            "styles/custom.css",
          ),
        TypeError,
        "matched multiple",
      );
    });

    it("does not match a configured stylesheet outside the project root", () => {
      assertThrows(
        () =>
          findStylesheetFromFiles(
            [{ path: "/outside/styles/custom.css", content: "outside" }],
            "styles/custom.css",
            "/project",
          ),
        TypeError,
        "project",
      );
    });

    it("rejects a proxied source listing without invoking its traps", () => {
      let trapCalls = 0;
      const files = new Proxy([{ path: "globals.css", content: "safe" }], {
        getOwnPropertyDescriptor(target, property) {
          trapCalls++;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });

      assertThrows(
        () => findStylesheetFromFiles(files),
        TypeError,
        "Proxy",
      );
      assertEquals(trapCalls, 0);
    });

    it("rejects sparse source listings before stylesheet discovery", () => {
      const files = new Array<{ path: string; content?: string }>(1);
      assertThrows(
        () => findStylesheetFromFiles(files),
        TypeError,
        "dense",
      );
    });
  });

  describe("local project helpers", () => {
    it("always excludes generated roots even when configuration protects them", async () => {
      const encoder = new TextEncoder();
      const fs = {
        readDir: (directoryPath: string) =>
          (async function* () {
            if (directoryPath === "/project") {
              for (const name of [".deno_cache", ".veryfront", "app"]) {
                yield { name, isFile: false, isDirectory: true, isSymlink: false };
              }
              return;
            }
            yield { name: "page.tsx", isFile: true, isDirectory: false, isSymlink: false };
          })(),
        readFileBytesWithinLimit: (path: string) =>
          Promise.resolve(encoder.encode(`<main className="${path}" />`)),
      } as unknown as FileSystem;

      const files = await collectLocalProjectSourceFiles({
        projectDir: "/project",
        styleProfile: createStyleScopeProfile({
          directories: {
            app: ".veryfront",
            components: [".deno_cache"],
          },
        }),
        fs,
      });

      assertEquals(files.map((file) => file.path), ["/project/app/page.tsx"]);
    });

    it("admits zero and exactly 10,000 selected local source files", async () => {
      const createSourceFileSystem = (fileCount: number) =>
        ({
          readDir: () =>
            (async function* () {
              for (let index = fileCount - 1; index >= 0; index--) {
                yield {
                  name: `source-${String(index).padStart(5, "0")}.ts`,
                  isFile: true,
                  isDirectory: false,
                  isSymlink: false,
                };
              }
            })(),
          readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array()),
        }) as unknown as FileSystem;

      assertEquals(
        await collectLocalProjectSourceFiles({
          projectDir: "/project",
          styleProfile: createStyleScopeProfile(),
          fs: createSourceFileSystem(0),
        }),
        [],
      );
      const files = await collectLocalProjectSourceFiles({
        projectDir: "/project",
        styleProfile: createStyleScopeProfile(),
        fs: createSourceFileSystem(MAX_CSS_FILES),
      });
      assertEquals(files.length, MAX_CSS_FILES);
      assertEquals(files[0]?.path, "/project/source-00000.ts");
      assertEquals(files.at(-1)?.path, "/project/source-09999.ts");
    });

    it("rejects 10,001 selected local source files", async () => {
      const fs = {
        readDir: () =>
          (async function* () {
            for (let index = 0; index <= MAX_CSS_FILES; index++) {
              yield {
                name: `source-${index}.ts`,
                isFile: true,
                isDirectory: false,
                isSymlink: false,
              };
            }
          })(),
        readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array()),
      } as unknown as FileSystem;

      await assertRejects(
        () =>
          collectLocalProjectSourceFiles({
            projectDir: "/project",
            styleProfile: createStyleScopeProfile(),
            fs,
          }),
        TypeError,
        `${MAX_CSS_FILES} files`,
      );
    });

    it("rejects duplicate local source paths", async () => {
      const fs = {
        readDir: () =>
          (async function* () {
            for (let index = 0; index < 2; index++) {
              yield {
                name: "page.tsx",
                isFile: true,
                isDirectory: false,
                isSymlink: false,
              };
            }
          })(),
        readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array()),
      } as unknown as FileSystem;

      await assertRejects(
        () =>
          collectLocalProjectSourceFiles({
            projectDir: "/project",
            styleProfile: createStyleScopeProfile(),
            fs,
          }),
        TypeError,
        "duplicate path",
      );
    });

    it("admits a trailing empty local source at the exact aggregate budget", async () => {
      const boundaryChunk = new Uint8Array(MAX_CSS_FILE_BYTES);
      const requestedLimits: number[] = [];
      const fs = {
        readDir: () =>
          (async function* () {
            for (const name of ["four.ts", "one.ts", "three.ts", "two.ts", "z-empty.ts"]) {
              yield { name, isFile: true, isDirectory: false, isSymlink: false };
            }
          })(),
        readFileBytesWithinLimit: (path: string, byteLimit: number) => {
          requestedLimits.push(byteLimit);
          return Promise.resolve(path.endsWith("z-empty.ts") ? new Uint8Array() : boundaryChunk);
        },
      } as unknown as FileSystem;

      const files = await collectLocalProjectSourceFiles({
        projectDir: "/project",
        styleProfile: createStyleScopeProfile(),
        fs,
      });

      assertEquals(MAX_CSS_FILE_BYTES * 4, MAX_CSS_TOTAL_BYTES);
      assertEquals(files.length, 5);
      assertEquals(files.at(-1), { path: "/project/z-empty.ts", content: "" });
      assertEquals(requestedLimits.at(-1), 1);
    });

    it("collects source content only through the exact bounded reader", async () => {
      let unboundedReads = 0;
      let receivedLimit = 0;
      const content = `export default () => <div className="safe" />;`;
      const fs = {
        readDir: () =>
          (async function* () {
            yield {
              name: "page.tsx",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          })(),
        stat: () => Promise.reject(new Error("source stat must not be a resource boundary")),
        readTextFile: () => {
          unboundedReads++;
          return Promise.reject(new Error("unbounded source read must not run"));
        },
        readFileBytesWithinLimit: (_path: string, byteLimit: number) => {
          receivedLimit = byteLimit;
          return Promise.resolve(new TextEncoder().encode(content));
        },
      } as unknown as FileSystem;

      assertEquals(
        await collectLocalProjectSourceFiles({
          projectDir: "/project",
          styleProfile: createStyleScopeProfile(),
          fs,
        }),
        [{ path: "/project/page.tsx", content }],
      );
      assertEquals(receivedLimit, Math.min(MAX_CSS_FILE_BYTES, MAX_CSS_TOTAL_BYTES));
      assertEquals(unboundedReads, 0);
    });

    it("treats source growth past the exact per-file bound as an integrity failure", async () => {
      let unboundedReads = 0;
      const fs = {
        readDir: () =>
          (async function* () {
            yield {
              name: "page.tsx",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          })(),
        stat: () =>
          Promise.resolve({
            size: 1,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: null,
          }),
        readTextFile: () => {
          unboundedReads++;
          return Promise.resolve("small-before-growth");
        },
        readFileBytesWithinLimit: (_path: string, byteLimit: number) =>
          Promise.reject(new RangeError(`File exceeds byte limit of ${byteLimit} bytes`)),
      } as unknown as FileSystem;

      await assertRejects(
        () =>
          collectLocalProjectSourceFiles({
            projectDir: "/project",
            styleProfile: createStyleScopeProfile(),
            fs,
          }),
        TypeError,
        `${MAX_CSS_FILE_BYTES} bytes`,
      );
      assertEquals(unboundedReads, 0);
    });

    it("reads a configured stylesheet only through the exact bounded reader", async () => {
      let receivedLimit = 0;
      let unboundedReads = 0;
      const fs = {
        readTextFile: () => {
          unboundedReads++;
          return Promise.reject(new Error("unbounded stylesheet read must not run"));
        },
        readFileBytesWithinLimit: (_path: string, byteLimit: number) => {
          receivedLimit = byteLimit;
          return Promise.resolve(new TextEncoder().encode(".safe{}"));
        },
      } as unknown as FileSystem;

      assertEquals(
        await readLocalProjectStylesheet("/project", "styles.css", fs),
        ".safe{}",
      );
      assertEquals(receivedLimit, MAX_CSS_FILE_BYTES);
      assertEquals(unboundedReads, 0);
    });

    it("fails closed before a configured stylesheet unbounded fallback", async () => {
      let unboundedReads = 0;
      const fs = {
        readTextFile: () => {
          unboundedReads++;
          return Promise.resolve(".unsafe{}");
        },
      } as unknown as FileSystem;

      await assertRejects(
        () => readLocalProjectStylesheet("/project", "styles.css", fs),
        TypeError,
        "exact bounded byte reader",
      );
      assertEquals(unboundedReads, 0);
    });

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

    it("fails when the configured stylesheet is absent instead of reading globals.css", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });

      try {
        await writeTextFile(join(projectDir, "globals.css"), ".globals { color: blue; }");
        await assertRejects(
          () => readLocalProjectStylesheet(projectDir, "styles/missing.css"),
          Deno.errors.NotFound,
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("propagates source file read failures", async () => {
      const readFailure = Object.assign(new Error("source read failed"), { code: "EIO" });
      const fs = {
        readDir: () =>
          (async function* () {
            yield {
              name: "page.tsx",
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          })(),
        stat: () =>
          Promise.resolve({
            size: 10,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: null,
          }),
        readFileBytesWithinLimit: () => Promise.reject(readFailure),
      } as unknown as FileSystem;

      const error = await assertRejects(() =>
        collectLocalProjectSourceFiles({
          projectDir: "/project",
          styleProfile: createStyleScopeProfile(),
          fs,
        })
      );
      assertEquals(error, readFailure);
    });

    it("propagates operational default stylesheet read failures", async () => {
      const readFailure = Object.assign(new Error("stylesheet read failed"), { code: "EIO" });
      const fs = {
        readFileBytesWithinLimit: () => Promise.reject(readFailure),
      } as unknown as FileSystem;

      const error = await assertRejects(() =>
        readLocalProjectStylesheet("/project", undefined, fs)
      );
      assertEquals(error, readFailure);
    });

    it("rejects configured stylesheet traversal before filesystem access", async () => {
      let reads = 0;
      const fs = {
        readTextFile: () => {
          reads++;
          return Promise.resolve("unexpected");
        },
      } as unknown as FileSystem;

      await assertRejects(
        () => readLocalProjectStylesheet("/project", "../outside.css", fs),
        TypeError,
        "Stylesheet path",
      );
      assertEquals(reads, 0);
    });

    it("rejects configured stylesheet symlinks", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-css-pregeneration-" });
      const outsideDir = await Deno.makeTempDir({ prefix: "vf-css-outside-" });

      try {
        const outsidePath = join(outsideDir, "outside.css");
        await writeTextFile(outsidePath, ".outside {}");
        await Deno.symlink(outsidePath, join(projectDir, "globals.css"));

        await assertRejects(
          () => readLocalProjectStylesheet(projectDir, "globals.css"),
          TypeError,
          "symbolic link",
        );
      } finally {
        await remove(projectDir, { recursive: true });
        await remove(outsideDir, { recursive: true });
      }
    });
  });
});
