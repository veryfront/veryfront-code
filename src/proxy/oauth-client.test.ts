import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../tests/_helpers/utils.ts";

describe("OAuth Client", () => {
  describe("fetchOAuthToken", () => {
    it("throws on timeout", async () => {
      // Import dynamically to avoid side effects
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      await assertRejects(
        () =>
          fetchOAuthToken({
            apiBaseUrl: "http://10.255.255.1", // Non-routable IP to force timeout
            apiClientId: "test",
            apiClientSecret: "test",
            timeoutMs: 100,
          }),
        Error,
        "timed out",
      );
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
  });
});
