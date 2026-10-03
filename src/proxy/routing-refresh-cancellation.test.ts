import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { FakeTime } from "#std/testing/time";
import { createProxyHandler } from "./handler.ts";
import { createProjectMetadataClient } from "./project-metadata-client.ts";
import { RoutingRefreshScheduler } from "./routing-refresh-scheduler.ts";

function metadata(key: string, routing: boolean): Response {
  return Response.json({
    id: `proj-${key[0]}`,
    slug: `project-${key[0]}`,
    name: "Project",
    environments: [{
      id: `env-${key[0]}`,
      name: "production",
      domains: [key],
      ...(routing ? { active_release_id: "rel-123" } : { protected: false }),
    }],
  });
}

describe("background routing producer ownership", () => {
  it("aborts an evicted refresh and never lets its late routing result evict a live key", async () => {
    using time = new FakeTime();
    const previous = Deno.env.get("VERYFRONT_PROXY_ROUTING_CACHE_MAX_ENTRIES");
    Deno.env.set("VERYFRONT_PROXY_ROUTING_CACHE_MAX_ENTRIES", "1");
    const lateRouting = Promise.withResolvers<Response>();
    let refreshSignal: AbortSignal | null | undefined;
    const routingCounts = new Map<string, number>();
    try {
      await withMockFetch(
        (async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === "/auth/token") {
            return Response.json({
              access_token: "service-token",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }
          const key = decodeURIComponent(url.pathname.split("/").at(-1)!);
          const routing = url.pathname.includes("proxy-routing");
          if (routing) {
            const count = (routingCounts.get(key) ?? 0) + 1;
            routingCounts.set(key, count);
            if (key === "a.example.com" && count === 2) {
              refreshSignal = init?.signal;
              return await lateRouting.promise; // Deliberately ignores cancellation.
            }
          }
          return metadata(key, routing);
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
          const request = (host: string) =>
            handler.processRequest(new Request(`https://${host}/page`));
          try {
            assertEquals((await request("a.example.com")).error, undefined);
            await time.tickAsync(45_000);
            await time.runMicrotasks();
            assertEquals(routingCounts.get("a.example.com"), 2);
            assertEquals((await request("b.example.com")).error, undefined);
            assertEquals(
              refreshSignal?.aborted,
              true,
              "eviction must abort the actual routing transport",
            );
            lateRouting.resolve(metadata("a.example.com", true));
            await time.runMicrotasks();
            assertEquals((await request("b.example.com")).error, undefined);
            assertEquals(
              routingCounts.get("b.example.com"),
              1,
              "a late refresh must not restore the evicted key",
            );
          } finally {
            lateRouting.resolve(metadata("a.example.com", true));
            await handler.close();
            await time.runMicrotasks();
          }
        },
      );
    } finally {
      if (previous === undefined) Deno.env.delete("VERYFRONT_PROXY_ROUTING_CACHE_MAX_ENTRIES");
      else Deno.env.set("VERYFRONT_PROXY_ROUTING_CACHE_MAX_ENTRIES", previous);
    }
  });

  it("retains the scheduler slot until an abort-ignoring routing producer settles", async () => {
    using time = new FakeTime();
    const scheduler = new RoutingRefreshScheduler(1);
    const lateRouting = Promise.withResolvers<Response>();
    const requests: string[] = [];
    await withMockFetch(
      (async (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        const key = decodeURIComponent(url.pathname.split("/").at(-1)!);
        requests.push(key);
        return key === "a.example.com" ? await lateRouting.promise : metadata(key, true);
      }) as typeof fetch,
      async () => {
        const client = createProjectMetadataClient({
          apiBaseUrl: "https://api.example.test",
          maxInflight: 1,
          waitForProducer: true,
        });
        scheduler.schedule("a", 10, async (signal) => {
          await client.lookupRouting("a.example.com", "service-token", { signal });
        });
        scheduler.schedule("b", 10, async (signal) => {
          await client.lookupRouting("b.example.com", "service-token", { signal });
        });
        try {
          await time.tickAsync(10);
          await time.runMicrotasks();
          assertEquals(requests, ["a.example.com"]);
          scheduler.cancel("a");
          await time.runMicrotasks();
          assertEquals(
            requests,
            ["a.example.com"],
            "a cancelled waiter must retain producer admission",
          );
          lateRouting.resolve(metadata("a.example.com", true));
          await time.runMicrotasks();
          assertEquals(requests, ["a.example.com", "b.example.com"]);
        } finally {
          lateRouting.resolve(metadata("a.example.com", true));
          scheduler.close();
          await time.runMicrotasks();
        }
      },
    );
  });
});
