import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { MDX_COMPILE_ERROR } from "#veryfront/errors";
import {
  findNestedImports,
  hasUnresolvedImports,
  resolveNestedImportBase,
  resolveNestedModuleImports,
} from "./nested-imports.ts";
import {
  MAX_MDX_MODULE_IMPORTS_PER_FILE,
  MAX_MDX_MODULE_TRANSFORM_CONCURRENCY,
  ModuleImportLimitError,
  ModuleSourceLimitError,
} from "./limits.ts";
import { buildMissingModuleError } from "../missing-module.ts";

describe("transforms/mdx/esm-module-loader/module-fetcher/nested-imports", () => {
  describe("findNestedImports", () => {
    it("finds _vf_modules imports", () => {
      const code = `import { foo } from "/_vf_modules/lib/utils.js";`;
      const result = findNestedImports(code);
      assertEquals(result.vfModules.length, 1);
      assertEquals(result.vfModules[0]!.path.includes("_vf_modules"), true);
    });

    it("finds relative imports", () => {
      const code = `import { foo } from "./lib/utils.js";`;
      const result = findNestedImports(code);
      assertEquals(result.relative.length, 1);
      assertEquals(result.relative[0]!.path, "./lib/utils.js");
    });

    it("returns empty arrays for code with no matching imports", () => {
      const code = `import React from "react";`;
      const result = findNestedImports(code);
      assertEquals(result.vfModules.length, 0);
      assertEquals(result.relative.length, 0);
    });

    it("finds both types of imports in same code", () => {
      const code = `
import { foo } from "/_vf_modules/lib/utils.js";
import { bar } from "./local.js";
      `;
      const result = findNestedImports(code);
      assertEquals(result.vfModules.length, 1);
      assertEquals(result.relative.length, 1);
    });

    it("strips file:// prefix from _vf_modules paths", () => {
      const code = `import { foo } from "file:///_vf_modules/lib/utils.js";`;
      const result = findNestedImports(code);
      if (result.vfModules.length > 0) {
        assertEquals(result.vfModules[0]!.path.startsWith("file://"), false);
      }
    });

    it("finds bare side-effect _vf_modules imports", () => {
      const code =
        `/* preload; */ import "/_vf_modules/styles/theme.css"; import '/_vf_modules/polyfills/runtime.js';`;
      const result = findNestedImports(code);
      assertEquals(result.vfModules.map((module) => module.path), [
        "_vf_modules/styles/theme.css",
        "_vf_modules/polyfills/runtime.js",
      ]);
    });

    it("does not abort on malformed escaped import specifiers", () => {
      const code = [
        `import bad from "./bad\\xZZ";`,
        `import good from "/_vf_modules/components/Good.js";`,
      ].join("\n");

      const result = findNestedImports(code);

      assertEquals(result.vfModules.map((module) => module.path), []);
      assertEquals(result.relative.map((module) => module.path), []);
    });
  });

  describe("hasUnresolvedImports", () => {
    it("returns count 0 for code with no unresolved imports", () => {
      const code = `import { foo } from "file:///cache/vfmod.mjs";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 0);
      assertEquals(result.paths.length, 0);
    });

    it("detects unresolved _vf_modules imports", () => {
      const code = `import { foo } from "/_vf_modules/_veryfront/lib.js";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count > 0, true);
    });

    it("detects file:///_vf_modules imports (malformed)", () => {
      const code = `import { foo } from "file:///_vf_modules/_veryfront/lib.js";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count > 0, true);
    });

    it("detects unresolved dynamic _vf_modules imports", () => {
      const code = `export const load = () => import("/_vf_modules/components/Lazy.js");`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 1);
      assertEquals(result.paths, ["/_vf_modules/components/Lazy.js"]);
    });

    it("detects unresolved dynamic _vf_modules imports in non-interpolated templates", () => {
      const code = "export const load = () => import(`/_vf_modules/components/Lazy.js`);";
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 1);
      assertEquals(result.paths, ["/_vf_modules/components/Lazy.js"]);
    });

    it("detects every unresolved same-line side-effect import", () => {
      const result = hasUnresolvedImports(
        `/* preload; */ import "/_vf_modules/styles/theme.css"; import "/_vf_modules/polyfills/runtime.js";`,
      );
      assertEquals(result.count, 2);
      assertEquals(result.paths, [
        "/_vf_modules/styles/theme.css",
        "/_vf_modules/polyfills/runtime.js",
      ]);
    });

    it("returns empty for normal resolved file:// imports", () => {
      const code =
        `import { foo } from "file:///home/user/.cache/veryfront-mdx-esm/proj/vfmod.mjs";`;
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 0);
    });

    it("limits paths to 5 entries", () => {
      const imports = Array.from(
        { length: 10 },
        (_, i) => `import { f${i} } from "_vf_modules/_veryfront/lib${i}.js";`,
      ).join("\n");
      const result = hasUnresolvedImports(imports);
      assertEquals(result.paths.length <= 5, true);
    });

    it("returns empty for empty string", () => {
      const result = hasUnresolvedImports("");
      assertEquals(result.count, 0);
    });

    it("does not count import-looking text in strings or comments", () => {
      const code = [
        `const text = 'from "/_vf_modules/_veryfront/lib.js"';`,
        `// import { foo } from "/_vf_modules/_veryfront/commented.js";`,
      ].join("\n");
      const result = hasUnresolvedImports(code);
      assertEquals(result.count, 0);
      assertEquals(result.paths, []);
    });

    it("treats malformed escaped import specifiers as unresolved evidence", () => {
      const result = hasUnresolvedImports(`import bad from "/_vf_modules/bad\\xZZ";`);

      assertEquals(result.count, 1);
      assertEquals(result.paths, ["<malformed import specifier>"]);
    });

    it("treats raw line terminators in import specifiers as unresolved evidence", () => {
      const result = hasUnresolvedImports('import bad from "/_vf_modules/bad\nmodule.js";');

      assertEquals(result.count, 1);
      assertEquals(result.paths, ["<malformed import specifier>"]);
    });
  });

  describe("resolveNestedModuleImports", () => {
    it("resolves vf module imports before relative imports", async () => {
      const calls: Array<{ path: string; parent?: string }> = [];
      const result = await resolveNestedModuleImports({
        moduleCode: [
          `import { shared } from "/_vf_modules/lib/shared.js";`,
          `import local from "./local.js";`,
          `export { shared, local };`,
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path, parent) => {
          calls.push({ path, parent });
          return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
        },
      });

      assertEquals(calls, [
        { path: "_vf_modules/lib/shared.js", parent: "_vf_modules/pages/index.js" },
        { path: "./local.js", parent: "_vf_modules/pages/index.js" },
      ]);
      assertEquals(
        result,
        [
          `import { shared } from "file:///cache/_vf_modules__lib__shared.js.mjs";`,
          `import local from "file:///cache/.__local.js.mjs";`,
          `export { shared, local };`,
        ].join("\n"),
      );
    });

    it("rewrites the matched import instead of the same text in an earlier comment", async () => {
      const result = await resolveNestedModuleImports({
        moduleCode: [
          `// Previous example: from "./local.js"`,
          `import local from "./local.js";`,
          `export { local };`,
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path) => Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`),
      });

      assertEquals(
        result,
        [
          `// Previous example: from "./local.js"`,
          `import local from "file:///cache/.__local.js.mjs";`,
          `export { local };`,
        ].join("\n"),
      );
    });

    it("materializes dynamic _vf_modules imports before caching the module", async () => {
      const calls: Array<{ path: string; parent?: string }> = [];
      const result = await resolveNestedModuleImports({
        moduleCode: [
          `export const load = () => import("/_vf_modules/components/Lazy.js");`,
          `export const unchanged = () => import(path);`,
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path, parent) => {
          calls.push({ path, parent });
          return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
        },
      });

      assertEquals(calls, [
        { path: "_vf_modules/components/Lazy.js", parent: "_vf_modules/pages/index.js" },
      ]);
      assertEquals(
        result,
        [
          `export const load = () => import("file:///cache/_vf_modules__components__Lazy.js.mjs");`,
          `export const unchanged = () => import(path);`,
        ].join("\n"),
      );
    });

    it("preserves suffixes when materializing nested imports", async () => {
      const calls: Array<{ path: string; parent?: string }> = [];
      const result = await resolveNestedModuleImports({
        moduleCode: [
          `import styles from "./theme.css?inline#critical";`,
          `export const load = () => import("/_vf_modules/components/Lazy.js#client");`,
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path, parent) => {
          calls.push({ path, parent });
          return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
        },
      });

      assertEquals(calls, [
        { path: "_vf_modules/components/Lazy.js", parent: "_vf_modules/pages/index.js" },
        { path: "./theme.css", parent: "_vf_modules/pages/index.js" },
      ]);
      assertEquals(
        result,
        [
          `import styles from "file:///cache/.__theme.css.mjs?inline#critical";`,
          `export const load = () => import("file:///cache/_vf_modules__components__Lazy.js.mjs#client");`,
        ].join("\n"),
      );
    });

    it("escapes preserved suffixes when materializing dynamic import literals", async () => {
      const result = await resolveNestedModuleImports({
        moduleCode:
          'export const load = () => import(`/_vf_modules/components/Lazy.js#client" + globalThis.bad + "`);',
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path) => {
          return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
        },
      });

      assertEquals(
        result,
        'export const load = () => import("file:///cache/_vf_modules__components__Lazy.js.mjs#client\\" + globalThis.bad + \\"");',
      );
    });

    it("materializes dynamic _vf_modules imports inside template substitutions", async () => {
      const calls: Array<{ path: string; parent?: string }> = [];
      const result = await resolveNestedModuleImports({
        moduleCode: [
          'export const html = `<p>${await import("/_vf_modules/components/Lazy.js")}</p>`;',
          'export const text = `import("/_vf_modules/components/TextOnly.js")`;',
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path, parent) => {
          calls.push({ path, parent });
          return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
        },
      });

      assertEquals(calls, [
        { path: "_vf_modules/components/Lazy.js", parent: "_vf_modules/pages/index.js" },
      ]);
      assertEquals(
        result,
        [
          'export const html = `<p>${await import("file:///cache/_vf_modules__components__Lazy.js.mjs")}</p>`;',
          'export const text = `import("/_vf_modules/components/TextOnly.js")`;',
        ].join("\n"),
      );
    });

    it("materializes bare side-effect _vf_modules imports before caching the module", async () => {
      const calls: Array<{ path: string; parent?: string }> = [];
      const result = await resolveNestedModuleImports({
        moduleCode: [
          `import "/_vf_modules/styles/theme.css";`,
          `import '/_vf_modules/polyfills/runtime.js';`,
          `export const ready = true;`,
        ].join("\n"),
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: (path, parent) => {
          calls.push({ path, parent });
          return Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`);
        },
      });

      assertEquals(calls, [
        { path: "_vf_modules/styles/theme.css", parent: "_vf_modules/pages/index.js" },
        { path: "_vf_modules/polyfills/runtime.js", parent: "_vf_modules/pages/index.js" },
      ]);
      assertEquals(
        result,
        [
          `import "file:///cache/_vf_modules__styles__theme.css.mjs";`,
          `import "file:///cache/_vf_modules__polyfills__runtime.js.mjs";`,
          `export const ready = true;`,
        ].join("\n"),
      );
    });

    it("keeps dynamic import syntax when non-strict missing modules use stubs", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-dynamic-stub-cache-" });

      try {
        const result = await resolveNestedModuleImports({
          moduleCode: `export const load = () => import("./Missing.js");`,
          esmCacheDir,
          normalizedPath: "_vf_modules/pages/index.js",
          projectSlug: "docs",
          strictMissingModules: false,
          fetchAndCacheModule: () => Promise.resolve(null),
        });

        assertEquals(result.includes("import(from "), false);
        assertEquals(
          /^export const load = \(\) => import\("file:\/\/.*stub-[a-f0-9]+\.mjs"\);$/.test(result),
          true,
        );
      } finally {
        await remove(esmCacheDir, { recursive: true });
      }
    });

    it("defers a missing strict dynamic import until the branch executes", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-dynamic-missing-cache-" });
      const source =
        `export const load = (enabled) => enabled ? import("./optional.js") : Promise.resolve("skipped");`;
      const calls: string[] = [];

      try {
        const result = await resolveNestedModuleImports({
          moduleCode: source,
          esmCacheDir,
          normalizedPath: "_vf_modules/pages/index.js",
          projectSlug: "docs",
          strictMissingModules: true,
          fetchAndCacheModule: (path) => {
            calls.push(path);
            throw buildMissingModuleError({
              modulePath: path,
              importer: "_vf_modules/pages/index.js",
              importStatement: `import("./optional.js")`,
              code: source,
              projectSlug: "docs",
            });
          },
        });
        const parentPath = join(esmCacheDir, "dynamic-parent.mjs");
        await Deno.writeTextFile(parentPath, result);
        const loaded = await import(
          `${toFileUrl(parentPath).href}?test=${crypto.randomUUID()}`
        ) as { load(enabled: boolean): Promise<unknown> };

        assertEquals(calls, ["./optional.js"]);
        assertEquals(await loaded.load(false), "skipped");
        await assertRejects(
          () => loaded.load(true),
          Error,
          "Missing module: ./optional.js",
        );
      } finally {
        await remove(esmCacheDir, { recursive: true });
      }
    });

    it("defers strict dynamic child source failures until the branch executes", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-dynamic-source-cache-" });
      const source =
        `export const load = (enabled) => enabled ? import("./oversized.js") : Promise.resolve("skipped");`;

      try {
        const result = await resolveNestedModuleImports({
          moduleCode: source,
          esmCacheDir,
          normalizedPath: "_vf_modules/pages/index.js",
          projectSlug: "docs",
          strictMissingModules: true,
          fetchAndCacheModule: (path) => {
            throw new ModuleSourceLimitError(path, 2048, 1024);
          },
        });
        const parentPath = join(esmCacheDir, "dynamic-source-parent.mjs");
        await Deno.writeTextFile(parentPath, result);
        const loaded = await import(
          `${toFileUrl(parentPath).href}?test=${crypto.randomUUID()}`
        ) as { load(enabled: boolean): Promise<unknown> };

        assertEquals(await loaded.load(false), "skipped");
        const error = await assertRejects(
          () => loaded.load(true),
          Error,
          "module source exceeds the allowed size",
        );
        if (!(error instanceof Error)) throw new Error("expected Error");
        assertEquals(error.name, "ModuleSourceLimitError");
      } finally {
        await remove(esmCacheDir, { recursive: true });
      }
    });

    it("defers strict dynamic child transform failures with sanitized runtime errors", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-dynamic-transform-cache-" });
      const source =
        `export const load = (enabled) => enabled ? import("./broken.mdx") : Promise.resolve("skipped");`;

      try {
        const result = await resolveNestedModuleImports({
          moduleCode: source,
          esmCacheDir,
          normalizedPath: "_vf_modules/pages/index.js",
          projectSlug: "docs",
          strictMissingModules: true,
          fetchAndCacheModule: () => {
            throw MDX_COMPILE_ERROR.create({
              detail: "MDX compilation error: <raw source> | file: <PROJECT_DIR>/broken.mdx",
            });
          },
        });
        const parentPath = join(esmCacheDir, "dynamic-transform-parent.mjs");
        await Deno.writeTextFile(parentPath, result);
        const loaded = await import(
          `${toFileUrl(parentPath).href}?test=${crypto.randomUUID()}`
        ) as { load(enabled: boolean): Promise<unknown> };

        assertEquals(await loaded.load(false), "skipped");
        const error = await assertRejects(
          () => loaded.load(true),
          Error,
          "MDX compilation failed",
        );
        if (!(error instanceof Error)) throw new Error("expected Error");
        assertEquals(error.name, "MdxCompileError");
        assertEquals(error.message.includes("<PROJECT_DIR>"), false);
        assertEquals(error.message.includes("<raw source>"), false);
      } finally {
        await remove(esmCacheDir, { recursive: true });
      }
    });

    it("defers strict dynamic child cycles until the branch executes", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-dynamic-cycle-cache-" });
      const source =
        `export const load = (enabled) => enabled ? import("./cycle.js") : Promise.resolve("skipped");`;

      try {
        const result = await resolveNestedModuleImports({
          moduleCode: source,
          esmCacheDir,
          normalizedPath: "_vf_modules/pages/index.js",
          projectSlug: "docs",
          strictMissingModules: true,
          fetchAndCacheModule: () => {
            const error = new Error(
              "Circular module dependency detected: _vf_modules/pages/index.js -> ./cycle.js",
            );
            error.name = "CircularModuleDependencyError";
            throw error;
          },
        });
        const parentPath = join(esmCacheDir, "dynamic-cycle-parent.mjs");
        await Deno.writeTextFile(parentPath, result);
        const loaded = await import(
          `${toFileUrl(parentPath).href}?test=${crypto.randomUUID()}`
        ) as { load(enabled: boolean): Promise<unknown> };

        assertEquals(await loaded.load(false), "skipped");
        const error = await assertRejects(
          () => loaded.load(true),
          Error,
          "circular module dependency",
        );
        if (!(error instanceof Error)) throw new Error("expected Error");
        assertEquals(error.name, "CircularModuleDependencyError");
      } finally {
        await remove(esmCacheDir, { recursive: true });
      }
    });

    it("uses fallback stubs for non-strict dynamic child dependency failures", async () => {
      const cases = [
        {
          name: "source",
          path: "./oversized.js",
          error: () => new ModuleSourceLimitError("./oversized.js", 2048, 1024),
        },
        {
          name: "transform",
          path: "./broken.mdx",
          error: () =>
            MDX_COMPILE_ERROR.create({
              detail: "MDX compilation error: <raw source> | file: <PROJECT_DIR>/broken.mdx",
            }),
        },
        {
          name: "cycle",
          path: "./cycle.js",
          error: () => {
            const error = new Error(
              "Circular module dependency detected: _vf_modules/pages/index.js -> ./cycle.js",
            );
            error.name = "CircularModuleDependencyError";
            return error;
          },
        },
      ];

      for (const testCase of cases) {
        const esmCacheDir = await makeTempDir({
          prefix: `vf-mdx-dynamic-${testCase.name}-fallback-cache-`,
        });
        const source =
          `export const load = (enabled) => enabled ? import("${testCase.path}") : Promise.resolve("skipped");`;

        try {
          const result = await resolveNestedModuleImports({
            moduleCode: source,
            esmCacheDir,
            normalizedPath: "_vf_modules/pages/index.js",
            projectSlug: "docs",
            strictMissingModules: false,
            fetchAndCacheModule: () => {
              throw testCase.error();
            },
          });
          const parentPath = join(esmCacheDir, `dynamic-${testCase.name}-fallback-parent.mjs`);
          await Deno.writeTextFile(parentPath, result);
          const loaded = await import(
            `${toFileUrl(parentPath).href}?test=${crypto.randomUUID()}`
          ) as { load(enabled: boolean): Promise<unknown> };

          assertEquals(await loaded.load(false), "skipped");
          const loadedFallback = await loaded.load(true);
          assertEquals(typeof loadedFallback, "object");
        } finally {
          await remove(esmCacheDir, { recursive: true });
        }
      }
    });

    it("keeps strict static imports fail-fast", async () => {
      await assertRejects(
        () =>
          resolveNestedModuleImports({
            moduleCode: `import value from "./missing.js"; export { value };`,
            esmCacheDir: "/tmp/veryfront-unused",
            normalizedPath: "_vf_modules/pages/index.js",
            projectSlug: "docs",
            strictMissingModules: true,
            fetchAndCacheModule: () => Promise.resolve(null),
          }),
        Error,
        "Missing module: ./missing.js",
      );
    });

    it("keeps strict static child source failures fail-fast", async () => {
      await assertRejects(
        () =>
          resolveNestedModuleImports({
            moduleCode: `import value from "./oversized.js"; export { value };`,
            esmCacheDir: "/tmp/veryfront-unused",
            normalizedPath: "_vf_modules/pages/index.js",
            projectSlug: "docs",
            strictMissingModules: true,
            fetchAndCacheModule: (path) => {
              throw new ModuleSourceLimitError(path, 2048, 1024);
            },
          }),
        ModuleSourceLimitError,
        "exceeds the source-size limit",
      );
    });

    it("keeps strict static child transform failures fail-fast", async () => {
      await assertRejects(
        () =>
          resolveNestedModuleImports({
            moduleCode: `import value from "./broken.mdx"; export { value };`,
            esmCacheDir: "/tmp/veryfront-unused",
            normalizedPath: "_vf_modules/pages/index.js",
            projectSlug: "docs",
            strictMissingModules: true,
            fetchAndCacheModule: () => {
              throw MDX_COMPILE_ERROR.create({
                detail: "MDX compilation error: <raw source> | file: <PROJECT_DIR>/broken.mdx",
              });
            },
          }),
        Error,
        "MDX compilation error",
      );
    });

    it("keeps strict static child cycles fail-fast", async () => {
      await assertRejects(
        () =>
          resolveNestedModuleImports({
            moduleCode: `import value from "./cycle.js"; export { value };`,
            esmCacheDir: "/tmp/veryfront-unused",
            normalizedPath: "_vf_modules/pages/index.js",
            projectSlug: "docs",
            strictMissingModules: true,
            fetchAndCacheModule: () => {
              const error = new Error(
                "Circular module dependency detected: _vf_modules/pages/index.js -> ./cycle.js",
              );
              error.name = "CircularModuleDependencyError";
              throw error;
            },
          }),
        Error,
        "Circular module dependency detected",
      );
    });

    it("keeps dynamic infrastructure failures fail-fast", async () => {
      await assertRejects(
        () =>
          resolveNestedModuleImports({
            moduleCode: `export const load = () => import("./later.js");`,
            esmCacheDir: "/tmp/veryfront-unused",
            normalizedPath: "_vf_modules/pages/index.js",
            projectSlug: "docs",
            strictMissingModules: true,
            fetchAndCacheModule: () => {
              throw new Error("cache backend unavailable");
            },
          }),
        Error,
        "cache backend unavailable",
      );
    });

    it("resolves admitted fan-out with bounded concurrency", async () => {
      const importCount = MAX_MDX_MODULE_TRANSFORM_CONCURRENCY + 4;
      const moduleCode = Array.from(
        { length: importCount },
        (_, index) => `import value${index} from "./dependency-${index}.js";`,
      ).join("\n");
      let active = 0;
      let peak = 0;

      await resolveNestedModuleImports({
        moduleCode,
        esmCacheDir: "/tmp/veryfront-unused",
        normalizedPath: "_vf_modules/pages/index.js",
        projectSlug: "docs",
        strictMissingModules: true,
        fetchAndCacheModule: async (path) => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return `/cache/${path.replaceAll("/", "__")}.mjs`;
        },
      });

      assertEquals(peak, MAX_MDX_MODULE_TRANSFORM_CONCURRENCY);
    });

    it("rejects excessive per-file fan-out before starting child fetches", async () => {
      let fetchCount = 0;
      const moduleCode = Array.from(
        { length: MAX_MDX_MODULE_IMPORTS_PER_FILE + 1 },
        (_, index) => `import value${index} from "./dependency-${index}.js";`,
      ).join("\n");

      await assertRejects(
        () =>
          resolveNestedModuleImports({
            moduleCode,
            esmCacheDir: "/tmp/veryfront-unused",
            normalizedPath: "_vf_modules/pages/index.js",
            projectSlug: "docs",
            strictMissingModules: true,
            fetchAndCacheModule: () => {
              fetchCount += 1;
              return Promise.resolve(null);
            },
          }),
        ModuleImportLimitError,
      );
      assertEquals(fetchCount, 0);
    });
  });

  describe("resolveNestedImportBase", () => {
    // A barrel lives at lib/index.ts but is addressed as _vf_modules/lib.
    // Resolving its children against "_vf_modules/lib.js" drops the "lib"
    // segment, so ./constants.js resolved to _vf_modules/constants.js, one
    // directory too high. The file was then stubbed and the barrel silently
    // stopped re-exporting: "does not provide an export named 'COLORS'".
    it("keeps the directory segment for an index module", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib.js", "/project/lib/index.ts"),
        "_vf_modules/lib/index.js",
      );
      assertEquals(
        resolveNestedImportBase("_vf_modules/components.js", "/project/components/index.tsx"),
        "_vf_modules/components/index.js",
      );
    });

    it("leaves a plain module untouched", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/constants.js", "/project/lib/constants.ts"),
        "_vf_modules/lib/constants.js",
      );
    });

    it("does not double up when the path already names index", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/index.js", "/project/lib/index.ts"),
        "_vf_modules/lib/index.js",
      );
    });

    // The import rewriter preserves .mdx specifiers rather than rewriting them
    // to .js, so an index module can reach here still carrying its source
    // extension. Appending another /index.js invents a directory that has no
    // file under it, and every relative import inside that page then 500s.
    it("does not double up when the path names index with a source extension", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/posts/index.mdx", "/project/posts/index.mdx"),
        "_vf_modules/posts/index.mdx",
      );
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/index.ts", "/project/lib/index.ts"),
        "_vf_modules/lib/index.ts",
      );
    });

    it("is a no-op without a resolved file path", () => {
      assertEquals(resolveNestedImportBase("_vf_modules/lib.js"), "_vf_modules/lib.js");
    });

    it("does not treat a file merely named index-something as an index module", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib.js", "/project/lib/indexer.ts"),
        "_vf_modules/lib.js",
      );
    });

    // Which extensions arrive depends on the resolver: the project adapter
    // resolves .md and .mdx alongside the script extensions, and each of those
    // is a transformable module. All of them are their directory's index.
    it("recognises an index file whatever extension it carries", () => {
      for (const ext of ["ts", "tsx", "js", "jsx", "mdx", "md"]) {
        assertEquals(
          resolveNestedImportBase("_vf_modules/lib.js", `/project/lib/index.${ext}`),
          "_vf_modules/lib/index.js",
          ext,
        );
      }
    });

    it("keeps an extensionless index path as it is", () => {
      assertEquals(
        resolveNestedImportBase("_vf_modules/lib/index", "/project/lib/index.ts"),
        "_vf_modules/lib/index",
      );
    });
  });
});
