import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { createRequire } from "node:module";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import {
  applyRuntimeDefaultRequestHeaders,
  createPinnedFetchResponse,
  DEFAULT_OUTBOUND_USER_AGENT,
  fetchWithPinnedAddresses,
  isReplayableRequestBody,
  isRetriableConnectFailure,
  planPinnedConnectAttempts,
} from "./pinned-fetch.ts";
import { copyNativeHeaders } from "./native-request-init.ts";
import {
  installArrayWriteProbe,
  installCredentialProbes,
} from "#veryfront/security/http/credential-probes.test-helpers.ts";

// Probe tests pin what Deno 2.7.7's own Request and fetch call through the
// live prototypes; Node's undici and Bun take different internal paths.
const DENO_INTERNALS = { ignore: !isDeno };
const requireNode = createRequire(import.meta.url);

const PINNED_ABORT_TEST_CERTIFICATE = {
  cert: `-----BEGIN CERTIFICATE-----
MIIDNzCCAh+gAwIBAgIUejX9XrRH7oNOysUGD2Mj5eicg4kwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRcGlubmVkLWFib3J0LnRlc3QwHhcNMjYxMDA3MDAyMzM3
WhcNMzYxMDA0MDAyMzM3WjAcMRowGAYDVQQDDBFwaW5uZWQtYWJvcnQudGVzdDCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALpANpwil+MGedqozKRfoL9s
EEQx4BphW0pl2CfRg33Xt9gl6+oi7o8Er34LEri4Vn8bcI5039ufJstYz2OAidUv
RR98GhJ2HlRLXmTumdGO0HnJYgk80jLn1LtPSUasY765aSvqcFNX6tChSM6V7Kh7
gPfL0uMRWPEYPqOy2XNZ/2J6zp5Hv/p69y8xhbQz/3uAjuqbHr8GD9hjx3Ar6yOs
Qr/Cj/PjhDo3WMpePNR83ozTZG9Q0uPSKP2MOfOIaDyWx/5XIdG9VT/ig/2/3at8
MHHb379chBKDfbRcmVSA9gAQ+EkdIWQfWsm4HKnHyneAdAf+XiERNNus1UVH05sC
AwEAAaNxMG8wHQYDVR0OBBYEFJ4tAKoPTCl1PMOhbNhkMLZgBM6ZMB8GA1UdIwQY
MBaAFJ4tAKoPTCl1PMOhbNhkMLZgBM6ZMA8GA1UdEwEB/wQFMAMBAf8wHAYDVR0R
BBUwE4IRcGlubmVkLWFib3J0LnRlc3QwDQYJKoZIhvcNAQELBQADggEBAJujERSH
9BzW7Wdo2xhnjb6JyRJym7Ha8XOHtq1QMrVr13evIsmgx8hSvbjGI9Rbs2/OzFX/
DkdbdYXAvEFOWNkpGQ5JxVMO8DDcRfKQMQ30bLasTp6uKaADrimjsp/za/Rulmyf
tw3vjxSDd+WS0FtSxWETLz1C8mlSWj9rGxUtGA8cs9Hv7fkWfJQW2HyrrggZIaEh
M2iuyKYhQS7YChIf+yqhRF0UumIeKMxv3Coy7mwj/6o6xDiN6PZErxtsbGVJZk+w
pNCCuIP5SFe2A4YKd3DD3xU3+xtdWp+3Cwmt3zVqKkpklAA00xIqdgOUwg0uUI1i
TQLuMXba+fqPHWw=
-----END CERTIFICATE-----
`,
  key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6QDacIpfjBnna
qMykX6C/bBBEMeAaYVtKZdgn0YN917fYJevqIu6PBK9+CxK4uFZ/G3COdN/bnybL
WM9jgInVL0UffBoSdh5US15k7pnRjtB5yWIJPNIy59S7T0lGrGO+uWkr6nBTV+rQ
oUjOleyoe4D3y9LjEVjxGD6jstlzWf9ies6eR7/6evcvMYW0M/97gI7qmx6/Bg/Y
Y8dwK+sjrEK/wo/z44Q6N1jKXjzUfN6M02RvUNLj0ij9jDnziGg8lsf+VyHRvVU/
4oP9v92rfDBx29+/XIQSg320XJlUgPYAEPhJHSFkH1rJuBypx8p3gHQH/l4hETTb
rNVFR9ObAgMBAAECggEAVtfmHrtKkwLMApa+hM5KB7d9hi6zTdmjVXdTaI2agCz7
ff+AlvWewnTu1xiWrCbXvgCvZN0+HAuDbUGFweGHYy3dTybwiTcmQSu7YdiXRE0R
DBhIbAI+CJpsaMI5aoirIZ0WWvG/Wj0eMhVh+2GQraaYpfIV7OaD0Db7zhxwpAW/
R0RV7NYDONfdPyVYhdzA14s/A4YGufwxECnI4w4org+48FAmxONTbCNOm6sg91a6
+phC2++t8lo28CNmCxKuE7UpaKxuncm4d+0U044YlpJCVTsSdBJoG28yxUQymX8D
DKwckakwZBBylnA+5nj1QexyaLmYiUwrukr6qn7WUQKBgQD5pH0Rxd+ANn5WCzhT
3vxE4ACFw/DaBaBD2k11q7NYDbGGWnIfHhMA7f9Ti7+UXyO7hf6/gjdE+VwbyERv
bAObomD32RGC6vcmM+jFv3RpuB3NTpe0kq9N1bo+s5//5RuUTHtrNSGe4NMHvt8o
TNiEdS7IkctChizrSbVfRtMtzwKBgQC+/nNyz9REqumHKWnxJfujt7K3C4NlC2fh
57ZN6CI4rIUbdqWDgiOdfYXTFrHanneyAMFDZL4wsM5F0gVW1PzoBvCfShE708Ef
IeliSVQdNE3XrFgX0BkP/K/tc8kMqXjhQphn4kFtl5TZ9pEhnMF3rik4aXLzXmZy
1XvEbbrcdQKBgG3LwpZGiP5C+V2uoZ+Bu0IvowsyGoRJZStyoA7Y7ZAUtbd5oCe/
emw2QM3l8OS402ZukJR6GQTlB3XQpwi6YPvadvuLJQCHhxvuSLpwcirtJ25c2qw4
t5FsJvXc2soZYf/fg4irXZYbG7WUZWG8Kp5XS7Q7K0Ke8LKrQHIfHFJRAoGBAJ5t
/aAgS4kGaR6IOOwjQMDGkYWLFFxOAMcAaVXol/KBEQz99z/GRPrP86FtMu0RBGLw
g1//AlDraL+7/lfP51Yk45aOXwtMlObZP3obL53mFCgyOwTNxuxfBCQpJn3NWoso
rbmGkhVxZrUC9dJ28HjxTBoSRpsgFEVvVvJSv209AoGBAPFgL3vKEZ8RwqSQset9
UUed5wtayCE6G/kuKSp8NOIuf+OHCQ6U184A0P/Fv4YB/qk5C0oNUFShP9I9CYdS
9F+h2jQXvZa8VfaHvpXDS2UlUtVIG4epUYo7SSlU3AF4PRLqAoZsttELj1gw5JkA
Fm8yZNuRPGn/gJnF/NqZfkw4
-----END PRIVATE KEY-----
`,
} as const;
type ClosableNodeTestServer = {
  closeAllConnections?: () => void;
  close: (callback: (error?: Error & { code?: string }) => void) => void;
};

async function closeNodeTestServer(server: ClosableNodeTestServer): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (!error || error.code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

type ClientRequestMutationMember = "off" | "removeListener" | "emit";

async function mutateClientRequestMemberWhileRequestHoldsCredential(
  member: ClientRequestMutationMember,
  runRequest: (mutate: () => void) => Promise<void>,
): Promise<unknown> {
  const { ClientRequest } = await import("node:http");
  const original = Object.getOwnPropertyDescriptor(ClientRequest.prototype, member);
  const inherited = ClientRequest.prototype[member];
  if (typeof inherited !== "function") {
    throw new Error(`Missing ClientRequest.${member} for cleanup leak test`);
  }
  let observedAuthorization: unknown;
  const mutate = () => {
    Object.defineProperty(ClientRequest.prototype, member, {
      configurable: true,
      writable: true,
      value(this: { getHeader?: (name: string) => unknown }, ...args: unknown[]) {
        if (typeof this.getHeader === "function") {
          observedAuthorization ??= this.getHeader("authorization");
        }
        return Reflect.apply(inherited, this, args);
      },
    });
  };

  try {
    await runRequest(mutate);
    return observedAuthorization;
  } finally {
    if (original) Object.defineProperty(ClientRequest.prototype, member, original);
    else Reflect.deleteProperty(ClientRequest.prototype, member);
  }
}

describe("fetchWithPinnedAddresses", () => {
  const BEARER = "Bearer vf-pinned-bearer-41c9";

  it("refuses before copying the headers while an index accessor observes array writes", async () => {
    const probe = installArrayWriteProbe("Array.prototype index");
    try {
      await assertRejects(
        () =>
          fetchWithPinnedAddresses(new URL("http://pinned.example.test/"), ["127.0.0.1"], {
            headers: { authorization: BEARER },
          }),
        TypeError,
        "Refused a credential-bearing request",
      );
    } finally {
      probe.restore();
    }
    assertEquals(probe.saw(BEARER), false);
  });

  it("preserves Fetch null-body semantics for 204, 205, and 304", async () => {
    for (const status of [204, 205, 304]) {
      const response = createPinnedFetchResponse(
        status,
        "",
        new Headers(),
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("protocol-invalid-body"));
            controller.close();
          },
        }),
      );
      assertEquals(response.status, status);
      assertEquals(response.body, null);
      assertEquals(await response.text(), "");
    }
  });

  it("preserves HEAD null-body semantics for every response status", async () => {
    for (const status of [200, 404, 500]) {
      const response = createPinnedFetchResponse(
        status,
        "",
        new Headers({ "content-length": "21" }),
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("protocol-invalid-body"));
            controller.close();
          },
        }),
        "HEAD",
      );
      assertEquals(response.status, status);
      assertEquals(response.headers.get("content-length"), "21");
      assertEquals(response.body, null);
      assertEquals(await response.text(), "");
    }
  });

  it("fills in every request header the runtime's own fetch sends", async () => {
    // The defect this guards: the pinned transport talks to `node:http`
    // directly, so headers `fetch` supplies for free silently go missing.
    //
    // Runs on every runtime by checking the header policy rather than the
    // Node-only transport — `deno task test` is the only lane CI runs, so a
    // check gated on `isNode` would never execute. The baseline comes from a
    // live `fetch` instead of a hardcoded list, so a runtime that starts
    // sending a new default fails here rather than drifting silently.
    const { createServer } = await import("node:http");
    let runtimeSent: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      runtimeSent = request.headers;
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a TCP address");
      }
      await fetch(`http://127.0.0.1:${address.port}/baseline`, {
        method: "POST",
        body: '{"hello":"world"}',
        headers: { "content-type": "application/json" },
      });

      const defaulted = applyRuntimeDefaultRequestHeaders(
        new Headers({ "content-type": "application/json" }),
      );

      // `host` and the framing headers belong to whoever opens the socket.
      const transportOwned = new Set([
        "host",
        "connection",
        "content-length",
        "transfer-encoding",
      ]);
      // Sending more than the runtime does is harmless; sending less is the
      // regression, so assert the absence of gaps rather than an exact match.
      const missing = Object.keys(runtimeSent)
        .filter((name) => !transportOwned.has(name) && !defaulted.has(name))
        .sort();
      assertEquals(missing, []);
      assertEquals(defaulted.get("user-agent"), DEFAULT_OUTBOUND_USER_AGENT);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("uses identity for ranges and derives sec-fetch-mode from the request", async () => {
    // A compressed byte range is ambiguous for the pinned transport to decode,
    // even on runtimes such as Bun that advertise compression for native range
    // requests. Fetch metadata still follows the caller's request mode.
    const { createServer } = await import("node:http");
    const seen = new Map<string, Record<string, string | string[] | undefined>>();
    const server = createServer((request, response) => {
      seen.set(request.url ?? "", request.headers);
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a TCP address");
      }
      const origin = `http://127.0.0.1:${address.port}`;
      await fetch(`${origin}/no-cors`, { mode: "no-cors" });

      const ranged = applyRuntimeDefaultRequestHeaders(
        new Headers({ range: "bytes=0-0" }),
      );
      assertEquals(ranged.get("accept-encoding"), "identity");

      // Fetch metadata is not universal. Deno omits `sec-fetch-mode`, so
      // cross-check it only where the runtime actually emits one.
      const noCors = applyRuntimeDefaultRequestHeaders(new Headers(), "no-cors");
      const runtimeMode = seen.get("/no-cors")?.["sec-fetch-mode"];
      if (runtimeMode !== undefined) {
        assertEquals(noCors.get("sec-fetch-mode"), runtimeMode);
      }
      assertEquals(noCors.get("sec-fetch-mode"), "no-cors");

      // Unranged, default-mode requests keep the compressed-body offer.
      const plain = applyRuntimeDefaultRequestHeaders(new Headers());
      assertEquals(plain.get("accept-encoding"), "gzip, deflate");
      assertEquals(plain.get("sec-fetch-mode"), "cors");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it(
    "fills in the defaults without a patched intrinsic seeing the credential",
    DENO_INTERNALS,
    () => {
      const bearer = "Bearer vf-pinned-bearer-2e71";
      const headers = copyNativeHeaders({ authorization: bearer });
      const probes = installCredentialProbes();
      try {
        applyRuntimeDefaultRequestHeaders(headers, "cors");
      } finally {
        probes.restore();
      }

      assertEquals(probes.saw(bearer), false);
      assertEquals(headers.get("authorization"), bearer);
      assertEquals(headers.get("sec-fetch-mode"), "cors");
    },
  );

  it("keeps caller-supplied headers ahead of the runtime defaults", () => {
    const headers = applyRuntimeDefaultRequestHeaders(
      new Headers({ "user-agent": "caller/1.0", accept: "application/json" }),
    );
    assertEquals(headers.get("user-agent"), "caller/1.0");
    assertEquals(headers.get("accept"), "application/json");
    // Untouched defaults still land.
    assertEquals(headers.get("accept-encoding"), "gzip, deflate");
  });

  it("sends the origin Host header rather than the dialled address", async () => {
    // Ungated on purpose: node:http is available under Deno too, and the Node
    // lane does not run in CI, so this is the only place the wire is inspected.
    const { createServer } = await import("node:http");
    let seen: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      seen = request.headers;
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      await fetchWithPinnedAddresses(
        new URL(`http://pinned-host.test:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "GET" },
      );
      assertEquals(
        seen["host"],
        `pinned-host.test:${address.port}`,
        "the pinned transport must send the origin Host header, not the dialled IP",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("puts the defaults on the wire through the Node transport", async () => {
    if (!isNode) return;

    const { createServer } = await import("node:http");
    let seen: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      seen = request.headers;
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      await fetchWithPinnedAddresses(
        new URL(`http://127.0.0.1:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      );
      assertEquals(seen["user-agent"], DEFAULT_OUTBOUND_USER_AGENT);
      assertEquals(seen["accept"], "*/*");
      assertEquals(seen["content-type"], "application/json");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("sends a closing stream body through the pinned transport", async () => {
    const { createServer } = await import("node:http");
    let received = "";
    const server = createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        received += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(received);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }) as unknown as BodyInit;
      const response = await fetchWithPinnedAddresses(
        new URL(`http://pinned-stream.test:${address.port}/upload`),
        ["127.0.0.1"],
        { method: "POST", body },
      );
      assertEquals(response.status, 200);
      assertEquals(await response.text(), "hello");
      assertEquals(received, "hello");
    } finally {
      await closeNodeTestServer(server);
    }
  });

  it("falls through to the next validated address when the first refuses", async () => {
    if (!isNode) return;

    const { createServer } = await import("node:http");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("reached");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      // The server listens only on IPv4. The IPv6 loopback attempt fails at
      // connect time, then the second validated address serves. This keeps the
      // retry regression fast on hosts where 127.0.0.2 silently black-holes.
      const response = await fetchWithPinnedAddresses(
        new URL(`http://localhost:${address.port}/resource`),
        ["::1", "127.0.0.1"],
        { method: "GET" },
      );
      assertEquals(response.status, 200);
      assertEquals(await response.text(), "reached");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  for (
    const scenario of [
      "already aborted",
      "before registration",
      "after registration",
      "throwing reason",
      "throwing cleanup",
    ] as const
  ) {
    it(`preserves the cancellation failure with ${scenario}`, async () => {
      const controller = new AbortController();
      const reason = scenario === "throwing reason"
        ? new Error("reason unavailable")
        : new DOMException("registration stopped", "AbortError");
      if (scenario === "throwing reason") {
        Object.defineProperty(controller.signal, "reason", {
          get() {
            throw reason;
          },
        });
      }
      if (scenario === "throwing cleanup") {
        controller.signal.removeEventListener = () => {
          throw new Error("cleanup unavailable");
        };
      }
      if (scenario === "already aborted") {
        controller.abort(reason);
      } else {
        const registerListener = controller.signal.addEventListener.bind(controller.signal);
        controller.signal.addEventListener = (
          ...args: Parameters<AbortSignal["addEventListener"]>
        ) => {
          if (scenario === "before registration") controller.abort(reason);
          registerListener(...args);
          if (scenario !== "before registration") controller.abort(reason);
        };
      }
      const rejected = await assertRejects(
        () =>
          fetchWithPinnedAddresses(new URL("http://pinned-abort.test:1/resource"), ["127.0.0.1"], {
            headers: { authorization: BEARER },
            signal: controller.signal,
          }),
        Error,
        reason.message,
      );
      assertEquals(rejected, reason, "Cancellation must preserve the original failure");
    });
  }

  for (const timing of ["before", "after"] as const) {
    it(`does not create a credential request when registration aborts ${timing} installing the listener`, async () => {
      if (!isNode) return;

      const { channel } = await import("node:diagnostics_channel");
      const requests = channel("http.client.request.created");
      let createdRequests = 0;
      const observeRequest = () => {
        createdRequests++;
      };
      const controller = new AbortController();
      const registerListener = controller.signal.addEventListener.bind(controller.signal);
      controller.signal.addEventListener = (
        ...args: Parameters<AbortSignal["addEventListener"]>
      ) => {
        if (timing === "before") {
          controller.abort(new DOMException("registration stopped", "AbortError"));
        }
        registerListener(...args);
        if (timing === "after") {
          controller.abort(new DOMException("registration stopped", "AbortError"));
        }
      };
      requests.subscribe(observeRequest);
      try {
        await assertRejects(
          () =>
            fetchWithPinnedAddresses(
              new URL("http://pinned-abort.test:1/resource"),
              ["127.0.0.1"],
              {
                headers: { authorization: BEARER },
                signal: controller.signal,
              },
            ),
          DOMException,
          "registration stopped",
        );
        assertEquals(createdRequests, 0, "A synchronous abort must stop request construction");
      } finally {
        requests.unsubscribe(observeRequest);
      }
    });
  }

  for (const method of ["GET", "POST"] as const) {
    it(`closes the HTTP provider socket when an in-flight ${method} request is aborted`, async () => {
      if (!isNode) return;

      const { createServer } = await import("node:http");
      let requestSeen!: () => void;
      const seen = new Promise<void>((resolve) => {
        requestSeen = resolve;
      });
      let connectionClosed!: () => void;
      const closed = new Promise<boolean>((resolve) => {
        connectionClosed = () => resolve(true);
      });
      const server = createServer((request, _response) => {
        request.socket.once("close", connectionClosed);
        request.resume();
        requestSeen();
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing test TCP address");
        const controller = new AbortController();
        const pending = fetchWithPinnedAddresses(
          new URL(`http://pinned-abort.test:${address.port}/resource`),
          ["127.0.0.1"],
          {
            method,
            ...(method === "POST" ? { body: "payload" } : {}),
            headers: { authorization: BEARER },
            signal: controller.signal,
          },
        );
        await seen;
        const rejected = assertRejects(() => pending, DOMException, "stop");
        controller.abort(new DOMException("stop", "AbortError"));
        await rejected;
        const providerDisconnected = await Promise.race([
          closed,
          new Promise<boolean>((resolve) => {
            timeout = setTimeout(() => resolve(false), 1_500);
          }),
        ]);
        assertEquals(
          providerDisconnected,
          true,
          "Aborting must close the provider socket before cleanup",
        );
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        await closeNodeTestServer(server);
      }
    });
  }

  it("closes the HTTPS provider socket when an in-flight POST request is aborted", async () => {
    if (!isNode) return;

    const certificate = PINNED_ABORT_TEST_CERTIFICATE;

    const { createServer } = await import("node:https");
    let requestSeen!: () => void;
    const seen = new Promise<void>((resolve) => {
      requestSeen = resolve;
    });
    let connectionClosed!: () => void;
    const closed = new Promise<boolean>((resolve) => {
      connectionClosed = () => resolve(true);
    });
    const server = createServer(certificate, (request, _response) => {
      request.socket.once("close", connectionClosed);
      request.resume();
      requestSeen();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test TCP address");
      const controller = new AbortController();
      const pending = fetchWithPinnedAddresses(
        new URL(`https://pinned-abort.test:${address.port}/resource`),
        ["127.0.0.1"],
        {
          method: "POST",
          body: "payload",
          headers: { authorization: BEARER },
          signal: controller.signal,
        },
        { trustedCaCertificates: [certificate.cert] },
      );
      await seen;
      const rejected = assertRejects(() => pending, DOMException, "stop");
      controller.abort(new DOMException("stop", "AbortError"));
      await rejected;
      const providerDisconnected = await Promise.race([
        closed,
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 1_500);
        }),
      ]);
      assertEquals(
        providerDisconnected,
        true,
        "Aborting must close the provider socket before cleanup",
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      await closeNodeTestServer(server);
    }
  });

  it("does not pass credential-bearing responses through a mutated Readable.toWeb", async () => {
    if (isBun) return;

    const { createServer } = await import("node:http");
    const { Readable } = await import("node:stream");
    const originalToWeb = Object.getOwnPropertyDescriptor(Readable, "toWeb");
    const inheritedToWeb = Readable.toWeb;
    let observedAuthorization: unknown;
    let factoryWasCalled = false;
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      Object.defineProperty(Readable, "toWeb", {
        configurable: true,
        writable: true,
        value(source: { req?: { getHeader(name: string): unknown } }, ...args: unknown[]) {
          factoryWasCalled = true;
          observedAuthorization ??= source.req?.getHeader("authorization");
          return Reflect.apply(inheritedToWeb, this, [source, ...args]);
        },
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = await fetchWithPinnedAddresses(
        new URL(`http://pinned-to-web.test:${address.port}/resource`),
        ["127.0.0.1"],
        { headers: { authorization: BEARER } },
      );

      assertEquals(await response.text(), '{"ok":true}');
      assertEquals(factoryWasCalled, false);
      assertEquals(observedAuthorization, undefined);
    } finally {
      if (originalToWeb) Object.defineProperty(Readable, "toWeb", originalToWeb);
      await closeNodeTestServer(server);
    }
  });

  it("does not pipe credential-bearing compressed responses through a mutated zlib factory", async () => {
    if (!isNode) return;

    const { createServer } = await import("node:http");
    const zlib = requireNode("node:zlib") as typeof import("node:zlib");
    const originalCreateGunzip = Object.getOwnPropertyDescriptor(zlib, "createGunzip");
    const inheritedCreateGunzip = zlib.createGunzip;
    let observedAuthorization: unknown;
    let factoryWasCalled = false;
    const compressed = zlib.gzipSync(new TextEncoder().encode('{"ok":true}'));
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        "content-encoding": "gzip",
        "content-type": "application/json",
      });
      response.end(compressed);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      Object.defineProperty(zlib, "createGunzip", {
        configurable: true,
        writable: true,
        value(...args: unknown[]) {
          factoryWasCalled = true;
          const decoder = Reflect.apply(inheritedCreateGunzip, this, args);
          const originalEmit = decoder.emit;
          decoder.emit = function (
            event: string | symbol,
            source: unknown,
            ...emitArgs: unknown[]
          ) {
            if (event === "pipe" && typeof source === "object" && source !== null) {
              observedAuthorization ??= (source as {
                req?: { getHeader(name: string): unknown };
              }).req?.getHeader("authorization");
            }
            return Reflect.apply(originalEmit, this, [event, source, ...emitArgs]);
          };
          return decoder;
        },
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = await fetchWithPinnedAddresses(
        new URL(`http://pinned-gzip.test:${address.port}/resource`),
        ["127.0.0.1"],
        { headers: { authorization: BEARER } },
      );

      assertEquals(await response.text(), '{"ok":true}');
      assertEquals(factoryWasCalled, false);
      assertEquals(observedAuthorization, undefined);
    } finally {
      if (originalCreateGunzip) Object.defineProperty(zlib, "createGunzip", originalCreateGunzip);
      await closeNodeTestServer(server);
    }
  });

  it("does not invoke a mutated request destroy during late abort teardown", async () => {
    const { ClientRequest, createServer } = await import("node:http");
    let releaseRequest!: () => void;
    const requestSeen = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const server = createServer((request, _response) => {
      request.resume();
      releaseRequest();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const originalDestroy = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "destroy");
    const inheritedDestroy = ClientRequest.prototype.destroy;
    let observedAuthorization: unknown;
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const abort = new AbortController();
      const response = fetchWithPinnedAddresses(
        new URL(`http://pinned-abort.test:${address.port}/resource`),
        ["127.0.0.1"],
        { headers: { authorization: BEARER }, signal: abort.signal },
      );
      await requestSeen;

      Object.defineProperty(ClientRequest.prototype, "destroy", {
        configurable: true,
        writable: true,
        ...originalDestroy,
        value(this: { getHeader(name: string): unknown }, ...args: unknown[]) {
          observedAuthorization ??= this.getHeader("authorization");
          return Reflect.apply(inheritedDestroy, this, args);
        },
      });

      abort.abort(new DOMException("stop", "AbortError"));
      let rejected = false;
      try {
        await response;
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
      assertEquals(observedAuthorization, undefined);
    } finally {
      if (originalDestroy) {
        Object.defineProperty(ClientRequest.prototype, "destroy", originalDestroy);
      } else Reflect.deleteProperty(ClientRequest.prototype, "destroy");
      await closeNodeTestServer(server);
    }
  });

  it("stops the request with captured destroy when late abort rejects a changed destroy", async () => {
    if (!isNode) return;

    const { ClientRequest, createServer } = await import("node:http");
    let requestCount = 0;
    const server = createServer((request, response) => {
      requestCount++;
      request.resume();
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
      },
    }) as unknown as BodyInit;
    const originalDestroy = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "destroy");
    const inheritedDestroy = ClientRequest.prototype.destroy;
    let observedAuthorization: unknown;
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const abort = new AbortController();
      const response = fetchWithPinnedAddresses(
        new URL(`http://pinned-abort-stop.test:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: BEARER }, signal: abort.signal, body },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      Object.defineProperty(ClientRequest.prototype, "destroy", {
        configurable: true,
        writable: true,
        ...originalDestroy,
        value(this: { getHeader(name: string): unknown }, ...args: unknown[]) {
          observedAuthorization ??= this.getHeader("authorization");
          return Reflect.apply(inheritedDestroy, this, args);
        },
      });
      abort.abort(new DOMException("stop", "AbortError"));
      await response.catch(() => undefined);

      if (originalDestroy) {
        Object.defineProperty(ClientRequest.prototype, "destroy", originalDestroy);
      } else Reflect.deleteProperty(ClientRequest.prototype, "destroy");
      bodyController.enqueue(new TextEncoder().encode("late"));
      bodyController.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      assertEquals(observedAuthorization, undefined);
      assertEquals(requestCount, 0);
    } finally {
      if (originalDestroy) {
        Object.defineProperty(ClientRequest.prototype, "destroy", originalDestroy);
      } else Reflect.deleteProperty(ClientRequest.prototype, "destroy");
      await closeNodeTestServer(server);
    }
  });

  it("does not expose credentials to mutated request cleanup members after a stream pull", async () => {
    if (isBun) return;

    for (const member of ["off", "removeListener", "emit"] as const) {
      const { createServer } = await import("node:http");
      const encoder = new TextEncoder();
      let releaseFirstReceipt!: () => void;
      const firstReceipt = new Promise<void>((resolve) => {
        releaseFirstReceipt = resolve;
      });
      const server = createServer((request, _response) => {
        request.once("data", () => releaseFirstReceipt());
        request.resume();
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      let continueSecondPull!: () => void;
      const secondPullReady = new Promise<void>((resolve) => {
        continueSecondPull = resolve;
      });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("first"));
        },
        async pull(controller) {
          await firstReceipt;
          await secondPullReady;
          controller.enqueue(encoder.encode("second"));
          controller.close();
        },
      }) as unknown as BodyInit;

      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Node test server did not expose a TCP address");
        }
        const observedAuthorization = await mutateClientRequestMemberWhileRequestHoldsCredential(
          member,
          async (mutate) => {
            const response = fetchWithPinnedAddresses(
              new URL(`http://pinned-cleanup-${member}.test:${address.port}/upload`),
              ["127.0.0.1"],
              { method: "POST", headers: { authorization: BEARER }, body },
            );
            await firstReceipt;
            mutate();
            continueSecondPull();
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              const result = await Promise.race([
                response.then(
                  async (response) => {
                    await response.body?.cancel();
                    return "resolved";
                  },
                  (error) => error instanceof Error ? error.message : String(error),
                ),
                new Promise<string>((resolve) => {
                  timeout = setTimeout(() => resolve("timeout"), 1_500);
                }),
              ]);
              assertEquals(result.includes(member), true);
              await response.then(
                async (response) => {
                  await response.text();
                },
                () => undefined,
              );
            } finally {
              if (timeout !== undefined) clearTimeout(timeout);
            }
          },
        );
        assertEquals(observedAuthorization, undefined);
      } finally {
        await closeNodeTestServer(server);
      }
    }
  });

  it("rejects guard failures without waiting for body cancellation to finish", async () => {
    const { ClientRequest, createServer } = await import("node:http");
    const server = createServer((request, _response) => {
      request.resume();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const mutationMember = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "setHeader")
        ?.value !== undefined
      ? "setHeader"
      : "setTimeout";
    const originalMember = Object.getOwnPropertyDescriptor(
      ClientRequest.prototype,
      mutationMember,
    );
    if (originalMember?.value === undefined) {
      await closeNodeTestServer(server);
      throw new Error(`Missing test mutation member: ${mutationMember}`);
    }

    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    let releaseBodyPull!: () => void;
    const bodyPullStarted = new Promise<void>((resolve) => {
      releaseBodyPull = resolve;
    });
    let cancelStarted = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(new Uint8Array(1024));
      },
      pull() {
        releaseBodyPull();
        return new Promise(() => {});
      },
      cancel() {
        cancelStarted = true;
        return new Promise(() => {});
      },
    }) as unknown as BodyInit;

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = fetchWithPinnedAddresses(
        new URL(`http://pinned-cancel.test:${address.port}/upload`),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: BEARER }, body },
      );
      await bodyPullStarted;

      Object.defineProperty(ClientRequest.prototype, mutationMember, {
        configurable: true,
        writable: true,
        ...originalMember,
        value(this: unknown, ...args: unknown[]) {
          return Reflect.apply(originalMember.value, this, args);
        },
      });
      bodyController.enqueue(new Uint8Array(1024));

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        response.then(
          () => "resolved",
          (error) => error instanceof Error ? error.message : String(error),
        ),
        new Promise<string>((resolve) => {
          timeout = setTimeout(() => resolve("timeout"), 250);
        }),
      ]);
      if (timeout !== undefined) clearTimeout(timeout);
      assertEquals(result.includes(mutationMember), true);
      assertEquals(cancelStarted, true);
    } finally {
      Object.defineProperty(ClientRequest.prototype, mutationMember, originalMember);
      await closeNodeTestServer(server);
    }
  });

  it("does not invoke a mutated request destroy during payload error teardown", async () => {
    if (isBun) return;

    const { ClientRequest, createServer } = await import("node:http");
    const encoder = new TextEncoder();
    let releaseRequest!: () => void;
    const requestSeen = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const server = createServer((request, _response) => {
      request.resume();
      releaseRequest();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(encoder.encode("prefix"));
      },
    }) as unknown as BodyInit;
    const originalDestroy = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "destroy");
    const inheritedDestroy = ClientRequest.prototype.destroy;
    let observedAuthorization: unknown;
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = fetchWithPinnedAddresses(
        new URL(`http://pinned-payload.test:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: BEARER }, body },
      );
      await requestSeen;

      Object.defineProperty(ClientRequest.prototype, "destroy", {
        configurable: true,
        writable: true,
        ...originalDestroy,
        value(this: { getHeader(name: string): unknown }, ...args: unknown[]) {
          observedAuthorization ??= this.getHeader("authorization");
          return Reflect.apply(inheritedDestroy, this, args);
        },
      });

      bodyController.error(new Error("body failed"));
      let rejected = false;
      try {
        await response;
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
      assertEquals(observedAuthorization, undefined);
    } finally {
      if (originalDestroy) {
        Object.defineProperty(ClientRequest.prototype, "destroy", originalDestroy);
      } else Reflect.deleteProperty(ClientRequest.prototype, "destroy");
      await closeNodeTestServer(server);
    }
  });

  it("returns a null body for HEAD through the native Node transport", async () => {
    if (!isNode) return;

    const { createServer } = await import("node:http");
    let seenMethod: string | undefined;
    const server = createServer((request, response) => {
      seenMethod = request.method;
      response.writeHead(200, {
        "content-length": "21",
        "content-type": "text/plain",
      });
      response.end("protocol-invalid-body");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Node test server did not expose a TCP address");
      }
      const response = await fetchWithPinnedAddresses(
        new URL(`http://pinned-head.test:${address.port}/resource`),
        ["127.0.0.1"],
        { method: "HEAD" },
      );
      assertEquals(seenMethod, "HEAD");
      assertEquals(response.status, 200);
      assertEquals(response.headers.get("content-length"), "21");
      assertEquals(response.body, null);
      assertEquals(await response.text(), "");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

describe("pinned connect attempts", () => {
  it("keeps a single validated address as one attempt", () => {
    assertEquals(planPinnedConnectAttempts(["203.0.113.7"]), [["203.0.113.7"]]);
  });

  it("dials one address per attempt", () => {
    // Every attempt dials one address; the runtime is never asked to choose.
    const plan = planPinnedConnectAttempts(["2606:4700::1", "104.26.14.209"]);
    assertEquals(plan[0], ["2606:4700::1"]);
    assertEquals(plan.length, 2);
    assertEquals(plan[1], ["104.26.14.209"]);
  });

  it("tries the other address family before a sibling of the failed one", () => {
    const plan = planPinnedConnectAttempts([
      "2606:4700::1",
      "2606:4700::2",
      "104.26.14.209",
    ]);
    // A host with no IPv6 route fails on both AAAA records, so the A record has
    // to come before the second AAAA.
    assertEquals(plan[1], ["104.26.14.209"]);
    assertEquals(plan[2], ["2606:4700::2"]);
  });

  it("retries only connect-level failures", () => {
    assertEquals(isRetriableConnectFailure({ code: "ECONNREFUSED" }), true);
    assertEquals(isRetriableConnectFailure({ code: "ENETUNREACH" }), true);
    assertEquals(isRetriableConnectFailure({ code: "ECONNRESET" }), false);
    assertEquals(isRetriableConnectFailure(new Error("boom")), false);
    assertEquals(isRetriableConnectFailure(null), false);
  });

  it("retries ETIMEDOUT only when it came from connect", () => {
    // A socket timeout after the request was written carries the same code, and
    // replaying it could deliver a non-idempotent request twice.
    assertEquals(
      isRetriableConnectFailure({ code: "ETIMEDOUT", syscall: "connect" }),
      true,
    );
    assertEquals(
      isRetriableConnectFailure({ code: "ETIMEDOUT", syscall: "read" }),
      false,
    );
    assertEquals(isRetriableConnectFailure({ code: "ETIMEDOUT" }), false);
  });

  it("replays only bodies that re-read identically", () => {
    assertEquals(isReplayableRequestBody(null), true);
    assertEquals(isReplayableRequestBody("{}"), true);
    assertEquals(isReplayableRequestBody(new Uint8Array([1, 2])), true);
    assertEquals(isReplayableRequestBody(new URLSearchParams("a=1")), true);
    // Immutable, and writeRequestBody takes a fresh body.stream() per attempt.
    assertEquals(isReplayableRequestBody(new Blob(["x"])), true);
    // Already drained by the attempt that failed, so a retry would send nothing.
    assertEquals(
      isReplayableRequestBody(new Blob(["x"]).stream() as unknown as BodyInit),
      false,
    );
  });
});
