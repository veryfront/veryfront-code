import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import {
  guardedEgressFetch,
  WorkerEgressBlockedError,
} from "#veryfront/security/sandbox/worker-egress-guard.ts";
import {
  createOutboundFetchBoundary,
  guardedOutboundFetch,
  HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
  loadTrustedCaCertificates,
  OutboundRequestBlockedError,
} from "./outbound-fetch.ts";

function createTestBoundary(fetchImpl: typeof fetch) {
  return createOutboundFetchBoundary({
    fetch: fetchImpl,
    pinnedFetch: (url, _addresses, init) => fetchImpl(url, init),
  });
}

describe("guardedOutboundFetch", () => {
  it("adds a bounded PEM bundle after the runtime trust roots", async () => {
    let seenPath: string | undefined;
    let seenLimit: number | undefined;
    const trusted = await loadTrustedCaCertificates(
      "/project/local-ca.crt",
      ["<RUNTIME_CA>"],
      (path, byteLimit) => {
        seenPath = path;
        seenLimit = byteLimit;
        return Promise.resolve(
          new TextEncoder().encode(
            "-----BEGIN CERTIFICATE-----\n<LOCAL_CA>\n-----END CERTIFICATE-----\n",
          ),
        );
      },
    );

    assertEquals(seenPath, "/project/local-ca.crt");
    assertEquals(seenLimit, 1024 * 1024);
    assertEquals(trusted, [
      "<RUNTIME_CA>",
      "-----BEGIN CERTIFICATE-----\n<LOCAL_CA>\n-----END CERTIFICATE-----\n",
    ]);
    assertEquals(Object.isFrozen(trusted), true);
  });

  it("rejects unreadable or malformed extra CA bundles", async () => {
    await assertRejects(
      () =>
        loadTrustedCaCertificates("/private/ca.crt", [], () => {
          throw new Error("path-specific failure");
        }),
      Error,
      "Bun could not read NODE_EXTRA_CA_CERTS.",
    );
    await assertRejects(
      () =>
        loadTrustedCaCertificates(
          "/private/ca.crt",
          [],
          () => Promise.resolve(new TextEncoder().encode("not a certificate")),
        ),
      Error,
      "NODE_EXTRA_CA_CERTS must contain PEM certificates.",
    );
  });

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

  it("ignores a hand-assigned globalThis.fetch rather than failing open to it", async () => {
    // The old ambient path honoured this assignment, but only when DENO_TESTING
    // was set four modules away. Forgetting the flag did not break loudly -- it
    // reached the internet. There is now no flag and no ambient path: an
    // assignment controls direct fetch callers and nothing else, so a test that
    // stubs it and expects a canned response fails on its own terms instead of
    // egressing to a third party.
    let ambientCalls = 0;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      value: () => {
        ambientCalls++;
        return Promise.resolve(Response.json({ ambient: true }));
      },
      configurable: true,
      writable: true,
    });

    try {
      const response = await withMockFetch(
        () => Promise.resolve(Response.json({ seam: true })),
        () => guardedOutboundFetch("https://93.184.216.34/rag/documents"),
      );

      assertEquals(await response.json(), { seam: true });
      assertEquals(ambientCalls, 0);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
        writable: true,
      });
    }
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

  it("does not accept an untyped internal-egress capability from callers", async () => {
    let calls = 0;
    const boundary = createTestBoundary(() => {
      calls++;
      return Promise.resolve(new Response("unexpected"));
    });

    await assertRejects(
      () =>
        boundary.guardedFetch(
          "http://127.0.0.1/private",
          undefined,
          { allowInternalEgress: true } as never,
        ),
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

  it("pins against a transport-supplied resolver instead of real DNS", async () => {
    let resolved: string | undefined;
    let pinnedAddresses: readonly string[] | undefined;

    const boundary = createOutboundFetchBoundary({
      fetch: () => Promise.resolve(new Response("unexpected")),
      pinnedFetch: (_url, addresses) => {
        pinnedAddresses = addresses;
        return Promise.resolve(Response.json({ pinned: true }));
      },
      resolveHost: (hostname) => {
        resolved = hostname;
        return Promise.resolve(["93.184.216.34"]);
      },
    });

    // A name no resolver answers for, so a real lookup would fail here.
    const response = await boundary.guardedFetch("https://vf-transport.invalid/v1/models");

    assertEquals(await response.json(), { pinned: true });
    assertEquals(resolved, "vf-transport.invalid");
    assertEquals(pinnedAddresses, ["93.184.216.34"]);
  });

  it("still applies egress policy to what the injected resolver returns", async () => {
    let pinnedCalls = 0;
    const boundary = createOutboundFetchBoundary({
      fetch: () => Promise.resolve(new Response("unexpected")),
      pinnedFetch: () => {
        pinnedCalls++;
        return Promise.resolve(new Response("unexpected"));
      },
      resolveHost: () => Promise.resolve(["169.254.169.254"]),
    });

    await assertRejects(
      () => boundary.guardedFetch("https://vf-transport.invalid/latest/meta-data"),
      OutboundRequestBlockedError,
      "blocked for host",
    );
    assertEquals(pinnedCalls, 0);
  });

  it("refuses a transport whose host resolver is not callable", () => {
    assertThrows(
      () =>
        createOutboundFetchBoundary({
          fetch: () => Promise.resolve(new Response("unexpected")),
          resolveHost: "not-a-function" as unknown as () => Promise<string[]>,
        }),
      TypeError,
      "host resolver must be a function",
    );
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

  it("reports followed redirect hops to the host caller", async () => {
    const redirects: Array<{ status: number; fromUrl: string; toUrl: string }> = [];
    const fetchImpl: typeof fetch = (input) => {
      const url = String(input);
      if (url.endsWith("/start")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://93.184.216.35/auth" },
          }),
        );
      }
      if (url.endsWith("/auth")) {
        return Promise.resolve(
          new Response(null, {
            status: 307,
            headers: { location: "https://93.184.216.36/sign-in" },
          }),
        );
      }
      return Promise.resolve(new Response("sign in"));
    };
    const boundary = createTestBoundary(fetchImpl);

    const response = await boundary.guardedFetch(
      "https://93.184.216.34/start",
      undefined,
      {
        onRedirect({ status, fromUrl, toUrl }) {
          redirects.push({
            status,
            fromUrl: fromUrl.href,
            toUrl: toUrl.href,
          });
        },
      },
    );

    assertEquals(await response.text(), "sign in");
    assertEquals(redirects, [
      {
        status: 302,
        fromUrl: "https://93.184.216.34/start",
        toUrl: "https://93.184.216.35/auth",
      },
      {
        status: 307,
        fromUrl: "https://93.184.216.35/auth",
        toUrl: "https://93.184.216.36/sign-in",
      },
    ]);
  });

  it("does not report a redirect that the egress guard blocks", async () => {
    const redirects: string[] = [];
    let fetchCalls = 0;

    await assertRejects(
      () =>
        guardedEgressFetch("https://public.example/start", undefined, {
          fetchImpl: () => {
            fetchCalls++;
            return Promise.resolve(
              new Response(null, {
                status: 302,
                headers: { location: "https://private.example/sign-in" },
              }),
            );
          },
          pinnedFetch: (_url, _addresses, _init) => {
            fetchCalls++;
            return Promise.resolve(
              new Response(null, {
                status: 302,
                headers: { location: "https://private.example/sign-in" },
              }),
            );
          },
          onRedirect({ toUrl }) {
            redirects.push(toUrl.href);
          },
          options: {
            resolveHost(hostname) {
              return Promise.resolve([
                hostname === "private.example" ? "10.0.0.8" : "93.184.216.34",
              ]);
            },
          },
        }),
      WorkerEgressBlockedError,
      "blocked for host: private.example",
    );

    assertEquals(fetchCalls, 1);
    assertEquals(redirects, []);
  });

  it("cancels the destination response when a redirect observer fails", async () => {
    let cancelledBodies = 0;
    let fetchCalls = 0;
    const boundary = createTestBoundary((input) => {
      fetchCalls++;
      if (String(input).endsWith("/start")) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://93.184.216.35/final" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelledBodies++;
            },
          }),
        ),
      );
    });

    await assertRejects(
      () =>
        boundary.guardedFetch("https://93.184.216.34/start", undefined, {
          onRedirect() {
            throw new Error("observer failed");
          },
        }),
      Error,
      "observer failed",
    );

    assertEquals(fetchCalls, 2);
    assertEquals(cancelledBodies, 1);
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

  it("blocks cross-origin provider requests before credentials leave the boundary", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(Response.json({ ok: true }));
    };
    const providerFetch = createTestBoundary(fetchImpl).createOriginBoundFetch(
      "https://93.184.216.34/v1",
    );

    await assertRejects(
      () =>
        providerFetch("https://93.184.216.35/v1/messages", {
          headers: { "x-api-key": "provider-secret" },
        }),
      OutboundRequestBlockedError,
      "destination origin is not authorized",
      "a string input pointing at another origin must not reach the transport",
    );
    assertEquals(calls, 0, "a cross-origin provider request must never reach the transport");

    await assertRejects(
      () =>
        providerFetch(
          new Request("https://93.184.216.35/v1/messages", {
            headers: { "x-api-key": "provider-secret" },
          }),
        ),
      OutboundRequestBlockedError,
      "destination origin is not authorized",
      "a Request input bypasses the base rewrite and must be authorized too",
    );
    assertEquals(calls, 0, "the Request branch must not reach the transport either");
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

  it("allows only an exact host-approved internal provider origin", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      seen.push(String(input));
      return Promise.resolve(Response.json({ ok: true }));
    };

    await withEnv(
      { [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: "http://localhost:11434" },
      async () => {
        const boundary = createTestBoundary(fetchImpl);
        const allowedFetch = boundary.createOriginBoundFetch("http://localhost:11434/v1");
        const deniedFetch = boundary.createOriginBoundFetch("http://localhost:1234/v1");

        assertEquals(
          (await allowedFetch("http://localhost:11434/v1/chat/completions")).status,
          200,
        );
        await assertRejects(
          () => deniedFetch("http://localhost:1234/v1/chat/completions"),
          OutboundRequestBlockedError,
          "internal host",
        );
      },
    );

    assertEquals(seen, ["http://localhost:11434/v1/chat/completions"]);
  });

  it("does not let project environment grant internal provider access", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls++;
      return Promise.resolve(Response.json({ ok: true }));
    };

    await withEnv({ [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: "" }, async () => {
      await runWithProjectEnv(
        { [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: "http://localhost:11434" },
        async () => {
          const providerFetch = createTestBoundary(fetchImpl).createOriginBoundFetch(
            "http://localhost:11434/v1",
          );
          await assertRejects(
            () => providerFetch("http://localhost:11434/v1/chat/completions"),
            OutboundRequestBlockedError,
            "internal host",
          );
        },
      );
    });

    assertEquals(calls, 0);
  });

  it("rejects malformed internal provider origin configuration", async () => {
    for (
      const value of [
        "localhost:11434",
        "file:///tmp/provider",
        "http://user:secret@localhost:11434",
        "http://localhost:11434/v1",
        "http://localhost:11434?mode=dev",
        "http://localhost:11434#local",
      ]
    ) {
      await withEnv({ [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: value }, async () => {
        assertThrows(
          () =>
            createTestBoundary(() => Promise.resolve(Response.json({ ok: true })))
              .createOriginBoundFetch("http://localhost:11434/v1"),
          TypeError,
          HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
        );
      });
    }
  });
});
