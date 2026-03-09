import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __injectCacheForTests, clearDomainCache, getEnvironmentType } from "./domain-lookup.ts";
import type { DomainLookupResult } from "./domain-lookup.ts";

function makeResult(envName: string | null): DomainLookupResult | null {
  if (envName == null) return null;

  return {
    project_id: "p1",
    project_slug: "test",
    project_name: "Test",
    environment: { id: "e1", name: envName },
    release_id: null,
  };
}

describe("server/utils/domain-lookup", () => {
  describe("getEnvironmentType", () => {
    it("should return undefined for null result", () => {
      assertEquals(getEnvironmentType(null), undefined);
    });

    it("should return undefined for null environment", () => {
      const result: DomainLookupResult = {
        project_id: "p1",
        project_slug: "test",
        project_name: "Test",
        environment: null,
        release_id: null,
      };

      assertEquals(getEnvironmentType(result), undefined);
    });

    it("should return production for 'production' env", () => {
      assertEquals(getEnvironmentType(makeResult("production")), "production");
    });

    it("should return production for 'prod' env", () => {
      assertEquals(getEnvironmentType(makeResult("prod")), "production");
    });

    it("should return production for 'Production' (case-insensitive)", () => {
      assertEquals(getEnvironmentType(makeResult("Production")), "production");
    });

    it("should return preview for 'preview' env", () => {
      assertEquals(getEnvironmentType(makeResult("preview")), "preview");
    });

    it("should return preview for 'staging' env", () => {
      assertEquals(getEnvironmentType(makeResult("staging")), "preview");
    });

    it("should return preview for 'development' env", () => {
      assertEquals(getEnvironmentType(makeResult("development")), "preview");
    });

    it("should return production for unrecognized env names", () => {
      assertEquals(getEnvironmentType(makeResult("custom")), "production");
    });

    it("should return production for env containing 'production' substring", () => {
      assertEquals(getEnvironmentType(makeResult("my-production-env")), "production");
    });

    it("should return preview for env containing 'preview' substring", () => {
      assertEquals(getEnvironmentType(makeResult("my-preview-env")), "preview");
    });

    it("should return preview for env containing 'staging' substring", () => {
      assertEquals(getEnvironmentType(makeResult("staging-us-east")), "preview");
    });

    it("should return preview for env containing 'development' substring", () => {
      assertEquals(getEnvironmentType(makeResult("development-local")), "preview");
    });
  });

  describe("clearDomainCache", () => {
    afterEach(() => {
      __injectCacheForTests(null);
    });

    it("clears the cache without throwing", () => {
      // Should not throw even when no injected cache
      clearDomainCache();
    });

    it("clears injected cache repository", () => {
      let clearCalled = false;
      const mockRepo = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        clear: () => {
          clearCalled = true;
          return Promise.resolve();
        },
      };
      __injectCacheForTests(mockRepo as any);
      clearDomainCache();
      assertEquals(clearCalled, true);
    });
  });

  describe("__injectCacheForTests", () => {
    afterEach(() => {
      __injectCacheForTests(null);
    });

    it("can inject a mock cache repository", () => {
      const mockRepo = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
      // Should not throw
      __injectCacheForTests(mockRepo as any);
    });

    it("can reset to null", () => {
      __injectCacheForTests(null);
      // Should not throw
    });
  });
});
