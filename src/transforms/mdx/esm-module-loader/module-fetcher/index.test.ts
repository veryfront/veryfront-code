import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/module-fetcher/index.test */

import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { join } from "#veryfront/compat/path";
import {
  CircularModuleDependencyError,
  createModuleFetcherContext,
  endRenderSession,
  fetchAndCacheModule,
  rewriteDntImports,
  startRenderSession,
} from "./index.ts";
import {
  MAX_MDX_MODULE_GRAPH_ENTRIES,
  ModuleGraphLimitError,
  ModuleSourceLimitError,
} from "./limits.ts";
import { MAX_MDX_MODULE_CODE_BYTES } from "./recovery-payload.ts";
import { FRAMEWORK_ROOT, HASH_SEED_FNV1A } from "../constants.ts";
import { resolveVeryfrontModuleUrl } from "../../../veryfront-module-urls.ts";
import { MDX_ESM_CACHE_NAMESPACE } from "../cache-format.ts";
import { getDefaultImportMap } from "#veryfront/modules/import-map/index.ts";
import { normalizePath } from "./module-cache.ts";
import type {
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "#veryfront/cache/types.ts";
import {
  __injectCachesForTests,
  __resetInitStateForTests,
} from "#veryfront/transforms/esm/transform-cache.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";

class PermitFlowCache implements RevisionedCacheBackend {
  readonly type = "distributed" as const;
  readonly events: string[];
  readonly primaryReads: string[] = [];
  readonly primaryExchanges: Array<{ expectedRevision: string; result: boolean }> = [];
  readonly ordinaryCalls: string[] = [];
  private primaryRevision = "replacement-after-observation";
  private recoveryRevision = 0;

  constructor(events: string[]) {
    this.events = events;
  }

  get(key: string): Promise<string | null> {
    this.ordinaryCalls.push(`get:${key}`);
    return Promise.reject(new Error("ordinary get must not be used"));
  }

  set(key: string): Promise<void> {
    this.ordinaryCalls.push(`set:${key}`);
    return Promise.reject(new Error("ordinary set must not be used"));
  }

  del(key: string): Promise<void> {
    this.ordinaryCalls.push(`del:${key}`);
    return Promise.reject(new Error("ordinary del must not be used"));
  }

  getWithRevision(key: string): Promise<CacheRevisionSnapshot> {
    if (key.includes(":transform:")) {
      this.primaryReads.push(key);
      this.events.push("primary-observation");
      if (this.primaryReads.length === 1) {
        return Promise.resolve({ value: null, revision: "observed-before-transform" });
      }
      return Promise.resolve({ value: null, revision: this.primaryRevision });
    }
    return Promise.resolve({ value: null, revision: String(this.recoveryRevision) });
  }

  compareExchange(
    key: string,
    expectedRevision: string,
    mutation: CacheRevisionMutation,
  ): Promise<boolean> {
    if (key.includes(":transform:")) {
      const result = expectedRevision === this.primaryRevision;
      this.primaryExchanges.push({ expectedRevision, result });
      this.events.push("primary-publication");
      if (result) this.primaryRevision = "unexpected-overwrite";
      return Promise.resolve(result);
    }
    if (expectedRevision === String(this.recoveryRevision) && mutation.kind === "set") {
      this.recoveryRevision++;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

function createPermitFlowLogger(events: string[]): Logger {
  const log = {
    debug(message: string) {
      if (message.includes("transformToESM START")) events.push("transform-start");
    },
    info: () => {},
    warn: () => {},
    error: () => {},
    time: (_label: string, fn: () => unknown) => fn(),
    child: () => log,
    component: () => log,
  };
  return log as unknown as Logger;
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

function rewriteVeryfrontImports(code: string): string {
  return code.replace(/from\s*["'](veryfront\/[^"']+)["']/g, (_match, specifier: string) => {
    const mapped = resolveVeryfrontModuleUrl(specifier);
    return `from "${mapped ?? specifier}"`;
  });
}

function findNestedImports(moduleCode: string): {
  vfModules: Array<{ original: string; path: string }>;
  relative: Array<{ original: string; path: string }>;
} {
  const VF_MODULE_IMPORT_PATTERN = /from\s*["'](\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;
  const RELATIVE_IMPORT_PATTERN = /from\s*["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;

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
  const UNRESOLVED_VF_MODULES_PATTERN = /from\s*["'](\/?_vf_modules\/[^"']+)["']/g;
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
  afterEach(() => {
    __injectCachesForTests(null);
    __resetInitStateForTests();
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
      assertEquals(result, `import Head from "/_vf_modules/_veryfront/react/runtime/core.js";`);
    });

    it("rewrites veryfront/router", () => {
      const code = `import { useRouter } from "veryfront/router";`;
      const result = rewriteVeryfrontImports(code);
      assertEquals(
        result,
        `import { useRouter } from "/_vf_modules/_veryfront/react/runtime/core.js";`,
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
      assertEquals(result, `import Head from "/_vf_modules/_veryfront/react/runtime/core.js";`);
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

  async function runPermitFlow(): Promise<{
    cache: PermitFlowCache;
    events: string[];
  }> {
    const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-permit-cache-" });
    const projectDir = await makeTempDir({ prefix: "vf-mdx-permit-project-" });
    const events: string[] = [];
    const cache = new PermitFlowCache(events);
    const adapter = {
      env: { get: (_key: string) => undefined },
      fs: {
        resolveFile: (path: string) => Promise.resolve(path === "page" ? "/virtual/page.ts" : null),
        readFile: (path: string) => {
          if (path !== "/virtual/page.ts") throw new Error(`Unexpected path: ${path}`);
          return Promise.resolve("export default function Page() { return null; }");
        },
      },
    } as unknown as RuntimeAdapter;

    try {
      __injectCachesForTests({ cacheBackend: cache });
      const context = createModuleFetcherContext(
        esmCacheDir,
        adapter,
        projectDir,
        `project-${crypto.randomUUID()}`,
        {
          contentSourceId: "preview-main",
          importMap: getDefaultImportMap(),
          projectSlug: "permit-flow",
          logger: createPermitFlowLogger(events),
          strictMissingModules: true,
        },
      );

      const path = await fetchAndCacheModule("/_vf_modules/page.js", context);
      assertEquals(typeof path, "string");
      return { cache, events };
    } finally {
      await remove(esmCacheDir, { recursive: true });
      await remove(projectDir, { recursive: true });
    }
  }

  it("carries the exact primary permit from read through persistence", async () => {
    const { cache } = await runPermitFlow();

    assertEquals(cache.primaryExchanges, [{
      expectedRevision: "observed-before-transform",
      result: false,
    }]);
    assertEquals(cache.ordinaryCalls, []);
  });

  it("does not reacquire the primary revision after transformation", async () => {
    const { cache, events } = await runPermitFlow();

    assertEquals(cache.primaryReads.length, 1);
    assertEquals(events, [
      "primary-observation",
      "transform-start",
      "primary-publication",
    ]);
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

  describe("strictMissingModules", () => {
    it("rethrows an unknown failure unchanged without logging or coercing it", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-strict-safe-log-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-strict-safe-project-" });
      const coercionFailure = new Error("coercion hook must not run");
      const thrownValue = {
        [Symbol.toPrimitive]() {
          throw coercionFailure;
        },
      };
      const warnings: Array<{ message: string; metadata?: unknown }> = [];
      const logger = {
        debug: () => {},
        info: () => {},
        warn(message: string, metadata?: unknown) {
          warnings.push({ message, metadata });
        },
        error: () => {},
        time: (_label: string, fn: () => unknown) => fn(),
        child: () => logger,
        component: () => logger,
      } as unknown as Logger;
      const adapter = {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: () => Promise.reject(thrownValue),
        },
      } as any;

      try {
        const context = createModuleFetcherContext(
          esmCacheDir,
          adapter,
          projectDir,
          "proj-safe-log",
          { logger, strictMissingModules: true },
        );
        let caught: unknown;
        try {
          await fetchAndCacheModule("/_vf_modules/private/secret.js", context);
        } catch (error) {
          caught = error;
        }

        assertStrictEquals(caught, thrownValue);
        assertEquals(warnings, [{
          message: "[mdx-loader] Failed to process module",
          metadata: {
            strictMissingModules: true,
            fatal: false,
            errorName: "object",
          },
        }]);
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });

    it("returns the legacy non-strict fallback without coercing an unknown failure", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-nonstrict-safe-log-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-nonstrict-safe-project-" });
      let coercionCalls = 0;
      const thrownValue = {
        [Symbol.toPrimitive]() {
          coercionCalls += 1;
          throw new Error("coercion hook must not run");
        },
      };
      const warnings: Array<{ message: string; metadata?: unknown }> = [];
      const logger = {
        debug: () => {},
        info: () => {},
        warn(message: string, metadata?: unknown) {
          warnings.push({ message, metadata });
        },
        error: () => {},
        time: (_label: string, fn: () => unknown) => fn(),
        child: () => logger,
        component: () => logger,
      } as unknown as Logger;
      const adapter = {
        env: { get: (_key: string) => undefined },
        fs: {
          resolveFile: () => Promise.reject(thrownValue),
        },
      } as any;

      try {
        const context = createModuleFetcherContext(
          esmCacheDir,
          adapter,
          projectDir,
          "proj-safe-log",
          { logger, strictMissingModules: false },
        );

        assertEquals(
          await fetchAndCacheModule("/_vf_modules/private/secret.js", context),
          null,
        );
        assertEquals(coercionCalls, 0);
        assertEquals(warnings, [{
          message: "[mdx-loader] Failed to process module",
          metadata: {
            strictMissingModules: false,
            fatal: false,
            errorName: "object",
          },
        }]);
      } finally {
        await remove(esmCacheDir, { recursive: true });
        await remove(projectDir, { recursive: true });
      }
    });

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
          importMap: getDefaultImportMap(),
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

    it("falls back to stub resolution in non-strict mode", async () => {
      const esmCacheDir = await makeTempDir({ prefix: "vf-mdx-cycle-nonstrict-cache-" });
      const projectDir = await makeTempDir({ prefix: "vf-mdx-cycle-nonstrict-proj-" });
      const adapter = createCircularAdapter();

      try {
        const ctx = createModuleFetcherContext(esmCacheDir, adapter, projectDir, "proj-cycle", {
          importMap: getDefaultImportMap(),
          strictMissingModules: false,
        });

        const result = await fetchAndCacheModule("/_vf_modules/a.js", ctx);
        assertEquals(typeof result, "string");
        assertEquals(result?.endsWith(".mjs"), true);
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
          {
            importMap: getDefaultImportMap(),
            strictMissingModules: true,
          },
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
