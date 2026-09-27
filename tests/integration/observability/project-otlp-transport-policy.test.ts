import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { __runWithOutboundFetchTransportForTests } from "#veryfront/security/http/outbound-fetch.ts";
import {
  createProjectOtlpTransport,
  PROJECT_OTLP_MAX_REQUEST_BYTES,
} from "#veryfront/observability/tracing/project-otlp-transport.ts";

const endpoint = "https://collector.example/v1/traces";
const bytes = new TextEncoder().encode('{"resourceSpans":[]}');
const suppression = new AsyncLocalStorage<boolean>();
const withSuppressedTracing = <T>(operation: () => Promise<T>) => suppression.run(true, operation);

describe("project OTLP transport", () => {
  it("owns the JSON content type even when supplied headers use different casing", async () => {
    await withMockFetch((input, init) => {
      const request = new Request(input, init);
      assertEquals(request.headers.get("content-type"), "application/json");
      return Promise.resolve(Response.json({}));
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: { "Content-Type": "text/plain" },
        withSuppressedTracing,
      });
      assertEquals((await transport.send(bytes, 1000)).status, "success");
      transport.shutdown();
    });
  });

  it("snapshots credentials and sends through the guarded transport in suppressed context", async () => {
    let request: Request | undefined;
    await withMockFetch(async (input, init) => {
      await Promise.resolve();
      assertEquals(suppression.getStore(), true);
      request = new Request(input, init);
      return Response.json({});
    }, async () => {
      const headers = { authorization: "Bearer synthetic-token" };
      const data = bytes.slice();
      const transport = createProjectOtlpTransport({ endpoint, headers, withSuppressedTracing });
      headers.authorization = "changed";
      const result = transport.send(data, 1000);
      data.fill(0);
      assertEquals(await result, { status: "success" });
      transport.shutdown();
    });
    assertExists(request);
    assertEquals(request.url, endpoint);
    assertEquals(request.method, "POST");
    assertEquals(request.headers.get("authorization"), "Bearer synthetic-token");
    assertEquals(request.headers.get("content-type"), "application/json");
    assertEquals(await request.text(), new TextDecoder().decode(bytes));
  });

  it("rejects redirects without forwarding collector credentials", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(
        new Response(null, {
          status: 307,
          headers: { location: "https://other.example/v1/traces" },
        }),
      );
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: { authorization: "Bearer synthetic-token" },
        withSuppressedTracing,
      });
      const result = await transport.send(bytes, 1000);
      assertEquals(result.status, "failure");
      if (result.status === "failure") {
        assertEquals(result.error.message, "Project trace export failed");
      }
      transport.shutdown();
    });
    assertEquals(calls, 1);
  });

  it("blocks private DNS answers before sending any bytes", async () => {
    let calls = 0;
    await withEnv(
      {
        VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "false",
        VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS: "",
      },
      () =>
        __runWithOutboundFetchTransportForTests({
          fetch: () => {
            calls++;
            return Promise.resolve(Response.json({}));
          },
          resolveHost: () => Promise.resolve(["169.254.169.254"]),
        }, async () => {
          const transport = createProjectOtlpTransport({
            endpoint,
            headers: {},
            withSuppressedTracing,
          });
          assertEquals((await transport.send(bytes, 1000)).status, "failure");
          transport.shutdown();
        }),
    );
    assertEquals(calls, 0);
  });

  it("does not include collector response data in export errors", async () => {
    await withMockFetch(
      () => Promise.resolve(new Response("synthetic-secret-echo", { status: 503 })),
      async () => {
        const transport = createProjectOtlpTransport({
          endpoint,
          headers: {},
          withSuppressedTracing,
        });
        const result = await transport.send(bytes, 1000);
        assertEquals(result.status, "failure");
        if (result.status === "failure") {
          assertEquals(
            result.error.message,
            "Project trace export failed",
          );
        }
        transport.shutdown();
      },
    );
  });

  it("uses pinned public DNS answers and rejects a later private answer", async () => {
    let resolves = 0;
    let sends = 0;
    await withEnv(
      { VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS: "false" },
      () =>
        __runWithOutboundFetchTransportForTests({
          fetch: () => {
            throw new Error("must use the pinned transport");
          },
          resolveHost: () => Promise.resolve(++resolves === 1 ? ["93.184.216.34"] : ["10.0.0.8"]),
          pinnedFetch: (_url, addresses) => {
            sends++;
            assertEquals(addresses, ["93.184.216.34"]);
            return Promise.resolve(Response.json({}));
          },
        }, async () => {
          const transport = createProjectOtlpTransport({
            endpoint,
            headers: {},
            withSuppressedTracing,
          });
          assertEquals((await transport.send(bytes, 1000)).status, "success");
          assertEquals((await transport.send(bytes, 1000)).status, "failure");
          transport.shutdown();
        }),
    );
    assertEquals(sends, 1);
  });

  it("bounds concurrent sends without preventing another destination from exporting", async () => {
    const release = Promise.withResolvers<Response>();
    let slowCalls = 0;
    await withMockFetch((input) => {
      if (String(input).includes("/slow")) {
        slowCalls++;
        return release.promise;
      }
      return Promise.resolve(Response.json({}));
    }, async () => {
      const slow = createProjectOtlpTransport({
        endpoint: `${endpoint}/slow`,
        headers: {},
        withSuppressedTracing,
      });
      const healthy = createProjectOtlpTransport({ endpoint, headers: {}, withSuppressedTracing });
      const first = slow.send(bytes, 1000);
      const second = slow.send(bytes, 1000);
      try {
        assertEquals((await slow.send(bytes, 1000)).status, "failure");
        assertEquals((await healthy.send(bytes, 1000)).status, "success");
        assertEquals(slowCalls, 2);
      } finally {
        slow.shutdown();
        healthy.shutdown();
        release.resolve(Response.json({}));
        await Promise.all([first, second]);
      }
    });
  });

  it("settles at the deadline even when the fetch implementation ignores abort", async () => {
    const release = Promise.withResolvers<Response>();
    let signal: AbortSignal | null | undefined;
    await withMockFetch((_input, init) => {
      signal = init?.signal;
      return release.promise;
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      try {
        const result = await transport.send(bytes, 10);
        assertEquals(result.status, "failure");
        assertEquals(signal?.aborted, true);
      } finally {
        release.resolve(Response.json({}));
        transport.shutdown();
      }
    });
  });

  it("shutdown settles active sends and rejects further sends", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    await withMockFetch(() => {
      started.resolve();
      return release.promise;
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      const send = transport.send(bytes, 1000);
      await started.promise;
      transport.shutdown();
      assertEquals((await send).status, "failure");
      assertEquals((await transport.send(bytes, 1000)).status, "failure");
      release.resolve(Response.json({}));
    });
  });

  it("rejects oversized payloads and invalid time budgets without a request", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(Response.json({}));
    }, async () => {
      const transport = createProjectOtlpTransport({
        endpoint,
        headers: {},
        withSuppressedTracing,
      });
      assertEquals(
        (await transport.send(new Uint8Array(PROJECT_OTLP_MAX_REQUEST_BYTES + 1), 1000)).status,
        "failure",
      );
      for (const timeout of [0, -1, NaN, Infinity]) {
        assertEquals((await transport.send(bytes, timeout)).status, "failure");
      }
      transport.shutdown();
    });
    assertEquals(calls, 0);
  });
});
