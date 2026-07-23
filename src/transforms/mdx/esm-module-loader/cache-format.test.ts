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
    it("uses a full digest and the ssr suffix", () => {
      const key = buildMdxEsmTransformCacheKey(
        "proj1",
        "src1",
        "19.1.1",
        "_vf_modules/pages/index.js",
        "hashA",
      );
      assertEquals(
        new RegExp(`^${MDX_ESM_CACHE_NAMESPACE}:transform:[a-f0-9]{64}:ssr$`).test(key),
        true,
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
    it("uses a framed namespace, react version, path, and source digest", () => {
      assertEquals(
        buildMdxEsmPathCacheKey("/a.js", "19.1.1", "source-hash"),
        `${MDX_ESM_CACHE_NAMESPACE}:path:["19.1.1","/a.js","source-hash"]`,
      );
    });

    it("defaults the react version when omitted", () => {
      const key = buildMdxEsmPathCacheKey("/a.js");
      assertEquals(key.startsWith(`${MDX_ESM_CACHE_NAMESPACE}:`), true);
      assertEquals(key.includes('"/a.js"'), true);
      assertEquals(key.endsWith(",null]"), true);
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
    it("uses a full tenant/file digest and vfmod suffix", () => {
      const key = buildMdxEsmModuleRecoveryCacheKey("proj1", "src1", "vfmod-x.mjs");
      assertEquals(
        new RegExp(`^${MDX_ESM_CACHE_NAMESPACE}:recovery:[a-f0-9]{64}:vfmod$`).test(key),
        true,
      );
    });

    it("frames delimiter-bearing tenant ids without collisions", () => {
      const first = buildMdxEsmModuleRecoveryCacheKey("a:b", "c", "vfmod-x.mjs");
      const second = buildMdxEsmModuleRecoveryCacheKey("a", "b:c", "vfmod-x.mjs");
      assertEquals(first === second, false);
    });
  });

  describe("buildMdxJsxCacheFileName", () => {
    it("produces a jsx-<namespace>-<hash>.mjs filename", () => {
      const name = buildMdxJsxCacheFileName(
        "fixtures/project/Button.tsx",
        "export default function Button() {}",
      );
      assertEquals(name.startsWith(`jsx-${MDX_ESM_CACHE_NAMESPACE}-`), true);
      assertEquals(name.endsWith(".mjs"), true);
    });

    it("derives distinct names from distinct paths and source contents", () => {
      const a = buildMdxJsxCacheFileName("fixtures/a/Button.tsx", "export const A = 1;");
      const b = buildMdxJsxCacheFileName("fixtures/b/Button.tsx", "export const A = 1;");
      const changed = buildMdxJsxCacheFileName("fixtures/a/Button.tsx", "export default 1;");
      assertEquals(a !== b, true);
      assertEquals(a !== changed, true);
      assertEquals(a, buildMdxJsxCacheFileName("fixtures/a/Button.tsx", "export const A = 1;"));
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
