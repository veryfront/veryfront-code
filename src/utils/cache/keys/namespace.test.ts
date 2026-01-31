import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getCacheNamespace, setCacheNamespace } from "./namespace.ts";

describe("cache namespace", () => {
  afterEach(() => setCacheNamespace(undefined));

  it("should set and get namespace", () => {
    setCacheNamespace("test-ns");
    assertEquals(getCacheNamespace(), "test-ns");
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
