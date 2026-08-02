import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { ServerResolver } from "./server-resolver.ts";

// Minimal HTTP server for testing — bind to 127.0.0.1 to avoid IPv6 flakiness
function createMockApi(
  handler: (req: Request) => Response | Promise<Response>,
): { url: string; close: () => Promise<void> } {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    handler,
  );
  const addr = server.addr as Deno.NetAddr;
  return {
    url: `http://${addr.hostname}:${addr.port}`,
    close: () => server.shutdown(),
  };
}

Deno.test("ServerResolver", async (t) => {
  await t.step("returns dedicated server URL when environment has running server", async () => {
    const api = createMockApi(() =>
      Response.json({
        server: {
          id: "srv-1",
          short_id: "4281039506",
          hostname: "veryfront-server-4281039506.veryfront-production.svc.cluster.local",
          status: "running",
        },
      })
    );
    const resolver = new ServerResolver(api.url, "", "");
    try {
      const result = await resolver.resolve("env-001");
      assertEquals(
        result,
        "http://veryfront-server-4281039506.veryfront-production.svc.cluster.local",
      );
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("returns null when no dedicated server", async () => {
    const api = createMockApi(() => Response.json({ server: null }));
    const resolver = new ServerResolver(api.url, "", "");
    try {
      const result = await resolver.resolve("env-002");
      assertEquals(result, null);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("returns null when environmentId is undefined", async () => {
    const resolver = new ServerResolver("http://unused", "", "");
    try {
      const result = await resolver.resolve(undefined);
      assertEquals(result, null);
    } finally {
      resolver.close();
    }
  });

  await t.step("caches result and reuses on second call", async () => {
    let callCount = 0;
    const api = createMockApi(() => {
      callCount++;
      return Response.json({
        server: {
          id: "srv-1",
          short_id: "1234567890",
          hostname: "veryfront-server-1234567890.ns.svc.cluster.local",
          status: "running",
        },
      });
    });
    const resolver = new ServerResolver(api.url, "", "", 5_000);
    try {
      await resolver.resolve("env-cached");
      await resolver.resolve("env-cached");
      assertEquals(callCount, 1, "should only call API once due to cache");
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("expires cached results at the configured monotonic deadline", async () => {
    let now = 100;
    let callCount = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      30,
      {
        now: () => now,
        fetchImpl: () => {
          callCount++;
          return Promise.resolve(Response.json({ server: null }));
        },
      },
    );
    try {
      assertEquals(await resolver.resolve("env-expiry"), null);
      now = 129;
      assertEquals(await resolver.resolve("env-expiry"), null);
      assertEquals(callCount, 1);
      now = 130;
      assertEquals(await resolver.resolve("env-expiry"), null);
      assertEquals(callCount, 2);
    } finally {
      resolver.close();
    }
  });

  await t.step("returns null and does not throw when API is unreachable", async () => {
    const resolver = new ServerResolver("http://localhost:1", "", "");
    try {
      const result = await resolver.resolve("env-unreachable");
      assertEquals(result, null);
    } finally {
      resolver.close();
    }
  });

  await t.step("returns null when API returns non-OK status", async () => {
    const api = createMockApi(() => new Response("Internal Server Error", { status: 500 }));
    const resolver = new ServerResolver(api.url, "", "");
    try {
      const result = await resolver.resolve("env-500");
      assertEquals(result, null);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("sends basic auth when credentials are configured", async () => {
    let receivedAuth = "";
    const api = createMockApi((req) => {
      receivedAuth = req.headers.get("authorization") || "";
      return Response.json({ server: null });
    });
    const resolver = new ServerResolver(api.url, "admin", "secret123");
    try {
      await resolver.resolve("env-auth");
      assertEquals(receivedAuth, `Basic ${btoa("admin:secret123")}`);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("deduplicates concurrent requests for same environment", async () => {
    let callCount = 0;
    const api = createMockApi(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50)); // simulate latency
      return Response.json({ server: null });
    });
    const resolver = new ServerResolver(api.url, "", "");
    try {
      // Fire 3 concurrent requests for the same environment
      const [r1, r2, r3] = await Promise.all([
        resolver.resolve("env-dedup"),
        resolver.resolve("env-dedup"),
        resolver.resolve("env-dedup"),
      ]);
      assertEquals(r1, null);
      assertEquals(r2, null);
      assertEquals(r3, null);
      assertEquals(callCount, 1, "should deduplicate to single API call");
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("deduplicates transient failures without rejecting followers", async () => {
    let callCount = 0;
    const api = createMockApi(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response("Service Unavailable", { status: 503 });
    });
    const resolver = new ServerResolver(api.url, "", "");
    try {
      assertEquals(
        await Promise.all([
          resolver.resolve("env-shared-error"),
          resolver.resolve("env-shared-error"),
          resolver.resolve("env-shared-error"),
        ]),
        [null, null, null],
      );
      assertEquals(callCount, 1);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("does not cache transient API errors (retries on next request)", async () => {
    let callCount = 0;
    const api = createMockApi(() => {
      callCount++;
      if (callCount === 1) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return Response.json({
        server: {
          id: "srv-1",
          short_id: "9999999999",
          hostname: "veryfront-server-9999999999.ns.svc.cluster.local",
          status: "running",
        },
      });
    });
    const resolver = new ServerResolver(api.url, "", "", 30_000);
    try {
      // First call: API returns 503 → should return null (fallback) but NOT cache
      const r1 = await resolver.resolve("env-transient");
      assertEquals(r1, null);

      // Second call: API now healthy → should hit API again (not use cached null)
      const r2 = await resolver.resolve("env-transient");
      assertEquals(
        r2,
        "http://veryfront-server-9999999999.ns.svc.cluster.local",
      );
      assertEquals(callCount, 2, "should call API twice (error was not cached)");
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("preserves a path-prefixed API base", async () => {
    let requestedUrl = "";
    const resolver = new ServerResolver(
      "https://api.example.com/control/",
      "",
      "",
      0,
      {
        fetchImpl: (input) => {
          requestedUrl = input.toString();
          return Promise.resolve(Response.json({ server: null }));
        },
      },
    );
    try {
      await resolver.resolve("env-path");
      const requested = new URL(requestedUrl);
      assertEquals(
        requested.pathname,
        "/control/internal/environment-server",
      );
      assertEquals(requested.searchParams.get("environmentId"), "env-path");
    } finally {
      resolver.close();
    }
  });

  await t.step("rejects unsafe construction and environment identifiers", async () => {
    assertThrows(
      () => new ServerResolver("file:///tmp/api", "", ""),
      TypeError,
      "HTTP(S)",
    );
    assertThrows(
      () => new ServerResolver("https://api.exam\tple.com", "", ""),
      TypeError,
      "invalid",
    );
    assertThrows(
      () => new ServerResolver("https://api.example.com", "user", ""),
      TypeError,
      "configured together",
    );
    assertThrows(
      () => new ServerResolver("https://api.example.com", "", "", -1),
      RangeError,
      "cache TTL",
    );
    assertThrows(
      () =>
        new ServerResolver(
          "https://api.example.com",
          "",
          "",
          1_000,
          { maxEntry: 1 } as never,
        ),
      TypeError,
      "unknown option",
    );
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "maxEntries", {
      get() {
        optionReads++;
        return 1;
      },
    });
    assertThrows(
      () =>
        new ServerResolver(
          "https://api.example.com",
          "",
          "",
          1_000,
          accessorOptions,
        ),
      TypeError,
      "data property",
    );
    assertEquals(optionReads, 0);

    const resolver = new ServerResolver("https://api.example.com", "", "");
    try {
      await assertRejects(
        () => resolver.resolve(" environment"),
        TypeError,
        "environment ID",
      );
    } finally {
      resolver.close();
    }
  });

  await t.step("rejects malformed and inactive server targets", async () => {
    let calls = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      30_000,
      {
        fetchImpl: (_input) => {
          calls++;
          return Promise.resolve(Response.json({
            server: {
              id: "srv-1",
              short_id: "short-1",
              hostname: calls === 1
                ? "internal.example.com/path"
                : calls === 2
                ? "internal.example.com"
                : "127.1",
              status: calls === 2 ? "stopped" : "running",
            },
          }));
        },
      },
    );
    try {
      assertEquals(await resolver.resolve("env-invalid-host"), null);
      assertEquals(await resolver.resolve("env-stopped"), null);
      assertEquals(await resolver.resolve("env-stopped"), null);
      assertEquals(await resolver.resolve("env-ambiguous-host"), null);
      assertEquals(calls, 3, "the inactive result should be cached");
    } finally {
      resolver.close();
    }
  });

  await t.step("does not cache malformed control-plane answers", async () => {
    let calls = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      30_000,
      {
        fetchImpl: () => {
          calls++;
          return Promise.resolve(Response.json({
            server: calls === 1
              ? {
                id: "srv-1",
                short_id: "short-1",
                hostname: "server.internal",
                status: "run\u0000ning",
              }
              : null,
          }));
        },
      },
    );
    try {
      assertEquals(await resolver.resolve("env-malformed-status"), null);
      assertEquals(await resolver.resolve("env-malformed-status"), null);
      assertEquals(calls, 2);
    } finally {
      resolver.close();
    }
  });

  await t.step("bounds and type-checks control-plane response bodies", async () => {
    let calls = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      0,
      {
        fetchImpl: () => {
          calls++;
          if (calls === 1) {
            return Promise.resolve(
              new Response("{}", {
                headers: { "content-type": "text/plain" },
              }),
            );
          }
          return Promise.resolve(
            new Response("x".repeat(64 * 1_024 + 1), {
              headers: { "content-type": "application/json" },
            }),
          );
        },
      },
    );
    try {
      assertEquals(await resolver.resolve("env-content-type"), null);
      assertEquals(await resolver.resolve("env-oversized"), null);
      assertEquals(calls, 2);
    } finally {
      resolver.close();
    }
  });

  await t.step("bounds cache entries with LRU eviction", async () => {
    const calls = new Map<string, number>();
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      30_000,
      {
        maxEntries: 2,
        fetchImpl: (input) => {
          const requestUrl = new URL(input.toString());
          const environmentId = requestUrl.searchParams.get("environmentId")!;
          calls.set(environmentId, (calls.get(environmentId) ?? 0) + 1);
          return Promise.resolve(Response.json({
            server: {
              id: `server-${environmentId}`,
              short_id: `short-${environmentId}`,
              hostname: `${environmentId}.internal`,
              status: "running",
            },
          }));
        },
      },
    );
    try {
      await resolver.resolve("env-1");
      await resolver.resolve("env-2");
      await resolver.resolve("env-1");
      await resolver.resolve("env-3");
      await resolver.resolve("env-2");

      assertEquals(calls.get("env-1"), 1);
      assertEquals(calls.get("env-2"), 2);
      assertEquals(calls.get("env-3"), 1);
    } finally {
      resolver.close();
    }
  });

  await t.step("bounds distinct in-flight lookups", async () => {
    let releaseFetch!: () => void;
    let markFetchStarted!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let calls = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      30_000,
      {
        maxInflight: 1,
        fetchImpl: async () => {
          calls++;
          markFetchStarted();
          await fetchGate;
          return Response.json({ server: null });
        },
      },
    );
    try {
      const first = resolver.resolve("env-first");
      await fetchStarted;
      assertEquals(await resolver.resolve("env-overflow"), null);
      assertEquals(calls, 1);
      releaseFetch();
      assertEquals(await first, null);
    } finally {
      resolver.close();
    }
  });

  await t.step("retains lookup capacity until an error body cancellation settles", async () => {
    const cancellationGate = Promise.withResolvers<void>();
    const cancellationStarted = Promise.withResolvers<void>();
    let calls = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      0,
      {
        maxInflight: 1,
        fetchImpl: () => {
          calls++;
          if (calls > 1) return Promise.resolve(Response.json({ server: null }));
          return Promise.resolve(
            new Response(
              new ReadableStream({
                cancel() {
                  cancellationStarted.resolve();
                  return cancellationGate.promise;
                },
              }),
              { status: 500 },
            ),
          );
        },
      },
    );
    try {
      const first = resolver.resolve("env-hostile-body");
      await cancellationStarted.promise;

      let firstSettled = false;
      void first.then(() => {
        firstSettled = true;
      });
      await Promise.resolve();
      assertEquals(firstSettled, false);
      assertEquals(await resolver.resolve("env-at-capacity"), null);
      assertEquals(calls, 1);

      cancellationGate.resolve();
      assertEquals(await first, null);
      assertEquals(await resolver.resolve("env-after-cancellation"), null);
      assertEquals(calls, 2);
    } finally {
      cancellationGate.resolve();
      resolver.close();
    }
  });

  await t.step("bounds a fetch implementation that ignores cancellation", async () => {
    let calls = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      0,
      {
        maxInflight: 1,
        requestTimeoutMs: 5,
        fetchImpl: () => {
          calls++;
          return new Promise<Response>(() => {});
        },
      },
    );
    try {
      const startedAt = performance.now();
      assertEquals(await resolver.resolve("env-timeout"), null);
      assertEquals(performance.now() - startedAt < 250, true);
      assertEquals(await resolver.resolve("env-capacity"), null);
      assertEquals(calls, 1);
    } finally {
      resolver.close();
    }
  });

  await t.step("retains detached capacity until a late response cancellation settles", async () => {
    const lateResponse = Promise.withResolvers<Response>();
    const cancellationGate = Promise.withResolvers<void>();
    const cancellationStarted = Promise.withResolvers<void>();
    let calls = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      0,
      {
        maxInflight: 1,
        requestTimeoutMs: 5,
        fetchImpl: () => {
          calls++;
          if (calls === 1) return lateResponse.promise;
          return Promise.resolve(Response.json({ server: null }));
        },
      },
    );
    try {
      assertEquals(await resolver.resolve("env-timeout"), null);
      assertEquals(await resolver.resolve("env-still-detached"), null);
      assertEquals(calls, 1);

      lateResponse.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancellationStarted.resolve();
              return cancellationGate.promise;
            },
          }),
        ),
      );
      await cancellationStarted.promise;
      assertEquals(await resolver.resolve("env-cancelling-late-body"), null);
      assertEquals(calls, 1);

      cancellationGate.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(await resolver.resolve("env-after-late-cancellation"), null);
      assertEquals(calls, 2);
    } finally {
      cancellationGate.resolve();
      resolver.close();
    }
  });

  await t.step("shares capacity between live and cancellation-ignoring work", async () => {
    let calls = 0;
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      0,
      {
        maxInflight: 2,
        requestTimeoutMs: 5,
        fetchImpl: () => {
          calls++;
          if (calls === 2) markSecondStarted();
          return new Promise<Response>(() => {});
        },
      },
    );
    try {
      assertEquals(await resolver.resolve("env-detached"), null);
      const live = resolver.resolve("env-live");
      await secondStarted;
      assertEquals(await resolver.resolve("env-over-capacity"), null);
      assertEquals(calls, 2);
      resolver.close();
      assertEquals(await live, null);
    } finally {
      resolver.close();
    }
  });

  await t.step("applies the request deadline while reading the response body", async () => {
    let calls = 0;
    let cancellations = 0;
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      0,
      {
        requestTimeoutMs: 5,
        fetchImpl: () => {
          calls++;
          if (calls > 1) {
            return Promise.resolve(Response.json({ server: null }));
          }
          return Promise.resolve(
            new Response(
              new ReadableStream({
                pull: () => new Promise<void>(() => {}),
                cancel: () => {
                  cancellations++;
                },
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        },
      },
    );
    try {
      const startedAt = performance.now();
      assertEquals(await resolver.resolve("env-body-timeout"), null);
      assertEquals(performance.now() - startedAt < 250, true);
      assertEquals(cancellations, 1);
      assertEquals(await resolver.resolve("env-after-timeout"), null);
      assertEquals(calls, 2);
    } finally {
      resolver.close();
    }
  });

  await t.step("close aborts pending work and fences late cache writes", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchResult = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const resolver = new ServerResolver(
      "https://api.example.com",
      "",
      "",
      30_000,
      {
        fetchImpl: () => fetchResult,
      },
    );
    const lookup = resolver.resolve("env-close");
    await Promise.resolve();
    resolver.close();

    assertEquals(await lookup, null);
    resolveFetch(Response.json({
      server: {
        id: "server-late",
        short_id: "short-late",
        hostname: "late.internal",
        status: "running",
      },
    }));
    await assertRejects(
      () => resolver.resolve("env-close"),
      Error,
      "closed",
    );
  });
});
