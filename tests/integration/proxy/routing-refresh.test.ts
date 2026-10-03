import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { FakeTime } from "#std/testing/time";
import { createProxyHandler } from "#veryfront/proxy/handler.ts";

describe("idle proxy routing refresh", () => {
  it("refreshes before expiry, warms access, and still checks access on the idle request", async () => {
    using time = new FakeTime();
    let routingLookups = 0;
    let tokenRequests = 0;
    const metadataTokens: string[] = [];
    let accessLookups = 0;
    let protectedEnvironment = false;
    await withMockFetch(
      (async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        if (path === "/auth/token") {
          tokenRequests++;
          return Response.json({
            access_token: `test-token-${tokenRequests}`,
            token_type: "Bearer",
            expires_in: 30,
          });
        }
        metadataTokens.push(new Headers(init?.headers).get("authorization") ?? "");
        const isRouting = path.includes("/proxy-routing/");
        if (isRouting) {
          routingLookups++;
        } else if (path.includes("/proxy-access/")) {
          accessLookups++;
        } else {
          return new Response(null, { status: 404 });
        }
        return Response.json({
          id: "proj-123",
          slug: "my-project",
          name: "My Project",
          environments: [{
            id: "env-1",
            name: "production",
            domains: ["example.com"],
            ...(isRouting ? { active_release_id: "rel-123" } : { protected: protectedEnvironment }),
          }],
        });
      }) as typeof fetch,
      async () => {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: "https://api.example.test",
            apiClientId: "test-client",
            apiClientSecret: "test-secret",
            previewApiClientId: "test-client",
            previewApiClientSecret: "test-secret",
          },
        });
        const request = () => new Request("https://example.com/page");
        try {
          assertEquals((await handler.processRequest(request())).error, undefined);
          await time.tickAsync(45_000);
          await time.runMicrotasks();
          assertEquals(routingLookups, 2, "routing must refresh while idle");
          assertEquals(accessLookups, 2, "refresh must warm the uncached access endpoint");
          assertEquals(
            tokenRequests,
            2,
            "refresh must obtain a current service credential after expiry",
          );
          assertEquals(metadataTokens.slice(2), ["Bearer test-token-2", "Bearer test-token-2"]);
          time.tick(16_000);
          protectedEnvironment = true;
          const denied = await handler.processRequest(request());
          assertEquals(denied.error?.status, 302);
          assertEquals(routingLookups, 2, "first request after idle must use refreshed routing");
          assertEquals(accessLookups, 3, "access changes must apply on the next request");
          handler.invalidateRoutingLookup({ projectId: "proj-123", projectSlug: "my-project" });
          await time.tickAsync(30_000);
          await time.runMicrotasks();
          assertEquals(routingLookups, 2, "invalidation must cancel the old refresh");
          protectedEnvironment = false;
          assertEquals((await handler.processRequest(request())).error, undefined);
          assertEquals(routingLookups, 3, "invalidation must force a live lookup");
        } finally {
          await handler.close();
        }
        time.tick(60_000);
        assertEquals(routingLookups, 3, "close must cancel scheduled refreshes");
      },
    );
  });
});
