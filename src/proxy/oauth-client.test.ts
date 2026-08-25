import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { stub } from "#std/testing/mock";
import { createMockServer } from "../../tests/_helpers/utils.ts";

describe("OAuth Client", () => {
  describe("fetchOAuthToken", () => {
    it("throws on timeout", async () => {
      // Import dynamically to avoid side effects
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      // A request that never answers, rather than a non-routable address. The
      // deadline is then the test's own abort signal instead of the host's TCP
      // behaviour, so this needs no egress and cannot vary by machine.
      const neverAnswers: typeof globalThis.fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = observeFetchRequestInit(init).signal;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The signal has been aborted", "AbortError")),
            { once: true },
          );
        });

      await withMockFetch(neverAnswers, async () => {
        await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: "http://127.0.0.1",
              apiClientId: "test",
              apiClientSecret: "test",
              timeoutMs: 100,
            }),
          Error,
          "timed out",
        );
      });
    });

    it("throws on HTTP error", async () => {
      const { fetchOAuthToken, OAuthTokenRequestError } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () => new Response("Unauthorized", { status: 401 }),
      );

      try {
        await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiClientId: "test",
              apiClientSecret: "test",
            }),
          OAuthTokenRequestError,
          "401",
        );
      } finally {
        await server.shutdown();
      }
    });

    it("exposes HTTP status and response text on token request errors", async () => {
      const { fetchOAuthToken, OAuthTokenRequestError } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () => new Response("Project missing", { status: 404 }),
      );

      try {
        const error = await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiClientId: "test",
              apiClientSecret: "test",
            }),
          OAuthTokenRequestError,
        );

        if (!(error instanceof OAuthTokenRequestError)) {
          throw new Error("Expected OAuthTokenRequestError");
        }
        assertEquals(error.status, 404);
        assertEquals(error.responseText, "Project missing");
      } finally {
        await server.shutdown();
      }
    });

    it("parses successful response", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () =>
          new Response(
            JSON.stringify({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      );

      try {
        const result = await fetchOAuthToken({
          apiBaseUrl: `http://127.0.0.1:${port}`,
          apiClientId: "test",
          apiClientSecret: "test",
        });

        assertEquals(result.access_token, "test-token");
        assertEquals(result.token_type, "Bearer");
        assertEquals(result.expires_in, 3600);
      } finally {
        await server.shutdown();
      }
    });

    it("rejects malformed successful responses", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () =>
          Response.json({
            access_token: "test-token",
            token_type: "Basic",
            expires_in: 3600,
          }),
      );

      try {
        await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiClientId: "test",
              apiClientSecret: "test",
            }),
          TypeError,
          "invalid token response",
        );
      } finally {
        await server.shutdown();
      }
    });

    it("settles an invalid response body before returning its failure", async () => {
      const cancellationGate = Promise.withResolvers<void>();
      const cancellationStarted = Promise.withResolvers<void>();
      using _fetch = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                cancel() {
                  cancellationStarted.resolve();
                  return cancellationGate.promise;
                },
              }),
              { headers: { "Content-Type": "text/plain" } },
            ),
          ),
      );
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      const request = fetchOAuthToken({
        apiBaseUrl: "https://api.example.test",
        apiClientId: "test",
        apiClientSecret: "test",
      });
      await cancellationStarted.promise;

      let settled = false;
      void request.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await Promise.resolve();
      const settledBeforeCancellation = settled;

      cancellationGate.resolve();
      await assertRejects(
        () => request,
        TypeError,
        "invalid token response",
      );
      assertEquals(settledBeforeCancellation, false);
    });

    it("rejects an oversized successful response before JSON parsing", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () =>
          new Response("x", {
            headers: {
              "Content-Type": "application/json",
              "Content-Length": String(128 * 1024 + 1),
            },
          }),
      );

      try {
        await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiClientId: "test",
              apiClientSecret: "test",
            }),
          Error,
          "too-large",
        );
      } finally {
        await server.shutdown();
      }
    });

    it("bounds and sanitizes upstream error text", async () => {
      const { fetchOAuthToken, OAuthTokenRequestError } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () =>
          new Response(
            `client_secret=do-not-log https://user:password@example.test/${"x".repeat(20_000)}`,
            { status: 401 },
          ),
      );

      try {
        const error = await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiClientId: "test",
              apiClientSecret: "test",
            }),
          OAuthTokenRequestError,
        );
        if (!(error instanceof OAuthTokenRequestError)) {
          throw new Error("Expected OAuthTokenRequestError");
        }
        assertEquals(error.responseText, "OAuth error response exceeded the supported size");
      } finally {
        await server.shutdown();
      }
    });

    it("rejects non-HTTP API bases and unsafe timeout policy", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      await assertRejects(
        () =>
          fetchOAuthToken({
            apiBaseUrl: "file:///tmp",
            apiClientId: "test",
            apiClientSecret: "test",
          }),
        TypeError,
        "HTTP(S)",
      );
      await assertRejects(
        () =>
          fetchOAuthToken({
            apiBaseUrl: "https://api.example.test",
            apiClientId: "test",
            apiClientSecret: "test",
            timeoutMs: Number.POSITIVE_INFINITY,
          }),
        RangeError,
        "timeout",
      );
    });

    it("preserves primitive caller abort reasons before the request starts", async () => {
      using _fetch = stub(
        globalThis,
        "fetch",
        (_input, init) => Promise.reject(observeFetchRequestInit(init).signal?.reason),
      );
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const controller = new AbortController();
      controller.abort("caller cancelled token request");

      const error = await assertRejects(
        () =>
          fetchOAuthToken({
            apiBaseUrl: "https://api.example.test",
            apiClientId: "test",
            apiClientSecret: "test",
            signal: controller.signal,
          }),
        DOMException,
        "caller cancelled token request",
      );

      if (!(error instanceof DOMException)) {
        throw new Error("Expected a DOMException abort reason");
      }
      assertEquals(error.name, "AbortError");
    });

    it("preserves primitive caller abort reasons while reading an error response", async () => {
      const readStarted = Promise.withResolvers<void>();
      using _fetch = stub(
        globalThis,
        "fetch",
        () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                pull() {
                  readStarted.resolve();
                },
              }),
              { status: 503 },
            ),
          ),
      );
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const controller = new AbortController();
      const request = fetchOAuthToken({
        apiBaseUrl: "https://api.example.test",
        apiClientId: "test",
        apiClientSecret: "test",
        signal: controller.signal,
      });
      await readStarted.promise;
      controller.abort("caller cancelled response read");

      const error = await assertRejects(
        () => request,
        DOMException,
        "caller cancelled response read",
      );

      if (!(error instanceof DOMException)) {
        throw new Error("Expected a DOMException abort reason");
      }
      assertEquals(error.name, "AbortError");
    });

    it("keeps the timeout authoritative when a caller abort arrives later", async () => {
      const fetchAborted = Promise.withResolvers<void>();
      using _fetch = stub(
        globalThis,
        "fetch",
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = observeFetchRequestInit(init).signal;
            if (!signal) throw new Error("Expected an OAuth request abort signal");
            signal.addEventListener(
              "abort",
              () => {
                fetchAborted.resolve();
                setTimeout(() => reject(signal.reason), 0);
              },
              { once: true },
            );
          }),
      );
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const controller = new AbortController();
      const request = fetchOAuthToken({
        apiBaseUrl: "https://api.example.test",
        apiClientId: "test",
        apiClientSecret: "test",
        timeoutMs: 1,
        signal: controller.signal,
      });
      await fetchAborted.promise;
      controller.abort("late caller cancellation");

      await assertRejects(
        () => request,
        Error,
        "timed out after 1ms",
      );
    });
  });
});
