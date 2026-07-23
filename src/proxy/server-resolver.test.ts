import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "@std/assert";
import { ServerResolver } from "./server-resolver.ts";

// Minimal HTTP server for testing. Bind to 127.0.0.1 to avoid IPv6 flakiness.
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

  await t.step("uses the shared pool while a dedicated server is not running", async () => {
    const api = createMockApi(() =>
      Response.json({
        server: {
          hostname: "veryfront-server-pending.ns.svc.cluster.local",
          status: "provisioning",
        },
      })
    );
    const resolver = new ServerResolver(api.url, "", "");
    try {
      assertEquals(await resolver.resolve("env-pending"), null);
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

  await t.step("rejects malformed and unsafe dedicated server payloads", async () => {
    const payloads = [
      { server: "not-an-object" },
      { server: { hostname: "trusted.test@attacker.test" } },
      { server: { hostname: "trusted.test/private/path" } },
      { server: { hostname: "" } },
    ];
    let callCount = 0;
    const api = createMockApi(() => Response.json(payloads[callCount++]));
    const resolver = new ServerResolver(api.url, "", "", 30_000);
    try {
      for (let index = 0; index < payloads.length; index++) {
        assertEquals(await resolver.resolve(`env-malformed-${index}`), null);
      }
      assertEquals(callCount, payloads.length);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("aborts in-flight lookups when closed", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () =>
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      })) as typeof fetch;
    const resolver = new ServerResolver("http://api.test", "", "");
    try {
      const lookup = resolver.resolve("env-closing");
      await Promise.resolve();
      resolver.close();
      assertEquals(await lookup, null);
    } finally {
      resolver.close();
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("bounds the cache and evicts the least recently used entry", async () => {
    let callCount = 0;
    const api = createMockApi(() => {
      callCount++;
      return Response.json({ server: null });
    });
    const resolver = new ServerResolver(api.url, "", "", 30_000, 2);
    try {
      await resolver.resolve("env-1");
      await resolver.resolve("env-2");
      await resolver.resolve("env-1");
      await resolver.resolve("env-3");
      await resolver.resolve("env-2");
      assertEquals(callCount, 4);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("contains a shared transient failure for every deduplicated caller", async () => {
    let releaseRequest!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let callCount = 0;
    const api = createMockApi(async () => {
      callCount++;
      await release;
      return new Response("Service Unavailable", { status: 503 });
    });
    const resolver = new ServerResolver(api.url, "", "");
    try {
      const first = resolver.resolve("env-shared-failure");
      const second = resolver.resolve("env-shared-failure");
      releaseRequest();
      assertEquals(await Promise.all([first, second]), [null, null]);
      assertEquals(callCount, 1);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("rejects oversized API responses", async () => {
    const api = createMockApi(() =>
      new Response("x".repeat(65 * 1024), {
        headers: { "content-type": "application/json" },
      })
    );
    const resolver = new ServerResolver(api.url, "", "");
    try {
      assertEquals(await resolver.resolve("env-oversized"), null);
    } finally {
      resolver.close();
      await api.close();
    }
  });

  await t.step("bounds concurrent lookups for distinct environments", async () => {
    let releaseRequests!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let bothStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    let callCount = 0;
    const api = createMockApi(async () => {
      callCount++;
      if (callCount === 2) bothStarted();
      await release;
      return Response.json({ server: null });
    });
    const resolver = new ServerResolver(api.url, "", "", 30_000, 2);
    try {
      const first = resolver.resolve("env-pending-1");
      const second = resolver.resolve("env-pending-2");
      await started;
      assertEquals(await resolver.resolve("env-pending-3"), null);
      assertEquals(callCount, 2);
      releaseRequests();
      assertEquals(await Promise.all([first, second]), [null, null]);
    } finally {
      releaseRequests();
      resolver.close();
      await api.close();
    }
  });
});
