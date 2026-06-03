import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildFrameworkVfModuleCacheFileName,
  buildMdxEsmModuleFileName,
  buildMdxEsmModuleRecoveryCacheKey,
  buildMdxEsmPathCacheKey,
  buildMdxEsmTransformCacheKey,
  buildMdxJsxCacheFileName,
  FRAMEWORK_VF_MODULE_CACHE_NAMESPACE,
  MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE,
  MDX_ESM_CACHE_NAMESPACE,
  MDX_ESM_MJS_FILE_URL_PATTERN_SOURCE,
} from "./cache-format.ts";

describe("transforms/mdx/esm-module-loader/cache-format", () => {
  describe("namespaces", () => {
    it("exposes non-empty, distinct cache namespaces", () => {
      assertEquals(typeof MDX_ESM_CACHE_NAMESPACE, "string");
      assertEquals(MDX_ESM_CACHE_NAMESPACE.length > 0, true);
      assertEquals(typeof FRAMEWORK_VF_MODULE_CACHE_NAMESPACE, "string");
      assertEquals(FRAMEWORK_VF_MODULE_CACHE_NAMESPACE.length > 0, true);
      assertEquals(MDX_ESM_CACHE_NAMESPACE !== FRAMEWORK_VF_MODULE_CACHE_NAMESPACE, true);
    });
  });

  describe("buildMdxEsmTransformCacheKey", () => {
    it("includes all inputs and the ssr suffix in order", () => {
      const key = buildMdxEsmTransformCacheKey(
        "proj1",
        "src1",
        "19.1.1",
        "_vf_modules/pages/index.js",
        "hashA",
      );
      assertEquals(
        key,
        `${MDX_ESM_CACHE_NAMESPACE}:proj1:src1:19.1.1:_vf_modules/pages/index.js:hashA:ssr`,
      );
    });

    it("is deterministic for identical inputs", () => {
      const args = ["p", "s", "19", "/a.js", "h"] as const;
      assertEquals(
        buildMdxEsmTransformCacheKey(...args),
        buildMdxEsmTransformCacheKey(...args),
      );
    });

    it("changes when the content hash changes", () => {
      const a = buildMdxEsmTransformCacheKey("p", "s", "19", "/a.js", "h1");
      const b = buildMdxEsmTransformCacheKey("p", "s", "19", "/a.js", "h2");
      assertEquals(a !== b, true);
    });

    it("changes when the project id changes", () => {
      const a = buildMdxEsmTransformCacheKey("p1", "s", "19", "/a.js", "h");
      const b = buildMdxEsmTransformCacheKey("p2", "s", "19", "/a.js", "h");
      assertEquals(a !== b, true);
    });
  });

  describe("buildMdxEsmPathCacheKey", () => {
    it("includes namespace, react version, and path", () => {
      assertEquals(
        buildMdxEsmPathCacheKey("/a.js", "19.1.1"),
        `${MDX_ESM_CACHE_NAMESPACE}:19.1.1:/a.js`,
      );
    });

    it("defaults the react version when omitted", () => {
      const key = buildMdxEsmPathCacheKey("/a.js");
      assertEquals(key.startsWith(`${MDX_ESM_CACHE_NAMESPACE}:`), true);
      assertEquals(key.endsWith(":/a.js"), true);
      // Default version segment is non-empty.
      const segments = key.split(":");
      assertEquals(segments[1]!.length > 0, true);
    });
  });

  describe("buildMdxEsmModuleFileName", () => {
    it("produces a vfmod-<namespace>-<hash>.mjs filename", () => {
      assertEquals(
        buildMdxEsmModuleFileName("deadbeef"),
        `vfmod-${MDX_ESM_CACHE_NAMESPACE}-deadbeef.mjs`,
      );
    });

    it("always ends with .mjs", () => {
      assertEquals(buildMdxEsmModuleFileName("abc").endsWith(".mjs"), true);
    });
  });

  describe("buildMdxEsmModuleRecoveryCacheKey", () => {
    it("includes namespace, ids, file name, and vfmod suffix", () => {
      assertEquals(
        buildMdxEsmModuleRecoveryCacheKey("proj1", "src1", "vfmod-x.mjs"),
        `${MDX_ESM_CACHE_NAMESPACE}:proj1:src1:vfmod-x.mjs:vfmod`,
      );
    });
  });

  describe("buildMdxJsxCacheFileName", () => {
    it("produces a jsx-<namespace>-<hash>.mjs filename", () => {
      const name = buildMdxJsxCacheFileName("fixtures/project/Button.tsx");
      assertEquals(name.startsWith(`jsx-${MDX_ESM_CACHE_NAMESPACE}-`), true);
      assertEquals(name.endsWith(".mjs"), true);
    });

    it("derives distinct names from distinct paths but is path-deterministic", () => {
      const a = buildMdxJsxCacheFileName("fixtures/a/Button.tsx");
      const b = buildMdxJsxCacheFileName("fixtures/b/Button.tsx");
      assertEquals(a !== b, true);
      assertEquals(a, buildMdxJsxCacheFileName("fixtures/a/Button.tsx"));
    });
  });

  describe("buildFrameworkVfModuleCacheFileName", () => {
    it("interleaves path hash, env key, and content hash with the framework namespace", () => {
      assertEquals(
        buildFrameworkVfModuleCacheFileName("ph", "env", "ch"),
        `vfmod-${FRAMEWORK_VF_MODULE_CACHE_NAMESPACE}-ph-env-ch.mjs`,
      );
    });

    it("changes when the env key changes (cross-environment isolation)", () => {
      const a = buildFrameworkVfModuleCacheFileName("ph", "env1", "ch");
      const b = buildFrameworkVfModuleCacheFileName("ph", "env2", "ch");
      assertEquals(a !== b, true);
    });
  });

  describe("file URL pattern sources", () => {
    it("matches file:// URLs and the mjs-only variant only matches .mjs", () => {
      const all = new RegExp(MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE);
      const mjs = new RegExp(MDX_ESM_MJS_FILE_URL_PATTERN_SOURCE);
      assertEquals(all.test("file:///fixtures/a.css"), true);
      assertEquals(mjs.test("file:///fixtures/a.css"), false);
      assertEquals(mjs.test("file:///fixtures/a.mjs"), true);
    });
  });
});
