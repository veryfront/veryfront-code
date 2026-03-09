import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findVfModuleImports, resolveProjectDir } from "./loader-helpers.ts";
import type { ESMLoaderContext } from "./types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

function makeContext(overrides: Partial<ESMLoaderContext> = {}): ESMLoaderContext {
  return {
    moduleCache: new LRUCache({ maxEntries: 10 }),
    ...overrides,
  };
}

describe("transforms/mdx/esm-module-loader/loader-helpers", () => {
  describe("findVfModuleImports", () => {
    it("finds _vf_modules imports with leading slash", () => {
      const code = `import { foo } from "/_vf_modules/lib/utils.js";`;
      const result = findVfModuleImports(code);
      assertEquals(result.length, 1);
      assertEquals(result[0]!.path, "_vf_modules/lib/utils.js");
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
        } as ESMLoaderContext["adapter"],
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
        } as ESMLoaderContext["adapter"],
      });
      assertEquals(resolveProjectDir(context), "/vf/project");
    });

    it("throws when no projectDir available", () => {
      const context = makeContext({ projectSlug: "test" });
      let threw = false;
      try {
        resolveProjectDir(context);
      } catch (_) {
        threw = true;
      }
      assertEquals(threw, true);
    });
  });
});
