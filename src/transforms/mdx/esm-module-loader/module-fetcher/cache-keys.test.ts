import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getMdxModuleCacheVariant,
  getTransformCacheKey,
  getVersionedPathCacheKey,
} from "./cache-keys.ts";
import { MDX_ESM_CACHE_NAMESPACE } from "../cache-format.ts";

describe("transforms/mdx/esm-module-loader/module-fetcher/cache-keys", () => {
  describe("getTransformCacheKey", () => {
    it("includes cache namespace, projectId, content source, react version, path, hash, and ssr suffix", () => {
      const key = getTransformCacheKey("proj1", "preview-main", "19.1.1", "lib/utils.ts", "abc123");
      assertEquals(
        key,
        `${MDX_ESM_CACHE_NAMESPACE}:proj1:preview-main:19.1.1:lib/utils.ts:abc123:ssr`,
      );
    });

    it("always ends with :ssr", () => {
      const key = getTransformCacheKey("p", "preview-main", "19.1.1", "/path", "h");
      assertEquals(key.endsWith(":ssr"), true);
    });

    it("handles empty strings", () => {
      const key = getTransformCacheKey("", "", "", "", "");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}::::::ssr`);
    });

    it("preserves special characters in path", () => {
      const key = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "@/components/Button.tsx",
        "def456",
      );
      assertEquals(key.includes("@/components/Button.tsx"), true);
    });

    it("isolates by content source", () => {
      const previewKey = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
      );
      const releaseKey = getTransformCacheKey(
        "proj",
        "release-42",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
      );
      assertEquals(previewKey === releaseKey, false);
    });

    it("isolates by react version", () => {
      const react18Key = getTransformCacheKey(
        "proj",
        "preview-main",
        "18.3.1",
        "lib/utils.ts",
        "abc123",
      );
      const react19Key = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
      );
      assertEquals(react18Key === react19Key, false);
    });

    it("isolates distributed transforms by dependency pinning state", () => {
      const flagOff = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
        "off",
      );
      const unkeyed = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
      );
      const firstPins = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
        "on:first",
      );
      const changedPins = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
        "on:second",
      );

      assertEquals(new Set([flagOff, firstPins, changedPins]).size, 3);
      assertEquals(flagOff, unkeyed);
    });

    it("isolates pin-on distributed transforms by origin", () => {
      const base = [
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
        "on:snapshot",
      ] as const;
      const originA = getTransformCacheKey(...base, "https://a.example");
      const originB = getTransformCacheKey(...base, "https://b.example");
      const flagOff = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
        "off",
      );
      const flagOffWithOrigin = getTransformCacheKey(
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
        "off",
        "https://a.example",
      );

      assertEquals(originA === originB, false);
      assertEquals(flagOffWithOrigin, flagOff);
    });

    it("isolates transforms by the configured server external package set", () => {
      const base = [
        "proj",
        "preview-main",
        "19.1.1",
        "lib/utils.ts",
        "abc123",
        "off",
        undefined,
      ] as const;
      const baseline = getTransformCacheKey(...base);
      const knex = getTransformCacheKey(...base, ["knex"]);
      const combined = getTransformCacheKey(...base, ["knex", "@prisma/client"]);
      const reordered = getTransformCacheKey(...base, ["@prisma/client", "knex"]);

      assertEquals(knex === baseline, false);
      assertEquals(combined === knex, false);
      assertEquals(reordered, combined);
    });
  });

  describe("getVersionedPathCacheKey", () => {
    it("includes cache namespace, react version, and path", () => {
      const key = getVersionedPathCacheKey("lib/utils.ts", "19.1.1");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:19.1.1:lib/utils.ts`);
    });

    it("handles empty path", () => {
      const key = getVersionedPathCacheKey("", "19.1.1");
      assertEquals(key, `${MDX_ESM_CACHE_NAMESPACE}:19.1.1:`);
    });

    it("starts with cache namespace prefix", () => {
      const key = getVersionedPathCacheKey("any/path", "19.1.1");
      assertEquals(key.startsWith(`${MDX_ESM_CACHE_NAMESPACE}:`), true);
    });

    it("isolates by react version", () => {
      const react18Key = getVersionedPathCacheKey("lib/utils.ts", "18.3.1");
      const react19Key = getVersionedPathCacheKey("lib/utils.ts", "19.1.1");
      assertEquals(react18Key === react19Key, false);
    });

    it("isolates local paths by dependency pinning state", () => {
      const flagOff = getVersionedPathCacheKey("lib/utils.ts", "19.1.1", "off");
      const unkeyed = getVersionedPathCacheKey("lib/utils.ts", "19.1.1");
      const firstPins = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "on:first",
      );
      const changedPins = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "on:second",
      );

      assertEquals(new Set([flagOff, firstPins, changedPins]).size, 3);
      assertEquals(flagOff, unkeyed);
    });

    it("isolates pin-on local paths by origin", () => {
      const originA = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "on:snapshot",
        "https://a.example",
      );
      const originB = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "on:snapshot",
        "https://b.example",
      );
      const flagOff = getVersionedPathCacheKey("lib/utils.ts", "19.1.1", "off");
      const flagOffWithOrigin = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "off",
        "https://a.example",
      );

      assertEquals(originA === originB, false);
      assertEquals(flagOffWithOrigin, flagOff);
    });

    it("isolates local paths by the configured server external package set", () => {
      const baseline = getVersionedPathCacheKey("lib/utils.ts", "19.1.1");
      const knex = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "off",
        undefined,
        ["knex"],
      );
      const combined = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "off",
        undefined,
        ["knex", "@prisma/client"],
      );
      const reordered = getVersionedPathCacheKey(
        "lib/utils.ts",
        "19.1.1",
        "off",
        undefined,
        ["@prisma/client", "knex"],
      );

      assertEquals(knex === baseline, false);
      assertEquals(combined === knex, false);
      assertEquals(reordered, combined);
    });
  });
});

/**
 * The compile mode decides minification, tree shaking and inline sourcemaps, so
 * it is part of every module cache identity. The transform key feeds the
 * distributed transform cache, whose entries are shared across requests and
 * across instances, so a key without the compile mode would let one instance
 * serve development-compiled modules to a hosted production render.
 */
describe("transforms/mdx/esm-module-loader/module-fetcher/cache-keys compile mode", () => {
  const TRANSFORM_BASE = [
    "proj",
    "preview-main",
    "19.1.1",
    "lib/utils.ts",
    "abc123",
    "off",
    undefined,
    undefined,
  ] as const;

  it("gives the two compile modes different distributed transform cache keys", () => {
    const production = getTransformCacheKey(...TRANSFORM_BASE, false);
    const dev = getTransformCacheKey(...TRANSFORM_BASE, true);

    assertEquals(production === dev, false);
    assertEquals(dev.includes(":on:compile-dev:"), true);
    assertEquals(production.includes("compile-dev"), false);
  });

  it("treats an unset compile mode as production", () => {
    assertEquals(
      getTransformCacheKey(...TRANSFORM_BASE),
      getTransformCacheKey(...TRANSFORM_BASE, false),
    );
    assertEquals(
      getVersionedPathCacheKey("lib/utils.ts", "19.1.1"),
      getVersionedPathCacheKey("lib/utils.ts", "19.1.1", undefined, undefined, undefined, false),
    );
  });

  it("gives the two compile modes different path cache keys", () => {
    const production = getVersionedPathCacheKey(
      "lib/utils.ts",
      "19.1.1",
      "off",
      undefined,
      undefined,
      false,
    );
    const dev = getVersionedPathCacheKey(
      "lib/utils.ts",
      "19.1.1",
      "off",
      undefined,
      undefined,
      true,
    );

    assertEquals(production === dev, false);
    assertEquals(dev.includes("on:compile-dev"), true);
  });

  it("keeps the compile mode apart from the pin and server-external segments", () => {
    const variant = getMdxModuleCacheVariant(
      "on:snapshot",
      "https://a.example",
      ["knex"],
      true,
    );

    assertEquals(variant?.endsWith(":on:compile-dev"), true);
    assertEquals(
      getMdxModuleCacheVariant("on:snapshot", "https://a.example", ["knex"], false),
      variant?.slice(0, -":on:compile-dev".length),
    );
  });
});
