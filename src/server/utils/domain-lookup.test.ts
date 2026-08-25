import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  __injectCacheForTests,
  clearDomainCache,
  getEnvironmentType,
  lookupProjectByDomain,
} from "./domain-lookup.ts";
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

    it("should return preview for unrecognized env names", () => {
      // Unknown env names default to "preview" (safe: does not expose production content).
      assertEquals(getEnvironmentType(makeResult("custom")), "preview");
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

  describe("lookupProjectByDomain", () => {
    const cfg = { apiBaseUrl: "https://api.veryfront.test", apiToken: "test-token" };
    beforeEach(() => {
      clearDomainCache();
    });

    afterEach(() => {
      clearDomainCache();
    });

    it("returns null when the lookup API answers 404", async () => {
      await withMockFetch(
        (() => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch,
        async () => {
          assertEquals(
            await lookupProjectByDomain("missing.example.com", cfg),
            null,
            "a 404 means the domain is not mapped",
          );
        },
      );
    });

    it("normalizes port suffix and letter case to one cache key", async () => {
      let fetchCalls = 0;
      await withMockFetch(
        (() => {
          fetchCalls++;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "proj-1",
                name: "App",
                slug: "app",
                environments: [
                  {
                    id: "env-1",
                    name: "production",
                    domains: ["app.example.com"],
                    active_release_id: "rel-1",
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }) as typeof fetch,
        async () => {
          const first = await lookupProjectByDomain("app.example.com", cfg);
          assertEquals(
            first,
            {
              project_id: "proj-1",
              project_slug: "app",
              project_name: "App",
              environment: { id: "env-1", name: "production" },
              release_id: "rel-1",
            },
            "the matching environment and its active release must be extracted from the project body",
          );

          const second = await lookupProjectByDomain("App.Example.com:8443", cfg);
          assertEquals(
            second,
            first,
            "the normalized domain must resolve to the same cached result",
          );
          assertEquals(
            fetchCalls,
            1,
            "port suffix and letter case must normalize to one cache key",
          );
        },
      );
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
