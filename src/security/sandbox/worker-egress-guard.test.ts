import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertWorkerEgressAllowed,
  assertWorkerHostEgressAllowed,
  guardedEgressFetch,
  guardedWorkerConnect,
  guardedWorkerConnectTls,
  isInternalEgressIp,
  isInternalEgressOverrideEnabled,
  WORKER_INTERNAL_EGRESS_OVERRIDE_ENV,
  WorkerEgressBlockedError,
} from "./worker-egress-guard.ts";

describe("worker-egress-guard", () => {
  it("identifies loopback, metadata, private, and link-local addresses", () => {
    assertEquals(isInternalEgressIp("127.0.0.1"), true);
    assertEquals(isInternalEgressIp("169.254.169.254"), true);
    assertEquals(isInternalEgressIp("169.254.1.2"), true);
    assertEquals(isInternalEgressIp("10.1.2.3"), true);
    assertEquals(isInternalEgressIp("172.16.0.1"), true);
    assertEquals(isInternalEgressIp("172.31.255.255"), true);
    assertEquals(isInternalEgressIp("192.168.1.10"), true);
    assertEquals(isInternalEgressIp("::1"), true);
    assertEquals(isInternalEgressIp("fe80::1"), true);
    assertEquals(isInternalEgressIp("fd00::1"), true);
    assertEquals(isInternalEgressIp("93.184.216.34"), false);
    assertEquals(isInternalEgressIp("2606:2800:220:1:248:1893:25c8:1946"), false);
  });

  it("identifies CGNAT (100.64.0.0/10), benchmarking (198.18.0.0/15), and 0.0.0.0 as internal", () => {
    // 0.0.0.0 — unspecified address
    assertEquals(isInternalEgressIp("0.0.0.0"), true);
    // 100.64.0.0/10 — CGNAT shared address space (RFC 6598), b in [64, 127]
    assertEquals(isInternalEgressIp("100.64.0.1"), true);
    assertEquals(isInternalEgressIp("100.127.255.255"), true);
    // 198.18.0.0/15 — benchmarking range (RFC 2544), b in {18, 19}
    assertEquals(isInternalEgressIp("198.18.0.1"), true);
    assertEquals(isInternalEgressIp("198.19.255.255"), true);
    // Public addresses just outside the CGNAT range boundaries
    assertEquals(isInternalEgressIp("100.63.255.255"), false);
    assertEquals(isInternalEgressIp("100.128.0.1"), false);
    // Well-known public DNS servers
    assertEquals(isInternalEgressIp("8.8.8.8"), false);
    assertEquals(isInternalEgressIp("1.1.1.1"), false);
  });

  it("blocks non-global IPv4 and IPv6 ranges", () => {
    for (
      const address of [
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "239.255.255.255",
        "240.0.0.1",
        "255.255.255.255",
        "64:ff9b::a00:1",
        "64:ff9b:1::a00:1",
        "100::1",
        "2001::1",
        "2001:2::1",
        "2001:10::1",
        "2001:20::1",
        "2001:100::1",
        "2001:db8::1",
        "2002:0a00:1::1",
        "3fff::1",
        "3fff:fff::1",
        "fec0::1",
        "ff02::1",
      ]
    ) {
      assertEquals(isInternalEgressIp(address), true, address);
    }
    assertEquals(isInternalEgressIp("8.8.4.4"), false);
    assertEquals(isInternalEgressIp("2001:200::1"), false);
    assertEquals(isInternalEgressIp("2001:4860:4860::8888"), false);
  });

  it("identifies hexadecimal IPv4-mapped IPv6 forms of internal addresses", () => {
    assertEquals(isInternalEgressIp("::ffff:7f00:1"), true);
    assertEquals(isInternalEgressIp("::ffff:a00:1"), true);
    assertEquals(isInternalEgressIp("::ffff:a9fe:a9fe"), true);
    assertEquals(isInternalEgressIp("::ffff:6440:1"), true);
    assertEquals(isInternalEgressIp("::ffff:c612:1"), true);
    assertEquals(isInternalEgressIp("::ffff:5db8:d822"), false);
  });

  it("blocks a URL containing a hexadecimal IPv4-mapped loopback address", async () => {
    await assertRejects(
      () => assertWorkerEgressAllowed("http://[::ffff:7f00:1]/"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
  });

  it("does not let malformed IPv6 syntax bypass hostname resolution", async () => {
    let resolutionCount = 0;
    for (const hostname of ["2001:::1", "2001::1:"]) {
      await assertRejects(
        () =>
          assertWorkerHostEgressAllowed(hostname, {
            resolveHost: () => {
              resolutionCount++;
              return Promise.resolve(["127.0.0.1"]);
            },
          }),
        WorkerEgressBlockedError,
        "blocked for host",
      );
    }
    assertEquals(resolutionCount, 2);
  });

  it("blocks direct metadata, private, link-local, and localhost targets", async () => {
    await assertRejects(
      () => assertWorkerEgressAllowed("http://169.254.169.254/latest/meta-data/"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
    await assertRejects(
      () => assertWorkerEgressAllowed("http://10.0.0.5/private"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
    await assertRejects(
      () => assertWorkerEgressAllowed("http://[fe80::1]/"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
    await assertRejects(
      () => assertWorkerEgressAllowed("http://localhost/internal"),
      WorkerEgressBlockedError,
      "Worker network egress blocked",
    );
  });

  it("allows public direct IP targets", async () => {
    await assertWorkerEgressAllowed("https://93.184.216.34/");
    await assertWorkerEgressAllowed("https://[2606:2800:220:1:248:1893:25c8:1946]/");
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("tenant.example", {
          resolveHost: () => Promise.resolve(["10.1.2.3"]),
        }),
      WorkerEgressBlockedError,
      "blocked for host",
    );
  });

  it("allows hostnames that resolve only to public addresses", async () => {
    await assertWorkerHostEgressAllowed("api.example.com", {
      resolveHost: () => Promise.resolve(["93.184.216.34"]),
    });
  });

  it("requires hostname resolution by default", async () => {
    await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("api.example.com", {
          resolveHost: () => Promise.resolve([]),
        }),
      WorkerEgressBlockedError,
      "unable to resolve host",
    );
  });

  it("allows internal targets only when the self-hosted override is enabled", async () => {
    await assertWorkerEgressAllowed("http://127.0.0.1:3000/internal", {
      allowInternalEgress: true,
      resolveHost: () => Promise.resolve(["127.0.0.1"]),
    });
  });

  it("parses the explicit internal egress override env value", () => {
    assertEquals(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV, "VERYFRONT_WORKER_ALLOW_INTERNAL_EGRESS");
    assertEquals(isInternalEgressOverrideEnabled("1"), true);
    assertEquals(isInternalEgressOverrideEnabled("true"), true);
    assertEquals(isInternalEgressOverrideEnabled("yes"), true);
    assertEquals(isInternalEgressOverrideEnabled("on"), true);
    assertEquals(isInternalEgressOverrideEnabled("0"), false);
    assertEquals(isInternalEgressOverrideEnabled(undefined), false);
  });

  it("pins raw TLS to the validated IP while preserving the original TLS hostname", async () => {
    const tcpConnection = {} as Deno.TcpConn;
    const tlsConnection = {} as Deno.TlsConn;
    let connected: Deno.ConnectOptions | undefined;
    let tlsOptions: Deno.StartTlsOptions | undefined;

    const result = await guardedWorkerConnectTls(
      {
        hostname: "api.example.com",
        port: 443,
        caCerts: ["<TEST_CA>"],
        alpnProtocols: ["h2", "http/1.1"],
      },
      { resolveHost: () => Promise.resolve(["93.184.216.34"]) },
      {
        connect: (options) => {
          connected = options;
          return Promise.resolve(tcpConnection);
        },
        startTls: (connection, options) => {
          assertEquals(connection, tcpConnection);
          tlsOptions = options;
          return Promise.resolve(tlsConnection);
        },
      },
    );

    assertEquals(result, tlsConnection);
    assertEquals(connected?.hostname, "93.184.216.34");
    assertEquals(connected?.port, 443);
    assertEquals(tlsOptions?.hostname, "api.example.com");
    assertEquals(tlsOptions?.caCerts, ["<TEST_CA>"]);
    assertEquals(tlsOptions?.alpnProtocols, ["h2", "http/1.1"]);
  });

  it("fails closed for raw TLS client certificates that startTls cannot preserve", async () => {
    await assertRejects(
      () =>
        guardedWorkerConnectTls({
          hostname: "api.example.com",
          port: 443,
          cert: "<TEST_CERT>",
          key: "<TEST_KEY>",
        }),
      WorkerEgressBlockedError,
      "client certificates are unavailable",
    );
  });

  it("settles a raw connect when DNS resolution is aborted", async () => {
    const controller = new AbortController();
    let rejectResolution: ((error: Error) => void) | undefined;
    const pending = guardedWorkerConnect(
      {
        hostname: "stalled.invalid",
        port: 443,
        signal: controller.signal,
      },
      {
        resolveHost: () =>
          new Promise<string[]>((_resolve, reject) => {
            rejectResolution = reject;
          }),
      },
      {
        connect: () => {
          throw new Error("connect must not run after DNS cancellation");
        },
      },
    );

    controller.abort(new Error("DNS lookup cancelled"));
    await assertRejects(() => pending, Error, "DNS lookup cancelled");

    // A late resolver rejection is consumed by the abort race.
    rejectResolution?.(new Error("late DNS failure"));
    await Promise.resolve();
  });
});

describe("worker-egress-guard guardedEgressFetch redirect handling", () => {
  function redirectTo(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } });
  }

  it("keeps non-network fetch schemes out of the HTTP broker", async () => {
    let seenInput = "";
    const response = await guardedEgressFetch("data:text/plain,hello", undefined, {
      fetchImpl: (input) => {
        seenInput = String(input);
        return Promise.resolve(new Response("hello"));
      },
      options: {
        httpBroker: { url: "http://127.0.0.1:1/fetch", token: "<TOKEN>" },
      },
    });
    assertEquals(seenInput, "data:text/plain,hello");
    assertEquals(await response.text(), "hello");
  });

  it("keeps the pinned tunnel alive until a streaming response finishes", async () => {
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("a"));
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode("b"));
                controller.close();
              }, 25);
            },
          }),
        ),
    );
    const address = server.addr;
    if (address.transport !== "tcp") throw new Error("expected TCP test server");

    try {
      const response = await guardedEgressFetch(
        `http://stream.invalid:${address.port}/data`,
        undefined,
        {
          fetchImpl: globalThis.fetch.bind(globalThis),
          options: {
            allowInternalEgress: true,
            resolveHost: () => Promise.resolve(["127.0.0.1"]),
          },
        },
      );
      assertEquals(await response.text(), "ab");
    } finally {
      await server.shutdown();
    }
  });

  it("blocks a public URL that redirects to an internal address", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (input) => {
      calls++;
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("http://93.184.216.34")) {
        return Promise.resolve(redirectTo("http://169.254.169.254/latest/meta-data"));
      }
      throw new Error(`fetch should not have been called for ${url}`);
    };

    await assertRejects(
      () => guardedEgressFetch("http://93.184.216.34/start", undefined, { fetchImpl }),
      WorkerEgressBlockedError,
    );
    // The internal redirect target must never be fetched.
    assertEquals(calls, 1);
  });

  it("follows a public -> public redirect chain and returns the final response", async () => {
    const fetchImpl: typeof fetch = (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "http://93.184.216.34/a") {
        return Promise.resolve(redirectTo("http://93.184.216.35/b"));
      }
      if (url === "http://93.184.216.35/b") {
        return Promise.resolve(new Response("ok", { status: 200 }));
      }
      throw new Error(`unexpected fetch to ${url}`);
    };

    const res = await guardedEgressFetch("http://93.184.216.34/a", undefined, { fetchImpl });
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
    assertEquals(res.url, "http://93.184.216.35/b");
    assertEquals(res.redirected, true);
  });

  it("returns the redirect unfollowed when redirect mode is 'manual'", async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(redirectTo("http://169.254.169.254/x"));
    const res = await guardedEgressFetch(
      "http://93.184.216.34/a",
      { redirect: "manual" },
      { fetchImpl },
    );
    assertEquals(res.status, 302);
  });

  it("cancels an unexposed redirect body when redirect mode is 'error'", async () => {
    let cancellations = 0;
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancellations++;
            },
          }),
          { status: 302, headers: { location: "http://93.184.216.34/next" } },
        ),
      );

    await assertRejects(
      () =>
        guardedEgressFetch(
          "http://93.184.216.34/start",
          { redirect: "error" },
          { fetchImpl },
        ),
      WorkerEgressBlockedError,
    );
    assertEquals(cancellations, 1);
  });

  it("throws after exceeding the maximum redirect count", async () => {
    let cancellations = 0;
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancellations++;
            },
          }),
          { status: 302, headers: { location: "http://93.184.216.34/loop" } },
        ),
      );
    await assertRejects(
      () => guardedEgressFetch("http://93.184.216.34/loop", undefined, { fetchImpl }),
      WorkerEgressBlockedError,
    );
    assertEquals(cancellations, 21);
  });

  it("strips Authorization and Cookie on a cross-origin redirect", async () => {
    const seen: Array<{ auth: string | null; cookie: string | null }> = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const headers = new Headers(init?.headers);
      seen.push({ auth: headers.get("authorization"), cookie: headers.get("cookie") });
      if (url === "http://93.184.216.34/start") {
        return Promise.resolve(redirectTo("http://93.184.216.35/landing"));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    const res = await guardedEgressFetch(
      "http://93.184.216.34/start",
      { headers: { Authorization: "Bearer secret", Cookie: "sid=abc" } },
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    assertEquals(seen[0], { auth: "Bearer secret", cookie: "sid=abc" });
    assertEquals(seen[1], { auth: null, cookie: null });
  });

  it("preserves Authorization on a same-origin redirect", async () => {
    const seen: Array<string | null> = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      seen.push(new Headers(init?.headers).get("authorization"));
      if (url === "http://93.184.216.34/a") {
        return Promise.resolve(redirectTo("http://93.184.216.34/b"));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    await guardedEgressFetch(
      "http://93.184.216.34/a",
      { headers: { Authorization: "Bearer secret" } },
      { fetchImpl },
    );
    assertEquals(seen[0], "Bearer secret");
    assertEquals(seen[1], "Bearer secret");
  });

  it("applies the Fetch redirect method and body rules", async () => {
    const cases: Array<{
      status: number;
      method: string;
      body?: string;
      expectedMethod: string;
      expectedBody?: string;
    }> = [
      { status: 301, method: "POST", body: "post-body", expectedMethod: "GET" },
      {
        status: 302,
        method: "PUT",
        body: "put-body",
        expectedMethod: "PUT",
        expectedBody: "put-body",
      },
      { status: 303, method: "PATCH", body: "patch-body", expectedMethod: "GET" },
      { status: 303, method: "HEAD", expectedMethod: "HEAD" },
    ];

    for (const testCase of cases) {
      const seen: Array<{ method: string | undefined; body: BodyInit | null | undefined }> = [];
      let calls = 0;
      const fetchImpl: typeof fetch = (_input, init) => {
        seen.push({ method: init?.method, body: init?.body });
        calls++;
        return Promise.resolve(
          calls === 1
            ? redirectTo("http://93.184.216.34/landing", testCase.status)
            : new Response(null, { status: 200 }),
        );
      };

      await guardedEgressFetch(
        "http://93.184.216.34/start",
        { method: testCase.method, body: testCase.body },
        { fetchImpl },
      );

      assertEquals(seen, [
        { method: testCase.method, body: testCase.body },
        { method: testCase.expectedMethod, body: testCase.expectedBody },
      ]);
    }
  });

  it("removes request body headers when a redirect downgrades to GET", async () => {
    const seenHeaders: Headers[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = (_input, init) => {
      seenHeaders.push(new Headers(init?.headers));
      calls++;
      return Promise.resolve(
        calls === 1
          ? redirectTo("http://93.184.216.34/landing", 303)
          : new Response(null, { status: 200 }),
      );
    };

    await guardedEgressFetch(
      "http://93.184.216.34/start",
      {
        method: "POST",
        body: "payload",
        headers: {
          "content-encoding": "gzip",
          "content-language": "en",
          "content-location": "/source",
          "content-type": "text/plain",
        },
      },
      { fetchImpl },
    );

    for (
      const header of [
        "content-encoding",
        "content-language",
        "content-location",
        "content-type",
      ]
    ) {
      assertEquals(seenHeaders[0]?.get(header) !== null, true);
      assertEquals(seenHeaders[1]?.get(header), null);
    }
  });

  it("blocks a redirect to a non-http(s) scheme (e.g. file://)", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (input) => {
      calls++;
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("http://93.184.216.34")) {
        return Promise.resolve(redirectTo("file:///etc/passwd"));
      }
      throw new Error(`fetch should not have been called for ${url}`);
    };

    await assertRejects(
      () => guardedEgressFetch("http://93.184.216.34/start", undefined, { fetchImpl }),
      WorkerEgressBlockedError,
    );
    // The file:// target must never be fetched (would be a local file read).
    assertEquals(calls, 1);
  });

  it("preserves the abort signal across redirect hops", async () => {
    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      seenSignals.push(init?.signal);
      if (url === "http://93.184.216.34/a") {
        return Promise.resolve(redirectTo("http://93.184.216.35/b"));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    await guardedEgressFetch(
      "http://93.184.216.34/a",
      { signal: controller.signal },
      { fetchImpl },
    );
    assertEquals(seenSignals[0], controller.signal);
    assertEquals(seenSignals[1], controller.signal);
  });

  it("preserves request options (signal) from a Request input", async () => {
    const controller = new AbortController();
    // A Request wraps the passed signal in its own (following) AbortSignal, so we
    // compare against request.signal, not controller.signal.
    const request = new Request("http://93.184.216.34/a", { signal: controller.signal });
    let seenSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      seenSignal = init?.signal;
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    await guardedEgressFetch(request, undefined, { fetchImpl });
    assertEquals(seenSignal instanceof AbortSignal, true);
    assertEquals(seenSignal, request.signal);
  });
});
