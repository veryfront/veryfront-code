import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  guardedEgressFetch,
  WorkerEgressBlockedError,
} from "#veryfront/security/sandbox/worker-egress-guard.ts";
import {
  createOutboundFetchBoundary,
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "./outbound-fetch.ts";

function createTestBoundary(fetchImpl: typeof fetch) {
  return createOutboundFetchBoundary({
    fetch: fetchImpl,
    pinnedFetch: (url, _addresses, init) => fetchImpl(url, init),
  });
}

describe("guardedOutboundFetch", () => {
  it("uses withMockFetch transport instead of the captured host fetch in tests", async () => {
    let captured: Request | undefined;

    const response = await withMockFetch(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = new Request(input, init);
        return Response.json({ mocked: true });
      },
      () => guardedOutboundFetch("https://93.184.216.34/rag/documents"),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { mocked: true });
    assertEquals(captured?.url, "https://93.184.216.34/rag/documents");
  });

  it("rejects loopback and cloud metadata before invoking fetch", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(new Response("unexpected"));
    };
    const boundary = createTestBoundary(fetchImpl);

    await assertRejects(
      () => boundary.guardedFetch("http://127.0.0.1/private"),
      OutboundRequestBlockedError,
      "internal host",
    );
    await assertRejects(
      () => boundary.guardedFetch("http://169.254.169.254/metadata"),
      OutboundRequestBlockedError,
      "internal host",
    );
    assertEquals(calls, 0);
  });

  it("rejects non-HTTP schemes and URL credentials", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(new Response("unexpected"));
    };
    const boundary = createTestBoundary(fetchImpl);
    await assertRejects(
      () => boundary.guardedFetch("file:///private/config"),
      OutboundRequestBlockedError,
      "unsupported URL scheme",
    );
    await assertRejects(
      () => boundary.guardedFetch("https://user:secret@93.184.216.34/"),
      OutboundRequestBlockedError,
      "URL credentials are not allowed",
    );
    assertEquals(calls, 0);
  });

  it("rejects a public hostname whose DNS answer is private", async () => {
    let calls = 0;
    await assertRejects(
      () =>
        guardedEgressFetch("https://public.example/resource", undefined, {
          fetchImpl: () => {
            calls++;
            return Promise.resolve(new Response("unexpected"));
          },
          options: { resolveHost: () => Promise.resolve(["10.0.0.8"]) },
        }),
      WorkerEgressBlockedError,
      "blocked for host",
    );
    assertEquals(calls, 0);
  });

  it("applies caller authorization to every redirect destination", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      const url = String(input);
      if (url.endsWith("/start")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://93.184.216.35/next" },
          }),
        );
      }
      return Promise.resolve(new Response("unexpected"));
    };
    const boundary = createTestBoundary(fetchImpl);

    await assertRejects(
      () =>
        boundary.guardedFetch("https://93.184.216.34/start", undefined, {
          authorizeUrl(url) {
            seen.push(url.href);
            if (url.hostname !== "93.184.216.34") {
              throw new OutboundRequestBlockedError("origin is not allowed");
            }
          },
        }),
      OutboundRequestBlockedError,
      "origin is not allowed",
    );
    assertEquals(seen, [
      "https://93.184.216.34/start",
      "https://93.184.216.35/next",
    ]);
  });

  it("preserves Request input semantics for origin-bound provider transports", async () => {
    let captured: Request | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = new Request(input, init);
      return Response.json({ ok: true });
    };
    const request = new Request("https://93.184.216.34/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "provider-secret", "content-type": "application/json" },
      body: '{"message":"hello"}',
    });

    const providerFetch = createTestBoundary(fetchImpl).createOriginBoundFetch(
      "https://93.184.216.34/v1",
    );
    const response = await providerFetch(request);

    assertEquals(response.status, 200);
    assertEquals(captured?.method, "POST");
    assertEquals(captured?.headers.get("x-api-key"), "provider-secret");
    assertEquals(await captured?.text(), '{"message":"hello"}');
  });

  it("rejects provider redirects before API-key credentials can leave the origin", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(
        new Response(null, {
          status: 307,
          headers: { location: "https://93.184.216.35/collect" },
        }),
      );
    };
    const providerFetch = createTestBoundary(fetchImpl).createOriginBoundFetch(
      "https://93.184.216.34/v1",
    );
    await assertRejects(
      () =>
        providerFetch("https://93.184.216.34/v1/messages", {
          method: "POST",
          headers: { "x-api-key": "provider-secret" },
          body: "payload",
        }),
      OutboundRequestBlockedError,
      "unexpected redirect",
    );
    assertEquals(calls, 1);
  });

  it("allows one exact operator-configured internal endpoint without weakening guarded fetch", async () => {
    const requests: Request[] = [];
    const boundary = createTestBoundary(async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ ok: true });
    });
    const controlPlaneFetch = boundary.createTrustedEndpointFetch(
      "http://veryfront-api:80/mcp",
    );

    const response = await controlPlaneFetch("http://veryfront-api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: "{}",
    });

    assertEquals(response.status, 200);
    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.url, "http://veryfront-api/mcp");
    assertEquals(requests[0]?.redirect, "error");

    await assertRejects(
      () => controlPlaneFetch("http://veryfront-api/runs"),
      OutboundRequestBlockedError,
      "trusted endpoint",
    );
    await assertRejects(
      () => boundary.guardedFetch("http://veryfront-api/mcp"),
      OutboundRequestBlockedError,
      "unable to resolve host",
    );
    assertEquals(requests.length, 1);
  });

  it("rejects unsafe trusted endpoint configuration", async () => {
    const boundary = createTestBoundary(() => Promise.resolve(Response.json({ ok: true })));

    for (
      const endpoint of [
        "http://127.0.0.1/mcp",
        "http://localhost/mcp",
        "http://localhost./mcp",
        "http://tools.localhost./mcp",
        "http://user:secret@veryfront-api/mcp",
        "http://veryfront-api/mcp?mode=unsafe",
      ]
    ) {
      await assertRejects(
        async () => boundary.createTrustedEndpointFetch(endpoint),
        TypeError,
      );
    }
  });

  it("rejects redirects from a trusted control-plane endpoint", async () => {
    const controlPlaneFetch = createTestBoundary(() =>
      Promise.resolve(
        new Response(null, {
          status: 307,
          headers: { location: "http://veryfront-api/private" },
        }),
      )
    ).createTrustedEndpointFetch("http://veryfront-api/mcp");

    await assertRejects(
      () => controlPlaneFetch("http://veryfront-api/mcp"),
      OutboundRequestBlockedError,
      "unexpected redirect",
    );
  });
});
