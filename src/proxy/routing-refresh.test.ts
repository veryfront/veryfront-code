import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { FakeTime } from "#std/testing/time";
import { createProxyHandler } from "./handler.ts";

describe("idle proxy routing refresh", () => {
  it("refreshes before expiry, warms access, and still checks access on the idle request", async () => {
    using time = new FakeTime();
    let routingLookups = 0;
    let tokenRequests = 0;
    const metadataTokens: string[] = [];
    let accessLookups = 0;
    let protectedEnvironment = false;
    const fakeFetch = (async (input, init) => {
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
    }) as typeof fetch;
    const handler = createProxyHandler({
      metadataFetch: fakeFetch,
      tokenFetch: fakeFetch,
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
  });

  function createMetadataFetch(options: { delayMs?: () => number } = {}) {
    const calls = { routing: 0, access: 0, token: 0, authorizations: [] as string[] };
    const fakeFetch = (async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/auth/token") {
        calls.token++;
        return new Response(null, { status: 401 });
      }
      calls.authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
      const isRouting = path.includes("/proxy-routing/");
      if (isRouting) calls.routing++;
      else if (path.includes("/proxy-access/")) calls.access++;
      else return new Response(null, { status: 404 });
      const delayMs = options.delayMs?.() ?? 0;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return Response.json({
        id: "proj-123",
        slug: "my-project",
        name: "My Project",
        environments: [{
          id: "env-1",
          name: "production",
          domains: ["example.com"],
          ...(isRouting ? { active_release_id: "rel-123" } : { protected: false }),
        }],
      });
    }) as typeof fetch;
    return { calls, fakeFetch };
  }

  it("refreshes a lookup authenticated by the static token with that token", async () => {
    using time = new FakeTime();
    const { calls, fakeFetch } = createMetadataFetch();
    const handler = createProxyHandler({
      metadataFetch: fakeFetch,
      tokenFetch: fakeFetch,
      config: {
        apiBaseUrl: "https://api.example.test",
        apiClientId: "",
        apiClientSecret: "",
        previewApiClientId: "",
        previewApiClientSecret: "",
        apiToken: "static-token",
      },
    });
    const request = () => new Request("https://example.com/page");
    try {
      assertEquals((await handler.processRequest(request())).error, undefined);
      for (let elapsed = 0; elapsed < 61_000; elapsed += 1_000) await time.tickAsync(1_000);
      await time.runMicrotasks();
      const routingLookups = calls.routing;
      assertEquals(routingLookups >= 2, true, "static-token routing must refresh while idle");
      assertEquals(calls.token, 0, "refresh must not request an OAuth token");
      assertEquals(calls.authorizations.every((value) => value === "Bearer static-token"), true);
      assertEquals((await handler.processRequest(request())).error, undefined);
      assertEquals(
        calls.routing,
        routingLookups,
        "first request after idle must use refreshed routing",
      );
    } finally {
      await handler.close();
    }
  });

  it("does not schedule OAuth refreshes for a user-token lookup without service credentials", async () => {
    using time = new FakeTime();
    const calls = { routing: 0, token: 0, authorizations: [] as string[] };
    const fakeFetch = (async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/auth/token") {
        calls.token++;
        return new Response(null, { status: 401 });
      }
      calls.authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
      if (path.includes("/proxy-routing/")) calls.routing++;
      else if (!path.includes("/proxy-access/")) return new Response(null, { status: 404 });
      return Response.json({
        id: "proj-123",
        slug: "my-project",
        name: "My Project",
        environments: [{ id: "env-1", name: "preview", protected: false }],
      });
    }) as typeof fetch;
    const handler = createProxyHandler({
      metadataFetch: fakeFetch,
      tokenFetch: fakeFetch,
      config: {
        apiBaseUrl: "https://api.example.test",
        apiClientId: "",
        apiClientSecret: "",
        previewApiClientId: "",
        previewApiClientSecret: "",
        apiToken: "static-token",
      },
    });
    const request = () =>
      new Request("https://my-project.preview.veryfront.com/page", {
        headers: { cookie: "authToken=user-token" },
      });
    try {
      assertEquals((await handler.processRequest(request())).error, undefined);
      assertEquals(calls.routing, 1);
      for (let elapsed = 0; elapsed < 61_000; elapsed += 1_000) await time.tickAsync(1_000);
      await time.runMicrotasks();
      assertEquals(calls.token, 0, "idle refresh must not request an OAuth token");
      assertEquals(calls.routing, 1, "a user-token lookup has no renewable refresh credential");
      assertEquals(calls.authorizations.every((value) => value === "Bearer user-token"), true);
      assertEquals((await handler.processRequest(request())).error, undefined);
      assertEquals(calls.token, 0, "foreground authorization must stay unchanged");
      assertEquals(calls.routing, 2, "the expired entry must be looked up in the foreground");
    } finally {
      await handler.close();
    }
  });

  it("finishes a refresh whose requests each take nearly the full timeout", async () => {
    using time = new FakeTime();
    let slow = false;
    const { calls, fakeFetch } = createMetadataFetch({ delayMs: () => slow ? 14_000 : 0 });
    const handler = createProxyHandler({
      metadataFetch: fakeFetch,
      metadataTimeoutMs: 15_000,
      config: {
        apiBaseUrl: "https://api.example.test",
        apiClientId: "",
        apiClientSecret: "",
        previewApiClientId: "",
        previewApiClientSecret: "",
        apiToken: "static-token",
      },
    });
    const request = () => new Request("https://example.com/page");
    try {
      assertEquals((await handler.processRequest(request())).error, undefined);
      slow = true;
      for (let elapsed = 0; elapsed < 58_000; elapsed += 1_000) await time.tickAsync(1_000);
      await time.runMicrotasks();
      assertEquals(calls.routing, 2, "slow refresh must still complete");
      slow = false;
      await time.tickAsync(3_000);
      const routingLookups = calls.routing;
      assertEquals((await handler.processRequest(request())).error, undefined);
      assertEquals(
        calls.routing,
        routingLookups,
        "first request after idle must use refreshed routing",
      );
    } finally {
      await handler.close();
    }
  });

  it("stops refreshing an entry that no request has used for the idle cutoff", async () => {
    using time = new FakeTime();
    const { calls, fakeFetch } = createMetadataFetch();
    const handler = createProxyHandler({
      metadataFetch: fakeFetch,
      config: {
        apiBaseUrl: "https://api.example.test",
        apiClientId: "",
        apiClientSecret: "",
        previewApiClientId: "",
        previewApiClientSecret: "",
        apiToken: "static-token",
      },
    });
    const request = () => new Request("https://example.com/page");
    try {
      assertEquals((await handler.processRequest(request())).error, undefined);
      for (let elapsed = 0; elapsed < 16 * 60_000; elapsed += 1_000) await time.tickAsync(1_000);
      const refreshedLookups = calls.routing;
      assertEquals(refreshedLookups > 2, true, "routing must refresh while recently used");
      for (let elapsed = 0; elapsed < 5 * 60_000; elapsed += 1_000) await time.tickAsync(1_000);
      assertEquals(calls.routing, refreshedLookups, "an unused entry must stop refreshing");
      assertEquals((await handler.processRequest(request())).error, undefined);
      assertEquals(calls.routing, refreshedLookups + 1, "the next request looks routing up");
      for (let elapsed = 0; elapsed < 60_000; elapsed += 1_000) await time.tickAsync(1_000);
      assertEquals(calls.routing > refreshedLookups + 1, true, "use restarts the refresh");
    } finally {
      await handler.close();
    }
  });

  it("rejects an unbounded routing cache size", () => {
    for (const routingCacheMaxEntries of [-1, 1.5, 10_001]) {
      assertThrows(
        () =>
          createProxyHandler({
            routingCacheMaxEntries,
            config: {
              apiBaseUrl: "https://api.example.test",
              apiClientId: "test-client",
              apiClientSecret: "test-secret",
              previewApiClientId: "test-client",
              previewApiClientSecret: "test-secret",
            },
          }),
        RangeError,
      );
    }
  });
});
