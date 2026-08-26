import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/module-fetcher/index.test */

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { join } from "#veryfront/compat/path";
import { VeryfrontError } from "#veryfront/errors";
import {
  CircularModuleDependencyError,
  createModuleFetcherContext,
  endRenderSession,
  fetchAndCacheModule,
  hasRenderSession,
  rewriteDntImports,
  startRenderSession,
} from "./index.ts";
import {
  MAX_MDX_MODULE_GRAPH_ENTRIES,
  ModuleGraphLimitError,
  ModuleSourceLimitError,
} from "./limits.ts";
import { MAX_MDX_MODULE_CODE_BYTES } from "./limits.ts";
import { FRAMEWORK_ROOT } from "../constants.ts";
import { rewriteVeryfrontImports } from "./import-rewriter.ts";
import { findNestedImports, hasUnresolvedImports } from "./nested-imports.ts";
import { hashString } from "../utils/hash.ts";
import { MDX_ESM_CACHE_NAMESPACE } from "../cache-format.ts";
import { normalizePath } from "./module-cache.ts";
import { hashString as hashCacheString } from "#veryfront/cache/hash.ts";

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashCacheString(JSON.stringify(sortedEntries))}`;
}

function getTransformCacheKey(
  projectId: string,
  contentSourceId: string,
  reactVersion: string,
  normalizedPath: string,
  contentHash: string,
): string {
  return `${MDX_ESM_CACHE_NAMESPACE}:${projectId}:${contentSourceId}:${reactVersion}:${normalizedPath}:${contentHash}:ssr`;
}

function getVersionedPathCacheKey(normalizedPath: string, reactVersion: string): string {
  return `${MDX_ESM_CACHE_NAMESPACE}:${reactVersion}:${normalizedPath}`;
}

describe("module-fetcher", () => {
  // Transforming a real module starts esbuild's child process; stop it so the
  // handle does not leak into a later suite.
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  describe("getTransformCacheKey", () => {
    it("includes namespace, project, path, and hash", () => {
      const key = getTransformCacheKey(
        "proj1",
        "preview-main",
        "19.1.1",
        "_vf_modules/pages/index.js",
        "abc123",
      );
      assertEquals(
        key,
        `${MDX_ESM_CACHE_NAMESPACE}:proj1:preview-main:19.1.1:_vf_modules/pages/index.js:abc123:ssr`,
      );
    });

    it("produces different keys for different content hashes", () => {
      const k1 = getTransformCacheKey("p", "preview-main", "19.1.1", "path", "hash1");
      const k2 = getTransformCacheKey("p", "preview-main", "19.1.1", "path", "hash2");
      assertEquals(k1 !== k2, true);
    });

    it("produces different keys for different projects", () => {
      const k1 = getTransformCacheKey("proj-a", "preview-main", "19.1.1", "path", "hash");
      const k2 = getTransformCacheKey("proj-b", "preview-main", "19.1.1", "path", "hash");
      assertEquals(k1 !== k2, true);
    });

    it("produces different keys for different content sources", () => {
      const k1 = getTransformCacheKey("proj-a", "preview-main", "19.1.1", "path", "hash");
      const k2 = getTransformCacheKey("proj-a", "release-42", "19.1.1", "path", "hash");
      assertEquals(k1 !== k2, true);
    });

    it("produces different keys for different react versions", () => {
      const react18 = getTransformCacheKey("proj-a", "preview-main", "18.3.1", "path", "hash");
      const react19 = getTransformCacheKey("proj-a", "preview-main", "19.1.1", "path", "hash");
      assertEquals(react18 !== react19, true);
    });
  });

  describe("getVersionedPathCacheKey", () => {
    it("prefixes with cache namespace", () => {
      const key = getVersionedPathCacheKey("_vf_modules/pages/index.js", "19.1.1");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:19.1.1:_vf_modules/pages/index.js`);
    });
  });

  describe("rewriteVeryfrontImports", () => {
    it("rewrites known veryfront/* imports to /_vf_modules/ paths", () => {
      const code = `import Head from "veryfront/head";`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(
        result,
        `import Head from "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true";`,
      );
    });

    it("rewrites veryfront/router", () => {
      const code = `import { useRouter } from "veryfront/router";`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(
        result,
        `import { useRouter } from "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true";`,
      );
    });

    it("leaves unknown veryfront/* specifiers unchanged", () => {
      const code = `import foo from "veryfront/unknown";`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(result, `import foo from "veryfront/unknown";`);
    });

    it("handles multiple imports in one string", () => {
      const code = [
        `import Head from "veryfront/head";`,
        `import { useRouter } from "veryfront/router";`,
        `import other from "other-lib";`,
      ].join("\n");
      const result = rewriteVeryfrontImports(code);
      assertEquals(result.includes("/_vf_modules/_veryfront/react/runtime/core.js"), true);
      assertEquals(result.includes(`from "other-lib"`), true);
    });

    it("handles single-quoted imports", () => {
      const code = `import Head from 'veryfront/head';`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(
        result,
        `import Head from "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true";`,
      );
    });

    it("does not rewrite non-veryfront imports", () => {
      const code = `import React from "react";`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(result, code);
    });
  });

  describe("normalizePath", () => {
    it("strips leading slash", () => {
      assertEquals(normalizePath("/_vf_modules/pages/index.js"), "_vf_modules/pages/index.js");
    });

    it("returns path unchanged when no parent", () => {
      assertEquals(normalizePath("_vf_modules/pages/index.js"), "_vf_modules/pages/index.js");
    });

    it("resolves ./ relative import against parent", () => {
      const result = normalizePath("./utils.js", "_vf_modules/pages/index.js");
      assertEquals(result, "_vf_modules/pages/utils.js");
    });

    it("resolves ../ relative import against parent", () => {
      const result = normalizePath("../lib/helper.js", "_vf_modules/pages/index.js");
      assertEquals(result, "_vf_modules/lib/helper.js");
    });

    it("allows relative imports that reach but do not escape the virtual root", () => {
      const result = normalizePath("../../shared.js", "_vf_modules/a/b/page.js");
      assertEquals(result, "_vf_modules/shared.js");
    });

    it("rejects relative imports that escape the virtual root", () => {
      assertThrows(
        () => normalizePath("../../secret.js", "_vf_modules/pages/index.js"),
        TypeError,
        "project module root",
      );
      assertThrows(
        () => normalizePath("../../../secret.js", "_vf_modules/pages/index.js"),
        TypeError,
        "project module root",
      );
    });

    it("rejects pre-normalized paths that escape the virtual root", () => {
      assertThrows(
        () => normalizePath("_vf_modules/../secret.js"),
        TypeError,
        "project module root",
      );
      assertThrows(
        () => normalizePath("../secret.js"),
        TypeError,
        "project module root",
      );
    });

    it("adds _vf_modules/ prefix if missing after resolution", () => {
      const result = normalizePath("./foo.js", "bar/baz.js");
      assertEquals(result.startsWith("_vf_modules/"), true);
    });

    it("does not resolve non-relative paths against parent", () => {
      assertEquals(
        normalizePath("_vf_modules/components/Button.js", "_vf_modules/pages/index.js"),
        "_vf_modules/components/Button.js",
      );
    });
  });

  describe("findNestedImports", () => {
    it("finds /_vf_modules/ imports", () => {
      const code = `import Foo from "/_vf_modules/components/Foo.js";`;
      const { vfModules, relative } = findNestedImports(code);
      assertEquals(vfModules.length, 1);
      assertEquals(vfModules[0]!.path, "_vf_modules/components/Foo.js");
      assertEquals(relative.length, 0);
    });

    it("finds relative imports", () => {
      const code = `import utils from "./utils.js";`;
      const { vfModules, relative } = findNestedImports(code);
      assertEquals(vfModules.length, 0);
      assertEquals(relative.length, 1);
      assertEquals(relative[0]!.path, "./utils.js");
    });

    it("finds both types in mixed code", () => {
      const code = [
        `import Foo from "/_vf_modules/components/Foo.js";`,
        `import bar from "../lib/bar.js";`,
        `import Baz from "_vf_modules/pages/Baz.js";`,
      ].join("\n");
      const { vfModules, relative } = findNestedImports(code);
      assertEquals(vfModules.length, 2);
      assertEquals(relative.length, 1);
    });

    it("ignores query parameters in import paths", () => {
      const code = `import Foo from "/_vf_modules/components/Foo.js?v=123";`;
      const { vfModules } = findNestedImports(code);
      assertEquals(vfModules.length, 1);
      assertEquals(vfModules[0]!.path, "_vf_modules/components/Foo.js");
    });

    it("returns empty arrays for code with no imports", () => {
      const { vfModules, relative } = findNestedImports("const x = 1;");
      assertEquals(vfModules.length, 0);
      assertEquals(relative.length, 0);
    });
  });

  describe("hasUnresolvedImports", () => {
    it("detects unresolved /_vf_modules/ imports", () => {
      const code = `import Foo from "/_vf_modules/components/Foo.js";`;
      const { count, paths } = hasUnresolvedImports(code);
      assertEquals(count, 1);
      assertEquals(paths[0], "/_vf_modules/components/Foo.js");
    });

    it("returns 0 when no unresolved imports", () => {
      const code = `import React from "react";`;
      const { count } = hasUnresolvedImports(code);
      assertEquals(count, 0);
    });

    it("caps reported paths at 5", () => {
      const lines = Array.from(
        { length: 10 },
        (_, i) => `import M${i} from "/_vf_modules/m${i}.js";`,
      ).join("\n");
      const { count, paths } = hasUnresolvedImports(lines);
      assertEquals(count, 10);
      assertEquals(paths.length, 5);
    });
  });

  describe("hashString (FNV-1a)", () => {
    it("returns hex string", () => {
      const h = hashString("test");
      assertEquals(/^[0-9a-f]+$/.test(h), true);
    });

    it("same input produces same hash", () => {
      assertEquals(hashString("hello"), hashString("hello"));
    });

    it("different inputs produce different hashes", () => {
      assertEquals(hashString("a") !== hashString("b"), true);
    });

    it("empty string produces a valid hash", () => {
      const h = hashString("");
      assertEquals(/^[0-9a-f]+$/.test(h), true);
    });
  });

  describe("createModuleFetcherContext", () => {
    const mockAdapter = {
      env: { get: (_key: string) => undefined },
      fs: { readFile: () => Promise.resolve("") },
    } as any;

    it("creates context with required fields", () => {
      const ctx = createModuleFetcherContext("/cache", mockAdapter, "/project", "proj-123");
      assertEquals(ctx.esmCacheDir, "/cache");
      assertEquals(ctx.projectDir, "/project");
      assertEquals(ctx.projectId, "proj-123");
      assertEquals(ctx.adapter, mockAdapter);
    });

    it("includes optional fields when provided", () => {
      const ctx = createModuleFetcherContext("/cache", mockAdapter, "/project", "proj-123", {
        isLocalProject: true,
        projectSlug: "my-project",
        reactVersion: "19.0.0",
      });
      assertEquals(ctx.isLocalProject, true);
      assertEquals(ctx.projectSlug, "my-project");
      assertEquals(ctx.reactVersion, "19.0.0");
    });

    it("initializes inFlightModules map", () => {
      const ctx = createModuleFetcherContext("/cache", mockAdapter, "/project", "proj-123");
      assertEquals(ctx.inFlightModules instanceof Map, true);
      assertEquals(ctx.inFlightModules!.size, 0);
    });

    it("initializes a bounded module graph", () => {
      const ctx = createModuleFetcherContext("/cache", mockAdapter, "/project", "proj-123");
      assertEquals(ctx.moduleGraph instanceof Set, true);
      assertEquals(ctx.moduleGraph!.size, 0);
    });
  });

  it("rejects a new module after the request graph reaches its limit", async () => {
    let resolved = false;
    const adapter = {
      env: { get: (_key: string) => undefined },
      fs: {
        resolveFile: () => {
          resolved = true;
          return Promise.resolve(null);
        },
      },
    } as any;
    const ctx = createModuleFetcherContext("/cache", adapter, "/project", "proj-limit", {
      strictMissingModules: false,
    });
    for (let index = 0; index < MAX_MDX_MODULE_GRAPH_ENTRIES; index++) {
      ctx.moduleGraph!.add(`_vf_modules/existing-${index}.js`);
    }

    await assertRejects(
      () => fetchAndCacheModule("_vf_modules/one-too-many.js", ctx),
      ModuleGraphLimitError,
    );
    assertEquals(resolved, false);
  });

  describe("privileged framework modules", () => {
    const untouchableAdapter = {
      env: { get: (_key: string) => undefined },
      fs: {
        resolveFile: (_path: string) => {
          throw new Error("resolveFile must not be called for a refused privileged module");
        },
        readFile: (_path: string) => {
          throw new Error("readFile must not be called for a refused privileged module");
        },
      },
    } as any;

    it("refuses a tenant entry import of the host env implementation", async () => {
      const ctx = createModuleFetcherContext(
        "/cache",
        untouchableAdapter,
        "/project",
        "proj-privileged",
        { strictMissingModules: true },
      );

      const result = await fetchAndCacheModule(
        "/_vf_modules/_veryfront/platform/compat/process/env.js",
        ctx,
      );
      assertEquals(result, null);
    });

    it("refuses a privileged module imported from a tenant module", async () => {
      const ctx = createModuleFetcherContext(
        "/cache",
        untouchableAdapter,
        "/project",
        "proj-privileged",
        { strictMissingModules: true },
      );

      const result = await fetchAndCacheModule(
        "/_vf_modules/_veryfront/platform/compat/process/scoped-process-env.js",
        ctx,
        "_vf_modules/components/page.js",
      );
      assertEquals(result, null);
    });

    it("refuses a tenant entry import of the host cloud bootstrap", async () => {
      const ctx = createModuleFetcherContext(
        "/cache",
        untouchableAdapter,
        "/project",
        "proj-privileged",
        { strictMissingModules: true },
      );

      const result = await fetchAndCacheModule(
        "/_vf_modules/_veryfront/platform/cloud/resolver.js",
        ctx,
      );
      assertEquals(result, null);
    });
  });

  describe("strictMissingModules", () => {
    it("throws when module cannot be resolved", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-strict-cache-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-strict-proj-" });

      const adapter = {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: (_path: string) => Promise.resolve(null),
          readFile: (_path: string) => {
            throw new Error("readFile should not be called for missing module");
          },
        },
      } as any;

      try {
        const ctx = createModuleFetcherContext(esmCacheDir, adapter, projectDir, "proj-123", {
          strictMissingModules: true,
        });

        await assertRejects(
          () => fetchAndCacheModule("/_vf_modules/components/Missing.js", ctx),
          Error,
          "Missing module",
        );
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });

    it("returns null when strictMissingModules is false", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-nonstrict-cache-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-nonstrict-proj-" });

      const adapter = {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: (_path: string) => Promise.resolve(null),
          readFile: (_path: string) => {
            throw new Error("readFile should not be called for missing module");
          },
        },
      } as any;

      try {
        const ctx = createModuleFetcherContext(esmCacheDir, adapter, projectDir, "proj-123", {
          strictMissingModules: false,
        });

        const result = await fetchAndCacheModule("/_vf_modules/lib/utils.js", ctx);
        assertEquals(result, null, "Should return null for missing module when strict mode is off");
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });

    it("does not downgrade an oversized source to a non-strict stub", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-size-cache-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-size-proj-" });
      const adapter = {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: () => Promise.resolve("/virtual/oversized.ts"),
          readFile: () => Promise.resolve("x".repeat(MAX_MDX_MODULE_CODE_BYTES + 1)),
        },
      } as any;

      try {
        const ctx = createModuleFetcherContext(esmCacheDir, adapter, projectDir, "proj-size", {
          strictMissingModules: false,
        });
        await assertRejects(
          () => fetchAndCacheModule("/_vf_modules/oversized.js", ctx),
          ModuleSourceLimitError,
        );
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });
  });

  describe("dependency pinning path transport", () => {
    it("resolves a matching pinned path through a non-local project adapter", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-pinned-cache-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-pinned-proj-" });
      const dependencies = {};
      const cacheKey = cacheKeyForDependencies(dependencies);
      const resolvedPaths: string[] = [];
      const adapter = {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: (path: string) => {
            resolvedPaths.push(path);
            return Promise.resolve(
              path === "components/Child" ? "/virtual/components/Child.ts" : null,
            );
          },
          readFile: (path: string) => {
            if (path !== "/virtual/components/Child.ts") {
              throw new Error(`Unexpected file read: ${path}`);
            }
            return Promise.resolve("export const child = true;");
          },
        },
      } as unknown as RuntimeAdapter;

      try {
        const ctx = createModuleFetcherContext(
          esmCacheDir,
          adapter,
          projectDir,
          "proj-pinned",
          {
            isLocalProject: false,
            strictMissingModules: true,
            dependencyPinningCacheKey: cacheKey,
            dependencyPinningDependencies: dependencies,
          },
        );

        const result = await fetchAndCacheModule(
          `/_vf_modules/_pins/${encodeURIComponent(cacheKey)}/components/Child.js`,
          ctx,
        );

        assertEquals(typeof result, "string");
        assertEquals(resolvedPaths, ["components/Child"]);
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });

    for (
      const [name, path, slug, message] of [
        [
          "a different request snapshot",
          "/_vf_modules/_pins/on%3Asnapshot-b/components/Child.js",
          "dependency-pin-mismatch",
          "does not match the request snapshot",
        ],
        [
          "a malformed path",
          "/_vf_modules/_pins/on%3Asnapshot-a",
          "dependency-pin-malformed",
          "Malformed dependency snapshot module path",
        ],
        [
          "a nested reserved path with malformed percent encoding",
          "/_vf_modules/_pins/on%3Asnapshot-a/_pins/%E0%A4%A/components/Child.js",
          "dependency-pin-malformed",
          "Malformed dependency snapshot module path",
        ],
      ] as const
    ) {
      it(`rejects ${name} before adapter access`, async () => {
        let resolveCount = 0;
        const adapter = {
          env: { get: (_key: string) => undefined },
          fs: {
            resolveFile: () => {
              resolveCount++;
              return Promise.resolve(null);
            },
          },
        } as unknown as RuntimeAdapter;
        const ctx = createModuleFetcherContext("/cache", adapter, "/project", "proj-pinned", {
          dependencyPinningCacheKey: "on:snapshot-a",
          strictMissingModules: false,
        });

        const error = await assertRejects(
          () => fetchAndCacheModule(path, ctx),
          VeryfrontError,
          message,
        );
        if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
        assertEquals(error.slug, slug);
        assertEquals(resolveCount, 0);
      });
    }

    it("treats decodable non-key _pins segments as ordinary source paths", async () => {
      let resolveCount = 0;
      const adapter = {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: () => {
            resolveCount++;
            return Promise.resolve(null);
          },
        },
      } as unknown as RuntimeAdapter;
      const ctx = createModuleFetcherContext("/cache", adapter, "/project", "proj-pinned", {
        dependencyPinningCacheKey: "on:snapshot-a",
      });

      for (
        const path of [
          "/_vf_modules/_pins/project-dir/components/Child.js",
          "/_vf_modules/_pins/not-a-snapshot/components/Child.js",
        ]
      ) {
        const error = await assertRejects(
          () => fetchAndCacheModule(path, ctx),
          Error,
          "[MDX] Missing module",
        );
        if (!(error instanceof Error)) throw new Error("expected Error");
        assertEquals(error.name, "MissingModuleError");
      }
      assertEquals(resolveCount > 0, true);
    });
  });

  describe("circular imports", () => {
    function createCircularAdapter(): any {
      const sourceByPath = new Map<string, string>([
        [
          "/virtual/a.ts",
          `import B from "./b.js"; export default function A() { return B; }`,
        ],
        [
          "/virtual/b.ts",
          `import A from "./a.js"; export default function B() { return A; }`,
        ],
      ]);

      return {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: (path: string) => {
            if (path === "a") return Promise.resolve("/virtual/a.ts");
            if (path === "b") return Promise.resolve("/virtual/b.ts");
            return Promise.resolve(null);
          },
          readFile: (path: string) => {
            const source = sourceByPath.get(path);
            if (!source) throw new Error(`File not found: ${path}`);
            return Promise.resolve(source);
          },
        },
      };
    }

    it("throws CircularModuleDependencyError in strict mode", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-cycle-strict-cache-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-cycle-strict-proj-" });
      const adapter = createCircularAdapter();

      try {
        const ctx = createModuleFetcherContext(esmCacheDir, adapter, projectDir, "proj-cycle", {
          strictMissingModules: true,
        });

        await assertRejects(
          () => fetchAndCacheModule("/_vf_modules/a.js", ctx),
          CircularModuleDependencyError,
          "Circular module dependency detected",
        );
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });
  });

  describe("directory barrels", () => {
    // A page importing "@/lib" resolves to lib/index.ts, which re-exports
    // "./constants.js". That relative import must resolve to lib/constants.ts,
    // not to constants.ts beside the lib directory.
    function createBarrelAdapter(): RuntimeAdapter {
      const sourceByPath = new Map<string, string>([
        ["/virtual/lib/index.ts", `export * from "./constants.js";`],
        ["/virtual/lib/constants.ts", `export const COLORS = ["red", "blue"];`],
      ]);

      return {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: (path: string) => {
            if (path === "lib") return Promise.resolve("/virtual/lib/index.ts");
            if (path === "lib/constants") return Promise.resolve("/virtual/lib/constants.ts");
            return Promise.resolve(null);
          },
          readFile: (path: string) => {
            const source = sourceByPath.get(path);
            if (!source) throw new Error(`File not found: ${path}`);
            return Promise.resolve(source);
          },
        },
      } as unknown as RuntimeAdapter;
    }

    it("re-exports through a barrel's relative import", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-barrel-cache-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-barrel-proj-" });

      try {
        const ctx = createModuleFetcherContext(
          esmCacheDir,
          createBarrelAdapter(),
          projectDir,
          "proj-barrel",
          { strictMissingModules: true },
        );

        const modulePath = await fetchAndCacheModule("/_vf_modules/lib.js", ctx);
        assertEquals(typeof modulePath, "string");

        const barrel = await import(`file://${modulePath}`);
        assertEquals(barrel.COLORS, ["red", "blue"]);
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });
  });

  describe("rewriteDntImports", () => {
    const frameworkPath = "/usr/local/lib/node_modules/veryfront/src/react/router/index.tsx";
    const projectPath = "/app/project/components/Button.tsx";

    it("rewrites relative _dnt.polyfills.js import for framework files", async () => {
      const code = `import "../../../_dnt.polyfills.js";\nexport const foo = 1;`;
      const result = await rewriteDntImports(code, frameworkPath);
      assertEquals(result.includes("file://"), true);
      assertEquals(result.includes("_dnt.polyfills.js"), true);
      assertEquals(result.includes("../../../_dnt.polyfills.js"), false);
    });

    it("rewrites relative _dnt.shims.js import for framework files", async () => {
      const code = `import * as dntShim from "../../_dnt.shims.js";\nexport const foo = 1;`;
      const result = await rewriteDntImports(code, frameworkPath);
      assertEquals(result.includes("file://"), true);
      assertEquals(result.includes("_dnt.shims.js"), true);
      assertEquals(result.includes("../../_dnt.shims.js"), false);
    });

    it("rewrites side-effect _dnt.polyfills.js import (no from)", async () => {
      const code = `import "../../../_dnt.polyfills.js";\nimport "../../../_dnt.polyfills.js";`;
      const result = await rewriteDntImports(code, frameworkPath);
      const matches = result.match(/file:\/\//g);
      assertEquals(matches?.length, 2);
    });

    it("does not rewrite dnt imports for project files", async () => {
      const code = `import "../../../_dnt.polyfills.js";\nexport const foo = 1;`;
      const result = await rewriteDntImports(code, projectPath);
      assertEquals(result, code);
    });

    it("does not modify code without dnt imports", async () => {
      const code = `import React from "react";\nexport const foo = 1;`;
      const result = await rewriteDntImports(code, frameworkPath);
      assertEquals(result, code);
    });

    it("handles mixed dnt and non-dnt imports", async () => {
      const code = [
        `import "../../../_dnt.polyfills.js";`,
        `import React from "react";`,
        `import * as dntShim from "../../_dnt.shims.js";`,
        `export default function App() {}`,
      ].join("\n");
      const result = await rewriteDntImports(code, frameworkPath);
      assertEquals(result.includes(`from "react"`), true);
      assertEquals(result.includes("../../../_dnt.polyfills.js"), false);
      assertEquals(result.includes("../../_dnt.shims.js"), false);
      assertEquals((result.match(/file:\/\//g) ?? []).length, 2);
    });

    it("rewrites node_modules paths even if not under FRAMEWORK_ROOT", async () => {
      const nodeModulesPath = "/app/node_modules/veryfront/esm/src/react/router/index.js";
      const code = `import "../../_dnt.polyfills.js";`;
      const result = await rewriteDntImports(code, nodeModulesPath);
      assertEquals(result.includes("file://"), true);
    });

    it("does not rewrite project files under FRAMEWORK_ROOT in local dev", async () => {
      const localProjectPath = join(
        FRAMEWORK_ROOT,
        "projects/example-project/components/Header.tsx",
      );
      const code = `import { Logo } from "../elements/Logo.js";\nexport const foo = 1;`;
      const result = await rewriteDntImports(code, localProjectPath);
      assertEquals(result, code, "Project files under FRAMEWORK_ROOT should not be rewritten");
    });

    it("rewrites framework src files under FRAMEWORK_ROOT", async () => {
      const frameworkSrcPath = join(FRAMEWORK_ROOT, "src/react/components/Head.tsx");
      const code = `import "../../../_dnt.polyfills.js";\nexport const foo = 1;`;
      const result = await rewriteDntImports(code, frameworkSrcPath);
      assertEquals(result.includes("file://"), true);
      assertEquals(result.includes("../../../_dnt.polyfills.js"), false);
    });
  });

  describe("render sessions", () => {
    it("startRenderSession and endRenderSession lifecycle", () => {
      const sessionId = `test-session-${Date.now()}`;
      startRenderSession(sessionId, "test-project", "/");
      assertEquals(
        hasRenderSession(sessionId),
        true,
        "startRenderSession must register the session",
      );
      endRenderSession(sessionId);
      assertEquals(
        hasRenderSession(sessionId),
        false,
        "endRenderSession must tear the session down",
      );
    });

    it("endRenderSession with unknown session does not throw", () => {
      endRenderSession("nonexistent-session-id");
    });

    it("can start multiple sessions", () => {
      const id1 = `s1-${Date.now()}`;
      const id2 = `s2-${Date.now()}`;
      startRenderSession(id1, "proj-a", "/a");
      startRenderSession(id2, "proj-b", "/b");
      assertEquals(hasRenderSession(id1), true, "the first session must stay registered");
      assertEquals(hasRenderSession(id2), true, "the second session must stay registered");
      endRenderSession(id1);
      assertEquals(
        hasRenderSession(id2),
        true,
        "ending one session must not tear down a concurrent one",
      );
      endRenderSession(id2);
      assertEquals(hasRenderSession(id2), false, "the second session is torn down in turn");
    });
  });
});
