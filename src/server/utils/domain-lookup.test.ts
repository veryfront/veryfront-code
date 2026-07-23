import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/logger.ts";
import { createMockServer } from "../../../tests/_helpers/utils.ts";
import { createMockRepositoryContext } from "../../repositories/testing/index.ts";
import {
  __injectCacheForTests,
  clearDomainCache,
  DomainLookupApiError,
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
  afterEach(() => {
    __injectCacheForTests(null);
    clearDomainCache();
    __resetLogRecordEmitterForTests();
  });

  describe("lookupProjectByDomain", () => {
    it("returns null only when the lookup API reports that the domain is missing", async () => {
      const { server, port } = createMockServer(() => new Response(null, { status: 404 }));

      try {
        assertEquals(
          await lookupProjectByDomain("missing.example", {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiToken: "test-token",
          }),
          null,
        );
      } finally {
        await server.shutdown();
      }
    });

    it("fails closed when the lookup API returns a non-404 error", async () => {
      const privateDomain = "customer-private.example";
      const privateStatusText = "private-upstream-detail";
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const { server, port } = createMockServer(
        () => new Response(null, { status: 503, statusText: privateStatusText }),
      );

      try {
        const error = await assertRejects(
          () =>
            lookupProjectByDomain(privateDomain, {
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiToken: "test-token",
            }),
          DomainLookupApiError,
        );

        assert(error instanceof DomainLookupApiError);
        assertEquals(error.status, 503);
        assertEquals(error.message.includes(privateDomain), false);
        assertEquals(error.message.includes(privateStatusText), false);
        assertEquals(JSON.stringify(entries).includes(privateDomain), false);
        assertEquals(JSON.stringify(entries).includes(privateStatusText), false);
      } finally {
        await server.shutdown();
      }
    });

    it("fails closed when a successful API response is malformed", async () => {
      const { server, port } = createMockServer(() => Response.json({ id: "project-only" }));

      try {
        const error = await assertRejects(
          () =>
            lookupProjectByDomain("malformed.example", {
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiToken: "test-token",
            }),
          DomainLookupApiError,
        );

        assert(error instanceof DomainLookupApiError);
        assertEquals(error.status, 502);
      } finally {
        await server.shutdown();
      }
    });

    it("scopes cached lookups to the API configuration", async () => {
      const first = createMockServer(() =>
        Response.json({ id: "project-one", name: "One", slug: "one", environments: [] })
      );
      const second = createMockServer(() =>
        Response.json({ id: "project-two", name: "Two", slug: "two", environments: [] })
      );

      try {
        const firstResult = await lookupProjectByDomain("shared.example", {
          apiBaseUrl: `http://127.0.0.1:${first.port}`,
          apiToken: "first-token",
        });
        const secondResult = await lookupProjectByDomain("shared.example", {
          apiBaseUrl: `http://127.0.0.1:${second.port}`,
          apiToken: "second-token",
        });

        assertEquals(firstResult?.project_id, "project-one");
        assertEquals(secondResult?.project_id, "project-two");
      } finally {
        await Promise.all([first.server.shutdown(), second.server.shutdown()]);
      }
    });

    it("does not let a lookup that predates invalidation repopulate the cache", async () => {
      let requestCount = 0;
      let markFirstRequestStarted: (() => void) | undefined;
      let markSecondRequestStarted: (() => void) | undefined;
      let releaseFirstRequest: (() => void) | undefined;
      let releaseSecondRequest: (() => void) | undefined;
      const firstRequestStarted = new Promise<void>((resolve) => {
        markFirstRequestStarted = resolve;
      });
      const secondRequestStarted = new Promise<void>((resolve) => {
        markSecondRequestStarted = resolve;
      });
      const firstRequestReleased = new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
      });
      const secondRequestReleased = new Promise<void>((resolve) => {
        releaseSecondRequest = resolve;
      });
      const { server, port } = createMockServer(async () => {
        requestCount++;
        if (requestCount === 1) {
          markFirstRequestStarted?.();
          await firstRequestReleased;
        } else if (requestCount === 2) {
          markSecondRequestStarted?.();
          await secondRequestReleased;
        }
        return Response.json({
          id: "project",
          name: "Project",
          slug: "project",
          environments: [],
        });
      });
      const config = {
        apiBaseUrl: `http://127.0.0.1:${port}`,
        apiToken: "test-token",
      };

      try {
        const firstLookup = lookupProjectByDomain("cache-race.example", config);
        await firstRequestStarted;
        clearDomainCache();
        const secondLookup = lookupProjectByDomain("cache-race.example", config);
        await secondRequestStarted;
        releaseFirstRequest?.();
        await firstLookup;
        const deduplicatedLookup = lookupProjectByDomain("cache-race.example", config);
        releaseSecondRequest?.();
        await Promise.all([secondLookup, deduplicatedLookup]);

        assertEquals(requestCount, 2);
      } finally {
        releaseFirstRequest?.();
        releaseSecondRequest?.();
        await server.shutdown();
      }
    });

    it("does not expose lookup inputs in distributed cache keys", async () => {
      const keys: string[] = [];
      __injectCacheForTests({
        context: createMockRepositoryContext(),
        get: () => Promise.resolve(null),
        set: (key: string) => {
          keys.push(key);
          return Promise.resolve();
        },
        delete: () => Promise.resolve(),
      });
      const { server, port } = createMockServer(() =>
        Response.json({
          id: "project",
          name: "Project",
          slug: "project",
          environments: [],
        })
      );
      const apiBaseUrl = `http://127.0.0.1:${port}`;

      try {
        await lookupProjectByDomain("private-cache-domain.example", {
          apiBaseUrl,
          apiToken: "private-cache-token",
        });

        assertEquals(keys.length, 1);
        assertEquals(/^domain-lookup:v2:[a-f0-9]{64}$/.test(keys[0] ?? ""), true);
        assertEquals(keys[0]?.includes("private-cache-domain"), false);
        assertEquals(keys[0]?.includes("private-cache-token"), false);
        assertEquals(keys[0]?.includes(apiBaseUrl), false);
      } finally {
        await server.shutdown();
      }
    });

    it("does not log domains, API URLs, or project identifiers", async () => {
      const previousLevel = Deno.env.get("LOG_LEVEL");
      Deno.env.set("LOG_LEVEL", "DEBUG");
      refreshLoggerConfig();
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const { server, port } = createMockServer(() =>
        Response.json({
          id: "private-project-id",
          name: "Private project name",
          slug: "private-project-slug",
          environments: [{
            id: "private-environment-id",
            name: "private-environment-name",
            domains: ["private-customer.example"],
            active_release_id: "private-release-id",
          }],
        })
      );
      const apiBaseUrl = `http://127.0.0.1:${port}`;

      try {
        await lookupProjectByDomain("private-customer.example", {
          apiBaseUrl,
          apiToken: "private-api-token",
        });

        const serialized = JSON.stringify(entries);
        for (
          const privateValue of [
            "private-customer.example",
            apiBaseUrl,
            "private-project-id",
            "private-project-slug",
            "private-environment-name",
            "private-release-id",
            "private-api-token",
          ]
        ) {
          assertEquals(serialized.includes(privateValue), false);
        }
      } finally {
        await server.shutdown();
        if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLevel);
        refreshLoggerConfig();
      }
    });
  });

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

  describe("clearDomainCache", () => {
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
