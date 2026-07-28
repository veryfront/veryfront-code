import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findMissingFrameworkBundles,
  findVfModuleImports,
  initializeCacheDir,
  resolveProjectDir,
} from "./loader-helpers.ts";
import type { ESMLoaderContext } from "./types.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";

function makeContext(overrides: Partial<ESMLoaderContext> = {}): ESMLoaderContext {
  return {
    moduleCache: new LRUCache({ maxEntries: 10 }),
    ...overrides,
  };
}

describe("transforms/mdx/esm-module-loader/loader-helpers", () => {
  describe("findMissingFrameworkBundles", () => {
    it("returns only paths reported absent by the filesystem", async () => {
      assertEquals(
        await findMissingFrameworkBundles(
          ["/cache/present.mjs", "/cache/missing.mjs"],
          (path) => Promise.resolve(path.endsWith("present.mjs")),
        ),
        ["/cache/missing.mjs"],
      );
    });

    it("propagates operational existence-check failures", async () => {
      const permissionError = Object.assign(new Error("bundle lookup denied"), {
        code: "EACCES",
      });
      const error = await assertRejects(
        () =>
          findMissingFrameworkBundles(
            ["/cache/bundle.mjs"],
            () => Promise.reject(permissionError),
          ),
        Error,
        "bundle lookup denied",
      );
      assertEquals(error, permissionError);
    });
  });

  describe("initializeCacheDir", () => {
    function cacheContext(overrides: Partial<ESMLoaderContext> = {}): ESMLoaderContext {
      return makeContext({
        projectId: "project-1",
        projectSlug: "project",
        contentSourceId: "preview-main",
        ...overrides,
      });
    }

    it("uses a temporary cache only when the persistent directory is not writable", async () => {
      const context = cacheContext();
      const readOnlyError = Object.assign(new Error("read-only cache"), { code: "EROFS" });
      let tempPrefix: string | undefined;
      const fs: Pick<FileSystem, "mkdir" | "makeTempDir"> = {
        mkdir: () => Promise.reject(readOnlyError),
        makeTempDir: (options) => {
          tempPrefix = options?.prefix;
          return Promise.resolve("/tmp/veryfront-mdx-cache");
        },
      };

      const cacheDir = await initializeCacheDir(context, fs);

      assertEquals(cacheDir, "/tmp/veryfront-mdx-cache");
      assertEquals(context.esmCacheDir, cacheDir);
      assertEquals(tempPrefix?.startsWith("veryfront-mdx-esm-"), true);
    });

    it("propagates operational directory failures instead of masking them", async () => {
      const context = cacheContext();
      const ioError = Object.assign(new Error("cache device failed"), { code: "EIO" });
      let madeTempDir = false;
      const fs: Pick<FileSystem, "mkdir" | "makeTempDir"> = {
        mkdir: () => Promise.reject(ioError),
        makeTempDir: () => {
          madeTempDir = true;
          return Promise.resolve("/tmp/should-not-exist");
        },
      };

      const error = await assertRejects(
        () => initializeCacheDir(context, fs),
        Error,
        "cache device failed",
      );
      assertEquals(error, ioError);
      assertEquals(madeTempDir, false);
      assertEquals(context.esmCacheDir, undefined);
    });

    it("reuses an initialized cache without touching the filesystem", async () => {
      const context = cacheContext({ esmCacheDir: "/cache/already-initialized" });
      const fs: Pick<FileSystem, "mkdir" | "makeTempDir"> = {
        mkdir: () => Promise.reject(new Error("mkdir must not run")),
        makeTempDir: () => Promise.reject(new Error("makeTempDir must not run")),
      };

      assertEquals(
        await initializeCacheDir(context, fs),
        "/cache/already-initialized",
      );
    });
  });

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
