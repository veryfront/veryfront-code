import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isCacheNeutralCookieName, requestHasCacheSensitiveState } from "./request-cacheability.ts";

describe("cache/request-cacheability", () => {
  it("treats requests without auth state as cacheable", () => {
    const req = new Request("https://example.com/");
    assertEquals(requestHasCacheSensitiveState(req), false);
  });

  it("treats authorization and API keys as cache-sensitive", () => {
    const withAuthorization = new Request("https://example.com/", {
      headers: { authorization: "Bearer test" },
    });
    const withApiKey = new Request("https://example.com/", {
      headers: { "x-api-key": "test" },
    });

    assertEquals(requestHasCacheSensitiveState(withAuthorization), true);
    assertEquals(requestHasCacheSensitiveState(withApiKey), true);
  });

  it("does not treat the load-balancer cookie as personalized state", () => {
    const req = new Request("https://example.com/", {
      headers: { cookie: "lb=server-a" },
    });

    assertEquals(isCacheNeutralCookieName("lb"), true);
    assertEquals(requestHasCacheSensitiveState(req), false);
  });

  it("treats unknown cookies as cache-sensitive", () => {
    const req = new Request("https://example.com/", {
      headers: { cookie: "lb=server-a; session=abc123" },
    });

    assertEquals(requestHasCacheSensitiveState(req), true);
  });
});
