import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  findVfModuleImports,
  processVfModuleImports,
  resolveProjectDir,
} from "./loader-helpers.ts";
import type { MdxPreparationContext } from "./types.ts";
import { VeryfrontError } from "#veryfront/errors";
import { join } from "#veryfront/compat/path/index.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { clearModulePathCache, getModulePathCache } from "./cache/index.ts";
import { MDX_MODULE_DEV_COMPILE_VARIANT } from "./module-fetcher/cache-keys.ts";

function makeContext(overrides: Partial<MdxPreparationContext> = {}): MdxPreparationContext {
  return {
    ...overrides,
  };
}

describe("transforms/mdx/esm-module-loader/loader-helpers", () => {
  // Transforming a real module starts esbuild's child process; stop it so the
  // handle does not leak into a later suite.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  describe("findVfModuleImports", () => {
    it("finds _vf_modules imports with leading slash", () => {
      const code = `import { foo } from "/_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.path, "_vf_modules/lib/utils.js");
      assertEquals(
        result[0]!.isDynamic ?? false,
        false,
        "a static import must not be flagged as dynamic",
      );
    });

    it("finds dynamic _vf_modules imports and flags them", () => {
      const code = `const m = await import("/_vf_modules/lib/utils.js");`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1, "a dynamic _vf_modules import must be found");
      assertEquals(result[0]!.path, "_vf_modules/lib/utils.js");
      assertEquals(
        result[0]!.isDynamic,
        true,
        "a dynamic import must be flagged so processVfModuleImports defers its stub",
      );
    });

    it("splits a query suffix off the specifier", () => {
      const code = `import x from "/_vf_modules/lib/utils.js?ssr=true";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
      assertEquals(
        result[0]!.path,
        "_vf_modules/lib/utils.js",
        "the query must not leak into the module path",
      );
      assertEquals(
        result[0]!.suffix,
        "?ssr=true",
        "the query suffix must survive for resolution",
      );
    });

    it("finds _vf_modules imports without leading slash", () => {
      const code = `import { foo } from "_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.path, "_vf_modules/lib/utils.js");
    });

    it("finds multiple imports", () => {
      const code = `
import { foo } from "_vf_modules/lib/utils.js";
import { bar } from "/_vf_modules/components/Button.js";
      `;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 2);
    });

    it("returns empty for code with no _vf_modules imports", () => {
      const code = `import React from "react";`;
      assertEquals(findVfModuleImports(code), []);
    });

    it("returns empty for empty string", () => {
      assertEquals(findVfModuleImports(""), []);
    });

    it("captures the original match text", () => {
      const code = `import { foo } from "_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result[0]!.original.includes("from"), true);
    });

    it("handles single-quoted imports", () => {
      const code = `import { foo } from '_vf_modules/lib/utils.js';`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
    });

    it("handles re-export statements", () => {
      const code = `export { foo } from "_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
    });

    it("does not match _vf_modules in non-import context", () => {
      const code = `const path = "_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 0);
    });
  });

  describe("processVfModuleImports compile mode", () => {
    async function collectPathCacheKeys(
      mode: MdxPreparationContext["mode"],
    ): Promise<string[]> {
      const projectDir = await makeTempDir({ prefix: "vf-mdx-entry-mode-project-" });
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-entry-mode-cache-" });
      const code = `import { label } from "/_vf_modules/lib/label.js";\nexport default label;`;

      try {
        await mkdir(join(projectDir, "lib"), { recursive: true });
        await writeTextFile(
          join(projectDir, "lib/label.js"),
          `export const label = "compiled";`,
        );

        clearModulePathCache();
        await processVfModuleImports(
          code,
          findVfModuleImports(code),
          {
            esmCacheDir,
            adapter: await getLocalAdapter(),
            projectId: "mdx-entry-mode",
            projectDir,
            projectSlug: "mdx-entry-mode",
            contentSourceId: "release-1",
            reactVersion: "19.1.1",
            mode,
          },
          projectDir,
          true,
        );

        return [...(await getModulePathCache(esmCacheDir)).keys()];
      } finally {
        clearModulePathCache();
        await remove(projectDir, { recursive: true }).catch(() => undefined);
        await remove(esmCacheDir, { recursive: true }).catch(() => undefined);
      }
    }

    it("compiles a compiled-MDX entry's modules for the render mode", async () => {
      const developmentKeys = await collectPathCacheKeys("development");
      const productionKeys = await collectPathCacheKeys("production");

      // The compile mode decides minification, tree shaking and the inline
      // sourcemap, so the two renders must not meet on one cache key.
      assertEquals(
        developmentKeys.every((key) => key.includes(MDX_MODULE_DEV_COMPILE_VARIANT)),
        true,
        `expected development keys to carry the compile-mode segment: ${developmentKeys}`,
      );
      assertEquals(
        productionKeys.some((key) => key.includes(MDX_MODULE_DEV_COMPILE_VARIANT)),
        false,
        `expected no development key from a production render: ${productionKeys}`,
      );
      assertEquals(developmentKeys.length > 0, true);
      assertEquals(productionKeys.length > 0, true);
    });

    it("compiles for production when the context carries no render mode", async () => {
      const keys = await collectPathCacheKeys(undefined);

      assertEquals(keys.length > 0, true);
      assertEquals(keys.some((key) => key.includes(MDX_MODULE_DEV_COMPILE_VARIANT)), false);
    });
  });

  describe("resolveProjectDir", () => {
    it("returns projectDir when explicitly set", () => {
      const context = makeContext({
        projectDir: "/my/project",
        projectSlug: "test",
      });
      assertEquals(resolveProjectDir(context), "/my/project");
    });

    it("falls back to VERYFRONT_PROJECT_DIR env var", () => {
      const context = makeContext({
        projectSlug: "test",
        adapter: {
          env: {
            get(key: string) {
              if (key === "VERYFRONT_PROJECT_DIR") return "/env/project";
              return undefined;
            },
          },
        } as MdxPreparationContext["adapter"],
      });
      assertEquals(resolveProjectDir(context), "/env/project");
    });

    it("falls back to VF_PROJECT_DIR env var", () => {
      const context = makeContext({
        projectSlug: "test",
        adapter: {
          env: {
            get(key: string) {
              if (key === "VF_PROJECT_DIR") return "/vf/project";
              return undefined;
            },
          },
        } as MdxPreparationContext["adapter"],
      });
      assertEquals(resolveProjectDir(context), "/vf/project");
    });

    it("throws when no projectDir available", () => {
      const context = makeContext({ projectSlug: "test" });
      const error = assertThrows(
        () => resolveProjectDir(context),
        VeryfrontError,
        "projectDir is required",
      ) as VeryfrontError;
      assertEquals(
        error.slug,
        "invalid-argument",
        "a missing projectDir is classified as an invalid argument",
      );
      assertEquals(error.status, 400, "a missing projectDir maps to HTTP 400");
    });
  });
});
