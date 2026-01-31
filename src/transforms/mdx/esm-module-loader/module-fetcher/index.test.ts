/** @module transforms/mdx/esm-module-loader/module-fetcher/index.test */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join } from "#std/path.ts";
import {
  createModuleFetcherContext,
  endRenderSession,
  fetchAndCacheModule,
  rewriteDntImports,
  startRenderSession,
} from "./index.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { FRAMEWORK_ROOT, HASH_SEED_FNV1A } from "../constants.ts";

function getTransformCacheKey(
  projectId: string,
  normalizedPath: string,
  contentHash: string,
): string {
  return `v${VERSION}:${projectId}:${normalizedPath}:${contentHash}`;
}

function getVersionedPathCacheKey(normalizedPath: string): string {
  return `v${VERSION}:${normalizedPath}`;
}

const VERYFRONT_IMPORT_MAP: Record<string, string> = {
  "veryfront/head": "/_vf_modules/_veryfront/react/components/Head.js",
  "veryfront/router": "/_vf_modules/_veryfront/react/router/index.js",
  "veryfront/context": "/_vf_modules/_veryfront/react/context/index.js",
  "veryfront/fonts": "/_vf_modules/_veryfront/react/fonts/index.js",
};

function rewriteVeryfrontImports(code: string): string {
  return code.replace(
    /from\s+["'](veryfront\/[^"']+)["']/g,
    (_match, specifier: string) => `from "${VERYFRONT_IMPORT_MAP[specifier] ?? specifier}"`,
  );
}

function normalizePath(modulePath: string, parentModulePath?: string): string {
  const stripped = modulePath.replace(/^\//, "");
  if (!parentModulePath) return stripped;

  const isRelative = modulePath.startsWith("./") || modulePath.startsWith("../");
  if (!isRelative) return stripped;

  const parentDir = parentModulePath.replace(/\/[^/]+$/, "");
  const parts = [...parentDir.split("/"), ...modulePath.split("/")];

  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }

  const joined = resolved.join("/");
  return joined.startsWith("_vf_modules/") ? joined : `_vf_modules/${joined}`;
}

function findNestedImports(moduleCode: string): {
  vfModules: Array<{ original: string; path: string }>;
  relative: Array<{ original: string; path: string }>;
} {
  const VF_MODULE_IMPORT_PATTERN = /from\s+["'](\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;
  const RELATIVE_IMPORT_PATTERN = /from\s+["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;

  const vfModules: Array<{ original: string; path: string }> = [];
  const relative: Array<{ original: string; path: string }> = [];

  for (const match of moduleCode.matchAll(VF_MODULE_IMPORT_PATTERN)) {
    const path = match[1];
    if (path) vfModules.push({ original: match[0], path: path.replace(/^\//, "") });
  }

  for (const match of moduleCode.matchAll(RELATIVE_IMPORT_PATTERN)) {
    const path = match[1];
    if (path) relative.push({ original: match[0], path });
  }

  return { vfModules, relative };
}

function hasUnresolvedImports(moduleCode: string): { count: number; paths: string[] } {
  const UNRESOLVED_VF_MODULES_PATTERN = /from\s+["'](\/?_vf_modules\/[^"']+)["']/g;
  const matches = [...moduleCode.matchAll(UNRESOLVED_VF_MODULES_PATTERN)];

  return {
    count: matches.length,
    paths: matches
      .map((m) => m[1])
      .filter((p): p is string => p !== undefined)
      .slice(0, 5),
  };
}

function hashString(input: string): string {
  let hash = HASH_SEED_FNV1A >>> 0;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

describe("module-fetcher", { sanitizeResources: false, sanitizeOps: false }, () => {
  describe("getTransformCacheKey", () => {
    it("includes version, project, path, and hash", () => {
      const key = getTransformCacheKey("proj1", "_vf_modules/pages/index.js", "abc123");
      assertEquals(key, `v${VERSION}:proj1:_vf_modules/pages/index.js:abc123`);
    });

    it("produces different keys for different content hashes", () => {
      const k1 = getTransformCacheKey("p", "path", "hash1");
      const k2 = getTransformCacheKey("p", "path", "hash2");
      assertEquals(k1 !== k2, true);
    });

    it("produces different keys for different projects", () => {
      const k1 = getTransformCacheKey("proj-a", "path", "hash");
      const k2 = getTransformCacheKey("proj-b", "path", "hash");
      assertEquals(k1 !== k2, true);
    });
  });

  describe("getVersionedPathCacheKey", () => {
    it("prefixes with version", () => {
      const key = getVersionedPathCacheKey("_vf_modules/pages/index.js");
      assertEquals(key, `v${VERSION}:_vf_modules/pages/index.js`);
    });
  });

  describe("rewriteVeryfrontImports", () => {
    it("rewrites known veryfront/* imports to /_vf_modules/ paths", () => {
      const code = `import Head from "veryfront/head";`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(result, `import Head from "/_vf_modules/_veryfront/react/components/Head.js";`);
    });

    it("rewrites veryfront/router", () => {
      const code = `import { useRouter } from "veryfront/router";`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(
        result,
        `import { useRouter } from "/_vf_modules/_veryfront/react/router/index.js";`,
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
      assertEquals(result.includes("/_vf_modules/_veryfront/react/components/Head.js"), true);
      assertEquals(result.includes("/_vf_modules/_veryfront/react/router/index.js"), true);
      assertEquals(result.includes(`from "other-lib"`), true);
    });

    it("handles single-quoted imports", () => {
      const code = `import Head from 'veryfront/head';`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(result, `import Head from "/_vf_modules/_veryfront/react/components/Head.js";`);
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
        isLocalDev: true,
        projectSlug: "my-project",
        reactVersion: "19.0.0",
      });
      assertEquals(ctx.isLocalDev, true);
      assertEquals(ctx.projectSlug, "my-project");
      assertEquals(ctx.reactVersion, "19.0.0");
    });

    it("initializes inFlightModules map", () => {
      const ctx = createModuleFetcherContext("/cache", mockAdapter, "/project", "proj-123");
      assertEquals(ctx.inFlightModules instanceof Map, true);
      assertEquals(ctx.inFlightModules!.size, 0);
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
  });

  describe("rewriteDntImports", () => {
    const frameworkPath = "/usr/local/lib/node_modules/veryfront/src/react/router/index.tsx";
    const projectPath = "/app/project/components/Button.tsx";

    it("rewrites relative _dnt.polyfills.js import for framework files", () => {
      const code = `import "../../../_dnt.polyfills.js";\nexport const foo = 1;`;
      const result = rewriteDntImports(code, frameworkPath);
      assertEquals(result.includes("file://"), true);
      assertEquals(result.includes("_dnt.polyfills.js"), true);
      assertEquals(result.includes("../../../_dnt.polyfills.js"), false);
    });

    it("rewrites relative _dnt.shims.js import for framework files", () => {
      const code = `import * as dntShim from "../../_dnt.shims.js";\nexport const foo = 1;`;
      const result = rewriteDntImports(code, frameworkPath);
      assertEquals(result.includes("file://"), true);
      assertEquals(result.includes("_dnt.shims.js"), true);
      assertEquals(result.includes("../../_dnt.shims.js"), false);
    });

    it("rewrites side-effect _dnt.polyfills.js import (no from)", () => {
      const code = `import "../../../_dnt.polyfills.js";\nimport "../../../_dnt.polyfills.js";`;
      const result = rewriteDntImports(code, frameworkPath);
      const matches = result.match(/file:\/\//g);
      assertEquals(matches?.length, 2);
    });

    it("does not rewrite dnt imports for project files", () => {
      const code = `import "../../../_dnt.polyfills.js";\nexport const foo = 1;`;
      const result = rewriteDntImports(code, projectPath);
      assertEquals(result, code);
    });

    it("does not modify code without dnt imports", () => {
      const code = `import React from "react";\nexport const foo = 1;`;
      const result = rewriteDntImports(code, frameworkPath);
      assertEquals(result, code);
    });

    it("handles mixed dnt and non-dnt imports", () => {
      const code = [
        `import "../../../_dnt.polyfills.js";`,
        `import React from "react";`,
        `import * as dntShim from "../../_dnt.shims.js";`,
        `export default function App() {}`,
      ].join("\n");
      const result = rewriteDntImports(code, frameworkPath);
      assertEquals(result.includes(`from "react"`), true);
      assertEquals(result.includes("../../../_dnt.polyfills.js"), false);
      assertEquals(result.includes("../../_dnt.shims.js"), false);
      assertEquals((result.match(/file:\/\//g) ?? []).length, 2);
    });

    it("rewrites node_modules paths even if not under FRAMEWORK_ROOT", () => {
      const nodeModulesPath = "/app/node_modules/veryfront/esm/src/react/router/index.js";
      const code = `import "../../_dnt.polyfills.js";`;
      const result = rewriteDntImports(code, nodeModulesPath);
      assertEquals(result.includes("file://"), true);
    });

    it("does not rewrite project files under FRAMEWORK_ROOT in local dev", () => {
      const localProjectPath = join(FRAMEWORK_ROOT, "projects/codersociety/components/Header.tsx");
      const code = `import { Logo } from "../elements/Logo.js";\nexport const foo = 1;`;
      const result = rewriteDntImports(code, localProjectPath);
      assertEquals(result, code, "Project files under FRAMEWORK_ROOT should not be rewritten");
    });

    it("rewrites framework src files under FRAMEWORK_ROOT", () => {
      const frameworkSrcPath = join(FRAMEWORK_ROOT, "src/react/components/Head.tsx");
      const code = `import "../../../_dnt.polyfills.js";\nexport const foo = 1;`;
      const result = rewriteDntImports(code, frameworkSrcPath);
      assertEquals(result.includes("file://"), true);
      assertEquals(result.includes("../../../_dnt.polyfills.js"), false);
    });
  });

  describe("render sessions", () => {
    it("startRenderSession and endRenderSession lifecycle", () => {
      const sessionId = `test-session-${Date.now()}`;
      startRenderSession(sessionId, "test-project", "/");
      endRenderSession(sessionId);
    });

    it("endRenderSession with unknown session does not throw", () => {
      endRenderSession("nonexistent-session-id");
    });

    it("can start multiple sessions", () => {
      const id1 = `s1-${Date.now()}`;
      const id2 = `s2-${Date.now()}`;
      startRenderSession(id1, "proj-a", "/a");
      startRenderSession(id2, "proj-b", "/b");
      endRenderSession(id1);
      endRenderSession(id2);
    });
  });
});
