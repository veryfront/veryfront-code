import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildFrameworkVfModuleCacheFileName,
  buildMdxEsmCacheSchemaSample,
  buildMdxEsmModuleFileName,
  buildMdxEsmModuleRecoveryCacheKey,
  buildMdxEsmPathCacheKey,
  buildMdxEsmTransformCacheKey,
  buildMdxJsxCacheFileName,
  buildMdxJsxCacheFileNamePrefix,
  FRAMEWORK_VF_MODULE_CACHE_NAMESPACE,
  MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE,
  MDX_ESM_CACHE_NAMESPACE,
  MDX_ESM_MJS_FILE_URL_PATTERN_SOURCE,
  MDX_MODULE_DEV_COMPILE_VARIANT,
} from "./cache-format.ts";
import { createCacheNamespace } from "#veryfront/utils/cache-namespace.ts";
import { getMdxModuleCacheVariant } from "./module-fetcher/cache-keys.ts";

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

  describe("compile-mode isolation", () => {
    /**
     * Every current key builder, with the production compile mode. A production
     * render can only ever reach an entry stored under one of these.
     */
    function buildProductionKeys(): string[] {
      const productionVariant = getMdxModuleCacheVariant("off", undefined, undefined, false);
      const moduleFile = buildMdxEsmModuleFileName("deadbeef");
      return [
        buildMdxEsmTransformCacheKey(
          "proj",
          "release-1",
          "19.1.1",
          "_vf_modules/lib/label.js",
          "deadbeef",
          productionVariant,
        ),
        buildMdxEsmPathCacheKey("_vf_modules/lib/label.js", "19.1.1", productionVariant),
        buildMdxEsmModuleRecoveryCacheKey("proj", "release-1", moduleFile),
        moduleFile,
        buildMdxJsxCacheFileName("/project/Button.tsx", "export default function Button() {}"),
      ];
    }

    it("keeps a development-compiled writer off every production key", () => {
      const developmentVariant = getMdxModuleCacheVariant("off", undefined, undefined, true);
      const productionVariant = getMdxModuleCacheVariant("off", undefined, undefined, false);

      assertEquals(developmentVariant, MDX_MODULE_DEV_COMPILE_VARIANT);
      assertEquals(productionVariant, undefined);

      const productionKeys = buildProductionKeys();
      const developmentKeys = [
        buildMdxEsmTransformCacheKey(
          "proj",
          "release-1",
          "19.1.1",
          "_vf_modules/lib/label.js",
          "deadbeef",
          developmentVariant,
        ),
        buildMdxEsmPathCacheKey("_vf_modules/lib/label.js", "19.1.1", developmentVariant),
      ];

      for (const developmentKey of developmentKeys) {
        assertEquals(
          productionKeys.includes(developmentKey),
          false,
          `production render can reach a development-compiled entry at ${developmentKey}`,
        );
      }
    });

    it("keeps a legacy, always-development-compiled entry off every production key", () => {
      // Before the compile mode entered the cache identity every artifact was
      // development-compiled and every key was unsegmented, so a production
      // render would read one straight off its own key. The only thing stopping
      // that is the namespace roll the schema sample below carries. Rebuild the
      // pre-roll namespace and prove no current production key can reach it.
      const { devCompileVariant, ...legacySchemaSample } = buildMdxEsmCacheSchemaSample();
      assertEquals(devCompileVariant, MDX_MODULE_DEV_COMPILE_VARIANT);

      const legacyNamespace = createCacheNamespace("mdx-esm", legacySchemaSample);

      assertEquals(
        legacyNamespace === MDX_ESM_CACHE_NAMESPACE,
        false,
        "the cache namespace no longer names the compile-mode split, so legacy " +
          "development-compiled entries are readable from a production key",
      );

      for (const productionKey of buildProductionKeys()) {
        assertEquals(
          productionKey.includes(MDX_ESM_CACHE_NAMESPACE),
          true,
          `production key is outside the current namespace: ${productionKey}`,
        );
        assertEquals(
          productionKey.includes(legacyNamespace),
          false,
          `production key can reach a legacy entry: ${productionKey}`,
        );
      }
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

    it("isolates distributed transforms by dependency pinning state", () => {
      const unkeyed = buildMdxEsmTransformCacheKey(
        "p",
        "s",
        "19",
        "/a.js",
        "h",
      );
      const flagOff = buildMdxEsmTransformCacheKey(
        "p",
        "s",
        "19",
        "/a.js",
        "h",
        "off",
      );
      const flagOn = buildMdxEsmTransformCacheKey(
        "p",
        "s",
        "19",
        "/a.js",
        "h",
        "on:pins",
      );
      assertEquals(flagOff === flagOn, false);
      assertEquals(flagOff, unkeyed);
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

    it("isolates cached module paths by dependency pinning state", () => {
      const unkeyed = buildMdxEsmPathCacheKey("/a.js", "19.1.1");
      const flagOff = buildMdxEsmPathCacheKey("/a.js", "19.1.1", "off");
      const firstPins = buildMdxEsmPathCacheKey("/a.js", "19.1.1", "on:first");
      const changedPins = buildMdxEsmPathCacheKey("/a.js", "19.1.1", "on:second");

      assertEquals(new Set([flagOff, firstPins, changedPins]).size, 3);
      assertEquals(flagOff, unkeyed);
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
      const name = buildMdxJsxCacheFileName(
        "fixtures/project/Button.tsx",
        "export default function Button() {}",
      );
      assertEquals(name.startsWith(`jsx-${MDX_ESM_CACHE_NAMESPACE}-`), true);
      assertEquals(name.endsWith(".mjs"), true);
    });

    it("groups every content variant of one source path under a shared prefix", () => {
      const path = "fixtures/project/Button.tsx";
      const prefix = buildMdxJsxCacheFileNamePrefix(path);
      const first = buildMdxJsxCacheFileName(path, "export const A = 1;");
      const second = buildMdxJsxCacheFileName(path, "export const A = 2;");

      assertEquals(first.startsWith(prefix), true);
      assertEquals(second.startsWith(prefix), true);
      assertEquals(first !== second, true);
      assertEquals(
        buildMdxJsxCacheFileName("fixtures/project/Other.tsx", "export const A = 1;")
          .startsWith(prefix),
        false,
        "a different source path must not share the prefix its variants are pruned by",
      );
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
