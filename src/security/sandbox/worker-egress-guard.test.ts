import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit } from "#veryfront/testing/mock-fetch.ts";
import { DnsPermissionError } from "#veryfront/platform/compat/dns.ts";
import {
  assertWorkerEgressAllowed,
  assertWorkerHostEgressAllowed,
  guardedEgressFetch,
  guardedWorkerConnect,
  guardedWorkerConnectTls,
  isInternalEgressIp,
  isInternalEgressOverrideEnabled,
  startWorkerEgressBroker,
  startWorkerEgressSocksProxy,
  WORKER_INTERNAL_EGRESS_ALLOWED_HOSTS_ENV,
  WORKER_INTERNAL_EGRESS_OVERRIDE_ENV,
  WorkerEgressBlockedError,
} from "./worker-egress-guard.ts";
import type { WorkerEgressFetch } from "./worker-egress-guard.ts";

async function beforeDeadline<T>(
  operation: Promise<T>,
  message: string,
  timeoutMs = 2_000,
): Promise<T> {
  let timeout: number | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

function closeTestConnection(connection: Deno.Conn): void {
  try {
    connection.close();
  } catch {
    // The proxy may already have closed the peer during admission or shutdown.
  }
}

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

  it("allows hostnames on the trusted internal allowlist even when they resolve internal", async () => {
    await assertWorkerHostEgressAllowed("api.veryfront.org", {
      allowedInternalHosts: ["api.veryfront.org"],
      resolveHost: () => Promise.resolve(["10.255.128.3"]),
    });
  });

  it("ignores IP literals and localhost names on the allowlist", async () => {
    await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("169.254.169.254", {
          allowedInternalHosts: ["169.254.169.254"],
        }),
      WorkerEgressBlockedError,
      "internal host",
    );
    await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("localhost", {
          allowedInternalHosts: ["localhost"],
          resolveHost: () => Promise.resolve(["127.0.0.1"]),
        }),
      WorkerEgressBlockedError,
      "internal host",
    );
  });

  it("normalizes explicit allowlist entries for case and whitespace", async () => {
    await assertWorkerHostEgressAllowed("api.veryfront.org", {
      allowedInternalHosts: [" API.VERYFRONT.ORG "],
      resolveHost: () => Promise.resolve(["10.255.128.3"]),
    });
    await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("db.veryfront.org", {
          allowedInternalHosts: [" API.VERYFRONT.ORG "],
          resolveHost: () => Promise.resolve(["10.255.128.3"]),
        }),
      WorkerEgressBlockedError,
      "blocked for host",
    );
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

  it("forwards a DNS permission diagnosis as a blocked-egress message", async () => {
    // The broker boundary forwards only WorkerEgressBlockedError messages and
    // collapses everything else into a generic failure, so the permission
    // diagnosis must be translated at the guard or it never reaches the
    // consumer (veryfront-issue-inbox#744).
    const permissionError = new DnsPermissionError(
      'net access to the DNS resolver is not permitted while resolving "api.example.com"',
    );
    const error = await assertRejects(
      () =>
        assertWorkerHostEgressAllowed("api.example.com", {
          resolveHost: () => Promise.reject(permissionError),
        }),
      WorkerEgressBlockedError,
      "net access to the DNS resolver is not permitted",
    );
    assertEquals(
      (error as Error & { cause?: unknown }).cause,
      permissionError,
      "the resolver's permission error must stay on the cause chain",
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
    assertEquals(
      WORKER_INTERNAL_EGRESS_ALLOWED_HOSTS_ENV,
      "VERYFRONT_WORKER_ALLOWED_INTERNAL_HOSTS",
    );
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

describe("worker-egress-guard admission and shutdown", () => {
  it("caps simultaneous SOCKS handshakes and drains admitted handlers on close", async () => {
    const proxy = startWorkerEgressSocksProxy({ allowInternalEgress: true });
    const connections: Deno.TcpConn[] = [];

    try {
      connections.push(
        ...await beforeDeadline(
          Promise.all(
            Array.from(
              { length: 64 },
              () =>
                Deno.connect({
                  hostname: proxy.config.hostname,
                  port: proxy.config.port,
                }),
            ),
          ),
          "SOCKS admission flood did not connect in time",
        ),
      );

      const outcomes = await beforeDeadline(
        Promise.all(
          connections.map(async (connection): Promise<"admitted" | "rejected"> => {
            const greeting = new Uint8Array([0x05, 0x01, 0x02]);
            let written = 0;
            try {
              while (written < greeting.length) {
                written += await connection.write(greeting.subarray(written));
              }
              const response = new Uint8Array(2);
              const read = await connection.read(response);
              return read === 2 && response[0] === 0x05 && response[1] === 0x02
                ? "admitted"
                : "rejected";
            } catch {
              return "rejected";
            }
          }),
        ),
        "SOCKS admission decisions did not settle in time",
      );

      const admitted = outcomes.filter((outcome) => outcome === "admitted").length;
      const rejected = outcomes.length - admitted;
      assert(admitted > 0, "the proxy must admit work below its cap");
      assert(admitted <= 32, "the proxy admitted more than its structural cap");
      assert(rejected >= 32, "the proxy did not reject the excess flood");

      proxy.close();
      await beforeDeadline(proxy.closed, "SOCKS proxy did not drain after close");
      const endOfStreams = await beforeDeadline(
        Promise.all(
          connections.map((connection) => connection.read(new Uint8Array(1)).catch(() => null)),
        ),
        "SOCKS connections remained open after proxy drain",
      );
      assertEquals(endOfStreams.every((read) => read === null), true);
    } finally {
      proxy.close();
      await proxy.closed;
      for (const connection of connections) closeTestConnection(connection);
    }
  });

  it("rejects broker requests above the per-worker admission cap", async () => {
    const releaseResponses = Promise.withResolvers<void>();
    const admissionFilled = Promise.withResolvers<void>();
    let activeTargets = 0;
    let peakTargets = 0;
    const targetServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      async () => {
        activeTargets++;
        peakTargets = Math.max(peakTargets, activeTargets);
        if (activeTargets === 32) admissionFilled.resolve();
        try {
          await releaseResponses.promise;
          return new Response("ok");
        } finally {
          activeTargets--;
        }
      },
    );
    const targetAddress = targetServer.addr;
    if (targetAddress.transport !== "tcp") {
      await targetServer.shutdown();
      throw new Error("expected a TCP target server");
    }

    const broker = startWorkerEgressBroker({ allowInternalEgress: true });
    const requests = Array.from(
      { length: 64 },
      () =>
        guardedEgressFetch(`http://127.0.0.1:${targetAddress.port}/`, undefined, {
          options: { httpBroker: broker.config.httpBroker },
        }),
    );
    const settledRequests = Promise.allSettled(requests);

    try {
      await beforeDeadline(
        admissionFilled.promise,
        "broker did not fill its bounded admission window",
      );
      releaseResponses.resolve();
      const results = await beforeDeadline(
        settledRequests,
        "broker flood did not settle after releasing admitted requests",
      );
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Response> => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      assertEquals(peakTargets, 32);
      assertEquals(fulfilled.length, 32);
      assertEquals(rejected.length, 32);
      assertEquals(
        rejected.every((result) =>
          result.reason instanceof WorkerEgressBlockedError &&
          result.reason.message.includes("admission limit")
        ),
        true,
      );
      await Promise.all(
        fulfilled.map((result) => result.value.body?.cancel().catch(() => undefined)),
      );
    } finally {
      releaseResponses.resolve();
      broker.close();
      await beforeDeadline(
        Promise.all([broker.closed, settledRequests]).then(() => undefined),
        "broker flood did not drain during cleanup",
      );
      await targetServer.shutdown();
    }
  });

  it("rejects broker requests without the per-broker authentication token", async () => {
    let upstreamHits = 0;
    const targetServer = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      () => {
        upstreamHits++;
        return new Response("ok");
      },
    );
    const targetAddress = targetServer.addr;
    if (targetAddress.transport !== "tcp") {
      await targetServer.shutdown();
      throw new Error("expected a TCP target server");
    }

    const broker = startWorkerEgressBroker({ allowInternalEgress: true });

    try {
      for (const forgedToken of [undefined, "wrong-token"]) {
        const headers = new Headers({
          "x-veryfront-egress-target": `http://127.0.0.1:${targetAddress.port}/`,
        });
        if (forgedToken !== undefined) {
          headers.set("x-veryfront-egress-auth", forgedToken);
        }

        const response = await beforeDeadline(
          fetch(broker.config.httpBroker.url, { headers }),
          "the broker did not answer an unauthenticated request",
        );
        const body = await response.text();

        assertEquals(
          response.status,
          403,
          "the broker must reject an unauthenticated egress request",
        );
        assertEquals(
          response.headers.get("x-veryfront-egress-error"),
          "1",
          "the rejection must be marked as a broker error",
        );
        assertStringIncludes(
          body,
          "authentication failed",
          "the rejection must name the broker authentication gate",
        );
      }

      assertEquals(
        upstreamHits,
        0,
        "no upstream request may be made for an unauthenticated broker call",
      );
    } finally {
      broker.close();
      await beforeDeadline(broker.closed, "broker did not drain after close");
      await targetServer.shutdown();
    }
  });

  it("aborts and drains a broker request stalled during SOCKS resolution", async () => {
    const resolutionStarted = Promise.withResolvers<void>();
    // The target must be a loopback name: `fetch` checks --allow-net against
    // the URL host even when the connection only ever reaches the loopback
    // SOCKS proxy, so a non-loopback name cannot run on the loopback-only
    // unit lane (veryfront-issue-inbox#714). `localhost` still resolves
    // through the injected (stalled) resolver; allowInternalEgress lets it
    // past the internal-host gate so the stall is reached at all.
    const broker = startWorkerEgressBroker({
      allowInternalEgress: true,
      resolveHost: () => {
        resolutionStarted.resolve();
        return new Promise<string[]>(() => {});
      },
    });
    const pending = guardedEgressFetch("http://localhost/", undefined, {
      options: { httpBroker: broker.config.httpBroker },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    try {
      await beforeDeadline(
        resolutionStarted.promise,
        "stalled broker request did not reach host resolution",
      );
      broker.close();
      await beforeDeadline(broker.closed, "broker did not drain its stalled request");
      assert(await pending instanceof Error);
    } finally {
      broker.close();
      await broker.closed;
    }
  });
});

describe("worker-egress-guard guardedEgressFetch redirect handling", () => {
  function redirectTo(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } });
  }

  it("uses an injected pinned transport only after validating resolved addresses", async () => {
    let fallbackFetchCalls = 0;
    let pinnedFetchCalls = 0;
    const response = await guardedEgressFetch(
      "https://public.example/resource",
      undefined,
      {
        fetchImpl: () => {
          fallbackFetchCalls++;
          return Promise.resolve(new Response("unexpected"));
        },
        pinnedFetch(url, addresses, init) {
          pinnedFetchCalls++;
          assertEquals(url.href, "https://public.example/resource");
          assertEquals(addresses, ["93.184.216.34"]);
          assertEquals(init.redirect, "manual");
          return Promise.resolve(new Response("pinned"));
        },
        options: {
          resolveHost: () => Promise.resolve(["93.184.216.34"]),
        },
      },
    );

    assertEquals(await response.text(), "pinned");
    assertEquals(pinnedFetchCalls, 1);
    assertEquals(fallbackFetchCalls, 0);
  });

  it("rejects unsafe addresses before invoking an injected pinned transport", async () => {
    let pinnedFetchCalls = 0;
    await assertRejects(
      () =>
        guardedEgressFetch("https://public.example/resource", undefined, {
          pinnedFetch() {
            pinnedFetchCalls++;
            return Promise.resolve(new Response("unexpected"));
          },
          options: {
            resolveHost: () => Promise.resolve(["10.0.0.8"]),
          },
        }),
      WorkerEgressBlockedError,
      "blocked for host",
    );
    assertEquals(pinnedFetchCalls, 0);
  });

  it("cancels a late pinned response when the transport ignores abort", async () => {
    const controller = new AbortController();
    const transportStarted = Promise.withResolvers<void>();
    const lateResponse = Promise.withResolvers<Response>();
    const bodyCancelled = Promise.withResolvers<void>();
    const pending = guardedEgressFetch(
      "https://public.example/resource",
      { signal: controller.signal },
      {
        pinnedFetch() {
          transportStarted.resolve();
          return lateResponse.promise;
        },
        options: {
          resolveHost: () => Promise.resolve(["93.184.216.34"]),
        },
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    await transportStarted.promise;
    const abortReason = new Error("test abort");
    controller.abort(abortReason);
    assertEquals(await pending, abortReason);

    lateResponse.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            bodyCancelled.resolve();
          },
        }),
      ),
    );
    await beforeDeadline(
      bodyCancelled.promise,
      "late pinned response body was not cancelled",
    );
  });

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
      // The URL host must be a loopback name: `fetch` checks --allow-net
      // against it even though the connection goes through the pinned SOCKS
      // tunnel on 127.0.0.1, so a non-loopback name cannot run on the
      // loopback-only unit lane (veryfront-issue-inbox#714). The resolver
      // call count keeps the pinned path observable: the tunnel must be built
      // from the injected resolution, not from a direct system lookup.
      let resolveHostCalls = 0;
      const response = await guardedEgressFetch(
        `http://localhost:${address.port}/data`,
        undefined,
        {
          fetchImpl: globalThis.fetch.bind(globalThis),
          options: {
            allowInternalEgress: true,
            resolveHost: () => {
              resolveHostCalls++;
              return Promise.resolve(["127.0.0.1"]);
            },
          },
        },
      );
      assertEquals(await response.text(), "ab");
      assertEquals(resolveHostCalls, 1, "the guard must pin through the injected resolver");
    } finally {
      await server.shutdown();
    }
  });

  it("blocks a public URL that redirects to an internal address", async () => {
    let calls = 0;
    const fetchImpl: WorkerEgressFetch = (input) => {
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

  it("streams request bodies unless a redirect could force a replay", async () => {
    const streamBody = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("payload"));
          controller.close();
        },
      });

    // A stream reaches the guard either on a Request or through `init.body`.
    // Both have to obey the same rule, or a followed 307/308 hits
    // isReplayableBody and the hop is refused.
    const capture = async (redirect: RequestRedirect, source: "request" | "init") => {
      let seen: unknown;
      const fetchImpl: WorkerEgressFetch = (_input, init) => {
        seen = init?.body;
        return Promise.resolve(new Response(null, { status: 204 }));
      };
      if (source === "request") {
        const request = new Request("http://93.184.216.34/upload", {
          method: "POST",
          body: streamBody(),
          duplex: "half",
        } as unknown as RequestInit);
        await guardedEgressFetch(request, { redirect }, { fetchImpl });
      } else {
        await guardedEgressFetch("http://93.184.216.34/upload", {
          method: "POST",
          body: streamBody(),
          redirect,
          duplex: "half",
        } as unknown as RequestInit, { fetchImpl });
      }
      return seen;
    };

    for (const source of ["request", "init"] as const) {
      // Nothing can replay the body, so hand the stream to the transport as-is
      // rather than materializing an upload in memory.
      assert((await capture("error", source)) instanceof ReadableStream, `${source}/error`);
      // A redirect hop would have to resend it, so it must be buffered.
      assert((await capture("follow", source)) instanceof Uint8Array, `${source}/follow`);
    }
  });

  it("follows a public -> public redirect chain and returns the final response", async () => {
    const fetchImpl: WorkerEgressFetch = (input) => {
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
    const fetchImpl: WorkerEgressFetch = () =>
      Promise.resolve(redirectTo("http://169.254.169.254/x"));
    const res = await guardedEgressFetch(
      "http://93.184.216.34/a",
      { redirect: "manual" },
      { fetchImpl },
    );
    assertEquals(res.status, 302);
  });

  it("cancels an unexposed redirect body when redirect mode is 'error'", async () => {
    let cancellations = 0;
    const fetchImpl: WorkerEgressFetch = () =>
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
    const fetchImpl: WorkerEgressFetch = () =>
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

  it("strips bearer, cookie, and provider credentials on a cross-origin redirect", async () => {
    const credentialHeaders = [
      "authorization",
      "cookie",
      "proxy-authorization",
      "x-api-key",
      "api-key",
      "x-auth-token",
      "x-goog-api-key",
    ] as const;
    const seen: Array<Record<string, string | null>> = [];
    const fetchImpl: WorkerEgressFetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const headers = new Headers(observeFetchRequestInit(init).headers);
      seen.push(Object.fromEntries(credentialHeaders.map((name) => [name, headers.get(name)])));
      if (url === "http://93.184.216.34/start") {
        return Promise.resolve(redirectTo("http://93.184.216.35/landing"));
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    const res = await guardedEgressFetch(
      "http://93.184.216.34/start",
      {
        headers: Object.fromEntries(
          credentialHeaders.map((name) => [name, `${name}-secret`]),
        ),
      },
      { fetchImpl },
    );
    assertEquals(res.status, 200);
    assertEquals(
      seen[0],
      Object.fromEntries(credentialHeaders.map((name) => [name, `${name}-secret`])),
    );
    assertEquals(
      seen[1],
      Object.fromEntries(credentialHeaders.map((name) => [name, null])),
    );
  });

  it("preserves Authorization on a same-origin redirect", async () => {
    const seen: Array<string | null> = [];
    const fetchImpl: WorkerEgressFetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      seen.push(new Headers(observeFetchRequestInit(init).headers).get("authorization"));
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
      const fetchImpl: WorkerEgressFetch = (_input, init) => {
        const observedInit = observeFetchRequestInit(init);
        seen.push({ method: observedInit.method, body: observedInit.body });
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
    const fetchImpl: WorkerEgressFetch = (_input, init) => {
      seenHeaders.push(new Headers(observeFetchRequestInit(init).headers));
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
    const fetchImpl: WorkerEgressFetch = (input) => {
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
    const fetchImpl: WorkerEgressFetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      seenSignals.push(observeFetchRequestInit(init).signal);
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
    const fetchImpl: WorkerEgressFetch = (_input, init) => {
      seenSignal = observeFetchRequestInit(init).signal;
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    await guardedEgressFetch(request, undefined, { fetchImpl });
    assertEquals(seenSignal instanceof AbortSignal, true);
    assertEquals(seenSignal, request.signal);
  });
});
