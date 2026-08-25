import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { clearDomainCache, lookupProjectByDomain } from "#veryfront/server/utils/domain-lookup.ts";

describe("server/utils/domain-lookup network boundary", () => {
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
