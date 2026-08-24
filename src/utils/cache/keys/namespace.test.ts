import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { GlobalWithVeryFrontCache } from "#veryfront/types/global-guards.ts";
import { getCacheNamespace, setCacheNamespace } from "./namespace.ts";

describe("cache namespace", () => {
  afterEach(() => setCacheNamespace(undefined));

  it("should set and get namespace", () => {
    setCacheNamespace("test-ns");
    assertEquals(getCacheNamespace(), "test-ns");
  });

  it("should mirror the namespace onto the global", () => {
    const globalCache = globalThis as GlobalWithVeryFrontCache;

    setCacheNamespace("test-ns");
    assertEquals(
      globalCache.__VF_CACHE_NAMESPACE__,
      "test-ns",
      "setCacheNamespace must mirror onto the global so a duplicated module graph inherits it",
    );

    setCacheNamespace(undefined);
    assertEquals(
      globalCache.__VF_CACHE_NAMESPACE__,
      undefined,
      "clearing the namespace must clear the global too",
    );
  });

  it("should clear namespace", () => {
    setCacheNamespace("ns");

    setCacheNamespace(undefined);
    assertEquals(getCacheNamespace(), undefined);

    setCacheNamespace("ns");
    setCacheNamespace();
    assertEquals(getCacheNamespace(), undefined);
  });
});
