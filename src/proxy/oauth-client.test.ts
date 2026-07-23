import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../tests/_helpers/utils.ts";

describe("OAuth Client", () => {
  describe("fetchOAuthToken", () => {
    it("throws on timeout without relying on an external network", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      let bodyTimer: ReturnType<typeof setTimeout> | undefined;
      const { server, port } = createMockServer(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                bodyTimer = setTimeout(() => {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({
                        access_token: "late-token",
                        token_type: "Bearer",
                        expires_in: 60,
                      }),
                    ),
                  );
                  controller.close();
                }, 75);
              },
              cancel() {
                if (bodyTimer !== undefined) clearTimeout(bodyTimer);
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      );

      try {
        await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://127.0.0.1:${port}`,
              apiClientId: "test",
              apiClientSecret: "test",
              timeoutMs: 20,
            }),
          Error,
          "timed out",
        );
      } finally {
        await server.shutdown();
      }
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

    it("exposes status without leaking the upstream response body", async () => {
      const { fetchOAuthToken, OAuthTokenRequestError } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () => new Response("client_secret=do-not-expose customer payload", { status: 404 }),
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
        assertEquals(error.responseText, "HTTP 404");
        assertEquals(error.message.includes("do-not-expose"), false);
        assertEquals(error.responseText.includes("customer payload"), false);
      } finally {
        await server.shutdown();
      }
    });

    it("derives an allowlisted reason from bounded structured errors", async () => {
      const { fetchOAuthToken, OAuthTokenRequestError } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () =>
          new Response(
            JSON.stringify({
              error: "Project not found for domain",
              internal_detail: "must-not-be-retained",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
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
        assertEquals(
          (error as InstanceType<typeof OAuthTokenRequestError>).reason,
          "project-not-found-for-domain",
        );
        assertEquals((error as Error).message.includes("must-not-be-retained"), false);
      } finally {
        await server.shutdown();
      }
    });

    it("does not classify or retain oversized structured error bodies", async () => {
      const { fetchOAuthToken, OAuthTokenRequestError } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () =>
          new Response(
            JSON.stringify({
              error: "Project not found for domain",
              padding: "x".repeat(9 * 1_024),
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
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
        assertEquals((error as InstanceType<typeof OAuthTokenRequestError>).reason, undefined);
        assertEquals(
          (error as InstanceType<typeof OAuthTokenRequestError>).responseText,
          "HTTP 400",
        );
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

    it("normalizes a trailing base-URL slash", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      let pathname = "";
      const { server, port } = createMockServer((request) => {
        pathname = new URL(request.url).pathname;
        return new Response(
          JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 60 }),
          { headers: { "Content-Type": "application/json" } },
        );
      });

      try {
        await fetchOAuthToken({
          apiBaseUrl: `http://127.0.0.1:${port}/`,
          apiClientId: "test",
          apiClientSecret: "test",
        });
        assertEquals(pathname, "/auth/token");
      } finally {
        await server.shutdown();
      }
    });

    it("rejects redirects instead of forwarding client credentials", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      let redirectedRequests = 0;
      const target = createMockServer(() => {
        redirectedRequests++;
        return new Response("unexpected");
      });
      const source = createMockServer(
        () =>
          new Response(null, {
            status: 307,
            headers: { location: `http://127.0.0.1:${target.port}/capture` },
          }),
      );

      try {
        await assertRejects(() =>
          fetchOAuthToken({
            apiBaseUrl: `http://127.0.0.1:${source.port}`,
            apiClientId: "test",
            apiClientSecret: "test",
          })
        );
        assertEquals(redirectedRequests, 0);
      } finally {
        await source.server.shutdown();
        await target.server.shutdown();
      }
    });

    it("does not expose connection details through network errors", async () => {
      const { fetchOAuthToken, OAuthTokenNetworkError } = await import("./oauth-client.ts");
      const unavailable = createMockServer(() => new Response("unused"));
      const port = unavailable.port;
      await unavailable.server.shutdown();

      const error = await assertRejects(
        () =>
          fetchOAuthToken({
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiClientId: "test",
            apiClientSecret: "test",
          }),
        OAuthTokenNetworkError,
      );
      assertEquals((error as Error).message, "OAuth token request could not be completed");
      assertEquals((error as Error).message.includes(String(port)), false);
    });

    it("rejects malformed and oversized successful responses", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const responses = [
        { token_type: "Bearer", expires_in: 60 },
        { access_token: "token", token_type: "Basic", expires_in: 60 },
        { access_token: "token", token_type: "Bearer", expires_in: -1 },
        { access_token: "x".repeat(65_537), token_type: "Bearer", expires_in: 60 },
        { access_token: "token with whitespace", token_type: "Bearer", expires_in: 60 },
      ];
      const { server, port } = createMockServer(
        () =>
          new Response(JSON.stringify(responses.shift()), {
            headers: { "Content-Type": "application/json" },
          }),
      );

      try {
        for (let index = 0; index < 5; index++) {
          await assertRejects(
            () =>
              fetchOAuthToken({
                apiBaseUrl: `http://127.0.0.1:${port}`,
                apiClientId: "test",
                apiClientSecret: "test",
              }),
            TypeError,
            "Invalid OAuth token response",
          );
        }
      } finally {
        await server.shutdown();
      }
    });

    it("stops at the successful-response byte limit", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");
      const { server, port } = createMockServer(
        () =>
          new Response("x".repeat(129 * 1_024), {
            headers: { "Content-Type": "application/json" },
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
          "size limit",
        );
      } finally {
        await server.shutdown();
      }
    });

    it("rejects invalid URLs, credentials, and timeout settings before fetching", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      for (
        const apiBaseUrl of [
          "file:///tmp/oauth",
          "https://user:password@example.com",
          "https://example.com?token=value",
        ]
      ) {
        await assertRejects(
          () => fetchOAuthToken({ apiBaseUrl, apiClientId: "test", apiClientSecret: "test" }),
          TypeError,
          "apiBaseUrl",
        );
      }
      await assertRejects(() =>
        fetchOAuthToken({
          apiBaseUrl: "https://example.com",
          apiClientId: "",
          apiClientSecret: "test",
        })
      );
      await assertRejects(() =>
        fetchOAuthToken({
          apiBaseUrl: "https://example.com",
          apiClientId: "test",
          apiClientSecret: "test",
          timeoutMs: 0,
        })
      );
      await assertRejects(() =>
        fetchOAuthToken({
          apiBaseUrl: "https://example.com",
          apiClientId: "test",
          apiClientSecret: "test",
          timeoutMs: 300_001,
        })
      );
    });
  });
});
