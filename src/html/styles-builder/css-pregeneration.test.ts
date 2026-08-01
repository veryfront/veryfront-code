import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, remove, writeTextFile } from "#veryfront/compat/fs.ts";
import { type FileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
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
import { invalidatePreparedProjectCSSAsync } from "./prepared-project-css-cache.ts";
import { clearCSSCache, invalidateCompiler, invalidateProjectCSS } from "./css-compiler.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";

describe("styles-builder/css-pregeneration", () => {
  it("shares candidate-bound identities between prepared writers and warm lookups", async () => {
    const projectSlug = `prepared-writer-identity-${crypto.randomUUID()}`;
    const styleProfile = createStyleScopeProfile({});
    const baseOptions = {
      projectSlug,
      projectVersion: "branch:main",
      projectDir: "/project",
      styleProfile,
      stylesheet: '@import "tailwindcss";',
      minify: false,
      environment: "preview",
      buildMode: "production",
    } as const;

    try {
      const stale = await buildPreparedCSSArtifactFromFiles({
        ...baseOptions,
        files: [{ path: "/project/app/page.tsx", content: '<main class="text-red-500" />' }],
      });
      const staleOptions = {
        ...baseOptions,
        files: [{ path: "/project/app/page.tsx", content: '<main class="text-red-500" />' }],
      };
      assertEquals(await warmPreparedCSSArtifactFromFiles(staleOptions), false);

      const currentOptions = {
        ...baseOptions,
        files: [{ path: "/project/app/page.tsx", content: '<main class="text-blue-500" />' }],
      };
      const current = await buildPreparedCSSArtifactFromFiles(currentOptions);

      assertEquals(stale.context.cacheKey !== current.context.cacheKey, true);
      assertEquals(await warmPreparedCSSArtifactFromFiles(currentOptions), false);
    } finally {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
      await invalidatePreparedProjectCSSAsync(projectSlug);
    }
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
    it("captures one root-bound snapshot reader for every selected local source", async () => {
      const encoder = new TextEncoder();
      const snapshotCalls: Array<[string, string, number]> = [];
      let replacementCalls = 0;
      let legacyReads = 0;
      const replacement = () => {
        replacementCalls++;
        return Promise.resolve(encoder.encode("replacement"));
      };
      const fs = {
        readDir: () =>
          (async function* () {
            for (const name of ["b.ts", "a.ts"]) {
              yield { name, isFile: true, isDirectory: false, isSymlink: false };
            }
          })(),
        readFileSnapshotWithinLimit: (path: string, root: string, byteLimit: number) => {
          snapshotCalls.push([path, root, byteLimit]);
          fs.readFileSnapshotWithinLimit = replacement;
          return Promise.resolve(encoder.encode(path.endsWith("a.ts") ? "first" : "second"));
        },
        readFileBytesWithinLimit: () => {
          legacyReads++;
          return Promise.reject(new Error("legacy exact read must not run"));
        },
      } as unknown as FileSystem;

      assertEquals(
        await collectLocalProjectSourceFiles({
          projectDir: "/project",
          styleProfile: createStyleScopeProfile(),
          fs,
        }),
        [
          { path: "/project/a.ts", content: "first" },
          { path: "/project/b.ts", content: "second" },
        ],
      );
      assertEquals(snapshotCalls, [
        ["/project/a.ts", "/project", MAX_CSS_FILE_BYTES],
        ["/project/b.ts", "/project", MAX_CSS_FILE_BYTES],
      ]);
      assertEquals(replacementCalls, 0);
      assertEquals(legacyReads, 0);
    });

    it("requires stable source snapshot authority before walking the project", async () => {
      let walks = 0;
      let legacyReads = 0;
      const fs = {
        readDir: () => {
          walks++;
          return (async function* () {})();
        },
        readFileBytesWithinLimit: () => {
          legacyReads++;
          return Promise.resolve(new Uint8Array());
        },
      } as unknown as FileSystem;

      await assertRejects(
        () =>
          collectLocalProjectSourceFiles({
            projectDir: "/project",
            styleProfile: createStyleScopeProfile(),
            fs,
          }),
        TypeError,
        "stable snapshot",
      );
      assertEquals(walks, 0);
      assertEquals(legacyReads, 0);
    });

    it("reads a configured stylesheet through the captured project-root snapshot", async () => {
      const calls: Array<[string, string, number]> = [];
      let legacyReads = 0;
      const fs = {
        readFileSnapshotWithinLimit: (path: string, root: string, byteLimit: number) => {
          calls.push([path, root, byteLimit]);
          return Promise.resolve(new TextEncoder().encode(".safe{}"));
        },
        readFileBytesWithinLimit: () => {
          legacyReads++;
          return Promise.reject(new Error("legacy exact read must not run"));
        },
      } as unknown as FileSystem;

      assertEquals(
        await readLocalProjectStylesheet("/project", "styles/site.css", fs),
        ".safe{}",
      );
      assertEquals(calls, [["/project/styles/site.css", "/project", MAX_CSS_FILE_BYTES]]);
      assertEquals(legacyReads, 0);
    });

    it("rejects invalid UTF-8 returned by the stable stylesheet snapshot", async () => {
      const fs = {
        readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array([0xc3, 0x28])),
        readFileBytesWithinLimit: () => Promise.resolve(new TextEncoder().encode(".legacy{}")),
      } as unknown as FileSystem;

      await assertRejects(
        () => readLocalProjectStylesheet("/project", "styles.css", fs),
        TypeError,
        "valid UTF-8",
      );
    });

    it("normalizes stable stylesheet overflow without hiding operational failures", async () => {
      const overflowFs = {
        readFileSnapshotWithinLimit: () => Promise.reject(new RangeError("source grew")),
        readFileBytesWithinLimit: () => Promise.resolve(new TextEncoder().encode(".legacy{}")),
      } as unknown as FileSystem;
      await assertRejects(
        () => readLocalProjectStylesheet("/project", "styles.css", overflowFs),
        TypeError,
        `Project stylesheet exceeds ${MAX_CSS_FILE_BYTES} bytes`,
      );

      const operationalFailure = Object.assign(new Error("snapshot unavailable"), {
        code: "EIO",
      });
      let lstatCalls = 0;
      const failedFs = {
        lstat: () => {
          lstatCalls++;
          return Promise.reject(new Error("pre-read lstat must not run"));
        },
        readFileSnapshotWithinLimit: () => Promise.reject(operationalFailure),
        readFileBytesWithinLimit: () => Promise.resolve(new TextEncoder().encode(".legacy{}")),
      } as unknown as FileSystem;
      const error = await assertRejects(() =>
        readLocalProjectStylesheet("/project", "styles.css", failedFs)
      );
      assertEquals(error, operationalFailure);
      assertEquals(lstatCalls, 0);
    });

    it("skips only genuine missing default stylesheets", async () => {
      const calls: string[] = [];
      const fs = {
        readFileSnapshotWithinLimit: (path: string) => {
          calls.push(path);
          if (path === "/project/global.css") {
            return Promise.resolve(new TextEncoder().encode(".fallback{}"));
          }
          return Promise.reject(new Deno.errors.NotFound("default stylesheet absent"));
        },
      } as unknown as FileSystem;

      assertEquals(
        await readLocalProjectStylesheet("/project", undefined, fs),
        ".fallback{}",
      );
      assertEquals(calls, ["/project/globals.css", "/project/global.css"]);
    });

    it("does not misclassify a snapshot race as an absent default stylesheet", async () => {
      const changed = new FileSnapshotChangedError("stylesheet changed during snapshot");
      Object.defineProperty(changed, "cause", {
        value: new Deno.errors.NotFound("removed after discovery"),
      });
      let reads = 0;
      const fs = {
        readFileSnapshotWithinLimit: () => {
          reads++;
          return Promise.reject(changed);
        },
      } as unknown as FileSystem;

      const error = await assertRejects(() =>
        readLocalProjectStylesheet("/project", undefined, fs)
      );
      assertEquals(error, changed);
      assertEquals(reads, 1);
    });

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
        readFileSnapshotWithinLimit: (path: string) =>
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
          readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array()),
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
        readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array()),
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
        readFileSnapshotWithinLimit: () => Promise.resolve(new Uint8Array()),
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
        readFileSnapshotWithinLimit: (path: string, _root: string, byteLimit: number) => {
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

    it("collects source content only through the root-bound snapshot reader", async () => {
      let unboundedReads = 0;
      let receivedLimit = 0;
      let receivedRoot = "";
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
        readFileSnapshotWithinLimit: (_path: string, root: string, byteLimit: number) => {
          receivedRoot = root;
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
      assertEquals(receivedRoot, "/project");
      assertEquals(receivedLimit, Math.min(MAX_CSS_FILE_BYTES, MAX_CSS_TOTAL_BYTES));
      assertEquals(unboundedReads, 0);
    });

    it("treats source growth past the stable per-file bound as an integrity failure", async () => {
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
        readFileSnapshotWithinLimit: (_path: string, _root: string, byteLimit: number) =>
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

    it("reads a configured stylesheet only through the root-bound snapshot reader", async () => {
      let receivedLimit = 0;
      let receivedRoot = "";
      let unboundedReads = 0;
      const fs = {
        readTextFile: () => {
          unboundedReads++;
          return Promise.reject(new Error("unbounded stylesheet read must not run"));
        },
        readFileSnapshotWithinLimit: (_path: string, root: string, byteLimit: number) => {
          receivedRoot = root;
          receivedLimit = byteLimit;
          return Promise.resolve(new TextEncoder().encode(".safe{}"));
        },
      } as unknown as FileSystem;

      assertEquals(
        await readLocalProjectStylesheet("/project", "styles.css", fs),
        ".safe{}",
      );
      assertEquals(receivedRoot, "/project");
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
        "stable snapshot byte reader",
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
        const error = await assertRejects(() =>
          readLocalProjectStylesheet(projectDir, "styles/missing.css")
        );
        assertEquals(isNotFoundError(error), true);
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
        readFileSnapshotWithinLimit: () => Promise.reject(readFailure),
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
        readFileSnapshotWithinLimit: () => Promise.reject(readFailure),
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
