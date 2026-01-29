import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it, afterEach } from "#veryfront/testing/bdd.ts";
import { getCacheNamespace, setCacheNamespace } from "./namespace.ts";

describe("cache namespace", () => {
  afterEach(() => {
    setCacheNamespace(undefined);
  });

  it("should set and get namespace", () => {
    setCacheNamespace("test-ns");
    assertEquals(getCacheNamespace(), "test-ns");
  });

  it("should clear namespace when set to undefined", () => {
    setCacheNamespace("ns");
    setCacheNamespace(undefined);
    assertEquals(getCacheNamespace(), undefined);
  });

  it("should clear namespace when called with no args", () => {
    setCacheNamespace("ns");
    setCacheNamespace();
    assertEquals(getCacheNamespace(), undefined);
  });
});
